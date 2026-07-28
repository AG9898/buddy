/**
 * Unit tests for the `buddy hooks` lifecycle: install, status, and uninstall.
 *
 * Covers a complete install, an idempotent re-run, partial per-target coverage
 * rendered as a warning, read-only status reporting, buddy-owned removal, and
 * the expected failure paths. Install/detect/remove semantics live in
 * `src/main/hooks-install.ts` and stay mocked here: these tests assert only the
 * typed results and their shared rendering.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isCliError, type CliError } from '../result.js'
import { configureOutput, renderFailure, renderResult, resetOutputContext } from '../output.js'

const { mockInstallHooks, mockGetHooksStatus, mockUninstallHooks, mockIsWSL } = vi.hoisted(() => ({
  mockInstallHooks: vi.fn(),
  mockGetHooksStatus: vi.fn(),
  mockUninstallHooks: vi.fn(),
  mockIsWSL: vi.fn(),
}))

vi.mock('../../main/hooks-install.js', () => ({
  installHooks: mockInstallHooks,
  getHooksStatus: mockGetHooksStatus,
  uninstallHooks: mockUninstallHooks,
}))
vi.mock('../env.js', () => ({ isWSL: mockIsWSL }))

const EVENTS = ['PreToolUse', 'Stop']
const entriesFor = (target: string): string[] => EVENTS.map((event) => `${target}:${event}`)

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
  resetOutputContext()
})

afterEach(() => {
  resetOutputContext()
})

describe('runHooksInstall()', () => {
  it('reports a complete install for both assistants', async () => {
    mockInstallHooks.mockReturnValue({
      installed: [...entriesFor('claude-code'), ...entriesFor('codex-cli')],
      skipped: [],
      errors: [],
    })
    const { runHooksInstall } = await import('./hooks.js')

    const result = runHooksInstall()

    expect(mockInstallHooks).toHaveBeenCalledWith(
      expect.objectContaining({ claudeCode: true, codexCli: true, runtime: 'windows' }),
    )
    expect(result.command).toBe('hooks.install')
    expect(result.data).toMatchObject({ runtime: 'windows', installed: 4, skipped: 0, failed: 0 })
    expect(result.summary).toBe('Hooks installed (4 new, 0 already present).')
    expect(result.checks).toEqual([
      { label: 'claude-code', status: 'pass', detail: '2 installed' },
      { label: 'codex-cli', status: 'pass', detail: '2 installed' },
    ])
    // Newly written Codex hooks need an explicit trust step inside Codex CLI.
    expect(result.hint).toContain('/hooks')
  })

  it('is idempotent: a second run reports every entry as already present', async () => {
    mockInstallHooks.mockReturnValue({
      installed: [],
      skipped: [...entriesFor('claude-code'), ...entriesFor('codex-cli')],
      errors: [],
    })
    const { runHooksInstall } = await import('./hooks.js')

    const result = runHooksInstall()

    expect(result.data).toMatchObject({ installed: 0, skipped: 4, failed: 0 })
    expect(result.summary).toBe('All hooks are already installed.')
    expect(result.checks?.map((entry) => entry.detail)).toEqual([
      '2 already present',
      '2 already present',
    ])
    expect(result.hint).toBeUndefined()
  })

  it('marks a partially written target as a warning while the run still fails', async () => {
    mockInstallHooks.mockReturnValue({
      installed: ['claude-code:PreToolUse'],
      skipped: ['claude-code:Stop'],
      errors: ['claude-code: EACCES: permission denied'],
    })
    const { runHooksInstall } = await import('./hooks.js')

    let error: CliError | undefined
    try {
      runHooksInstall()
    } catch (err) {
      error = err as CliError
    }

    expect(isCliError(error)).toBe(true)
    expect(error?.code).toBe('hooks.install_failed')
    expect(error?.checks).toEqual([
      {
        label: 'claude-code',
        status: 'warn',
        detail: '1 installed  —  1 already present  —  EACCES: permission denied',
      },
    ])
    expect(error?.data).toMatchObject({ installed: 1, skipped: 1, failed: 1 })
  })

  it('fails with a typed error when a target could not be written at all', async () => {
    mockInstallHooks.mockReturnValue({
      installed: entriesFor('claude-code'),
      skipped: [],
      errors: ['codex-cli: EPERM: operation not permitted'],
    })
    const { runHooksInstall } = await import('./hooks.js')

    let error: CliError | undefined
    try {
      runHooksInstall()
    } catch (err) {
      error = err as CliError
    }

    expect(error?.code).toBe('hooks.install_failed')
    expect(error?.exitCode).toBe(1)
    expect(error?.hint).toContain('buddy hooks install')
    expect(error?.checks?.find((entry) => entry.label === 'codex-cli')).toMatchObject({
      status: 'fail',
    })

    const json = capture({ json: true })
    const exitCode = renderFailure(error, 'hooks.install')
    const payload = JSON.parse(json.join('')) as {
      ok: boolean
      command: string
      error: { code: string; data: { failed: number } }
    }
    expect(exitCode).toBe(1)
    expect(payload).toMatchObject({ ok: false, command: 'hooks.install' })
    expect(payload.error.data.failed).toBe(1)
    expect(json.join('').trim().split('\n')).toHaveLength(1)
  })

  it('installs the WSL bridge runtime when running under WSL', async () => {
    mockIsWSL.mockReturnValue(true)
    mockInstallHooks.mockReturnValue({ installed: entriesFor('codex-cli'), skipped: [], errors: [] })
    const { runHooksInstall } = await import('./hooks.js')

    const result = runHooksInstall('/home/dev/.bashrc')

    expect(mockInstallHooks).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: 'wsl', shellRcPath: '/home/dev/.bashrc' }),
    )
    expect(result.data.runtime).toBe('wsl')
    expect(result.details).toEqual([{ label: 'Runtime', value: 'WSL' }])
  })

  it('renders rows and summary in human mode, rows only in quiet, one payload in JSON', async () => {
    mockInstallHooks.mockReturnValue({
      installed: entriesFor('claude-code'),
      skipped: entriesFor('codex-cli'),
      errors: [],
    })
    const { runHooksInstall } = await import('./hooks.js')
    const result = runHooksInstall()

    const normal = capture()
    renderResult(result)
    const humanOutput = normal.join('')
    expect(humanOutput).toContain('buddy hooks install')
    expect(humanOutput).toContain('claude-code')
    expect(humanOutput).toContain('2 already present')
    expect(humanOutput).toContain('Hooks installed (2 new, 2 already present).')
    expect(humanOutput).toContain('buddy doctor')

    const quiet = capture({ mode: 'quiet' })
    renderResult(result)
    const quietOutput = quiet.join('')
    expect(quietOutput).toContain('codex-cli')
    expect(quietOutput).not.toContain('buddy hooks install')
    expect(quietOutput).not.toContain('─')
    // Suggestions are hints, so quiet drops them.
    expect(quietOutput).not.toContain('buddy doctor')

    const json = capture({ json: true })
    renderResult(result)
    const payload = JSON.parse(json.join('')) as { ok: boolean; command: string }
    expect(payload).toMatchObject({ ok: true, command: 'hooks.install' })
    expect(json.join('')).not.toContain('Hooks installed (')
  })
})

/* ── buddy hooks status ──────────────────────────────────────────────────── */

