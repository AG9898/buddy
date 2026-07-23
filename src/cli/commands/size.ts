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

import { CliError, commandResult, type CommandResult } from '../result.js'
import { postToSidecar } from '../sidecar-client.js'

// Default pet window dimensions (must match state-store.ts defaultState).
const DEFAULT_WIDTH = 356
const DEFAULT_HEIGHT = 320

// Absolute pixel bounds allowed for resize.
const MIN_SIZE = 80
const MAX_SIZE = 1200

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

export interface SizeCommandData {
  readonly width: number
  readonly height: number
}

/** Resize the running pet and return an output-mode-independent typed result. */
export async function runSize(sizeArg: string): Promise<CommandResult<SizeCommandData>> {
  const dims = parseSizeInput(sizeArg)
  if (!dims) {
    throw new CliError(`Invalid size format: '${sizeArg}'.`, {
      code: 'size.invalid_format',
      hint: [
        'Accepted formats:',
        '  Scale factor:       buddy size 1.5   or  buddy size 2x',
        '  Explicit WxH:       buddy size 400x300',
      ].join('\n'),
      data: { input: sizeArg },
    })
  }

  const boundsError = validateBounds(dims.width, dims.height)
  if (boundsError) {
    throw new CliError(boundsError, {
      code: 'size.out_of_bounds',
      hint: `Valid range: ${MIN_SIZE}–${MAX_SIZE} pixels per dimension.`,
      data: { width: dims.width, height: dims.height },
    })
  }

  const response = await postToSidecar<{ ok: boolean; width: number; height: number }>(
    '/resize',
    { width: dims.width, height: dims.height },
  )

  return commandResult(
    'size.set',
    { width: dims.width, height: dims.height },
    {
      summary: 'Buddy resized.',
      details: [
        { label: 'Width', value: `${dims.width}px` },
        { label: 'Height', value: `${dims.height}px` },
      ],
      verboseDetails: [`POST /resize → HTTP ${response.statusCode}`],
    },
  )
}
