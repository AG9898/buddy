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
 *
 * Output modes
 * ------------
 * Every invocation resolves one `OutputContext` (see `configureOutput`) that
 * carries the mode (`normal` | `quiet` | `verbose`), whether `--json` was
 * requested, and whether color/Unicode are available. Helpers route through
 * `emit()`, which decides per *channel* whether a line is written, suppressed,
 * or diverted to stderr:
 *
 *   error       always → stderr
 *   diagnostic  stdout; → stderr under --json
 *   progress    suppressed by --quiet and --json
 *   hint        suppressed by --quiet and --json
 *   result      stdout; suppressed by --json (the JSON payload is the result)
 *   verbose     only under --verbose
 *
 * Under `--json`, human output never touches stdout: `renderResult` /
 * `renderFailure` emit exactly one parseable payload there and all diagnostics
 * are isolated to stderr.
 */

import {
  type CommandResult,
  type ResultCheck,
  failurePayload,
  successPayload,
  toCliError,
} from './result.js'

/* ── Output context ──────────────────────────────────────────────────────────
   Resolved once per invocation so global flags (--quiet/--verbose/--json/
   --no-color) apply to every helper without threading options through calls.
───────────────────────────────────────────────────────────────────────────── */

export type OutputMode = 'quiet' | 'normal' | 'verbose'

/** Minimal writable surface — `process.stdout` and test doubles both satisfy it. */
export interface OutputStream {
  write(chunk: string): unknown
}

export interface OutputContextOptions {
  mode?: OutputMode
  json?: boolean
  /** Explicit color override (`--no-color`). Omit to auto-detect from env/TTY. */
  color?: boolean
  /** Explicit Unicode override. Omit to auto-detect. */
  unicode?: boolean
  stdout?: OutputStream
  stderr?: OutputStream
}

export interface OutputContext {
  readonly mode: OutputMode
  readonly json: boolean
  readonly color: boolean
  readonly unicode: boolean
  readonly stdout: OutputStream
  readonly stderr: OutputStream
}

function detectColorSupport(): boolean {
  // Honour explicit opt-out / opt-in env vars.
  if (process.env['NO_COLOR'] !== undefined) return false
  if (process.env['FORCE_COLOR'] !== undefined) return true

  // CI environments rarely support color without FORCE_COLOR.
  if (process.env['CI']) return false

  // Check if stdout is a TTY.
  return process.stdout.isTTY === true
}

function detectUnicodeSupport(color: boolean): boolean {
  if (!color) return false
  const enc = process.env['LANG'] ?? process.env['LC_ALL'] ?? ''
  if (enc.toLowerCase().includes('utf')) return true
  // On Windows PowerShell with modern terminal, stdout is a TTY; assume Unicode.
  if (process.platform === 'win32' && process.stdout.isTTY) return true
  return process.stdout.isTTY === true
}

/**
 * Build an output context. Color is auto-detected unless overridden, and is
 * always disabled under `--json` so stdout stays byte-stable for parsers.
 */
export function createOutputContext(options: OutputContextOptions = {}): OutputContext {
  const json = options.json === true
  const color = json ? false : (options.color ?? detectColorSupport())
  return {
    mode: options.mode ?? 'normal',
    json,
    color,
    unicode: options.unicode ?? detectUnicodeSupport(color),
    stdout: options.stdout ?? process.stdout,
    stderr: options.stderr ?? process.stderr,
  }
}

let activeContext: OutputContext | undefined

/** Current output context, lazily auto-detected on first use. */
export function getOutputContext(): OutputContext {
  activeContext ??= createOutputContext()
  return activeContext
}

export function setOutputContext(context: OutputContext): OutputContext {
  activeContext = context
  return context
}

/** Drop the active context so the next call re-detects from env/TTY. */
export function resetOutputContext(): void {
  activeContext = undefined
}

/** Create and install an output context in one step. */
export function configureOutput(options: OutputContextOptions = {}): OutputContext {
  return setOutputContext(createOutputContext(options))
}

/* ── ANSI helpers ────────────────────────────────────────────────────────────
   Tiny inline ANSI escape wrappers — no third-party chalk/kleur dependency.
   All wrap functions are no-ops when the active context has color disabled.
───────────────────────────────────────────────────────────────────────────── */

function ansi(code: string, text: string): string {
  if (!getOutputContext().color) return text
  return `\x1b[${code}m${text}\x1b[0m`
}

