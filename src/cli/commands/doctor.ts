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
import path from 'path'
import { getHooksStatus } from '../../main/hooks-install.js'
import { sidecarBaseUrl } from '../env.js'
import { isWSL } from '../env.js'

function resolveTokenPath(): string {
  const base = process.env['USERPROFILE'] ?? os.homedir()
  return path.join(base, '.petdex-win', 'runtime', 'update-token')
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
  })
}

function icon(ok: boolean): string {
  return ok ? 'PASS' : 'FAIL'
}

export async function runDoctor(): Promise<void> {
  console.log('buddy doctor')
  console.log('─'.repeat(40))

  // 1. Process check
  const processRunning = checkProcessRunning()
  console.log(`[${icon(processRunning)}] Electron process running`)

  // 2. Sidecar check
  const sidecarOk = await checkSidecar()
  console.log(`[${icon(sidecarOk)}] Sidecar /health → HTTP 200 (${sidecarBaseUrl()})`)

  // 3. Token file
  const tokenOk = checkTokenFile()
  const tokenFile = resolveTokenPath()
  console.log(`[${icon(tokenOk)}] Update token file exists (${tokenFile})`)

  // 4. Hooks
  const hooksStatus = checkHooks()
  const hookEntries = Object.entries(hooksStatus)
  const allHooksOk = hookEntries.every(([, v]) => v)
  const hooksInstalledCount = hookEntries.filter(([, v]) => v).length

  console.log(
    `[${icon(allHooksOk)}] Hooks installed (${hooksInstalledCount}/${hookEntries.length})`,
  )
  for (const [key, ok] of hookEntries) {
    console.log(`        [${icon(ok)}] ${key}`)
  }

  console.log('─'.repeat(40))

  const allOk = processRunning && sidecarOk && tokenOk && allHooksOk
  if (allOk) {
    console.log('All checks passed.')
  } else {
    const failing = [
      !processRunning && 'process not running (run: buddy start)',
      !sidecarOk && 'sidecar not responding (ensure buddy app is running)',
      !tokenOk && 'token missing (start buddy once to generate it)',
      !allHooksOk && 'some hooks not installed (run: buddy hooks install)',
    ].filter(Boolean)
    console.error('Some checks failed:')
    for (const msg of failing) {
      console.error(`  - ${msg}`)
    }
    process.exit(1)
  }
}
