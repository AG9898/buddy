/**
 * output.ts — Shared CLI terminal output layer for buddy commands.
 *
 * Provides consistent, styled terminal UX across all buddy subcommands:
 *   - Warm orange accent theme
 *   - Buddy ASCII logo banner
 *   - Polished status/success/warning/error output with symbols
 *   - Tasteful separators and spacing
 *   - Color-safe: styled when stdout supports it, plain ASCII fallback for non-TTY/CI
 *   - No Electron imports — safe for WSL and Windows CLI environments
 */

/* ── Color detection ─────────────────────────────────────────────────────────
   We detect color support manually so this module has zero runtime dependencies
   beyond Node builtins. Supports both stdout (display) and stderr (error output).
───────────────────────────────────────────────────────────────────────────── */

function detectColorSupport(): boolean {
  // Honour explicit opt-out / opt-in env vars.
  if (process.env['NO_COLOR'] !== undefined) return false
  if (process.env['FORCE_COLOR'] !== undefined) return true

  // CI environments rarely support color without FORCE_COLOR.
  if (process.env['CI']) return false

  // Check if stdout is a TTY.
  return process.stdout.isTTY === true
}

const COLOR_SUPPORTED = detectColorSupport()

/* ── ANSI helpers ────────────────────────────────────────────────────────────
   Tiny inline ANSI escape wrappers — no third-party chalk/kleur dependency.
   All wrap functions are no-ops when color is not supported.
───────────────────────────────────────────────────────────────────────────── */

function ansi(code: string, text: string): string {
  if (!COLOR_SUPPORTED) return text
  return `\x1b[${code}m${text}\x1b[0m`
}

/** Warm orange accent (ANSI 256-color index 208 via extended code). */
function orange(text: string): string {
  if (!COLOR_SUPPORTED) return text
  return `\x1b[38;5;208m${text}\x1b[0m`
}

function bold(text: string): string {
  return ansi('1', text)
}

function dim(text: string): string {
  return ansi('2', text)
}

function green(text: string): string {
  return ansi('32', text)
}

function yellow(text: string): string {
  return ansi('33', text)
}

function red(text: string): string {
  return ansi('31', text)
}

function cyan(text: string): string {
  return ansi('36', text)
}

/* ── Separator ───────────────────────────────────────────────────────────────
   Polished horizontal rule that stays readable without color.
───────────────────────────────────────────────────────────────────────────── */

const SEPARATOR_WIDTH = 48

export function separator(): string {
  const line = '─'.repeat(SEPARATOR_WIDTH)
  return dim(line)
}

/* ── ASCII logo banner ────────────────────────────────────────────────────────
   Canonical Buddy text logo from docs/CLI.md.
   Styled with warm orange accent when color is supported; plain text otherwise.
───────────────────────────────────────────────────────────────────────────── */

const BUDDY_LOGO = `    ____            __    __
   / __ )__  ______/ /___/ /_  __
  / __  / / / / __  / __  / / / /
 / /_/ / /_/ / /_/ / /_/ / /_/ /
/_____/\\__,_/\\__,_/\\__,_/\\__, /
                        /____/`

/**
 * Build the Buddy ASCII logo banner as a string.
 * Useful where the banner must be returned rather than written (e.g. Commander help text).
 */
export function bannerText(): string {
  return `\n${orange(BUDDY_LOGO)}\n${dim('  Windows floating desktop pet')}\n`
}

/**
 * Render the Buddy ASCII logo banner to stdout.
 * Call this on primary CLI entry / help surfaces.
 */
export function printBanner(): void {
  process.stdout.write(bannerText() + '\n')
}

/* ── Status line helpers ─────────────────────────────────────────────────────
   Each helper writes one line to stdout (info/success/warning) or stderr (error).
   Symbols degrade gracefully: Unicode when TTY supports it, ASCII otherwise.
───────────────────────────────────────────────────────────────────────────── */

function supportsUnicode(): boolean {
  if (!COLOR_SUPPORTED) return false
  const enc = process.env['LANG'] ?? process.env['LC_ALL'] ?? ''
  if (enc.toLowerCase().includes('utf')) return true
  // On Windows PowerShell with modern terminal, stdout is a TTY; assume Unicode.
  if (process.platform === 'win32' && process.stdout.isTTY) return true
  return process.stdout.isTTY === true
}

const UNICODE = supportsUnicode()

const SYM = {
  info: UNICODE ? '◆' : '*',
  success: UNICODE ? '✔' : 'OK',
  warning: UNICODE ? '⚠' : '!',
  error: UNICODE ? '✖' : 'ERR',
  bullet: UNICODE ? '•' : '-',
  arrow: UNICODE ? '→' : '->',
} as const

/**
 * Print a neutral status / info line.
 * Example: ◆ Checking sidecar health…
 */
export function status(message: string): void {
  process.stdout.write(`${cyan(SYM.info)} ${message}\n`)
}

/**
 * Print a success line.
 * Example: ✔ buddy started.
 */
export function success(message: string): void {
  process.stdout.write(`${green(SYM.success)} ${bold(message)}\n`)
}

/**
 * Print a warning line (stdout — not a fatal error).
 * Example: ⚠ Token file not found; some features may be unavailable.
 */
export function warn(message: string): void {
  process.stdout.write(`${yellow(SYM.warning)} ${message}\n`)
}

/**
 * Print an actionable error message to stderr.
 * Does not exit — caller decides on process.exit().
 * Expected errors (token missing, app not running, etc.) print without stack traces.
 *
 * @param message  Human-readable summary.
 * @param hint     Optional next-step hint printed on a second line.
 */
export function error(message: string, hint?: string): void {
  process.stderr.write(`${red(SYM.error)} ${bold(message)}\n`)
  if (hint) {
    process.stderr.write(`  ${dim(SYM.arrow)} ${hint}\n`)
  }
}

/**
 * Print a labeled pass/fail check row (used by doctor output).
 * Example:  ✔  Electron process running
 *           ✖  Sidecar not responding
 */
export function check(label: string, ok: boolean, detail?: string): void {
  const sym = ok ? green(SYM.success) : red(SYM.error)
  const line = `  ${sym}  ${label}`
  process.stdout.write(line + '\n')
  if (detail) {
    process.stdout.write(`       ${dim(detail)}\n`)
  }
}

/**
 * Print a sub-item row under a check (indented).
 * Example:        ✔  claudeCode.UserPromptSubmit
 */
export function subCheck(label: string, ok: boolean): void {
  const sym = ok ? green(SYM.success) : red(SYM.error)
  process.stdout.write(`       ${sym}  ${dim(label)}\n`)
}

/**
 * Print a bullet list item.
 * Example:  • pets/default
 */
export function bullet(message: string): void {
  process.stdout.write(`  ${orange(SYM.bullet)} ${message}\n`)
}

/**
 * Print a key → value label line.
 * Example:  → State: running
 */
export function label(key: string, value: string): void {
  process.stdout.write(`  ${dim(SYM.arrow)} ${bold(key)}: ${value}\n`)
}

/**
 * Print a section heading with a separator.
 * Example:  buddy doctor
 *           ────────────────────────────────────────────────
 */
export function heading(title: string): void {
  process.stdout.write(`\n${bold(orange(title))}\n`)
  process.stdout.write(separator() + '\n')
}

/**
 * Print a closing separator.
 */
export function closeSeparator(): void {
  process.stdout.write(separator() + '\n')
}

/* ── Re-exported theme colors (for callers that want raw styled strings) ── */
export { orange, bold, dim, green, yellow, red, cyan }
