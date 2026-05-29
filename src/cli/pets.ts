/**
 * Pet discovery and validation module for the buddy CLI.
 *
 * Enumerates valid pet folders from three sources:
 *   - buddy-managed pets: <buddy data dir>/pets            (read/write)
 *   - packaged pets:       <buddy package>/pets             (read-only built-ins)
 *   - Codex-compatible pets: %USERPROFILE%/.codex/pets     (read-only asset source)
 *
 * A valid pet folder contains:
 *   - pet.json with required state-machine fields (id, name, spritesheet, states)
 *   - The spritesheet file named by pet.json (exists on disk)
 *
 * No Electron imports. No writes to Codex internal state.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { buddyManagedPetsDir } from '../shared/buddy-paths.js'

// ── Pet data types ────────────────────────────────────────────────────────────

/** A single animation frame. */
export interface PetFrame {
  row: number
  col: number
  ms: number
}

/** One animation state in the pet state machine. */
export interface PetAnimState {
  frames: PetFrame[]
  once?: boolean
  fallback?: string
}

/** Schema for pet.json. */
export interface PetJson {
  id: string
  name: string
  spritesheet: string
  frameWidth?: number
  frameHeight?: number
  columns?: number
  rows?: number
  states: Record<string, PetAnimState>
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** Source of a discovered pet folder. */
export type PetSource = 'buddy' | 'packaged' | 'codex'

/** A successfully validated pet entry. */
export interface PetEntry {
  id: string
  name: string
  folderPath: string
  spritesheetPath: string
  source: PetSource
  petJson: PetJson
}

/** A pet folder that failed validation. */
export interface InvalidPetEntry {
  folderPath: string
  source: PetSource
  reason: string
}

/** Result of a discovery scan. */
export interface DiscoveryResult {
  valid: PetEntry[]
  invalid: InvalidPetEntry[]
}

// ── Directory resolution ──────────────────────────────────────────────────────

/**
 * Absolute path to the buddy-managed pets directory.
 * Respects BUDDY_SPRITES_DIR override from env, otherwise derives from BUDDY_DATA_DIR.
 */
export function buddyPetsDir(): string {
  const override = process.env['BUDDY_SPRITES_DIR']
  if (override) return override
  return buddyManagedPetsDir(process.env, os.homedir())
}

/**
 * Absolute path to the Codex-compatible pets directory.
 * buddy treats this directory as a read-only asset source.
 */
export function codexPetsDir(): string {
  const base = process.env['USERPROFILE'] ?? os.homedir()
  return path.join(base, '.codex', 'pets')
}

/**
 * Absolute path to the pets directory bundled with this buddy installation.
 * In source this resolves from src/cli -> repo root; in built output it
 * resolves from out/cli -> package root.
 */
export function packagedPetsDir(): string {
  return path.resolve(__dirname, '../../pets')
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Returns true if obj is a valid PetFrame record.
 */
function isValidFrame(obj: unknown): obj is PetFrame {
  if (typeof obj !== 'object' || obj === null) return false
  const f = obj as Record<string, unknown>
  return typeof f['row'] === 'number' && typeof f['col'] === 'number' && typeof f['ms'] === 'number'
}

/**
 * Returns true if obj is a valid PetAnimState record.
 */
function isValidAnimState(obj: unknown): obj is PetAnimState {
  if (typeof obj !== 'object' || obj === null) return false
  const s = obj as Record<string, unknown>
  if (!Array.isArray(s['frames'])) return false
  if (s['frames'].length === 0) return false
  return (s['frames'] as unknown[]).every(isValidFrame)
}

/**
 * Type guard: returns true if obj is a structurally valid PetJson.
 * Requires id, name, spritesheet, and at least one state with at least one frame.
 */
export function isValidPetJson(obj: unknown): obj is PetJson {
  if (typeof obj !== 'object' || obj === null) return false
  const p = obj as Record<string, unknown>
  if (typeof p['id'] !== 'string' || p['id'].trim() === '') return false
  if (typeof p['name'] !== 'string' || p['name'].trim() === '') return false
  if (typeof p['spritesheet'] !== 'string' || p['spritesheet'].trim() === '') return false
  if (typeof p['states'] !== 'object' || p['states'] === null) return false
  const states = p['states'] as Record<string, unknown>
  const stateKeys = Object.keys(states)
  if (stateKeys.length === 0) return false
  return stateKeys.every((k) => isValidAnimState(states[k]))
}

/**
 * Validate a single pet folder. Returns a PetEntry on success or an
 * InvalidPetEntry with a concise reason on failure.
 */
export function validatePetFolder(
  folderPath: string,
  source: PetSource,
): PetEntry | InvalidPetEntry {
  // pet.json must exist and be readable.
  const petJsonPath = path.join(folderPath, 'pet.json')
  let raw: string
  try {
    raw = fs.readFileSync(petJsonPath, 'utf8')
  } catch {
    return { folderPath, source, reason: 'pet.json missing or unreadable' }
  }

  // pet.json must parse as JSON.
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { folderPath, source, reason: 'pet.json is not valid JSON' }
  }

  // pet.json must satisfy the structural schema.
  if (!isValidPetJson(parsed)) {
    return {
      folderPath,
      source,
      reason: 'pet.json missing required fields (id, name, spritesheet, states with frames)',
    }
  }

  // Referenced spritesheet must exist on disk.
  const spritesheetPath = path.join(folderPath, parsed.spritesheet)
  if (!fs.existsSync(spritesheetPath)) {
    return {
      folderPath,
      source,
      reason: `spritesheet not found: ${parsed.spritesheet}`,
    }
  }

  return {
    id: parsed.id,
    name: parsed.name,
    folderPath,
    spritesheetPath,
    source,
    petJson: parsed,
  }
}

// ── Discovery ─────────────────────────────────────────────────────────────────

/**
 * Enumerate all first-level subdirectories in a directory.
 * Returns an empty array if the directory does not exist or cannot be read.
 */
function listSubdirectories(dirPath: string): string[] {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => path.join(dirPath, e.name))
  } catch {
    return []
  }
}

/**
 * Scan a single directory for valid pet folders. Returns arrays of valid and invalid entries.
 */
function scanDirectory(dirPath: string, source: PetSource): DiscoveryResult {
  const subdirs = listSubdirectories(dirPath)
  const valid: PetEntry[] = []
  const invalid: InvalidPetEntry[] = []

  for (const subdir of subdirs) {
    const result = validatePetFolder(subdir, source)
    if ('reason' in result) {
      invalid.push(result)
    } else {
      valid.push(result)
    }
  }

  return { valid, invalid }
}

/**
 * Discover all valid pet entries from the buddy-managed, packaged, and
 * Codex-compatible pet directories. Codex folders are treated as read-only asset sources.
 *
 * Returns all valid entries (sorted buddy, packaged, then codex) and all invalid entries.
 * Never reads or writes Codex internal state files.
 */
export function discoverPets(): DiscoveryResult {
  const buddyResult = scanDirectory(buddyPetsDir(), 'buddy')
  const packagedResult = scanDirectory(packagedPetsDir(), 'packaged')
  const codexResult = scanDirectory(codexPetsDir(), 'codex')

  return {
    valid: [...buddyResult.valid, ...packagedResult.valid, ...codexResult.valid],
    invalid: [...buddyResult.invalid, ...packagedResult.invalid, ...codexResult.invalid],
  }
}
