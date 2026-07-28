/**
 * buddy doctor — a pass/warn/fail health checklist for the local installation.
 *
 * Checks:
 *   1. Electron runtime is resolvable from the installed package
 *   2. Electron process is running (tasklist)
 *   3. GET /health returns HTTP 200
 *   4. Update token file exists
 *   5. Hooks are installed (Claude Code and Codex CLI)
 *
 * Collection is separated from presentation: `collectDoctorReport()` produces
 * plain data and `runDoctor()` turns it into a typed result, or into a typed
 * expected error when a check fails. The command never writes to a stream and
 * never sets an exit code — the CLI entry boundary renders both outcomes.
 *
 * Partial hook coverage is reported as a warning rather than a hard failure
 * symbol, but it still leaves the run unhealthy, so the non-zero exit code for
 * an unhealthy install is unchanged.
 *
 * No Electron imports in this module.
 */

import fs from 'fs'
import http from 'http'
import { execSync } from 'child_process'
import os from 'os'
import { getHooksStatus } from '../../main/hooks-install.js'
import { sidecarBaseUrl } from '../env.js'
import { isWSL } from '../env.js'
import {
  CliError,
  commandResult,
  type CommandResult,
  type ResultCheck,
  type ResultCheckStatus,
} from '../result.js'
import { resolveElectronBin, resolvePackageRoot } from '../runtime.js'
import { buddyTokenPath } from '../../shared/buddy-paths.js'

export type DoctorCheckId = 'runtime' | 'process' | 'sidecar' | 'token' | 'hooks'

/** One indented hook row under the hooks check. */
export interface DoctorCheckItem {
  readonly label: string
  readonly ok: boolean
}

export interface DoctorCheckReport {
  readonly id: DoctorCheckId
  readonly label: string
  /** `false` for both `warn` and `fail`; the run is healthy only when all are true. */
  readonly ok: boolean
  readonly status: ResultCheckStatus
  /** Resolved supporting fact, e.g. an executable or token path. */
  readonly detail?: string
  /** Recovery command shown with the row and reused as the failure hint. */
  readonly hint?: string
  readonly items?: readonly DoctorCheckItem[]
}

/** Machine-readable `--json` payload for `buddy doctor`. */
export type DoctorCommandData = {
  readonly ok: boolean
  readonly passed: number
  readonly total: number
  readonly environment: 'windows' | 'wsl'
  readonly checks: readonly DoctorCheckReport[]
}

function resolveTokenPath(): string {
  return buddyTokenPath(process.env, os.homedir())
}

function checkProcessRunning(): boolean {
  // `stdio: 'pipe'` already captures stderr, so the probe never adds a `2>NUL`
  // redirect: under WSL the surrounding shell would create a literal NUL file.
  const prefix = isWSL() ? 'cmd.exe /c ' : ''
  for (const image of ['buddy.exe', 'electron.exe']) {
    try {
      const out = execSync(`${prefix}tasklist /FI "IMAGENAME eq ${image}" /NH`, {
        stdio: 'pipe',
        encoding: 'utf8',
      })
      if (out.toLowerCase().includes(image)) return true
    } catch {
      // Missing tasklist or a non-zero exit means "not observed"; try the next image.
    }
  }
  return false
}

function checkSidecar(): Promise<boolean> {
  return new Promise((resolve) => {
    const url = `${sidecarBaseUrl()}/health`
    const req = http.get(url, (res) => {
      resolve(res.statusCode === 200)
      res.resume()
    })
    req.on('error', () => resolve(false))
    req.setTimeout(2000, () => {
      req.destroy()
      resolve(false)
    })
  })
}

function checkTokenFile(): boolean {
  return fs.existsSync(resolveTokenPath())
}

/* ── Collection ──────────────────────────────────────────────────────────── */

