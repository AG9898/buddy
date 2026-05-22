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

export function runStart(): void {
  if (isWSL()) {
    startFromWSL()
  } else {
    startOnWindows()
  }
}

function startOnWindows(): void {
  // Spawn the Electron app in the background, detached so the CLI can exit.
  // When installed globally via npm, the 'buddy-electron' binary (or 'electron .')
  // is reachable via the package main field. We launch via node with the package
  // main script resolved from the same package root.
  const electronBin = resolveElectronBin()
  if (!electronBin) {
    console.error(
      'Error: Could not locate the Electron binary.\n' +
        'Ensure buddy is installed correctly and try: npm install -g buddy',
    )
    process.exit(1)
  }

  const child = spawn(electronBin, ['.'], {
    detached: true,
    stdio: 'ignore',
    cwd: resolvePackageRoot(),
  })
  child.unref()
  console.log('buddy started.')
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
      console.error(`Error launching buddy.exe via WSL interop: ${err.message}`)
      console.error(
        'Ensure WSL interop is enabled and buddy is installed on the Windows side.',
      )
    }
    process.exit(1)
  })

  child.on('close', (code: number | null) => {
    if (code !== 0 && code !== null) {
      console.error(`cmd.exe exited with code ${code}.`)
      if (stderr) {
        console.error(stderr.trim())
      }
      printWSLInteropError()
      process.exit(1)
    } else {
      console.log('buddy started via WSL interop.')
    }
  })
}

function printWSLInteropError(): void {
  console.error(
    'Error: WSL interop is not available or cmd.exe is not reachable.\n\n' +
      'To fix this:\n' +
      '  1. Ensure WSL interop is enabled:\n' +
      '       echo 0 > /proc/sys/fs/binfmt_misc/WSLInterop  # disable\n' +
      '       echo 1 > /proc/sys/fs/binfmt_misc/WSLInterop  # re-enable\n' +
      '     Or set [interop] enabled=true in /etc/wsl.conf and restart WSL.\n' +
      '  2. Ensure buddy is installed on the Windows side:\n' +
      '       npm install -g buddy   (in a Windows terminal, not WSL)\n' +
      '  3. Then retry:  buddy start',
  )
}

function resolveElectronBin(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electronPath: string = require('electron') as string
    return electronPath
  } catch {
    return null
  }
}

function resolvePackageRoot(): string {
  // Walk up from __dirname to find package.json root.
  // In production the CLI is at <root>/out/cli/index.js; in dev at src/cli/index.ts.
  // We want the directory that contains package.json.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs')
  let dir = __dirname
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir
    }
    dir = path.dirname(dir)
  }
  return __dirname
}
