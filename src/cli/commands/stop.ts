/**
 * buddy stop — request an authenticated graceful Electron shutdown.
 *
 * The sidecar is always preferred. If it is unreachable, a stale-safe fallback
 * may target only the PID from Electron's runtime record after Windows verifies
 * both its executable and its command line still belong to this buddy app.
 * No Electron imports in this module.
 */

import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import { buddyProcessPath } from '../../shared/buddy-paths.js'
import { isWSL } from '../env.js'
import { CliError, commandResult, isCliError, type CommandResult } from '../result.js'
import { postToSidecar } from '../sidecar-client.js'

type StopMethod = 'graceful' | 'verified_pid_fallback' | 'already_stopped'
type StopEnvironment = 'windows' | 'wsl'

export interface StopCommandData {
  readonly method: StopMethod
  readonly environment: StopEnvironment
}

interface BuddyProcessRecord {
  readonly pid: number
  readonly executablePath: string
  readonly appPath: string
}

/** Ask the token-authenticated sidecar to persist and quit the Electron app. */
export async function runStop(): Promise<CommandResult<StopCommandData>> {
  try {
    await postToSidecar<{ ok: boolean }>('/shutdown', {})
    return stoppedResult('graceful')
  } catch (error) {
    // A rejected request is an authorization or protocol failure, not permission
    // to force-kill something. Only an unreachable sidecar may use the fallback.
    if (!isCliError(error) || error.code !== 'sidecar.unreachable') throw error
  }

  const processRecord = readProcessRecord()
  if (!processRecord || !verifyBuddyProcess(processRecord)) {
    return stoppedResult('already_stopped')
  }

  try {
    execFileSync('taskkill.exe', ['/PID', String(processRecord.pid), '/T', '/F'], {
      stdio: 'pipe',
      windowsHide: true,
    })
  } catch (error) {
    if (isNoSuchProcess(error)) return stoppedResult('already_stopped')
    throw new CliError('Could not stop the verified buddy process.', {
      code: 'stop.fallback_failed',
      hint: 'Try again after closing the buddy tray menu, or restart the app with: buddy start',
      cause: error,
    })
  }

  return stoppedResult('verified_pid_fallback')
}

function stoppedResult(method: StopMethod): CommandResult<StopCommandData> {
  const environment: StopEnvironment = isWSL() ? 'wsl' : 'windows'
  if (method === 'already_stopped') {
    return commandResult(
      'app.stop',
      { method, environment },
      {
        summary: 'buddy is not running.',
        hint: 'Start it when needed: buddy start',
      },
    )
  }

  return commandResult(
    'app.stop',
    { method, environment },
    {
      summary: 'buddy stopped.',
      verboseDetails:
        method === 'graceful'
          ? ['POST /shutdown → HTTP 200']
          : ['Sidecar unavailable; stopped a verified buddy process id.'],
    },
  )
}

function readProcessRecord(): BuddyProcessRecord | null {
  const file = buddyProcessPath(process.env, os.homedir())
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !Number.isSafeInteger((parsed as Record<string, unknown>)['pid']) ||
      (parsed as Record<string, number>)['pid'] <= 0 ||
      typeof (parsed as Record<string, unknown>)['executablePath'] !== 'string' ||
      typeof (parsed as Record<string, unknown>)['appPath'] !== 'string'
    ) {
      return null
    }

    return parsed as BuddyProcessRecord
  } catch {
    return null
  }
}

/** Escape a string literal embedded in a PowerShell single-quoted string. */
function powershellLiteral(value: string): string {
  return value.replaceAll("'", "''")
}

/**
 * Verify that a live Windows PID still has the exact Electron executable and
 * buddy app path recorded by Electron. A stale/reused PID never reaches taskkill.
 */
function verifyBuddyProcess(record: BuddyProcessRecord): boolean {
  const executable = powershellLiteral(record.executablePath)
  const appPath = powershellLiteral(record.appPath)
  const command = [
    `$process = Get-CimInstance -ClassName Win32_Process -Filter 'ProcessId = ${record.pid}'`,
    'if ($null -eq $process) { exit 3 }',
    `$expectedExecutable = '${executable}'`,
    `$expectedAppPath = '${appPath}'`,
    'if ($process.ExecutablePath -ne $expectedExecutable) { exit 4 }',
    'if ($process.CommandLine -notlike ("*" + $expectedAppPath + "*")) { exit 5 }',
    '$process.ProcessId',
  ].join('; ')

  try {
    const output = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { encoding: 'utf8', stdio: 'pipe', windowsHide: true },
    )
    return output.trim() === String(record.pid)
  } catch {
    return false
  }
}

function isNoSuchProcess(value: unknown): boolean {
  if (!(value instanceof Error)) return false
  const stderr = (value as NodeJS.ErrnoException & { stderr?: unknown }).stderr
  const detail = [value.message, stderr]
    .filter((part): part is string | Buffer => typeof part === 'string' || Buffer.isBuffer(part))
    .map((part) => part.toString())
    .join('\n')
  return /not found|no running instance|no tasks are running/i.test(detail)
}