/** Run every health check and return the report without rendering it. */
export async function collectDoctorReport(): Promise<DoctorCommandData> {
  const environment: 'windows' | 'wsl' = isWSL() ? 'wsl' : 'windows'
  const checks: DoctorCheckReport[] = []

  const electronBin = resolveElectronBin()
  checks.push({
    id: 'runtime',
    label: 'Electron runtime available',
    ok: electronBin !== null,
    status: electronBin !== null ? 'pass' : 'fail',
    ...(electronBin === null
      ? {
          detail: `Expected Electron under ${resolvePackageRoot()}`,
          hint: 'Reinstall: npm install -g @ag9898/buddy',
        }
      : { detail: electronBin }),
  })

  const processRunning = checkProcessRunning()
  checks.push({
    id: 'process',
    label: 'Electron process running',
    ok: processRunning,
    status: processRunning ? 'pass' : 'fail',
    ...(processRunning ? {} : { hint: 'Start the app: buddy start' }),
  })

  const sidecarOk = await checkSidecar()
  checks.push({
    id: 'sidecar',
    label: 'Sidecar /health responds',
    ok: sidecarOk,
    status: sidecarOk ? 'pass' : 'fail',
    detail: `${sidecarBaseUrl()}/health`,
    ...(sidecarOk ? {} : { hint: 'Start the app: buddy start' }),
  })

  const tokenOk = checkTokenFile()
  checks.push({
    id: 'token',
    label: 'Update token file exists',
    ok: tokenOk,
    status: tokenOk ? 'pass' : 'fail',
    detail: resolveTokenPath(),
    ...(tokenOk ? {} : { hint: 'Generate it by starting the app once: buddy start' }),
  })

  const hooksStatus = getHooksStatus({ claudeCode: true, codexCli: true, runtime: environment })
  const hookEntries = Object.keys(hooksStatus)
    .sort()
    .map((key) => ({ label: key, ok: hooksStatus[key] === true }))
  const installedHooks = hookEntries.filter((entry) => entry.ok).length
  const allHooksOk = hookEntries.length > 0 && installedHooks === hookEntries.length
  checks.push({
    id: 'hooks',
    label: `Hooks installed (${installedHooks}/${hookEntries.length})`,
    ok: allHooksOk,
    // Some coverage is a degraded state; none at all is a plain failure.
    status: allHooksOk ? 'pass' : installedHooks > 0 ? 'warn' : 'fail',
    ...(allHooksOk ? {} : { hint: 'Install the missing hooks: buddy hooks install' }),
    items: hookEntries,
  })

  const passed = checks.filter((entry) => entry.ok).length
  return {
    ok: passed === checks.length,
    passed,
    total: checks.length,
    environment,
    checks,
  }
}

/* ── Rendering ───────────────────────────────────────────────────────────── */

const DOCTOR_HEADING = 'buddy doctor'

/** Map the report onto the shared checklist rows rendered by the entry layer. */
export function doctorChecks(report: DoctorCommandData): ResultCheck[] {
  return report.checks.map((entry) => {
    const detail =
      entry.status === 'pass'
        ? entry.detail
        : [entry.detail, entry.hint].filter((part) => Boolean(part)).join('  —  ')
    return {
      label: entry.label,
      status: entry.status,
      ...(detail ? { detail } : {}),
      ...(entry.items ? { items: entry.items } : {}),
    }
  })
}

/** Run the checklist and return a typed result, or throw the typed failure. */
export async function runDoctor(): Promise<CommandResult<DoctorCommandData>> {
  const report = await collectDoctorReport()
  const checks = doctorChecks(report)

  if (!report.ok) {
    const firstHint = report.checks.find((entry) => !entry.ok && entry.hint)?.hint
    throw new CliError(`Some checks failed (${report.passed}/${report.total} passed).`, {
      code: 'doctor.checks_failed',
      ...(firstHint === undefined ? {} : { hint: firstHint }),
      heading: DOCTOR_HEADING,
      checks,
      data: { ...report },
    })
  }

  return commandResult('app.doctor', report, {
    heading: DOCTOR_HEADING,
    checks,
    summary: 'All checks passed.',
    verboseDetails: [`Environment: ${report.environment}`],
  })
}
