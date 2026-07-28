/**
 * buddy status — one operational summary of the local buddy installation.
 *
 * The Electron-owned, token-authenticated `GET /status` snapshot supplies app
 * running/visibility, the resolved active pet, and the current window size.
 * Hook coverage is resolved locally by the same detection `buddy doctor` uses.
 *
 * `runOverview()` is the bare-`buddy` surface: identical data and identical
 * `--json` payload, plus suggested next commands for a human terminal.
 *
 * Status is a read-only report, so a stopped app, a missing token, or an
 * unreachable sidecar degrade into a "not running" result instead of a failure.
 * Only the failure *code* is reported — never a token value, a filesystem path,
 * or any assistant configuration content.
 *
 * No Electron imports in this module.
 */

import { getHooksStatus } from '../../main/hooks-install.js'
import { isWSL } from '../env.js'
import { commandResult, isCliError, type CommandResult } from '../result.js'
import { getFromSidecar } from '../sidecar-client.js'
import { resolveCliVersion } from '../version.js'

/** Shorter than the shared default: status must stay a fast, interactive read. */
const STATUS_TIMEOUT_MS = 2_000

export type HookCoverage = 'none' | 'partial' | 'complete'

export interface StatusHookTarget {
  readonly installed: number
  readonly total: number
}

export interface StatusHooks {
  readonly installed: number
  readonly total: number
  readonly coverage: HookCoverage
  /** Per-assistant counts only — never hook commands or configuration content. */
  readonly targets: Readonly<Record<string, StatusHookTarget>>
}

export interface StatusPet {
  readonly id: string
  readonly name: string
  readonly source: string
}

export interface StatusWindow {
  readonly width: number
  readonly height: number
}

/** Machine-readable `--json` payload for `buddy status` and bare `buddy`. */
export interface StatusCommandData {
  readonly version: string
  readonly environment: 'windows' | 'wsl'
  readonly app: { readonly running: boolean; readonly visible: boolean }
  readonly pet: StatusPet | null
  readonly window: StatusWindow | null
  readonly hooks: StatusHooks
  /** `error` carries the stable failure code only, never a message or path. */
  readonly sidecar: { readonly reachable: boolean; readonly error: string | null }
}

/* ── Snapshot parsing ────────────────────────────────────────────────────────
   The sidecar is buddy-owned, but the response is still validated so a partial
   or unexpected body degrades to "not running" rather than printing junk.
───────────────────────────────────────────────────────────────────────────── */

