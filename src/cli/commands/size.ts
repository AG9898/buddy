/**
 * buddy size <scale-or-width> — resize the buddy pet window from the terminal.
 *
 * Accepts either:
 *   - A scale factor:           "1.5"  or  "1.5x"  (relative to default 356x320)
 *   - Explicit WxH dimensions:  "400x300"
 *
 * Bounds constraints (enforced on both CLI and sidecar):
 *   - Minimum: 80x80 pixels
 *   - Maximum: 1200x1200 pixels
 *
 * Uses the same token-authenticated sidecar POST path as `buddy state`.
 * No Electron imports in this module.
 */

import fs from 'fs'
import http from 'http'
import os from 'os'
import { sidecarBaseUrl } from '../env.js'
import { buddyTokenPath } from '../../shared/buddy-paths.js'
import { success, error, label } from '../output.js'

// Default pet window dimensions (must match state-store.ts defaultState).
const DEFAULT_WIDTH = 356
const DEFAULT_HEIGHT = 320

// Absolute pixel bounds allowed for resize.
const MIN_SIZE = 80
const MAX_SIZE = 1200

/** Absolute path to the shared update token file. */
function resolveTokenPath(): string {
  return buddyTokenPath(process.env, os.homedir())
}

function readToken(): string | null {
  const tokenFile = resolveTokenPath()
  try {
    return fs.readFileSync(tokenFile, 'utf8').trim()
  } catch {
    return null
  }
}

/**
 * Parse a size input string into { width, height } in pixels.
 *
 * Supported formats:
 *   "1.5"    → scale relative to default (356x320)
 *   "1.5x"   → scale relative to default (356x320)
 *   "400x300" → explicit WxH (case-insensitive separator: 'x')
 *
 * Returns null when the input cannot be parsed.
 */
export function parseSizeInput(input: string): { width: number; height: number } | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  // Explicit dimensions: NxM  (e.g., "400x300", "400X300")
  const dimMatch = /^(\d+(?:\.\d+)?)[xX](\d+(?:\.\d+)?)$/.exec(trimmed)
  if (dimMatch) {
    const w = parseFloat(dimMatch[1]!)
    const h = parseFloat(dimMatch[2]!)
    if (!Number.isFinite(w) || !Number.isFinite(h)) return null
    return { width: Math.round(w), height: Math.round(h) }
  }

  // Scale factor: bare number or trailing 'x'  (e.g., "1.5", "2x")
  const scaleMatch = /^(\d+(?:\.\d+)?)x?$/.exec(trimmed)
  if (scaleMatch) {
    const scale = parseFloat(scaleMatch[1]!)
    if (!Number.isFinite(scale) || scale <= 0) return null
    return {
      width: Math.round(DEFAULT_WIDTH * scale),
      height: Math.round(DEFAULT_HEIGHT * scale),
    }
  }

  return null
}

/**
 * Validate that width and height fall within the allowed bounds.
 * Returns an error message string, or null when valid.
 */
export function validateBounds(width: number, height: number): string | null {
  if (width < MIN_SIZE || height < MIN_SIZE) {
    return `Size too small: minimum is ${MIN_SIZE}x${MIN_SIZE} pixels (got ${width}x${height}).`
  }
  if (width > MAX_SIZE || height > MAX_SIZE) {
    return `Size too large: maximum is ${MAX_SIZE}x${MAX_SIZE} pixels (got ${width}x${height}).`
  }
  return null
}

export function runSize(sizeArg: string): void {
  const dims = parseSizeInput(sizeArg)
  if (!dims) {
    error(
      `Invalid size format: '${sizeArg}'.`,
      [
        'Accepted formats:',
        '  Scale factor:       buddy size 1.5   or  buddy size 2x',
        '  Explicit WxH:       buddy size 400x300',
      ].join('\n'),
    )
    process.exit(1)
  }

  const boundsError = validateBounds(dims.width, dims.height)
  if (boundsError) {
    error(boundsError, `Valid range: ${MIN_SIZE}–${MAX_SIZE} pixels per dimension.`)
    process.exit(1)
  }

  const token = readToken()
  if (!token) {
    const tokenFile = resolveTokenPath()
    error(
      'Update token not found.',
      `Start the buddy app first to generate the token: buddy start\n  Token path: ${tokenFile}`,
    )
    process.exit(1)
  }

  const url = `${sidecarBaseUrl()}/resize`
  const body = JSON.stringify({ width: dims.width, height: dims.height })

  const req = http.request(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Petdex-Update-Token': token,
      },
    },
    (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString()
      })
      res.on('end', () => {
        if (res.statusCode === 200) {
          success('Buddy resized.')
          label('Width', `${dims.width}px`)
          label('Height', `${dims.height}px`)
        } else {
          error(
            `Sidecar returned HTTP ${res.statusCode ?? 'unknown'}.`,
            data.trim() || 'Check that the buddy app is running.',
          )
          process.exit(1)
        }
      })
    },
  )

  req.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'ECONNREFUSED') {
      error(
        'Could not connect to the buddy sidecar.',
        'Ensure the buddy app is running: buddy start',
      )
    } else {
      error(`Connection error: ${err.message}`)
    }
    process.exit(1)
  })

  req.write(body)
  req.end()
}
