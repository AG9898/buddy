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
import { success, warn, error } from '../output.js'

export function runStop(): void {
  try {
    if (isWSL()) {
      stopFromWSL()
    } else {
      stopOnWindows()
    }
  } catch (err_) {
    const message = err_ instanceof Error ? err_.message : String(err_)
    // taskkill exits non-zero when no matching process is found
    if (message.includes('not found') || message.includes('No tasks')) {
      warn('buddy is not running.')
    } else {
      error(`Failed to stop buddy: ${message}`)
      process.exit(1)
    }
  }
}

function stopOnWindows(): void {
  // Kill by image name. The production binary is 'buddy.exe'; during dev it may
  // be the Electron executable. Use /F (force) and /IM (image name).
  try {
    execSync('taskkill /F /IM buddy.exe', { stdio: 'pipe' })
    success('buddy stopped.')
    return
  } catch {
    // Fallback: try the electron image name used in dev mode.
  }
  execSync('taskkill /F /IM electron.exe', { stdio: 'pipe' })
  success('buddy stopped.')
}

function stopFromWSL(): void {
  try {
    execSync('cmd.exe /c taskkill /F /IM buddy.exe', { stdio: 'pipe' })
    success('buddy stopped.')
    return
  } catch {
    // Fallback: dev mode electron process
  }
  execSync('cmd.exe /c taskkill /F /IM electron.exe', { stdio: 'pipe' })
  success('buddy stopped.')
}
