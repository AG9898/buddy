// FEAT-08: write Claude Code CLI and Codex CLI hook entries.
//
// IMPORTANT: no top-level Electron imports are allowed in this module.
// It must be importable from src/cli/ (runs in WSL/Node without Electron).
// Any Electron API usage must be done via dynamic require inside functions.

import fs from 'fs'
import os from 'os'
import path from 'path'
import { buddyTokenPath } from '../shared/buddy-paths'

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Hook event → buddy pet state mapping (applies to both Claude Code and Codex).
 */
export const HOOK_EVENT_MAP: Record<string, string> = {
  UserPromptSubmit: 'jumping',
  PreToolUse: 'running',
  PostToolUse: 'idle',
  PermissionRequest: 'waiting',
  Stop: 'waving',
}

/** Ordered list of all five hook events. */
const HOOK_EVENTS = Object.keys(HOOK_EVENT_MAP)

// ── Path helpers ──────────────────────────────────────────────────────────────

function homeDir(): string {
  return os.homedir()
}

/** ~/.claude/settings.json */
function claudeSettingsPath(): string {
  return path.join(homeDir(), '.claude', 'settings.json')
}

/** ~/.codex/hooks.json */
function codexHooksPath(): string {
  return path.join(homeDir(), '.codex', 'hooks.json')
}

/** Token file path (Windows style via USERPROFILE, or XDG-style home). */
function tokenPath(): string {
  return buddyTokenPath(process.env, homeDir())
}

// ── Claude Code settings.json helpers ────────────────────────────────────────

interface ClaudeHookCommand {
  type: 'command'
  command: string
}

interface ClaudeHookEntry {
  matcher: string
  hooks: ClaudeHookCommand[]
}

interface HookCommand {
  type: 'command'
  command: string
}

interface HookEntry {
  matcher: string
  hooks: HookCommand[]
}

interface HookSettings {
  hooks?: Record<string, HookEntry[]>
  [key: string]: unknown
}

interface ClaudeSettings {
  hooks?: Record<string, ClaudeHookEntry[]>
  [key: string]: unknown
}

function loadClaudeSettings(): ClaudeSettings {
  const filePath = claudeSettingsPath()
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as ClaudeSettings
    }
  } catch {
    // File missing or invalid — start fresh.
  }
  return {}
}

function saveClaudeSettings(settings: ClaudeSettings): void {
  const dir = path.dirname(claudeSettingsPath())
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(claudeSettingsPath(), JSON.stringify(settings, null, 2), 'utf8')
}

function loadCodexHooks(): HookSettings {
  const filePath = codexHooksPath()
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as HookSettings
    }
  } catch {
    // File missing or invalid — start fresh.
  }
  return {}
}

function saveCodexHooks(settings: HookSettings): void {
  const dir = path.dirname(codexHooksPath())
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(codexHooksPath(), JSON.stringify(settings, null, 2), 'utf8')
}

/**
 * Build the buddy command string for a given pet state.
 * Uses `buddy state <state>` for Windows-hosted hooks and `petdex-bridge state
 * <state>` for WSL-hosted hooks so WSL agent events cross into the Windows app
 * through the Rust bridge.
 */
function stateCommand(petState: string, runtime: HookRuntime): string {
  return runtime === 'wsl' ? `petdex-bridge state ${petState}` : `buddy state ${petState}`
}

/**
 * Check whether a Claude Code hook entry for a given event already exists
 * in settings.json.  We consider it installed if the buddy state command
 * for that event is already present in any hook entry under that event key.
 */
function isClaudeHookInstalled(settings: ClaudeSettings, event: string): boolean {
  const hooks = settings.hooks ?? {}
  const entries = hooks[event] ?? []
  const petState = HOOK_EVENT_MAP[event]
  if (!petState) return false
  const expected = stateCommand(petState, currentHookRuntime())
  return entries.some((entry) =>
    entry.hooks?.some((h) => h.type === 'command' && h.command === expected),
  )
}

/**
 * Check whether a Codex hook entry for a given event already exists in
 * ~/.codex/hooks.json with the expected runtime command.
 */
function isHookInstalled(settings: HookSettings, event: string, command: string): boolean {
  const hooks = settings.hooks ?? {}
  const entries = hooks[event] ?? []
  return entries.some((entry) =>
    entry.hooks?.some((h) => h.type === 'command' && h.command === command),
  )
}

// ── Public types ──────────────────────────────────────────────────────────────

export type HookRuntime = 'windows' | 'wsl'

export interface HookInstallOptions {
  claudeCode?: boolean
  codexCli?: boolean
  runtime?: HookRuntime
  /**
   * Deprecated legacy option retained for CLI compatibility. Codex hooks are
   * installed to ~/.codex/hooks.json, not shell rc files.
   */
  shellRcPath?: string
}

export interface HookInstallResult {
  installed: string[]
  skipped: string[]
  errors: string[]
}

let hookRuntimeOverride: HookRuntime | null = null

function currentHookRuntime(): HookRuntime {
  return hookRuntimeOverride ?? 'windows'
}

function withHookRuntime<T>(runtime: HookRuntime | undefined, fn: () => T): T {
  const previous = hookRuntimeOverride
  hookRuntimeOverride = runtime ?? 'windows'
  try {
    return fn()
  } finally {
    hookRuntimeOverride = previous
  }
}

// ── installHooks ──────────────────────────────────────────────────────────────

