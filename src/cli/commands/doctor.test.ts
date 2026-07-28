/**
 * Unit tests for `buddy doctor`.
 *
 * Covers the fully healthy checklist, partial hook coverage rendered as a
 * warning, the expected failure path, and the shared human/quiet/JSON modes.
 * The command must never call console.* or process.exit — failures travel as a
 * typed `CliError` the entry boundary renders.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isCliError, type CliError } from '../result.js'
import { configureOutput, renderFailure, renderResult, resetOutputContext } from '../output.js'

const {
  mockExecSync,
  mockExistsSync,
  mockGetHooksStatus,
  mockHttpGet,
  mockIsWSL,
  mockResolveElectronBin,
  mockResolvePackageRoot,
  mockSidecarBaseUrl,
} = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
  mockExistsSync: vi.fn(),
  mockGetHooksStatus: vi.fn(),
  mockHttpGet: vi.fn(),
  mockIsWSL: vi.fn(),
  mockResolveElectronBin: vi.fn(),
  mockResolvePackageRoot: vi.fn(),
  mockSidecarBaseUrl: vi.fn(),
}))

vi.mock('child_process', () => ({ execSync: mockExecSync }))
vi.mock('fs', () => ({ default: { existsSync: mockExistsSync }, existsSync: mockExistsSync }))
vi.mock('http', () => ({ default: { get: mockHttpGet }, get: mockHttpGet }))
vi.mock('../../main/hooks-install.js', () => ({ getHooksStatus: mockGetHooksStatus }))
vi.mock('../env.js', () => ({ isWSL: mockIsWSL, sidecarBaseUrl: mockSidecarBaseUrl }))
vi.mock('../runtime.js', () => ({
  resolveElectronBin: mockResolveElectronBin,
  resolvePackageRoot: mockResolvePackageRoot,
}))

const ALL_HOOKS = {
  'claude-code:PreToolUse': true,
  'claude-code:Stop': true,
  'codex-cli:PreToolUse': true,
  'codex-cli:Stop': true,
}

const PARTIAL_HOOKS = {
  'claude-code:PreToolUse': true,
  'claude-code:Stop': true,
  'codex-cli:PreToolUse': false,
  'codex-cli:Stop': false,
}

/** Resolve the health probe with a status code. */
function healthResponds(statusCode: number): void {
  mockHttpGet.mockImplementation((_url: string, cb: (res: unknown) => void) => {
    cb({ statusCode, resume: () => undefined })
    return { on: () => undefined, setTimeout: () => undefined, destroy: () => undefined }
  })
}

/** Fail the health probe the way a refused connection does. */
function healthUnreachable(): void {
  mockHttpGet.mockImplementation(() => ({
    on: (event: string, handler: (err: Error) => void) => {
      if (event === 'error') handler(new Error('ECONNREFUSED'))
    },
    setTimeout: () => undefined,
    destroy: () => undefined,
  }))
}

/** Run doctor and return the typed failure it threw. */
async function doctorFailure(): Promise<CliError> {
  const { runDoctor } = await import('./doctor.js')
  try {
    await runDoctor()
  } catch (err) {
    return err as CliError
  }
  throw new Error('Expected runDoctor() to throw a CliError')
}

/** Capture everything a renderer writes to stdout. */
function capture(options = {}): string[] {
  const chunks: string[] = []
  configureOutput({
    color: false,
    stdout: { write: (chunk: string) => chunks.push(chunk) },
    stderr: { write: () => true },
    ...options,
  })
  return chunks
}

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  mockIsWSL.mockReturnValue(false)
  mockSidecarBaseUrl.mockReturnValue('http://127.0.0.1:7777')
  mockResolveElectronBin.mockReturnValue('C:\\pkg\\node_modules\\electron\\dist\\electron.exe')
  mockResolvePackageRoot.mockReturnValue('C:\\pkg')
  mockExecSync.mockReturnValue('buddy.exe  4242 Console  1  120,000 K')
  mockExistsSync.mockReturnValue(true)
  mockGetHooksStatus.mockReturnValue(ALL_HOOKS)
  healthResponds(200)
  resetOutputContext()
})

afterEach(() => {
  resetOutputContext()
})

