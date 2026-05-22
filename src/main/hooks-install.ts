// FEAT-08: write Claude Code CLI and Codex CLI hook entries.
//
// IMPORTANT: no top-level Electron imports are allowed in this module.
// It must be importable from src/cli/ (runs in WSL/Node without Electron).
// Any Electron API usage must be done via dynamic require inside functions.

import fs from 'fs'
import os from 'os'
import path from 'path'

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

/** Sentinel comment injected into rc files so we can detect existing entries. */
const RC_SENTINEL = '# buddy-hooks-install'

// ── Path helpers ──────────────────────────────────────────────────────────────

function homeDir(): string {
  return os.homedir()
}

/** ~/.claude/settings.json */
function claudeSettingsPath(): string {
  return path.join(homeDir(), '.claude', 'settings.json')
}

/** Default shell rc path — ~/.zshrc when SHELL contains zsh, else ~/.bashrc. */
function defaultRcPath(): string {
  const shell = process.env['SHELL'] ?? ''
  if (shell.includes('zsh')) {
    return path.join(homeDir(), '.zshrc')
  }
  return path.join(homeDir(), '.bashrc')
}

/** Token file path (Windows style via USERPROFILE, or XDG-style home). */
function tokenPath(): string {
  const base = process.env['USERPROFILE'] ?? homeDir()
  return path.join(base, '.petdex-win', 'runtime', 'update-token')
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

/**
 * Build the buddy command string for a given pet state.
 * Uses `buddy state <state>` so it works from both Windows and WSL.
 */
function buddyStateCommand(petState: string): string {
  return `buddy state ${petState}`
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
  const expected = buddyStateCommand(petState)
  return entries.some((entry) =>
    entry.hooks?.some((h) => h.type === 'command' && h.command === expected),
  )
}

// ── Shell rc helpers ──────────────────────────────────────────────────────────

/**
 * Build the shell hook line for a given Codex event and pet state.
 * Written as a POSIX shell function bound via the Codex environment variable
 * convention used in shell rc files.  The format mirrors the existing
 * petdex hook style found in handoff.md.
 *
 * Each block has the form:
 *   # buddy-hooks-install codex UserPromptSubmit
 *   export CODEX_HOOK_USER_PROMPT_SUBMIT="buddy state jumping"
 */
function codexShellBlock(event: string, petState: string): string {
  const varName = `CODEX_HOOK_${event.replace(/([A-Z])/g, '_$1').slice(1).toUpperCase()}`
  return `${RC_SENTINEL} codex ${event}\nexport ${varName}="buddy state ${petState}"`
}

/**
 * Check whether a Codex shell block for `event` already exists in rc content.
 */
function isCodexRcBlockPresent(content: string, event: string): boolean {
  return content.includes(`${RC_SENTINEL} codex ${event}`)
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface HookInstallOptions {
  claudeCode?: boolean
  codexCli?: boolean
  /**
   * Path to the shell rc file for shell-based hooks.
   * Defaults to ~/.zshrc or ~/.bashrc based on the SHELL env variable.
   */
  shellRcPath?: string
}

export interface HookInstallResult {
  installed: string[]
  skipped: string[]
  errors: string[]
}

// ── installHooks ──────────────────────────────────────────────────────────────

/**
 * Install Claude Code CLI and/or Codex CLI hooks.
 *
 * - Claude Code: writes hook entries to ~/.claude/settings.json.
 * - Codex CLI: appends shell hook lines to the specified (or default) rc file.
 * - Both targets are idempotent — no duplicates are written.
 *
 * This function contains NO top-level Electron imports and is safe to call
 * from the CLI layer (FEAT-09) without an Electron environment.
 */
export function installHooks(options: HookInstallOptions = {}): HookInstallResult {
  const result: HookInstallResult = { installed: [], skipped: [], errors: [] }

  // ── Claude Code CLI ────────────────────────────────────────────────────────
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
          hooks: [{ type: 'command', command: buddyStateCommand(petState) }],
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

  // ── Codex CLI (shell rc) ───────────────────────────────────────────────────
  if (options.codexCli) {
    const rcPath = options.shellRcPath ?? defaultRcPath()
    try {
      // Read existing content (empty string if file does not exist).
      let content = ''
      try {
        content = fs.readFileSync(rcPath, 'utf8')
      } catch {
        // File does not exist yet — will be created.
      }

      const blocksToAppend: string[] = []

      for (const event of HOOK_EVENTS) {
        const petState = HOOK_EVENT_MAP[event]
        if (!petState) continue

        if (isCodexRcBlockPresent(content, event)) {
          result.skipped.push(`codex-cli:${event}`)
          continue
        }

        blocksToAppend.push(codexShellBlock(event, petState))
        result.installed.push(`codex-cli:${event}`)
      }

      if (blocksToAppend.length > 0) {
        const append = '\n' + blocksToAppend.join('\n') + '\n'
        fs.appendFileSync(rcPath, append, 'utf8')
      }
    } catch (err) {
      result.errors.push(`codex-cli: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return result
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
  const status: Record<string, boolean> = {}

  // ── Claude Code CLI ────────────────────────────────────────────────────────
  if (options.claudeCode !== false) {
    const settings = loadClaudeSettings()
    for (const event of HOOK_EVENTS) {
      status[`claude-code:${event}`] = isClaudeHookInstalled(settings, event)
    }
  }

  // ── Codex CLI (shell rc) ───────────────────────────────────────────────────
  if (options.codexCli !== false) {
    const rcPath = options.shellRcPath ?? defaultRcPath()
    let content = ''
    try {
      content = fs.readFileSync(rcPath, 'utf8')
    } catch {
      // File does not exist — all are absent.
    }
    for (const event of HOOK_EVENTS) {
      status[`codex-cli:${event}`] = isCodexRcBlockPresent(content, event)
    }
  }

  return status
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
  const result = installHooks({ claudeCode: true, codexCli: true })

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
