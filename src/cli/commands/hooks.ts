/**
 * buddy hooks — the install / status / uninstall lifecycle for assistant hooks.
 *
 * On Windows: installs hooks that call `buddy state <name>`.
 * In WSL: installs hooks that call `petdex-bridge state <name>`.
 *
 * Installation, detection, and removal all live in `src/main/hooks-install.ts`
 * and are idempotent. This module only turns their results into typed outcomes:
 * one checklist row per assistant plus a summary, or a typed expected error when
 * a target could not be written. It never writes to a stream, never sets an exit
 * code, and never modifies configuration outside an explicit install/uninstall
 * invocation — `status` is strictly read-only, like `buddy doctor`.
 *
 * No Electron imports in this module.
 */

import {
  getHooksStatus,
  installHooks,
  uninstallHooks,
  type HookInstallResult,
  type HookUninstallResult,
} from '../../main/hooks-install.js'
import { isWSL } from '../env.js'
import {
  CliError,
  commandResult,
  type CommandResult,
  type ResultCheck,
  type ResultCheckStatus,
} from '../result.js'
// Type-only: the coverage vocabulary is shared with `buddy status`, but no
// command module imports another command module at runtime.
import type { HookCoverage } from './status.js'

const HOOKS_HEADING = 'buddy hooks install'
const HOOKS_STATUS_HEADING = 'buddy hooks status'
const HOOKS_UNINSTALL_HEADING = 'buddy hooks uninstall'

/** The runtime whose hook commands this host installs and detects. */
function currentRuntime(): 'windows' | 'wsl' {
  return isWSL() ? 'wsl' : 'windows'
}

/** Per-assistant breakdown of one install run. */
export interface HookTargetReport {
  readonly target: string
  readonly status: ResultCheckStatus
  /** Hook events newly written on this run. */
  readonly installed: readonly string[]
  /** Hook events already present, left untouched. */
  readonly skipped: readonly string[]
  /** Failure messages reported for this target. */
  readonly errors: readonly string[]
}

/** Machine-readable `--json` payload for `buddy hooks install`. */
export type HooksInstallCommandData = {
  readonly runtime: 'windows' | 'wsl'
  readonly installed: number
  readonly skipped: number
  readonly failed: number
  readonly targets: readonly HookTargetReport[]
}

/** Per-assistant breakdown of one uninstall run. */
export interface HookRemovalReport {
  readonly target: string
  readonly status: ResultCheckStatus
  /** Hook events whose buddy-owned entry was removed on this run. */
  readonly removed: readonly string[]
  /** Hook events that carried no buddy-owned entry to begin with. */
  readonly skipped: readonly string[]
  readonly errors: readonly string[]
}

/** Machine-readable `--json` payload for `buddy hooks uninstall`. */
export type HooksUninstallCommandData = {
  readonly runtime: 'windows' | 'wsl'
  readonly removed: number
  readonly skipped: number
  readonly failed: number
  readonly targets: readonly HookRemovalReport[]
}

/** One event row under a `buddy hooks status` assistant. */
export interface HookEventStatus {
  readonly event: string
  readonly installed: boolean
}

/** Per-assistant coverage in one `buddy hooks status` report. */
export interface HookStatusTarget {
  readonly target: string
  readonly status: ResultCheckStatus
  readonly installed: number
  readonly total: number
  readonly events: readonly HookEventStatus[]
}

/** Machine-readable `--json` payload for `buddy hooks status`. */
export type HooksStatusCommandData = {
  readonly runtime: 'windows' | 'wsl'
  readonly installed: number
  readonly total: number
  readonly coverage: HookCoverage
  readonly targets: readonly HookStatusTarget[]
}

/** Split a `"<target>:<event>"` or `"<target>: <message>"` entry at the first colon. */
function splitEntry(entry: string): { target: string; value: string } {
  const index = entry.indexOf(':')
  if (index < 0) return { target: entry, value: entry }
  return { target: entry.slice(0, index), value: entry.slice(index + 1).trim() }
}

/** Per-target buckets of one install or uninstall run. */
interface GroupedEntries {
  /** Events changed by this run: installed for install, removed for uninstall. */
  changed: string[]
  /** Events left alone: already present for install, already absent for uninstall. */
  untouched: string[]
  errors: string[]
}

/** Group `"<target>:…"` entries into deterministic per-assistant buckets. */
function groupByTarget(
  changed: readonly string[],
  untouched: readonly string[],
  errors: readonly string[],
): Array<[string, GroupedEntries]> {
  const grouped = new Map<string, GroupedEntries>()
  const bucket = (target: string): GroupedEntries => {
    const existing = grouped.get(target)
    if (existing) return existing
    const created: GroupedEntries = { changed: [], untouched: [], errors: [] }
    grouped.set(target, created)
    return created
  }

  for (const [entries, key] of [
    [changed, 'changed'],
    [untouched, 'untouched'],
    [errors, 'errors'],
  ] as const) {
    for (const entry of entries) {
      const { target, value } = splitEntry(entry)
      bucket(target)[key].push(value)
    }
  }

  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))
}