describe('runDoctor()', () => {
  it('returns a passing typed result when every check succeeds', async () => {
    const { runDoctor } = await import('./doctor.js')

    const result = await runDoctor()

    expect(result.command).toBe('app.doctor')
    expect(result.summary).toBe('All checks passed.')
    expect(result.data).toMatchObject({ ok: true, passed: 5, total: 5, environment: 'windows' })
    expect(result.checks?.every((entry) => entry.status === 'pass')).toBe(true)
    expect(mockGetHooksStatus).toHaveBeenCalledWith(expect.objectContaining({ runtime: 'windows' }))
  })

  it('reports partial hook coverage as a warning with the install command', async () => {
    mockGetHooksStatus.mockReturnValue(PARTIAL_HOOKS)

    const error = await doctorFailure()
    const hooks = error.checks?.find((entry) => entry.label.startsWith('Hooks'))

    expect(hooks).toMatchObject({ label: 'Hooks installed (2/4)', status: 'warn' })
    expect(hooks?.detail).toContain('buddy hooks install')
    expect(hooks?.items).toHaveLength(4)
    // Degraded coverage still leaves the run unhealthy, so the exit stays non-zero.
    expect(error.code).toBe('doctor.checks_failed')
    expect(error.exitCode).toBe(1)
  })

  it('fails with a typed error naming the first recovery command', async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('tasklist not found')
    })
    healthUnreachable()

    const error = await doctorFailure()

    expect(isCliError(error)).toBe(true)
    expect(error.code).toBe('doctor.checks_failed')
    expect(error.message).toBe('Some checks failed (3/5 passed).')
    expect(error.hint).toBe('Start the app: buddy start')
    expect(error.data).toMatchObject({ ok: false, passed: 3, total: 5 })
  })

  it('reports a missing Electron runtime with the reinstall command', async () => {
    mockResolveElectronBin.mockReturnValue(null)

    const error = await doctorFailure()
    const runtime = error.checks?.[0]

    expect(runtime).toMatchObject({ label: 'Electron runtime available', status: 'fail' })
    expect(runtime?.detail).toContain('C:\\pkg')
    expect(runtime?.detail).toContain('npm install -g @ag9898/buddy')
  })

  it('detects the WSL environment and probes through cmd.exe', async () => {
    mockIsWSL.mockReturnValue(true)
    const { runDoctor } = await import('./doctor.js')

    const result = await runDoctor()

    expect(result.data.environment).toBe('wsl')
    expect(String(mockExecSync.mock.calls[0]?.[0])).toContain('cmd.exe /c tasklist')
    expect(mockGetHooksStatus).toHaveBeenCalledWith(expect.objectContaining({ runtime: 'wsl' }))
  })

  it('renders the checklist in normal and quiet modes and one payload in JSON', async () => {
    const { runDoctor } = await import('./doctor.js')
    const result = await runDoctor()

    const normal = capture()
    renderResult(result)
    const humanOutput = normal.join('')
    expect(humanOutput).toContain('buddy doctor')
    expect(humanOutput).toContain('Electron process running')
    expect(humanOutput).toContain('claude-code:PreToolUse')
    expect(humanOutput).toContain('All checks passed.')
    expect(humanOutput).not.toContain('\x1b[')

    // Quiet keeps the rows but drops the heading and separators.
    const quiet = capture({ mode: 'quiet' })
    renderResult(result)
    const quietOutput = quiet.join('')
    expect(quietOutput).toContain('Electron process running')
    expect(quietOutput).not.toContain('buddy doctor')
    expect(quietOutput).not.toContain('─')

    const json = capture({ json: true })
    renderResult(result)
    const payload = JSON.parse(json.join('')) as { ok: boolean; command: string }
    expect(payload).toMatchObject({ ok: true, command: 'app.doctor' })
    expect(json.join('')).not.toContain('All checks passed.')
    expect(json.join('').trim().split('\n')).toHaveLength(1)
  })

  it('renders failed checks before the error line and one JSON failure payload', async () => {
    mockExistsSync.mockReturnValue(false)
    const error = await doctorFailure()

    const human = capture()
    renderFailure(error, 'app.doctor')
    expect(human.join('')).toContain('Update token file exists')

    const json = capture({ json: true })
    const exitCode = renderFailure(error, 'app.doctor')
    const payload = JSON.parse(json.join('')) as {
      ok: boolean
      error: { code: string; data: { passed: number } }
    }
    expect(exitCode).toBe(1)
    expect(payload.ok).toBe(false)
    expect(payload.error.code).toBe('doctor.checks_failed')
    expect(payload.error.data.passed).toBe(4)
    // JSON stdout stays exactly one payload line.
    expect(json.join('').trim().split('\n')).toHaveLength(1)
  })
})
