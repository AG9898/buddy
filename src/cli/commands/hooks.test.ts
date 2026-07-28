/**
 * Unit tests for `buddy hooks install`.
 *
 * Covers a complete install, an idempotent re-run, partial per-target coverage
 * rendered as a warning, and the expected failure path. Installation semantics
 * live in `src/main/hooks-install.ts` and stay mocked here: these tests assert
 * only the typed result and its shared rendering.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isCliError, type CliError } from '../result.js'
import { configureOutput, renderFailure, renderResult, resetOutputContext } from '../output.js'

const { mockInstallHooks, mockIsWSL } = vi.hoisted(() => ({
  mockInstallHooks: vi.fn(),
  mockIsWSL: vi.fn(),
}))

vi.mock('../../main/hooks-install.js', () => ({ installHooks: mockInstallHooks }))
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