/** Warm orange accent (ANSI 256-color index 208 via extended code). */
function orange(text: string): string {
  if (!getOutputContext().color) return text
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

/* ── Channel routing ─────────────────────────────────────────────────────── */

type Channel = 'error' | 'diagnostic' | 'progress' | 'hint' | 'result' | 'verbose'

function emit(channel: Channel, text: string): void {
  const ctx = getOutputContext()

  // Errors are never suppressed and never share stdout with a JSON payload.
  if (channel === 'error') {
    ctx.stderr.write(text)
    return
  }

  if (channel === 'verbose' && ctx.mode !== 'verbose') return

  if (ctx.json) {
    // Human output must not pollute the single stdout payload. Warnings and
    // opt-in verbose detail survive as stderr diagnostics; the rest is dropped.
    if (channel === 'diagnostic' || channel === 'verbose') ctx.stderr.write(text)
    return
  }

  if (ctx.mode === 'quiet' && (channel === 'progress' || channel === 'hint')) return

  ctx.stdout.write(text)
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
  emit('progress', bannerText() + '\n')
}

/* ── Status line helpers ─────────────────────────────────────────────────────
   Each helper writes one line through emit(), which applies mode routing.
   Symbols degrade gracefully: Unicode when the terminal supports it, ASCII otherwise.
───────────────────────────────────────────────────────────────────────────── */

function symbols(): Record<'info' | 'success' | 'warning' | 'error' | 'bullet' | 'arrow', string> {
  const unicode = getOutputContext().unicode
  return {
    info: unicode ? '◆' : '*',
    success: unicode ? '✔' : 'OK',
    warning: unicode ? '⚠' : '!',
    error: unicode ? '✖' : 'ERR',
    bullet: unicode ? '•' : '-',
    arrow: unicode ? '→' : '->',
  }
}

/**
 * Print a neutral status / progress line.
 * Suppressed by `--quiet` and `--json`.
 * Example: ◆ Checking sidecar health…
 */
export function status(message: string): void {
  emit('progress', `${cyan(symbols().info)} ${message}\n`)
}

/** Format a duration for compact progress output. */
export function elapsedTime(startedAt: number, now = Date.now()): string {
  return `${((now - startedAt) / 1000).toFixed(1)}s`
}

/**
 * Print one stable, numbered workflow stage. Stages use the progress channel so
 * quiet and JSON output remain deterministic.
 */
export function stage(number: number, total: number, message: string, startedAt: number): void {
  emit('progress', `${cyan(`${number}/${total}`)} ${message} ${dim(`(${elapsedTime(startedAt)})`)}\n`)
}

export interface ProgressSpinner {
  stop(outcome?: string): void
}

/**
 * Render an in-place progress spinner only when a human is watching a TTY.
 * Every started spinner owns its final newline so later output never lands on
 * a transient terminal line.
 */
export function startProgressSpinner(message: string, startedAt: number): ProgressSpinner {
  const ctx = getOutputContext()
  if (ctx.json || ctx.mode === 'quiet' || process.stdout.isTTY !== true) {
    return { stop() {} }
  }

  const frames = ['|', '/', '-', '\\']
  let index = 0
  let stopped = false
  const render = (): void => {
    ctx.stdout.write(`\r${cyan(frames[index]!)} ${message} ${dim(`(${elapsedTime(startedAt)})`)}`)
    index = (index + 1) % frames.length
  }
  render()
  const timer = setInterval(render, 100)

  return {
    stop(outcome = 'complete'): void {
      if (stopped) return
      stopped = true
      clearInterval(timer)
      ctx.stdout.write(
        `\r${green(symbols().success)} ${message} ${dim(`(${elapsedTime(startedAt)}`)} ${outcome}\n`,
      )
    },
  }
}

/**
 * Print a success line.
 * Example: ✔ buddy started.
 */
export function success(message: string): void {
  emit('result', `${green(symbols().success)} ${bold(message)}\n`)
}

/**
 * Print a warning line (not a fatal error).
 * Routed to stderr under `--json` so stdout stays parseable.
 * Example: ⚠ Token file not found; some features may be unavailable.
 */
export function warn(message: string): void {
  emit('diagnostic', `${yellow(symbols().warning)} ${message}\n`)
}

/**
 * Print a next-step hint. Suppressed by `--quiet` and `--json`.
 * Example: → Try: buddy start
 */
export function hint(message: string): void {
  emit('hint', `  ${dim(symbols().arrow)} ${message}\n`)
}

/**
 * Print a detail line that only appears under `--verbose`.
 * Routed to stderr under `--json`.
 */
export function detail(message: string): void {
  emit('verbose', `  ${dim(message)}\n`)
}

/** Write raw child-process detail without allowing it to contaminate JSON stdout. */
export function verboseRaw(text: string): void {
  emit('verbose', text)
}

/**
 * Print an actionable error message to stderr.
 * Does not exit — the entry boundary owns `process.exitCode`.
 * Expected errors (token missing, app not running, etc.) print without stack traces.
 *
 * @param message  Human-readable summary.
 * @param errorHint  Optional next-step hint printed on a second line.
 */
export function error(message: string, errorHint?: string): void {
  const sym = symbols()
  emit('error', `${red(sym.error)} ${bold(message)}\n`)
  if (errorHint) {
    emit('error', `  ${dim(sym.arrow)} ${errorHint}\n`)
  }
}

/**
 * Print a labeled pass/fail check row (used by doctor output).
 * Example:  ✔  Electron process running
 *           ✖  Sidecar not responding
 */
export function check(label_: string, ok: boolean, detailText?: string): void {
  checkRow({
    label: label_,
    status: ok ? 'pass' : 'fail',
    ...(detailText === undefined ? {} : { detail: detailText }),
  })
}

/**
 * Print one typed checklist row plus its sub-items.
 *
 * Rows use the `result` channel, so `--quiet` keeps the full checklist while
 * `--json` drops it in favour of the single machine-readable payload.
 */
export function checkRow(entry: ResultCheck): void {
  const sym = symbols()
  const mark =
    entry.status === 'pass'
      ? green(sym.success)
      : entry.status === 'warn'
        ? yellow(sym.warning)
        : red(sym.error)
  emit('result', `  ${mark}  ${entry.label}\n`)
  if (entry.detail) {
    emit('result', `       ${dim(entry.detail)}\n`)
  }
  for (const item of entry.items ?? []) {
    subCheck(item.label, item.ok)
  }
}

/**
 * Print a sub-item row under a check (indented).
 * Example:        ✔  claudeCode.UserPromptSubmit
 */
export function subCheck(label_: string, ok: boolean): void {
  const sym = symbols()
  const mark = ok ? green(sym.success) : red(sym.error)
  emit('result', `       ${mark}  ${dim(label_)}\n`)
}

/**
 * Print a bullet list item.
 * Example:  • pets/default
 */
export function bullet(message: string): void {
  emit('result', `  ${orange(symbols().bullet)} ${message}\n`)
}

/**
 * Print a key → value label line.
 * Example:  → State: running
 */
export function label(key: string, value: string): void {
  emit('result', `  ${dim(symbols().arrow)} ${bold(key)}: ${value}\n`)
}

/**
 * Print a section heading with a separator.
 * Suppressed by `--quiet` and `--json`.
 */
export function heading(title: string): void {
  emit('progress', `\n${bold(orange(title))}\n`)
  emit('progress', separator() + '\n')
}

/**
 * Print a closing separator. Suppressed by `--quiet` and `--json`.
 */
export function closeSeparator(): void {
  emit('progress', separator() + '\n')
}

/* ── Typed result rendering ──────────────────────────────────────────────────
   The entry boundary renders typed outcomes here so command implementations
   never write to streams directly and never call process.exit.
───────────────────────────────────────────────────────────────────────────── */

/**
 * Render an optional heading + checklist section.
 *
 * The heading and closing separator are progress decoration, so `--quiet` keeps
 * only the rows themselves. Callers under `--json` never reach this.
 */
function renderChecks(sectionHeading?: string, checks?: readonly ResultCheck[]): void {
  if (sectionHeading) heading(sectionHeading)
  for (const entry of checks ?? []) checkRow(entry)
  if (checks && checks.length > 0) closeSeparator()
}

/** Render a typed success result: one JSON payload, or human summary/details. */
export function renderResult<T>(result: CommandResult<T>): void {
  const ctx = getOutputContext()

  if (ctx.json) {
    ctx.stdout.write(JSON.stringify(successPayload(result)) + '\n')
    return
  }

  renderChecks(result.heading, result.checks)
  if (result.summary) success(result.summary)
  for (const row of result.details ?? []) label(row.label, row.value)
  for (const line of result.verboseDetails ?? []) detail(line)
  if (result.hint) hint(result.hint)
  for (const step of result.nextSteps ?? []) hint(step)
}

/**
 * Render a failed outcome and return the process exit code to apply.
 *
 * In JSON mode the failure payload is still the single stdout result so scripts
 * can branch on `ok`; the human message stays on stderr.
 */
export function renderFailure(value: unknown, command: string | null = null): number {
  const ctx = getOutputContext()
  const err = toCliError(value)

  if (ctx.json) {
    ctx.stdout.write(JSON.stringify(failurePayload(err, command)) + '\n')
  } else {
    // A failed diagnostic still shows which checks passed before the message.
    renderChecks(err.heading, err.checks)
  }

  error(err.message, err.hint)

  if (ctx.mode === 'verbose' && err.stack) {
    emit('error', `${dim(err.stack)}\n`)
  }

  return err.exitCode
}

/* ── Re-exported theme colors (for callers that want raw styled strings) ── */
export { orange, bold, dim, green, yellow, red, cyan }