/**
 * Install Claude Code CLI and/or Codex CLI hooks.
 *
 * - Claude Code: writes hook entries to ~/.claude/settings.json.
 * - Codex CLI: writes hook entries to ~/.codex/hooks.json.
 * - Both targets are idempotent — no duplicates are written.
 *
 * This function contains NO top-level Electron imports and is safe to call
 * from the CLI layer (FEAT-09) without an Electron environment.
 */
export function installHooks(options: HookInstallOptions = {}): HookInstallResult {
  return withHookRuntime(options.runtime, () => {
    const result: HookInstallResult = { installed: [], skipped: [], errors: [] }

    // ── Claude Code CLI ──────────────────────────────────────────────────────
    if (options.claudeCode) {
      try {
        const settings = loadClaudeSettings()
        if (!settings.hooks) {
          settings.hooks = {}
        }

        let changed = false

        for (const event of HOOK_EVENTS) {
          const petState = HOOK_EVENT_MAP[event]
          if (!petState) continue

          if (isClaudeHookInstalled(settings, event)) {
            result.skipped.push(`claude-code:${event}`)
            continue
          }

          // Append a new hook entry for this event.
          if (!settings.hooks[event]) {
            settings.hooks[event] = []
          }
          settings.hooks[event].push({
            matcher: '',
            hooks: [{ type: 'command', command: stateCommand(petState, currentHookRuntime()) }],
          })
          result.installed.push(`claude-code:${event}`)
          changed = true
        }

        if (changed) {
          saveClaudeSettings(settings)
        }
      } catch (err) {
        result.errors.push(`claude-code: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // ── Codex CLI ────────────────────────────────────────────────────────────
    if (options.codexCli) {
      try {
        const settings = loadCodexHooks()
        if (!settings.hooks) {
          settings.hooks = {}
        }

        let changed = false

        for (const event of HOOK_EVENTS) {
          const petState = HOOK_EVENT_MAP[event]
          if (!petState) continue

          const command = stateCommand(petState, currentHookRuntime())
          if (isHookInstalled(settings, event, command)) {
            result.skipped.push(`codex-cli:${event}`)
            continue
          }

          if (!settings.hooks[event]) {
            settings.hooks[event] = []
          }
          settings.hooks[event].push({
            matcher: '',
            hooks: [{ type: 'command', command }],
          })
          result.installed.push(`codex-cli:${event}`)
          changed = true
        }

        if (changed) {
          saveCodexHooks(settings)
        }
      } catch (err) {
        result.errors.push(`codex-cli: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return result
  })
}

// ── getHooksStatus ─────────────────────────────────────────────────────────────

/**
 * Check which hooks are currently installed.
 *
 * Returns a flat record mapping keys of the form `"<target>:<event>"` to
 * booleans indicating whether each hook is present.
 *
 * Example: `{ "claude-code:PreToolUse": true, "codex-cli:PreToolUse": false, ... }`
 */
export function getHooksStatus(options: HookInstallOptions = {}): Record<string, boolean> {
  return withHookRuntime(options.runtime, () => {
    const status: Record<string, boolean> = {}

    // ── Claude Code CLI ──────────────────────────────────────────────────────
    if (options.claudeCode !== false) {
      const settings = loadClaudeSettings()
      for (const event of HOOK_EVENTS) {
        status[`claude-code:${event}`] = isClaudeHookInstalled(settings, event)
      }
    }

    // ── Codex CLI ────────────────────────────────────────────────────────────
    if (options.codexCli !== false) {
      const settings = loadCodexHooks()
      for (const event of HOOK_EVENTS) {
        const petState = HOOK_EVENT_MAP[event]
        status[`codex-cli:${event}`] = Boolean(
          petState && isHookInstalled(settings, event, stateCommand(petState, currentHookRuntime())),
        )
      }
    }

    return status
  })
}

// ── Tray integration helper ────────────────────────────────────────────────────

/**
 * Install hooks and show a result dialog using Electron's dialog module.
 *
 * This function uses a dynamic require for Electron's `dialog` API so the
 * module remains importable from the CLI without loading Electron.
 * Call this only from the Electron main process (tray menu handler).
 */
export async function installHooksWithDialog(): Promise<void> {
  const result = installHooks({ claudeCode: true, codexCli: true, runtime: 'windows' })

  // Dynamic require — safe to call only when Electron is loaded.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { dialog } = require('electron') as typeof import('electron')

  const lines: string[] = []

  if (result.installed.length > 0) {
    lines.push(`Installed (${result.installed.length}):\n  ${result.installed.join('\n  ')}`)
  }
  if (result.skipped.length > 0) {
    lines.push(`Already installed (${result.skipped.length}):\n  ${result.skipped.join('\n  ')}`)
  }
  if (result.errors.length > 0) {
    lines.push(`Errors (${result.errors.length}):\n  ${result.errors.join('\n  ')}`)
  }

  const hasErrors = result.errors.length > 0
  await dialog.showMessageBox({
    type: hasErrors ? 'error' : 'info',
    title: 'buddy — Install Hooks',
    message: hasErrors ? 'Hook installation encountered errors' : 'Hook installation complete',
    detail: lines.join('\n\n') || 'No changes were made.',
    buttons: ['OK'],
  })
}

// ── Re-export token path for CLI use ─────────────────────────────────────────

/** Absolute path to the shared update token file. */
export { tokenPath }
