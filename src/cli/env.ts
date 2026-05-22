/**
 * Environment detection helpers for the buddy CLI.
 * Safe to import from both Windows (node.exe) and WSL (node).
 * No Electron imports allowed in this module.
 */

import fs from 'fs'

/**
 * Returns true when the process is running inside WSL.
 * Detection: process.platform is 'linux' AND /proc/version contains 'Microsoft'.
 */
export function isWSL(): boolean {
  if (process.platform !== 'linux') {
    return false
  }
  try {
    const version = fs.readFileSync('/proc/version', 'utf8')
    return version.toLowerCase().includes('microsoft')
  } catch {
    return false
  }
}

/**
 * The buddy HTTP sidecar port (Windows loopback).
 */
export function buddyPort(): number {
  const raw = process.env['BUDDY_PORT']
  if (!raw) return 7777
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 7777
}

/**
 * The buddy HTTP sidecar base URL.
 */
export function sidecarBaseUrl(): string {
  return `http://127.0.0.1:${buddyPort()}`
}
