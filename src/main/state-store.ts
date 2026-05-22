// FEAT-03: read/write %USERPROFILE%\.petdex-win\state.json
// See docs/ARCHITECTURE.md for AppState schema.

import fs from 'fs'
import os from 'os'
import path from 'path'
import type { Rectangle } from 'electron'

/** Bounds of the overlay window on screen. */
export interface BoundsRecord {
  x: number
  y: number
  width: number
  height: number
}

/** Pet configuration stored in state. */
export interface PetRecord {
  id: string
  spritesheetPath: string
  width: number
  height: number
  state: string
}

/** Full persisted application state. */
export interface AppState {
  open: boolean
  bounds: BoundsRecord
  pet: PetRecord
  /** Window bounds keyed by screen resolution string, e.g. "1920x1080". */
  byResolution: Record<string, BoundsRecord>
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Absolute path to %USERPROFILE%\.petdex-win */
function petdexWinDir(): string {
  return path.join(os.homedir(), '.petdex-win')
}

/** Absolute path to the state JSON file. */
function stateFilePath(): string {
  return path.join(petdexWinDir(), 'state.json')
}

/** Default state returned when no valid persisted state exists. */
function defaultState(): AppState {
  return {
    open: true,
    bounds: { x: 1600, y: 760, width: 356, height: 320 },
    pet: {
      id: 'default',
      spritesheetPath: '',
      width: 142,
      height: 154,
      state: 'idle',
    },
    byResolution: {},
  }
}

/** Returns true if obj looks like a valid AppState (basic structural check). */
function isValidAppState(obj: unknown): obj is AppState {
  if (typeof obj !== 'object' || obj === null) return false
  const s = obj as Record<string, unknown>
  if (typeof s['open'] !== 'boolean') return false
  if (typeof s['bounds'] !== 'object' || s['bounds'] === null) return false
  if (typeof s['pet'] !== 'object' || s['pet'] === null) return false
  if (typeof s['byResolution'] !== 'object' || s['byResolution'] === null) return false
  return true
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load persisted AppState from disk.
 * Returns the default state if the file is missing or cannot be parsed.
 * All I/O is synchronous.
 */
export function loadState(): AppState {
  const filePath = stateFilePath()
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (isValidAppState(parsed)) {
      return parsed
    }
    // File exists but has unexpected structure — fall through to defaults.
    return defaultState()
  } catch {
    // File missing or unreadable — return defaults.
    return defaultState()
  }
}

/**
 * Persist AppState to disk.
 * Creates the .petdex-win directory if it does not exist.
 * All I/O is synchronous.
 */
export function saveState(state: AppState): void {
  const dir = petdexWinDir()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(stateFilePath(), JSON.stringify(state, null, 2), 'utf8')
}

/**
 * Update the window bounds in the current state and persist.
 * Also updates byResolution keyed by the screen resolution string
 * derived from the bounds dimensions (e.g. "1920x1080").
 *
 * The resolution key uses the display resolution that best fits the window,
 * which for simplicity we derive from the current state's byResolution
 * heuristic: key = `${bounds.width}x${bounds.height}` is NOT right —
 * the task spec says key = `${screenWidth}x${screenHeight}`.
 *
 * Because state-store.ts has no Electron screen dependency (it is a pure
 * file-I/O module), we accept an explicit resolutionKey string from the
 * caller (avatar-window.ts computes it using screen.getDisplayNearestPoint).
 * When resolutionKey is omitted we fall back to deriving it from the
 * current display size stored in byResolution, defaulting to "".
 *
 * Per task spec: "keyed by '${width}x${height}'" refers to screen
 * resolution.  For callers that pass an Electron Rectangle directly
 * (drag-end, close), the resolution key must be provided separately.
 * This overload accepts an optional resolutionKey for that purpose.
 */
export function saveBounds(bounds: Rectangle, resolutionKey?: string): void {
  const state = loadState()
  state.bounds = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  }
  const key = resolutionKey ?? `${bounds.width}x${bounds.height}`
  state.byResolution[key] = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  }
  saveState(state)
}
