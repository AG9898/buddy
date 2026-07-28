/**
 * Unit tests for src/main/hooks-install.ts
 * Acceptance criteria:
 *   - installHooks({claudeCode:true}) writes all five Claude Code hook events to settings.json
 *   - installHooks({codexCli:true}) writes all five Codex hook events to hooks.json
 *   - Re-running installHooks is idempotent (no duplicate entries)
 *   - getHooksStatus() accurately reports which hooks are installed
 *   - No top-level Electron import — module loads without Electron
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock fs before importing the module under test ─────────────────────────

const {
  mockReadFileSync,
  mockWriteFileSync,
  mockMkdirSync,
  mockExistsSync,
} = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockExistsSync: vi.fn(),
}))

vi.mock('fs', () => ({
  default: {
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    mkdirSync: mockMkdirSync,
    existsSync: mockExistsSync,
  },
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
  existsSync: mockExistsSync,
}))

const MOCK_HOME = '/mock/home'

vi.mock('os', () => ({
  default: { homedir: () => MOCK_HOME },
  homedir: () => MOCK_HOME,
}))

// Import AFTER mocks are registered.
import {
  installHooks,
  getHooksStatus,
  isBuddyHookCommand,
  uninstallHooks,
  HOOK_EVENT_MAP,
} from './hooks-install'

// ── Helpers ────────────────────────────────────────────────────────────────

const HOOK_EVENTS = Object.keys(HOOK_EVENT_MAP)
// Use path.join so separator matches the OS-specific output of hooks-install.ts
import path from 'path'
const CLAUDE_SETTINGS = path.join(MOCK_HOME, '.claude', 'settings.json')
const CODEX_HOOKS = path.join(MOCK_HOME, '.codex', 'hooks.json')

beforeEach(() => {
  vi.clearAllMocks()
  // Default: rc file does not exist → readFileSync throws ENOENT
  mockReadFileSync.mockImplementation(() => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  })
})

// ── installHooks — Claude Code ─────────────────────────────────────────────

describe('installHooks — claudeCode', () => {
  it('writes all five hook events to settings.json when starting from empty', () => {
    let written = ''
    mockWriteFileSync.mockImplementation((_p: unknown, data: unknown) => {
      written = data as string
    })

    const result = installHooks({ claudeCode: true })

    expect(result.errors).toHaveLength(0)
    expect(result.installed).toHaveLength(5)
    expect(result.skipped).toHaveLength(0)

    for (const event of HOOK_EVENTS) {
      expect(result.installed).toContain(`claude-code:${event}`)
    }

    // Verify the written JSON contains all five events in the hooks section.
    const settings = JSON.parse(written) as { hooks: Record<string, unknown[]> }
    for (const event of HOOK_EVENTS) {
      expect(settings.hooks[event]).toBeDefined()
      expect(settings.hooks[event].length).toBeGreaterThan(0)
    }
  })

  it('is idempotent — does not create duplicates on second run', () => {
    // First run: settings.json does not exist.
    let capturedJson = ''
    mockWriteFileSync.mockImplementation((_p: unknown, data: unknown) => {
      capturedJson = data as string
    })
    installHooks({ claudeCode: true })

    // Second run: settings.json now contains the hooks from first run.
    mockReadFileSync.mockReturnValue(capturedJson)
    mockWriteFileSync.mockClear()
    const result2 = installHooks({ claudeCode: true })

    expect(result2.installed).toHaveLength(0)
    expect(result2.skipped).toHaveLength(5)
    expect(result2.errors).toHaveLength(0)
    // writeFileSync should not have been called again (no changes).
    expect(mockWriteFileSync).not.toHaveBeenCalled()
  })

  it('writes petdex-bridge commands for WSL-hosted Claude Code hooks', () => {
    let written = ''
    mockWriteFileSync.mockImplementation((_p: unknown, data: unknown) => {
      written = data as string
    })

    const result = installHooks({ claudeCode: true, runtime: 'wsl' })

    expect(result.errors).toHaveLength(0)
    const settings = JSON.parse(written) as { hooks: Record<string, { hooks: { command: string }[] }[]> }
    expect(settings.hooks['PreToolUse']?.[0]?.hooks[0]?.command).toBe(
      'petdex-bridge state running',
    )
  })

  it('only installs missing events when settings.json has some hooks already', () => {
    // Pre-populate settings.json with two hook events.
    const partial = {
      hooks: {
        UserPromptSubmit: [
          {
            matcher: '',
            hooks: [{ type: 'command', command: 'buddy state jumping' }],
          },
        ],
        PreToolUse: [
          {
            matcher: '',
            hooks: [{ type: 'command', command: 'buddy state running' }],
          },
        ],
      },
    }
    mockReadFileSync.mockReturnValue(JSON.stringify(partial))

    let written = ''
    mockWriteFileSync.mockImplementation((_p: unknown, data: unknown) => {
      written = data as string
    })

    const result = installHooks({ claudeCode: true })

    // Two were already there.
    expect(result.skipped).toContain('claude-code:UserPromptSubmit')
    expect(result.skipped).toContain('claude-code:PreToolUse')
    // Three should be newly installed.
    expect(result.installed).toHaveLength(3)

    const saved = JSON.parse(written) as { hooks: Record<string, unknown[]> }
    expect(saved.hooks['PostToolUse']).toBeDefined()
    expect(saved.hooks['PermissionRequest']).toBeDefined()
    expect(saved.hooks['Stop']).toBeDefined()
  })
})

// ── installHooks — Codex CLI ───────────────────────────────────────────────

describe('installHooks — codexCli', () => {
  it('writes all five hook events to ~/.codex/hooks.json when starting from empty', () => {
    let writtenPath = ''
    let written = ''
    mockWriteFileSync.mockImplementation((p: unknown, data: unknown) => {
      writtenPath = p as string
      written = data as string
    })

    const result = installHooks({ codexCli: true })

    expect(result.errors).toHaveLength(0)
    expect(result.installed).toHaveLength(5)
    expect(result.skipped).toHaveLength(0)
    expect(writtenPath).toBe(CODEX_HOOKS)
    for (const event of HOOK_EVENTS) {
      expect(result.installed).toContain(`codex-cli:${event}`)
    }

    const settings = JSON.parse(written) as { hooks: Record<string, { hooks: { command: string }[] }[]> }
    for (const event of HOOK_EVENTS) {
      expect(settings.hooks[event]).toBeDefined()
    }
    expect(settings.hooks['PreToolUse']?.[0]?.hooks[0]?.command).toBe('buddy state running')
  })

  it('is idempotent — does not create duplicate entries', () => {
    let capturedJson = ''
    mockWriteFileSync.mockImplementation((_p: unknown, data: unknown) => {
      capturedJson = data as string
    })
    installHooks({ codexCli: true })

    mockReadFileSync.mockReturnValue(capturedJson)
    mockWriteFileSync.mockClear()
    const result2 = installHooks({ codexCli: true })

    expect(result2.installed).toHaveLength(0)
    expect(result2.skipped).toHaveLength(5)
    expect(result2.errors).toHaveLength(0)
    expect(mockWriteFileSync).not.toHaveBeenCalled()
  })

  it('writes petdex-bridge commands for WSL-hosted Codex hooks', () => {
    let written = ''
    mockWriteFileSync.mockImplementation((_p: unknown, data: unknown) => {
      written = data as string
    })

    const result = installHooks({ codexCli: true, runtime: 'wsl' })

    expect(result.errors).toHaveLength(0)
    const settings = JSON.parse(written) as { hooks: Record<string, { hooks: { command: string }[] }[]> }
    expect(settings.hooks['PreToolUse']?.[0]?.hooks[0]?.command).toBe(
      'petdex-bridge state running',
    )
  })
})

// ── getHooksStatus ─────────────────────────────────────────────────────────

describe('getHooksStatus', () => {
  it('returns false for all hooks when settings.json and rc file do not exist', () => {
    const status = getHooksStatus({ claudeCode: true, codexCli: true })

    for (const event of HOOK_EVENTS) {
      expect(status[`claude-code:${event}`]).toBe(false)
      expect(status[`codex-cli:${event}`]).toBe(false)
    }
  })

  it('returns true for claude-code hooks after installHooks writes them', () => {
    let written = ''
    mockWriteFileSync.mockImplementation((_p: unknown, data: unknown) => {
      written = data as string
    })
    installHooks({ claudeCode: true })

    // Now simulate settings.json containing the written data.
    mockReadFileSync.mockImplementation((p: unknown) => {
      if (p === CLAUDE_SETTINGS) return written
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    const status = getHooksStatus({ claudeCode: true })
    for (const event of HOOK_EVENTS) {
      expect(status[`claude-code:${event}`]).toBe(true)
    }
  })

  it('returns true for codex-cli hooks after installHooks writes hooks.json', () => {
    let written = ''
    mockWriteFileSync.mockImplementation((_p: unknown, data: unknown) => {
      written = data as string
    })
    installHooks({ codexCli: true })

    mockReadFileSync.mockImplementation((p: unknown) => {
      if (p === CODEX_HOOKS) return written
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    const status = getHooksStatus({ codexCli: true })
    for (const event of HOOK_EVENTS) {
      expect(status[`codex-cli:${event}`]).toBe(true)
    }
  })
})

// ── uninstallHooks ─────────────────────────────────────────────────────────

/** Capture the single JSON document a run writes, if it writes one. */
function captureWrite(): { path: () => string; json: () => string } {
  let writtenPath = ''
  let written = ''
  mockWriteFileSync.mockImplementation((p: unknown, data: unknown) => {
    writtenPath = p as string
    written = data as string
  })
  return { path: () => writtenPath, json: () => written }
}

