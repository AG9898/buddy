/**
 * buddy doctor — print a pass/fail health checklist.
 *
 * Checks:
 *   1. Electron process is running (tasklist / ps)
 *   2. GET /health returns HTTP 200
 *   3. Update token file exists
 *   4. Hooks are installed (Claude Code and/or Codex CLI)
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
import { heading, check, subCheck, closeSeparator, success, error } from '../output.js'
import { resolveElectronBin, resolvePackageRoot } from '../runtime.js'
import { buddyTokenPath } from '../../shared/buddy-paths.js'

function resolveTokenPath(): string {
  return buddyTokenPath(process.env, os.homedir())
}

function checkProcessRunning(): boolean {
  try {
    if (isWSL()) {
      const out = execSync('cmd.exe /c tasklist /FI "IMAGENAME eq buddy.exe" /NH 2>NUL', {
        stdio: 'pipe',
        encoding: 'utf8',
      })
      if (out.toLowerCase().includes('buddy.exe')) return true
      // Also check electron.exe (dev mode)
      const out2 = execSync('cmd.exe /c tasklist /FI "IMAGENAME eq electron.exe" /NH 2>NUL', {
        stdio: 'pipe',
        encoding: 'utf8',
      })
      return out2.toLowerCase().includes('electron.exe')
    } else {
      const out = execSync('tasklist /FI "IMAGENAME eq buddy.exe" /NH', {
        stdio: 'pipe',
        encoding: 'utf8',
      })
      if (out.toLowerCase().includes('buddy.exe')) return true
      const out2 = execSync('tasklist /FI "IMAGENAME eq electron.exe" /NH', {
        stdio: 'pipe',
        encoding: 'utf8',
      })
      return out2.toLowerCase().includes('electron.exe')
    }
  } catch {
    return false
  }
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
  const tokenFile = resolveTokenPath()
  return fs.existsSync(tokenFile)
}

function checkHooks(): Record<string, boolean> {
  return getHooksStatus({
    claudeCode: true,
    codexCli: true,
    runtime: isWSL() ? 'wsl' : 'windows',
  })
}

export async function runDoctor(): Promise<void> {
  heading('buddy doctor')

  // 1. Runtime check
  const electronBin = resolveElectronBin()
  const runtimeOk = electronBin !== null
  check(
    'Electron runtime available',
    runtimeOk,
    runtimeOk
      ? electronBin
      : `Expected Electron under ${resolvePackageRoot()} -- reinstall with: npm install -g @ag9898/buddy`,
  )

  // 2. Process check
  const processRunning = checkProcessRunning()
  check(
    'Electron process running',
    processRunning,
    processRunning ? undefined : 'Run: buddy start',
  )

  // 3. Sidecar check
  const sidecarOk = await checkSidecar()
  check(
    `Sidecar /health → HTTP 200  ${sidecarBaseUrl()}`,
    sidecarOk,
    sidecarOk ? undefined : 'Ensure the buddy app is running: buddy start',
  )

  // 4. Token file
  const tokenOk = checkTokenFile()
  const tokenFile = resolveTokenPath()
  check(
    'Update token file exists',
    tokenOk,
    tokenOk ? tokenFile : `Expected: ${tokenFile}  —  run buddy start once to generate it`,
  )

  // 5. Hooks
  const hooksStatus = checkHooks()
  const hookEntries = Object.entries(hooksStatus)
  const allHooksOk = hookEntries.every(([, v]) => v)
  const hooksInstalledCount = hookEntries.filter(([, v]) => v).length

  check(
    `Hooks installed (${hooksInstalledCount}/${hookEntries.length})`,
    allHooksOk,
    allHooksOk ? undefined : 'Run: buddy hooks install',
  )
  for (const [key, ok] of hookEntries) {
    subCheck(key, ok)
  }

  closeSeparator()

  const allOk = runtimeOk && processRunning && sidecarOk && tokenOk && allHooksOk
  if (allOk) {
    success('All checks passed.')
  } else {
    const failing = [
      !runtimeOk && 'Electron runtime missing (reinstall: npm install -g @ag9898/buddy)',
      !processRunning && 'process not running (run: buddy start)',
      !sidecarOk && 'sidecar not responding (ensure buddy app is running)',
      !tokenOk && 'token missing (start buddy once to generate it)',
      !allHooksOk && 'some hooks not installed (run: buddy hooks install)',
    ].filter(Boolean)
    error('Some checks failed:')
    for (const msg of failing) {
      process.stderr.write(`  - ${msg}\n`)
    }
    process.exit(1)
  }
}