/**
 * Severity of one target: a target that changed nothing at all failed, while a
 * target that changed some entries and then failed is degraded.
 */
function targetStatus(entries: GroupedEntries): ResultCheckStatus {
  if (entries.errors.length === 0) return 'pass'
  return entries.changed.length + entries.untouched.length > 0 ? 'warn' : 'fail'
}

/** Group a raw install result into deterministic per-assistant reports. */
export function summarizeInstall(result: HookInstallResult): HookTargetReport[] {
  return groupByTarget(result.installed, result.skipped, result.errors).map(
    ([target, entries]) => ({
      target,
      status: targetStatus(entries),
      installed: entries.changed,
      skipped: entries.untouched,
      errors: entries.errors,
    }),
  )
}

/** Group a raw uninstall result into deterministic per-assistant reports. */
export function summarizeUninstall(result: HookUninstallResult): HookRemovalReport[] {
  return groupByTarget(result.removed, result.skipped, result.errors).map(([target, entries]) => ({
    target,
    status: targetStatus(entries),
    removed: entries.changed,
    skipped: entries.untouched,
    errors: entries.errors,
  }))
}

function targetDetail(report: HookTargetReport): string {
  const parts: string[] = []
  if (report.installed.length > 0) parts.push(`${report.installed.length} installed`)
  if (report.skipped.length > 0) parts.push(`${report.skipped.length} already present`)
  if (report.errors.length === 0 && parts.length === 0) parts.push('no changes')
  return [...parts, ...report.errors].join('  —  ')
}

function hookChecks(data: HooksInstallCommandData): ResultCheck[] {
  return data.targets.map((report) => ({
    label: report.target,
    status: report.status,
    detail: targetDetail(report),
  }))
}

function summaryFor(data: HooksInstallCommandData): string {
  if (data.installed === 0) return 'All hooks are already installed.'
  return `Hooks installed (${data.installed} new, ${data.skipped} already present).`
}

/**
 * Install hooks for both supported assistants and return the typed outcome.
 *
 * @param shellRcPath Deprecated `--rc` value; accepted and ignored.
 */
export function runHooksInstall(shellRcPath?: string): CommandResult<HooksInstallCommandData> {
  const runtime = currentRuntime()

  const result: HookInstallResult = installHooks({
    claudeCode: true,
    codexCli: true,
    runtime,
    ...(shellRcPath === undefined ? {} : { shellRcPath }),
  })

  const targets = summarizeInstall(result)
  const data: HooksInstallCommandData = {
    runtime,
    installed: result.installed.length,
    skipped: result.skipped.length,
    failed: result.errors.length,
    targets,
  }
  const checks = hookChecks(data)

  if (data.failed > 0) {
    throw new CliError('Some hooks could not be installed.', {
      code: 'hooks.install_failed',
      hint: 'Check write access to ~/.claude/settings.json and ~/.codex/hooks.json, then re-run: buddy hooks install',
      heading: HOOKS_HEADING,
      checks,
      data: { ...data },
    })
  }

  const installedCodex = targets.some(
    (report) => report.target === 'codex-cli' && report.installed.length > 0,
  )

  return commandResult('hooks.install', data, {
    heading: HOOKS_HEADING,
    checks,
    summary: summaryFor(data),
    details: [{ label: 'Runtime', value: runtime === 'wsl' ? 'WSL' : 'Windows' }],
    ...(installedCodex
      ? { hint: 'Codex CLI may require approving the new hooks from /hooks before it runs them.' }
      : {}),
    nextSteps: ['buddy doctor'],
  })
}

/* ── buddy hooks status ──────────────────────────────────────────────────────
   Read-only: it runs the same detection `buddy doctor` and `buddy status` use
   and never opens a configuration file for writing.
───────────────────────────────────────────────────────────────────────────── */

/** Group the flat `"<target>:<event>" → boolean` detection map by assistant. */
export function summarizeStatus(status: Readonly<Record<string, boolean>>): HookStatusTarget[] {
  const grouped = new Map<string, HookEventStatus[]>()

  // Detection order is derived from a constant map, so it is already stable;
  // only the assistants themselves need an explicit sort.
  for (const key of Object.keys(status)) {
    const { target, value } = splitEntry(key)
    const events = grouped.get(target) ?? []
    events.push({ event: value, installed: status[key] === true })
    grouped.set(target, events)
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([target, events]) => {
      const installed = events.filter((entry) => entry.installed).length
      return {
        target,
        // Partial coverage is degraded-but-present, matching the doctor row.
        status: installed === events.length ? 'pass' : installed > 0 ? 'warn' : 'fail',
        installed,
        total: events.length,
        events,
      }
    })
}

