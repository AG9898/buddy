/**
 * buddy stop — find and terminate the running Electron (buddy) process.
 *
 * On Windows: use taskkill to terminate processes named 'buddy.exe' or 'electron.exe'
 * running from the buddy package root.
 * In WSL: use WSL interop to run taskkill on the Windows side.
 *
 * No Electron imports in this module.
 */

import { execSync } from 'child_process'
import { isWSL } from '../env.js'

export function runStop(): void {
  try {
    if (isWSL()) {
      stopFromWSL()
    } else {
      stopOnWindows()
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // taskkill exits non-zero when no matching process is found
    if (message.includes('not found') || message.includes('No tasks')) {
      console.log('buddy is not running.')
    } else {
      console.error(`Error stopping buddy: ${message}`)
      process.exit(1)
    }
  }
}

function stopOnWindows(): void {
  // Kill by image name. The production binary is 'buddy.exe'; during dev it may
  // be the Electron executable. Use /F (force) and /IM (image name).
  try {
    execSync('taskkill /F /IM buddy.exe', { stdio: 'pipe' })
    console.log('buddy stopped.')
    return
  } catch {
    // Fallback: try the electron image name used in dev mode.
  }
  execSync('taskkill /F /IM electron.exe', { stdio: 'pipe' })
  console.log('buddy stopped.')
}

function stopFromWSL(): void {
  try {
    execSync('cmd.exe /c taskkill /F /IM buddy.exe', { stdio: 'pipe' })
    console.log('buddy stopped.')
    return
  } catch {
    // Fallback: dev mode electron process
  }
  execSync('cmd.exe /c taskkill /F /IM electron.exe', { stdio: 'pipe' })
  console.log('buddy stopped.')
}
