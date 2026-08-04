/** Explicitly update the globally installed buddy package through npm. */

import { spawn, type ChildProcess } from 'child_process'
import { CliError, commandResult, type CommandResult } from '../result.js'

const PACKAGE_SPEC = '@ag9898/buddy@latest'
const NPM_ARGS = ['install', '--global', PACKAGE_SPEC] as const

export interface UpdateCommandData {
  readonly package: string
  readonly version: 'latest'
}

function npmExecutable(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

/** Update buddy only when the user explicitly invokes this command. */
export async function runUpdate(): Promise<CommandResult<UpdateCommandData>> {
  const executable = npmExecutable()
  let child: ChildProcess

  try {
    child = spawn(executable, NPM_ARGS, { stdio: 'pipe', shell: false })
  } catch (cause) {
    throw updateSpawnError(cause, executable)
  }

  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })

  const exitCode = await waitForNpm(child, executable)
  if (exitCode !== 0) {
    const permissionDenied = /\b(?:EACCES|EPERM)\b|permission denied/i.test(output)
    throw new CliError(
      permissionDenied
        ? 'npm could not update buddy because permission was denied.'
        : `npm could not update buddy (exit code ${exitCode ?? 'unknown'}).`,
      {
        code: permissionDenied ? 'update.npm_permission_denied' : 'update.npm_failed',
        hint: permissionDenied
          ? 'Use an account permitted to update global npm packages, then retry: buddy update'
          : 'Run npm install --global @ag9898/buddy@latest to inspect the npm error, then retry: buddy update',
        data: exitCode === null ? {} : { exitCode },
      },
    )
  }

  return commandResult(
    'app.update',
    { package: '@ag9898/buddy', version: 'latest' },
    {
      summary: 'buddy updated to the latest npm release.',
      hint: 'Restart buddy to use the updated app: buddy stop && buddy start',
      verboseDetails: [`npm command: ${executable} ${NPM_ARGS.join(' ')}`],
    },
  )
}

function waitForNpm(child: ChildProcess, executable: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const onError = (cause: Error): void => {
      cleanup()
      reject(updateSpawnError(cause, executable))
    }
    const onClose = (code: number | null): void => {
      cleanup()
      resolve(code)
    }
    const cleanup = (): void => {
      child.off('error', onError)
      child.off('close', onClose)
    }

    child.once('error', onError)
    child.once('close', onClose)
  })
}

function updateSpawnError(cause: unknown, executable: string): CliError {
  const systemCode = isErrnoWithCode(cause) ? cause.code : undefined
  if (systemCode === 'ENOENT') {
    return new CliError('npm is required to update buddy but was not found.', {
      code: 'update.npm_unavailable',
      hint: 'Install Node.js (which includes npm), then retry: buddy update',
      ...(systemCode === undefined ? {} : { data: { systemCode } }),
      cause,
    })
  }

  if (systemCode === 'EACCES' || systemCode === 'EPERM') {
    return new CliError('npm could not update buddy because permission was denied.', {
      code: 'update.npm_permission_denied',
      hint: 'Use an account permitted to update global npm packages, then retry: buddy update',
      ...(systemCode === undefined ? {} : { data: { systemCode } }),
      cause,
    })
  }

  return new CliError(`Could not start ${executable} to update buddy.`, {
    code: 'update.npm_spawn_failed',
    hint: 'Verify npm is available, then retry: buddy update',
    ...(systemCode === undefined ? {} : { data: { systemCode } }),
    cause,
  })
}

function isErrnoWithCode(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value
}
