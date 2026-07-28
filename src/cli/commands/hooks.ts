/**
 * buddy hooks install — write Claude Code and/or Codex CLI hook entries.
 *
 * On Windows: installs hooks that call `buddy state <name>`.
 * In WSL: installs hooks that call `petdex-bridge state <name>`.
 *
 * Installation itself lives in `src/main/hooks-install.ts` and is idempotent.
 * This module only turns its result into a typed outcome: one checklist row per
 * assistant plus a summary, or a typed expected error when a target could not
 * be written. It never writes to a stream and never sets an exit code.
 *
 * No Electron imports in this module.
 */

import { installHooks, type HookInstallResult } from '../../main/hooks-install.js'
import { isWSL } from '../env.js'
import {
  CliError,
  commandResult,
  type CommandResult,
  type ResultCheck,
  type ResultCheckStatus,
} from '../result.js'

const HOOKS_HEADING = 'buddy hooks install'

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

/** Split a `"<target>:<event>"` or `"<target>: <message>"` entry at the first colon. */
function splitEntry(entry: string): { target: string; value: string } {
  const index = entry.indexOf(':')
  if (index < 0) return { target: entry, value: entry }
  return { target: entry.slice(0, index), value: entry.slice(index + 1).trim() }
}

/** Group a raw install result into deterministic per-assistant reports. */
export function summarizeInstall(result: HookInstallResult): HookTargetReport[] {
  const grouped = new Map<string, { installed: string[]; skipped: string[]; errors: string[] }>()
  const bucket = (target: string): { installed: string[]; skipped: string[]; errors: string[] } => {
    const existing = grouped.get(target)
    if (existing) return existing
    const created = { installed: [], skipped: [], errors: [] }
    grouped.set(target, created)
    return created
  }

  for (const entry of result.installed) {
    const { target, value } = splitEntry(entry)
    bucket(target).installed.push(value)
  }
  for (const entry of result.skipped) {
    const { target, value } = splitEntry(entry)
    bucket(target).skipped.push(value)
  }
  for (const entry of result.errors) {
    const { target, value } = splitEntry(entry)
    bucket(target).errors.push(value)
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([target, entries]) => ({
      target,
      // A target that wrote nothing at all failed; a partial write is degraded.
      status:
        entries.errors.length === 0
          ? 'pass'
          : entries.installed.length + entries.skipped.length > 0
            ? 'warn'
            : 'fail',
      installed: entries.installed,
      skipped: entries.skipped,
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
  const runtime: 'windows' | 'wsl' = isWSL() ? 'wsl' : 'windows'

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
