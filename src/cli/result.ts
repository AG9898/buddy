/**
 * result.ts — Typed CLI command results and expected errors.
 *
 * Command implementations describe *what happened* with these types; they never
 * decide how it is printed and never call `process.exit`. The entry boundary
 * (`src/cli/index.ts`) renders the recorded result or the thrown `CliError`
 * through `src/cli/output.ts` and owns `process.exitCode`.
 *
 * This keeps command logic unit-testable without mocking streams or trapping
 * process termination.
 *
 * No Electron imports anywhere in src/cli/ — safe to run in WSL node.
 */

/* ── Typed success results ─────────────────────────────────────────────────── */

/** One `key: value` row rendered under a human-mode summary. */
export interface ResultDetail {
  readonly label: string
  readonly value: string
}

/**
 * The typed outcome of a successful command.
 *
 * `data` is the machine-readable payload emitted verbatim in `--json` mode, so
 * its shape is part of the public CLI contract. The remaining fields only shape
 * human rendering.
 */
export interface CommandResult<T = unknown> {
  /** Stable dotted command identifier, e.g. `pets.list`. */
  readonly command: string
  /** Machine-readable payload for `--json`. */
  readonly data: T
  /** One-line human success message. */
  readonly summary?: string
  /** `key: value` rows shown in human mode. */
  readonly details?: readonly ResultDetail[]
  /** Next-command hint; suppressed by `--quiet`. */
  readonly hint?: string
  /** Extra lines shown only under `--verbose`. */
  readonly verboseDetails?: readonly string[]
  /** Suggested follow-up commands; rendered like hints and suppressed the same way. */
  readonly nextSteps?: readonly string[]
}

/** Build a typed success result (thin helper for inference and readability). */
export function commandResult<T>(
  command: string,
  data: T,
  extra: Omit<CommandResult<T>, 'command' | 'data'> = {},
): CommandResult<T> {
  return { command, data, ...extra }
}

/* ── Typed expected errors ─────────────────────────────────────────────────── */

export interface CliErrorOptions {
  /** Stable machine-readable error code, e.g. `sidecar.unreachable`. */
  readonly code?: string
  /** Actionable next step shown under the message. */
  readonly hint?: string
  /** Process exit code for this failure. */
  readonly exitCode?: number
  /** Extra machine-readable context emitted in `--json` mode. */
  readonly data?: Readonly<Record<string, unknown>>
  readonly cause?: unknown
}

export const DEFAULT_ERROR_CODE = 'buddy.error'
export const DEFAULT_ERROR_EXIT_CODE = 1

/**
 * An expected, user-actionable failure.
 *
 * These render as a concise terminal error without a stack trace. Unexpected
 * errors stay plain `Error`s and are wrapped by `toCliError` at the boundary.
 */
export class CliError extends Error {
  readonly code: string
  readonly hint: string | undefined
  readonly exitCode: number
  readonly data: Readonly<Record<string, unknown>> | undefined

  constructor(message: string, options: CliErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'CliError'
    this.code = options.code ?? DEFAULT_ERROR_CODE
    this.hint = options.hint
    this.exitCode = options.exitCode ?? DEFAULT_ERROR_EXIT_CODE
    this.data = options.data
  }
}

/** Type guard for `CliError`, tolerant of duplicated module instances. */
export function isCliError(value: unknown): value is CliError {
  return value instanceof CliError || (value instanceof Error && value.name === 'CliError')
}

/** Normalize any thrown value into a `CliError` the renderer can display. */
export function toCliError(value: unknown): CliError {
  if (value instanceof CliError) return value
  if (value instanceof Error) {
    return new CliError(value.message, { cause: value })
  }
  return new CliError(String(value))
}

/* ── JSON payloads ─────────────────────────────────────────────────────────── */

export interface JsonSuccessPayload<T = unknown> {
  readonly ok: true
  readonly command: string
  readonly data: T
}

export interface JsonFailurePayload {
  readonly ok: false
  readonly command: string | null
  readonly error: {
    readonly code: string
    readonly message: string
    readonly hint?: string
    readonly data?: Readonly<Record<string, unknown>>
  }
}

export type JsonPayload<T = unknown> = JsonSuccessPayload<T> | JsonFailurePayload

/** Build the single stdout payload for a successful `--json` invocation. */
export function successPayload<T>(result: CommandResult<T>): JsonSuccessPayload<T> {
  return { ok: true, command: result.command, data: result.data }
}

/** Build the single stdout payload for a failed `--json` invocation. */
export function failurePayload(value: unknown, command: string | null = null): JsonFailurePayload {
  const err = toCliError(value)
  return {
    ok: false,
    command,
    error: {
      code: err.code,
      message: err.message,
      ...(err.hint === undefined ? {} : { hint: err.hint }),
      ...(err.data === undefined ? {} : { data: err.data }),
    },
  }
}

/* ── Per-invocation result slot ────────────────────────────────────────────────
   Commander action handlers cannot return a value to the caller, so commands
   record their typed result here and the entry boundary drains it after parse.
───────────────────────────────────────────────────────────────────────────── */

let pendingResult: CommandResult | undefined
let pendingCommand: string | undefined

/** Record the command identifier before an action performs asynchronous work. */
export function recordCommand(command: string): void {
  pendingCommand = command
}

/** Record the typed result of the command that just ran. */
export function recordResult<T>(result: CommandResult<T>): CommandResult<T> {
  pendingResult = result as CommandResult
  pendingCommand = result.command
  return result
}

/** Take and clear the recorded result. Returns `undefined` if none was recorded. */
export function takeResult(): CommandResult | undefined {
  const result = pendingResult
  pendingResult = undefined
  pendingCommand = undefined
  return result
}

/** Take and clear the command currently executing, if one was recorded. */
export function takeCommand(): string | null {
  const command = pendingCommand ?? null
  pendingCommand = undefined
  return command
}

/** Discard any recorded result (test isolation). */
export function clearResult(): void {
  pendingResult = undefined
  pendingCommand = undefined
}