/** Classify overall coverage with the same rule `buddy status` reports. */
function coverageFor(installed: number, total: number): HookCoverage {
  if (total === 0 || installed === 0) return 'none'
  return installed === total ? 'complete' : 'partial'
}

function statusChecks(data: HooksStatusCommandData): ResultCheck[] {
  return data.targets.map((report) => ({
    label: report.target,
    status: report.status,
    detail: `${report.installed}/${report.total} installed`,
    items: report.events.map((entry) => ({ label: entry.event, ok: entry.installed })),
  }))
}

/**
 * Report hook coverage per assistant and per event without touching any file.
 *
 * Incomplete coverage is a report, not a failure: like `buddy status`, this
 * command exits `0` and hints at the recovery command. Use `buddy doctor` when a
 * non-zero exit for an unhealthy install is wanted.
 */
export function runHooksStatus(): CommandResult<HooksStatusCommandData> {
  const runtime = currentRuntime()
  const targets = summarizeStatus(getHooksStatus({ claudeCode: true, codexCli: true, runtime }))

  const installed = targets.reduce((sum, report) => sum + report.installed, 0)
  const total = targets.reduce((sum, report) => sum + report.total, 0)
  const data: HooksStatusCommandData = {
    runtime,
    installed,
    total,
    coverage: coverageFor(installed, total),
    targets,
  }

  const summary =
    data.coverage === 'complete'
      ? `All hooks are installed (${installed}/${total}).`
      : data.coverage === 'none'
        ? 'No buddy hooks are installed.'
        : `Hook coverage is partial (${installed}/${total} installed).`

  return commandResult('hooks.status', data, {
    heading: HOOKS_STATUS_HEADING,
    checks: statusChecks(data),
    summary,
    details: [{ label: 'Runtime', value: runtime === 'wsl' ? 'WSL' : 'Windows' }],
    ...(data.coverage === 'complete'
      ? {}
      : { hint: 'Install the missing hooks: buddy hooks install' }),
  })
}

/* ── buddy hooks uninstall ───────────────────────────────────────────────────
   Destructive, so it happens only on this explicit invocation. `doctor` and
   `status` never call it.
───────────────────────────────────────────────────────────────────────────── */

function removalDetail(report: HookRemovalReport): string {
  const parts: string[] = []
  if (report.removed.length > 0) parts.push(`${report.removed.length} removed`)
  if (report.skipped.length > 0) parts.push(`${report.skipped.length} already absent`)
  if (report.errors.length === 0 && parts.length === 0) parts.push('no changes')
  return [...parts, ...report.errors].join('  —  ')
}

function removalChecks(data: HooksUninstallCommandData): ResultCheck[] {
  return data.targets.map((report) => ({
    label: report.target,
    status: report.status,
    detail: removalDetail(report),
  }))
}

/**
 * Remove every buddy-owned hook entry and return the typed outcome.
 *
 * Unrelated Claude Code and Codex CLI configuration is preserved, and a repeated
 * run is a successful no-op that reports every event as already absent.
 */
export function runHooksUninstall(): CommandResult<HooksUninstallCommandData> {
  const runtime = currentRuntime()
  const result: HookUninstallResult = uninstallHooks({
    claudeCode: true,
    codexCli: true,
    runtime,
  })

  const targets = summarizeUninstall(result)
  const data: HooksUninstallCommandData = {
    runtime,
    removed: result.removed.length,
    skipped: result.skipped.length,
    failed: result.errors.length,
    targets,
  }
  const checks = removalChecks(data)

  if (data.failed > 0) {
    throw new CliError('Some hook entries could not be removed.', {
      code: 'hooks.uninstall_failed',
      hint: 'Check ~/.claude/settings.json and ~/.codex/hooks.json are readable, writable, and valid JSON, then re-run: buddy hooks uninstall',
      heading: HOOKS_UNINSTALL_HEADING,
      checks,
      data: { ...data },
    })
  }

  return commandResult('hooks.uninstall', data, {
    heading: HOOKS_UNINSTALL_HEADING,
    checks,
    summary:
      data.removed === 0
        ? 'No buddy hook entries were present.'
        : `Hooks removed (${data.removed} removed, ${data.skipped} already absent).`,
    details: [{ label: 'Runtime', value: runtime === 'wsl' ? 'WSL' : 'Windows' }],
    nextSteps: ['buddy hooks status'],
  })
}
