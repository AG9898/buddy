/**
 * buddy start — launch the Electron pet window.
 *
 * On Windows, wait for the detached Electron child to emit `spawn` before
 * reporting success. In WSL, wait for the cmd.exe interop process to spawn and
 * exit successfully. The CLI result is rendered only by the entry boundary.
 *
 * No Electron imports in this module.
 */

import { spawn, type ChildProcess } from 'child_process'
import { isWSL } from '../env.js'
import { CliError, commandResult, type CommandResult } from '../result.js'
import { resolveElectronAppPath, resolveElectronBin, resolvePackageRoot } from '../runtime.js'

type StartEnvironment = 'windows' | 'wsl'

export interface StartCommandData {
  readonly environment: StartEnvironment
}

const WINDOWS_LAUNCH_HINT =
  'Ensure @ag9898/buddy and its Electron runtime are installed, then retry: buddy start'

const WSL_INTEROP_HINT = [
  'Ensure WSL interop is enabled and buddy is installed on the Windows side:',
  '  1. Set [interop] enabled=true in /etc/wsl.conf and restart WSL.',
  '  2. Run in a Windows terminal: npm install -g @ag9898/buddy',
  '  3. Then retry: buddy start',
].join('\n')

/** Launch buddy and return an output-mode-independent typed result. */
export async function runStart(): Promise<CommandResult<StartCommandData>> {
  return isWSL() ? startFromWSL() : startOnWindows()
}

async function startOnWindows(): Promise<CommandResult<StartCommandData>> {
  const packageRoot = resolvePackageRoot()
  const electronBin = resolveElectronBin(packageRoot)
  if (!electronBin) {
    throw new CliError('Could not locate the Electron runtime for buddy.', {
      code: 'start.runtime_missing',
      hint: [
        'Install buddy with production dependencies:',
        '  npm install -g @ag9898/buddy',
        `Package root checked: ${packageRoot}`,
      ].join('\n'),
      data: { packageRoot },
    })
  }

  const appPath = resolveElectronAppPath(packageRoot)
  const child = spawnElectron(electronBin, appPath, packageRoot)

  try {
    await waitForSpawn(child)
  } catch (cause) {
    throw new CliError(`Failed to launch the Buddy Electron app: ${errorMessage(cause)}`, {
      code: 'start.spawn_failed',
      hint: WINDOWS_LAUNCH_HINT,
      data: { electronBin, appPath },
      cause,
    })
  }

  child.unref()
  return commandResult(
    'app.start',
    { environment: 'windows' },
    {
      summary: 'buddy started.',
      verboseDetails: [`Electron runtime: ${electronBin}`, `App path: ${appPath}`],
    },
  )
}

function spawnElectron(electronBin: string, appPath: string, packageRoot: string): ChildProcess {
  try {
    return spawn(electronBin, [appPath], {
      detached: true,
      stdio: 'ignore',
      cwd: packageRoot,
    })
  } catch (cause) {
    throw new CliError(`Failed to launch the Buddy Electron app: ${errorMessage(cause)}`, {
      code: 'start.spawn_failed',
      hint: WINDOWS_LAUNCH_HINT,
      data: { electronBin, appPath },
      cause,
    })
  }
}

async function startFromWSL(): Promise<CommandResult<StartCommandData>> {
  let child: ChildProcess
  try {
    // cmd.exe /c start "" buddy.exe — the empty string is the window title argument.
    child = spawn('cmd.exe', ['/c', 'start', '', 'buddy.exe'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (cause) {
    throw wslSpawnError(cause)
  }

  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })

  let exitCode: number | null
  try {
    exitCode = await waitForWSLInterop(child)
  } catch (cause) {
    throw wslSpawnError(cause)
  }

  if (exitCode !== 0) {
    throw new CliError(`WSL interop could not launch buddy.exe (exit code ${exitCode ?? 'unknown'}).`, {
      code: 'start.wsl_interop_failed',
      hint: WSL_INTEROP_HINT,
      data: {
        ...(exitCode === null ? {} : { exitCode }),
        ...(stderr.trim() ? { stderr: stderr.trim() } : {}),
      },
    })
  }

  return commandResult(
    'app.start',
    { environment: 'wsl' },
    {
      summary: 'buddy started via WSL interop.',
      verboseDetails: ['Interop command: cmd.exe /c start "" buddy.exe'],
    },
  )
}

function wslSpawnError(cause: unknown): CliError {
  const code = isErrnoWithCode(cause) ? cause.code : undefined
  const unavailable = code === 'ENOENT'
  return new CliError(
    unavailable
      ? 'WSL interop is not available or cmd.exe is not reachable.'
      : `Failed to launch buddy.exe via WSL interop: ${errorMessage(cause)}`,
    {
      code: unavailable ? 'start.wsl_interop_unavailable' : 'start.wsl_spawn_failed',
      hint: WSL_INTEROP_HINT,
      ...(code === undefined ? {} : { data: { systemCode: code } }),
      cause,
    },
  )
}

function waitForSpawn(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSpawn = (): void => {
      cleanup()
      resolve()
    }
    const onError = (cause: Error): void => {
      cleanup()
      reject(cause)
    }
    const cleanup = (): void => {
      child.off('spawn', onSpawn)
      child.off('error', onError)
    }

    child.once('spawn', onSpawn)
    child.once('error', onError)
  })
}

function waitForWSLInterop(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let spawned = false
    const onSpawn = (): void => {
      spawned = true
    }
    const onError = (cause: Error): void => {
      cleanup()
      reject(cause)
    }
    const onClose = (code: number | null): void => {
      cleanup()
      if (!spawned) {
        reject(new Error('WSL interop closed before it could spawn.'))
        return
      }
      resolve(code)
    }
    const cleanup = (): void => {
      child.off('spawn', onSpawn)
      child.off('error', onError)
      child.off('close', onClose)
    }

    child.once('spawn', onSpawn)
    child.once('error', onError)
    child.once('close', onClose)
  })
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

function isErrnoWithCode(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value
}
