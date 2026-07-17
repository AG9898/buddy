/**
 * buddy start — launch the Electron pet window.
 *
 * On Windows: spawn the Electron app process directly.
 * In WSL: invoke the Windows-side buddy.exe via WSL interop (cmd.exe /c start buddy.exe).
 * If interop is unavailable: print a clear actionable error and exit non-zero.
 *
 * No Electron imports in this module.
 */

import { spawn } from 'child_process'
import { isWSL } from '../env.js'
import { success, error } from '../output.js'
import { resolveElectronAppPath, resolveElectronBin, resolvePackageRoot } from '../runtime.js'

export function runStart(): void {
  if (isWSL()) {
    startFromWSL()
  } else {
    startOnWindows()
  }
}

function startOnWindows(): void {
  // Spawn the Electron app in the background, detached so the CLI can exit.
  const packageRoot = resolvePackageRoot()
  const electronBin = resolveElectronBin()
  if (!electronBin) {
    error(
      'Could not locate the Electron runtime for buddy.',
      [
        'Ensure the package was installed with production dependencies:',
        '  npm install -g @ag9898/buddy',
        `Package root checked: ${packageRoot}`,
      ].join('\n'),
    )
    process.exit(1)
  }

  const child = spawn(electronBin, [resolveElectronAppPath(packageRoot)], {
    detached: true,
    stdio: 'ignore',
    cwd: packageRoot,
  })
  child.unref()
  success('buddy started.')
}

function startFromWSL(): void {
  // Use WSL interop to launch the Windows-side buddy.exe.
  // cmd.exe /c start "" buddy.exe — the empty string is the window title argument.
  const child = spawn('cmd.exe', ['/c', 'start', '', 'buddy.exe'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stderr = ''
  child.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString()
  })

  child.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') {
      printWSLInteropError()
    } else {
      error(
        `Failed to launch buddy.exe via WSL interop: ${err.message}`,
        'Ensure WSL interop is enabled and buddy is installed on the Windows side.',
      )
    }
    process.exit(1)
  })

  child.on('close', (code: number | null) => {
    if (code !== 0 && code !== null) {
      if (stderr) {
        process.stderr.write(stderr.trim() + '\n')
      }
      printWSLInteropError()
      process.exit(1)
    } else {
      success('buddy started via WSL interop.')
    }
  })
}

function printWSLInteropError(): void {
  error(
    'WSL interop is not available or cmd.exe is not reachable.',
    [
      'To fix this:',
      '  1. Ensure WSL interop is enabled:',
      '       echo 1 > /proc/sys/fs/binfmt_misc/WSLInterop',
      '     Or set [interop] enabled=true in /etc/wsl.conf and restart WSL.',
      '  2. Ensure buddy is installed on the Windows side:',
      '       npm install -g @ag9898/buddy   (in a Windows terminal, not WSL)',
      '  3. Then retry:  buddy start',
    ].join('\n'),
  )
}