/** Build a detection map like `getHooksStatus()` returns. */
function coverage(entries: Record<string, readonly boolean[]>): Record<string, boolean> {
  const status: Record<string, boolean> = {}
  for (const [target, flags] of Object.entries(entries)) {
    flags.forEach((ok, index) => {
      status[`${target}:${EVENTS[index]}`] = ok
    })
  }
  return status
}

describe('runHooksStatus()', () => {
  it('reports complete per-assistant and per-event coverage without writing', async () => {
    mockGetHooksStatus.mockReturnValue(
      coverage({ 'claude-code': [true, true], 'codex-cli': [true, true] }),
    )
    const { runHooksStatus } = await import('./hooks.js')

    const result = runHooksStatus()

    expect(mockGetHooksStatus).toHaveBeenCalledWith({
      claudeCode: true,
      codexCli: true,
      runtime: 'windows',
    })
    // Status must never modify configuration.
    expect(mockInstallHooks).not.toHaveBeenCalled()
    expect(mockUninstallHooks).not.toHaveBeenCalled()

    expect(result.command).toBe('hooks.status')
    expect(result.data).toMatchObject({ installed: 4, total: 4, coverage: 'complete' })
    expect(result.summary).toBe('All hooks are installed (4/4).')
    expect(result.checks).toEqual([
      {
        label: 'claude-code',
        status: 'pass',
        detail: '2/2 installed',
        items: [
          { label: 'PreToolUse', ok: true },
          { label: 'Stop', ok: true },
        ],
      },
      {
        label: 'codex-cli',
        status: 'pass',
        detail: '2/2 installed',
        items: [
          { label: 'PreToolUse', ok: true },
          { label: 'Stop', ok: true },
        ],
      },
    ])
    expect(result.hint).toBeUndefined()
  })

  it('marks a partially covered assistant as a warning and hints at install', async () => {
    mockGetHooksStatus.mockReturnValue(
      coverage({ 'claude-code': [true, false], 'codex-cli': [false, false] }),
    )
    const { runHooksStatus } = await import('./hooks.js')

    const result = runHooksStatus()

    expect(result.data).toMatchObject({ installed: 1, total: 4, coverage: 'partial' })
    expect(result.summary).toBe('Hook coverage is partial (1/4 installed).')
    expect(result.checks?.map((entry) => [entry.label, entry.status, entry.detail])).toEqual([
      ['claude-code', 'warn', '1/2 installed'],
      ['codex-cli', 'fail', '0/2 installed'],
    ])
    expect(result.hint).toBe('Install the missing hooks: buddy hooks install')
  })

  it('reports no coverage at all as a successful read-only report', async () => {
    mockGetHooksStatus.mockReturnValue(coverage({ 'claude-code': [false, false] }))
    const { runHooksStatus } = await import('./hooks.js')

    const result = runHooksStatus()

    expect(result.data.coverage).toBe('none')
    expect(result.summary).toBe('No buddy hooks are installed.')
    expect(result.hint).toBe('Install the missing hooks: buddy hooks install')
  })

  it('detects the WSL bridge command target when running under WSL', async () => {
    mockIsWSL.mockReturnValue(true)
    mockGetHooksStatus.mockReturnValue(coverage({ 'codex-cli': [true, true] }))
    const { runHooksStatus } = await import('./hooks.js')

    const result = runHooksStatus()

    expect(mockGetHooksStatus).toHaveBeenCalledWith(expect.objectContaining({ runtime: 'wsl' }))
    expect(result.data.runtime).toBe('wsl')
    expect(result.details).toEqual([{ label: 'Runtime', value: 'WSL' }])
  })

  it('renders event rows in human mode and one payload in JSON', async () => {
    mockGetHooksStatus.mockReturnValue(coverage({ 'claude-code': [true, false] }))
    const { runHooksStatus } = await import('./hooks.js')
    const result = runHooksStatus()

    const normal = capture()
    renderResult(result)
    const humanOutput = normal.join('')
    expect(humanOutput).toContain('buddy hooks status')
    expect(humanOutput).toContain('1/2 installed')
    expect(humanOutput).toContain('PreToolUse')
    expect(humanOutput).toContain('Stop')

    const json = capture({ json: true })
    renderResult(result)
    const payload = JSON.parse(json.join('')) as {
      ok: boolean
      command: string
      data: { targets: { events: { event: string; installed: boolean }[] }[] }
    }
    expect(payload).toMatchObject({ ok: true, command: 'hooks.status' })
    expect(payload.data.targets[0]?.events).toEqual([
      { event: 'PreToolUse', installed: true },
      { event: 'Stop', installed: false },
    ])
  })
})