interface ParsedSnapshot {
  readonly running: boolean
  readonly visible: boolean
  readonly pet: StatusPet | null
  readonly window: StatusWindow | null
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function dimension(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null
}

export function parseStatusSnapshot(value: unknown): ParsedSnapshot | null {
  const body = record(value)
  const app = record(body?.['app'])
  if (!body || !app || typeof app['running'] !== 'boolean') return null

  const petBody = record(body['pet'])
  const id = text(petBody?.['id'])
  const name = text(petBody?.['name'])
  const source = text(petBody?.['source'])

  const windowBody = record(body['window'])
  const width = dimension(windowBody?.['width'])
  const height = dimension(windowBody?.['height'])

  return {
    running: app['running'],
    visible: app['visible'] === true,
    pet: id && name && source ? { id, name, source } : null,
    window: width && height ? { width, height } : null,
  }
}

/* ── Hook coverage ───────────────────────────────────────────────────────── */

/** Summarize installed hook entries into per-assistant counts. */
export function summarizeHooks(status: Readonly<Record<string, boolean>>): StatusHooks {
  const targets: Record<string, StatusHookTarget> = {}
  let installed = 0
  let total = 0

  for (const key of Object.keys(status).sort()) {
    const ok = status[key] === true
    const separator = key.indexOf(':')
    const target = separator > 0 ? key.slice(0, separator) : key
    const current = targets[target] ?? { installed: 0, total: 0 }
    targets[target] = {
      installed: current.installed + (ok ? 1 : 0),
      total: current.total + 1,
    }
    installed += ok ? 1 : 0
    total += 1
  }

  const coverage: HookCoverage =
    total === 0 || installed === 0 ? 'none' : installed === total ? 'complete' : 'partial'

  return { installed, total, coverage, targets }
}

/* ── Collection ──────────────────────────────────────────────────────────── */

/** Gather the full operational snapshot without deciding how it is rendered. */
export async function collectStatus(): Promise<StatusCommandData> {
  const environment: 'windows' | 'wsl' = isWSL() ? 'wsl' : 'windows'
  const hooks = summarizeHooks(
    getHooksStatus({ claudeCode: true, codexCli: true, runtime: environment }),
  )

  let snapshot: ParsedSnapshot | null = null
  let error: string | null = null

  try {
    const response = await getFromSidecar<unknown>('/status', { timeoutMs: STATUS_TIMEOUT_MS })
    snapshot = parseStatusSnapshot(response.data)
    if (!snapshot) error = 'sidecar.invalid_response'
  } catch (err) {
    // Only the stable code travels into the result; messages and hints can
    // contain the token path and are deliberately dropped here.
    error = isCliError(err) ? err.code : 'sidecar.connection_error'
  }

  return {
    version: resolveCliVersion(),
    environment,
    app: {
      running: snapshot?.running === true,
      visible: snapshot?.running === true && snapshot.visible,
    },
    pet: snapshot?.running === true ? snapshot.pet : null,
    window: snapshot?.running === true ? snapshot.window : null,
    hooks,
    sidecar: { reachable: snapshot !== null, error },
  }
}

/* ── Rendering ───────────────────────────────────────────────────────────── */

function hookValue(hooks: StatusHooks): string {
  const targets = Object.entries(hooks.targets)
    .map(([target, counts]) => `${target} ${counts.installed}/${counts.total}`)
    .join(', ')
  const summary = `${hooks.installed}/${hooks.total} installed`
  return targets ? `${summary} (${targets})` : summary
}

function statusDetails(data: StatusCommandData): Array<{ label: string; value: string }> {
  const details = [
    { label: 'Version', value: data.version },
    {
      label: 'App',
      value: data.app.running ? (data.app.visible ? 'running (visible)' : 'running (hidden)') : 'stopped',
    },
  ]

  if (data.pet) {
    details.push({ label: 'Pet', value: `${data.pet.name} (${data.pet.id}, ${data.pet.source})` })
  }
  if (data.window) {
    details.push({ label: 'Window', value: `${data.window.width}x${data.window.height}` })
  }

  details.push({ label: 'Hooks', value: hookValue(data.hooks) })
  return details
}

/** The single actionable next step for the current state, if there is one. */
function statusHint(data: StatusCommandData): string | undefined {
  if (!data.app.running) {
    return data.sidecar.error === 'sidecar.token_missing'
      ? 'No runtime token yet — start the app once: buddy start'
      : 'Start the app: buddy start'
  }
  if (data.hooks.coverage !== 'complete') return 'Install the missing hooks: buddy hooks install'
  return undefined
}

/** Suggested commands for the interactive root overview (deterministic order). */
function nextSteps(data: StatusCommandData): string[] {
  const steps = data.app.running
    ? ['buddy pets list', 'buddy size 1.5', 'buddy stop']
    : ['buddy start', 'buddy pets list']
  if (data.hooks.coverage !== 'complete') steps.push('buddy hooks install')
  steps.push('buddy --help')
  return steps
}

function summaryFor(data: StatusCommandData): string {
  return data.app.running ? 'buddy is running.' : 'buddy is not running.'
}

function verboseFor(data: StatusCommandData): string[] {
  return [
    `GET /status → ${data.sidecar.reachable ? 'ok' : (data.sidecar.error ?? 'unavailable')}`,
    `Environment: ${data.environment}`,
  ]
}

/** `buddy status` — the operational summary without the banner or suggestions. */
export async function runStatus(): Promise<CommandResult<StatusCommandData>> {
  const data = await collectStatus()
  return commandResult('app.status', data, {
    summary: summaryFor(data),
    details: statusDetails(data),
    ...(statusHint(data) === undefined ? {} : { hint: statusHint(data)! }),
    verboseDetails: verboseFor(data),
  })
}

/** Bare `buddy` — the same result plus suggested next commands. */
export async function runOverview(): Promise<CommandResult<StatusCommandData>> {
  const data = await collectStatus()
  return commandResult('app.status', data, {
    summary: summaryFor(data),
    details: statusDetails(data),
    verboseDetails: verboseFor(data),
    nextSteps: nextSteps(data),
  })
}