describe('uninstallHooks', () => {
  it('removes every buddy-owned Claude Code entry it installed', () => {
    const installed = captureWrite()
    installHooks({ claudeCode: true })
    const afterInstall = installed.json()

    mockReadFileSync.mockReturnValue(afterInstall)
    const removed = captureWrite()
    const result = uninstallHooks({ claudeCode: true })

    expect(result.errors).toHaveLength(0)
    expect(result.removed).toHaveLength(5)
    expect(result.skipped).toHaveLength(0)
    for (const event of HOOK_EVENTS) {
      expect(result.removed).toContain(`claude-code:${event}`)
    }
    expect(removed.path()).toBe(CLAUDE_SETTINGS)
    const saved = JSON.parse(removed.json()) as { hooks: Record<string, unknown[]> }
    expect(Object.keys(saved.hooks)).toHaveLength(0)
  })

  it('removes Codex entries from ~/.codex/hooks.json', () => {
    const installed = captureWrite()
    installHooks({ codexCli: true })

    mockReadFileSync.mockReturnValue(installed.json())
    const removed = captureWrite()
    const result = uninstallHooks({ codexCli: true })

    expect(result.removed).toHaveLength(5)
    expect(removed.path()).toBe(CODEX_HOOKS)
  })

  it('removes WSL petdex-bridge commands regardless of the current runtime', () => {
    const installed = captureWrite()
    installHooks({ claudeCode: true, runtime: 'wsl' })

    mockReadFileSync.mockReturnValue(installed.json())
    const removed = captureWrite()
    // Ownership follows the command, not the shell the uninstall runs in.
    const result = uninstallHooks({ claudeCode: true, runtime: 'windows' })

    expect(result.removed).toHaveLength(5)
    const saved = JSON.parse(removed.json()) as { hooks: Record<string, unknown[]> }
    expect(Object.keys(saved.hooks)).toHaveLength(0)
  })

  it('preserves unrelated keys, events, and entries', () => {
    const existing = {
      model: 'opus',
      hooks: {
        PreToolUse: [
          { matcher: '', hooks: [{ type: 'command', command: 'buddy state running' }] },
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'my-linter --check' }] },
        ],
        SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'echo hello' }] }],
      },
    }
    mockReadFileSync.mockReturnValue(JSON.stringify(existing))
    const removed = captureWrite()

    const result = uninstallHooks({ claudeCode: true })

    expect(result.removed).toEqual(['claude-code:PreToolUse'])
    expect(result.skipped).toHaveLength(4)

    const saved = JSON.parse(removed.json()) as typeof existing
    expect(saved.model).toBe('opus')
    expect(saved.hooks.SessionStart).toEqual(existing.hooks.SessionStart)
    expect(saved.hooks.PreToolUse).toEqual([
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'my-linter --check' }] },
    ])
  })

  it('keeps unrelated commands that share an entry with a buddy command', () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        hooks: {
          Stop: [
            {
              matcher: '',
              hooks: [
                { type: 'command', command: 'buddy state waving' },
                { type: 'command', command: 'notify-send done' },
              ],
            },
          ],
        },
      }),
    )
    const removed = captureWrite()

    const result = uninstallHooks({ claudeCode: true })

    expect(result.removed).toEqual(['claude-code:Stop'])
    const saved = JSON.parse(removed.json()) as {
      hooks: Record<string, { matcher: string; hooks: { command: string }[] }[]>
    }
    expect(saved.hooks['Stop']).toEqual([
      { matcher: '', hooks: [{ type: 'command', command: 'notify-send done' }] },
    ])
  })

  it('is an idempotent no-op that writes nothing when no buddy entries exist', () => {
    // No settings.json at all: readFileSync throws ENOENT by default.
    const result = uninstallHooks({ claudeCode: true, codexCli: true })

    expect(result.errors).toHaveLength(0)
    expect(result.removed).toHaveLength(0)
    expect(result.skipped).toHaveLength(10)
    expect(mockWriteFileSync).not.toHaveBeenCalled()
  })

  it('leaves a malformed configuration file untouched and reports it', () => {
    mockReadFileSync.mockReturnValue('{ not json')

    const result = uninstallHooks({ claudeCode: true })

    expect(result.removed).toHaveLength(0)
    expect(result.skipped).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('claude-code:')
    expect(result.errors[0]).toContain('not valid JSON')
    expect(mockWriteFileSync).not.toHaveBeenCalled()
  })

  it('reports a write failure without throwing', () => {
    const installed = captureWrite()
    installHooks({ claudeCode: true })
    mockReadFileSync.mockReturnValue(installed.json())
    mockWriteFileSync.mockImplementation(() => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    })

    const result = uninstallHooks({ claudeCode: true })

    expect(result.errors).toEqual(['claude-code: EACCES: permission denied'])
  })

  it('only touches the targets it was asked to clean', () => {
    const installed = captureWrite()
    installHooks({ codexCli: true })
    mockReadFileSync.mockReturnValue(installed.json())
    captureWrite()

    const result = uninstallHooks({ claudeCode: true })

    expect(result.removed.every((entry) => entry.startsWith('claude-code:'))).toBe(true)
    expect(result.removed.some((entry) => entry.startsWith('codex-cli:'))).toBe(false)
  })
})

describe('isBuddyHookCommand', () => {
  it('recognises both runtime command forms for a mapped event', () => {
    expect(isBuddyHookCommand('buddy state running', 'PreToolUse')).toBe(true)
    expect(isBuddyHookCommand('petdex-bridge state running', 'PreToolUse')).toBe(true)
  })

  it('rejects another event’s state, unrelated commands, and unmapped events', () => {
    expect(isBuddyHookCommand('buddy state waving', 'PreToolUse')).toBe(false)
    expect(isBuddyHookCommand('buddy start', 'PreToolUse')).toBe(false)
    expect(isBuddyHookCommand('buddy state running', 'SessionStart')).toBe(false)
    expect(isBuddyHookCommand(undefined, 'PreToolUse')).toBe(false)
  })
})

// ── No top-level Electron import ───────────────────────────────────────────

describe('module loading', () => {
  it('does not throw when imported without Electron', () => {
    // If we reached this point the module loaded fine — Electron is not
    // available in the Vitest environment and would have thrown at import time
    // if it were required at the top level.
    expect(HOOK_EVENT_MAP).toBeDefined()
    expect(typeof installHooks).toBe('function')
    expect(typeof getHooksStatus).toBe('function')
  })
})