/* ── buddy hooks uninstall ───────────────────────────────────────────────── */

describe('runHooksUninstall()', () => {
  it('removes buddy-owned entries for both assistants', async () => {
    mockUninstallHooks.mockReturnValue({
      removed: [...entriesFor('claude-code'), ...entriesFor('codex-cli')],
      skipped: [],
      errors: [],
    })
    const { runHooksUninstall } = await import('./hooks.js')

    const result = runHooksUninstall()

    expect(mockUninstallHooks).toHaveBeenCalledWith({
      claudeCode: true,
      codexCli: true,
      runtime: 'windows',
    })
    expect(result.command).toBe('hooks.uninstall')
    expect(result.data).toMatchObject({ removed: 4, skipped: 0, failed: 0 })
    expect(result.summary).toBe('Hooks removed (4 removed, 0 already absent).')
    expect(result.checks).toEqual([
      { label: 'claude-code', status: 'pass', detail: '2 removed' },
      { label: 'codex-cli', status: 'pass', detail: '2 removed' },
    ])
    expect(result.nextSteps).toEqual(['buddy hooks status'])
  })

  it('is an idempotent no-op when nothing buddy owns is left', async () => {
    mockUninstallHooks.mockReturnValue({
      removed: [],
      skipped: [...entriesFor('claude-code'), ...entriesFor('codex-cli')],
      errors: [],
    })
    const { runHooksUninstall } = await import('./hooks.js')

    const result = runHooksUninstall()

    expect(result.data).toMatchObject({ removed: 0, skipped: 4, failed: 0 })
    expect(result.summary).toBe('No buddy hook entries were present.')
    expect(result.checks?.map((entry) => entry.detail)).toEqual([
      '2 already absent',
      '2 already absent',
    ])
  })

  it('fails with a typed error when a configuration file cannot be cleaned', async () => {
    mockUninstallHooks.mockReturnValue({
      removed: entriesFor('claude-code'),
      skipped: [],
      errors: ['codex-cli: /home/dev/.codex/hooks.json is not valid JSON; left unchanged'],
    })
    const { runHooksUninstall } = await import('./hooks.js')

    let error: CliError | undefined
    try {
      runHooksUninstall()
    } catch (err) {
      error = err as CliError
    }

    expect(isCliError(error)).toBe(true)
    expect(error?.code).toBe('hooks.uninstall_failed')
    expect(error?.exitCode).toBe(1)
    expect(error?.hint).toContain('buddy hooks uninstall')
    // A target that removed nothing at all is a failure row, not a warning.
    expect(error?.checks).toEqual([
      { label: 'claude-code', status: 'pass', detail: '2 removed' },
      {
        label: 'codex-cli',
        status: 'fail',
        detail: '/home/dev/.codex/hooks.json is not valid JSON; left unchanged',
      },
    ])

    const json = capture({ json: true })
    const exitCode = renderFailure(error, 'hooks.uninstall')
    const payload = JSON.parse(json.join('')) as {
      ok: boolean
      command: string
      error: { code: string; data: { failed: number } }
    }
    expect(exitCode).toBe(1)
    expect(payload).toMatchObject({ ok: false, command: 'hooks.uninstall' })
    expect(payload.error.data.failed).toBe(1)
    expect(json.join('').trim().split('\n')).toHaveLength(1)
  })

  it('marks a partially cleaned target as a warning', async () => {
    mockUninstallHooks.mockReturnValue({
      removed: ['claude-code:PreToolUse'],
      skipped: ['claude-code:Stop'],
      errors: ['claude-code: EACCES: permission denied'],
    })
    const { runHooksUninstall } = await import('./hooks.js')

    let error: CliError | undefined
    try {
      runHooksUninstall()
    } catch (err) {
      error = err as CliError
    }

    expect(error?.checks).toEqual([
      {
        label: 'claude-code',
        status: 'warn',
        detail: '1 removed  —  1 already absent  —  EACCES: permission denied',
      },
    ])
  })

  it('removes the WSL bridge command target when running under WSL', async () => {
    mockIsWSL.mockReturnValue(true)
    mockUninstallHooks.mockReturnValue({
      removed: entriesFor('codex-cli'),
      skipped: [],
      errors: [],
    })
    const { runHooksUninstall } = await import('./hooks.js')

    const result = runHooksUninstall()

    expect(mockUninstallHooks).toHaveBeenCalledWith(expect.objectContaining({ runtime: 'wsl' }))
    expect(result.details).toEqual([{ label: 'Runtime', value: 'WSL' }])
  })

  it('renders rows and summary in human mode, rows only in quiet, one payload in JSON', async () => {
    mockUninstallHooks.mockReturnValue({
      removed: entriesFor('claude-code'),
      skipped: entriesFor('codex-cli'),
      errors: [],
    })
    const { runHooksUninstall } = await import('./hooks.js')
    const result = runHooksUninstall()

    const normal = capture()
    renderResult(result)
    const humanOutput = normal.join('')
    expect(humanOutput).toContain('buddy hooks uninstall')
    expect(humanOutput).toContain('2 already absent')
    expect(humanOutput).toContain('Hooks removed (2 removed, 2 already absent).')
    expect(humanOutput).toContain('buddy hooks status')

    const quiet = capture({ mode: 'quiet' })
    renderResult(result)
    const quietOutput = quiet.join('')
    expect(quietOutput).toContain('claude-code')
    expect(quietOutput).not.toContain('buddy hooks uninstall')
    expect(quietOutput).not.toContain('buddy hooks status')

    const json = capture({ json: true })
    renderResult(result)
    const payload = JSON.parse(json.join('')) as { ok: boolean; command: string }
    expect(payload).toMatchObject({ ok: true, command: 'hooks.uninstall' })
    expect(json.join('')).not.toContain('Hooks removed (')
  })
})
