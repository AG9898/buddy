/**
 * buddy pets — enumerate and select pets from the buddy CLI.
 *
 * Subcommands:
 *   pets list        List valid buddy-managed, packaged, and Codex-compatible pets.
 *   pets show        Print the currently selected pet and its source path.
 *   pets use <id>    Validate and persist a pet selection.
 *
 * Selection is stored in buddy-owned state (<buddy data dir>\state.json).
 * Never reads or writes Codex internal state.
 * No Electron imports in this module.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { discoverPets, type PetEntry } from '../pets.js'
import { buddyStatePath } from '../../shared/buddy-paths.js'
import {
  heading,
  success,
  error,
  warn,
  bullet,
  label,
  closeSeparator,
  dim,
  bold,
  orange,
} from '../output.js'

// ── State file helpers ─────────────────────────────────────────────────────────
// Minimal read/write of the buddy state JSON.
// We do NOT import state-store.ts because it carries `import type { Rectangle } from 'electron'`
// which would break CLI-only (non-Electron) builds. Instead we work with the raw JSON here.

/** Absolute path to the buddy-owned state file. */
function stateFilePath(): string {
  return buddyStatePath(process.env, os.homedir())
}

interface RawPetRecord {
  id?: string
  spritesheetPath?: string
  width?: number
  height?: number
  state?: string
}

interface RawState {
  pet?: RawPetRecord
  [key: string]: unknown
}

/** Read the current active pet id from state.json, or null if unreadable. */
function readActivePetId(): string | null {
  try {
    const raw = fs.readFileSync(stateFilePath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null) {
      const s = parsed as RawState
      if (typeof s.pet?.id === 'string' && s.pet.id.trim() !== '') {
        return s.pet.id
      }
    }
  } catch {
    // File missing or unreadable — no active selection.
  }
  return null
}

/** Persist the selected pet id and spritesheet path to buddy-owned state.json. */
function saveActivePet(entry: PetEntry): void {
  const filePath = stateFilePath()

  // Load existing state or start from a minimal skeleton.
  let existing: RawState = {}
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null) {
      existing = parsed as RawState
    }
  } catch {
    // No existing state — create minimal state with just the pet field.
  }

  // Merge pet selection into existing state. Preserve all other fields.
  const updated: RawState = {
    ...existing,
    pet: {
      ...(existing.pet ?? {}),
      id: entry.id,
      spritesheetPath: entry.spritesheetPath,
    },
  }

  // Ensure the directory exists.
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf8')
}

// ── Output helpers ─────────────────────────────────────────────────────────────

/** Source label text for a pet entry. */
function sourceLabel(source: PetEntry['source']): string {
  if (source === 'buddy') return 'buddy-managed'
  if (source === 'packaged') return 'packaged'
  return 'codex-compatible'
}

/** Render a single pet entry row. */
function printPetRow(entry: PetEntry, activePetId: string | null): void {
  const isActive = entry.id === activePetId
  const activeMarker = isActive ? orange(' *') : '  '
  const src = dim(`[${sourceLabel(entry.source)}]`)
  process.stdout.write(`${activeMarker} ${bold(entry.id)}  ${entry.name}  ${src}\n`)
  process.stdout.write(`     ${dim(entry.folderPath)}\n`)
}

// ── Command implementations ────────────────────────────────────────────────────

/**
 * buddy pets list
 *
 * Enumerate all valid pets from buddy-managed, packaged, and Codex-compatible directories.
 * Marks the currently active pet with an asterisk.
 */
export function runPetsList(): void {
  heading('buddy pets list')

  const { valid, invalid } = discoverPets()
  const activePetId = readActivePetId()

  if (valid.length === 0 && invalid.length === 0) {
    warn('No pet folders found.')
    process.stdout.write(
      dim(
        '  Add pets to %USERPROFILE%\\.petdex-win\\pets, this package\\pets, or %USERPROFILE%\\.codex\\pets\n',
      ),
    )
    closeSeparator()
    return
  }

  if (valid.length > 0) {
    for (const entry of valid) {
      printPetRow(entry, activePetId)
    }
  } else {
    warn('No valid pets found.')
  }

  if (invalid.length > 0) {
    process.stdout.write('\n')
    process.stdout.write(dim(`  ${invalid.length} invalid folder(s) skipped:\n`))
    for (const inv of invalid) {
      process.stdout.write(dim(`    ${inv.folderPath}  — ${inv.reason}\n`))
    }
  }

  closeSeparator()

  if (valid.length > 0) {
    if (activePetId) {
      process.stdout.write(dim(`  Active: ${activePetId}  (use 'buddy pets use <id>' to change)\n`))
    } else {
      process.stdout.write(dim(`  No active pet set. Use 'buddy pets use <id>' to select one.\n`))
    }
  }
}

/**
 * buddy pets show
 *
 * Print the currently selected pet id and folder path.
 */
export function runPetsShow(): void {
  heading('buddy pets show')

  const activePetId = readActivePetId()

  if (!activePetId) {
    warn('No active pet selected.')
    process.stdout.write(dim("  Use 'buddy pets use <id>' to select a pet.\n"))
    closeSeparator()
    return
  }

  // Find the active pet in discovered pets to get full details.
  const { valid } = discoverPets()
  const entry = valid.find((p) => p.id === activePetId)

  label('Active pet', activePetId)

  if (entry) {
    label('Name', entry.name)
    label('Source', sourceLabel(entry.source))
    label('Folder', entry.folderPath)
    label('Spritesheet', entry.spritesheetPath)
  } else {
    // The stored id no longer resolves to a valid pet.
    warn(`Stored pet id '${activePetId}' no longer resolves to a valid pet.`)
    process.stdout.write(
      dim("  Run 'buddy pets list' to see available pets, then 'buddy pets use <id>' to reselect.\n"),
    )
  }

  closeSeparator()
}

/**
 * buddy pets use <id>
 *
 * Validate the requested pet and persist the selection.
 */
export function runPetsUse(id: string): void {
  if (!id || id.trim() === '') {
    error('Pet id is required.', "Usage: buddy pets use <id>")
    process.exit(1)
  }

  const petId = id.trim()
  const { valid, invalid } = discoverPets()

  // Check for valid match first.
  const entry = valid.find((p) => p.id === petId)

  if (!entry) {
    // Check if the id exists in invalid entries for a better error message.
    const invalidEntry = invalid.find((inv) => path.basename(inv.folderPath) === petId)
    if (invalidEntry) {
      error(
        `Pet '${petId}' exists but failed validation.`,
        `Reason: ${invalidEntry.reason}`,
      )
    } else {
      const available = valid.map((p) => p.id)
      const hint =
        available.length > 0
          ? `Available pets: ${available.join(', ')}`
          : "Run 'buddy pets list' to see available pets."
      error(`Pet '${petId}' not found.`, hint)
    }
    process.exit(1)
  }

  // Persist the selection.
  try {
    saveActivePet(entry)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    error(`Failed to save pet selection: ${msg}`)
    process.exit(1)
  }

  success(`Active pet set to '${entry.id}'.`)
  label('Name', entry.name)
  label('Source', sourceLabel(entry.source))
  label('Folder', entry.folderPath)

  const activePetId = readActivePetId()
  if (activePetId !== entry.id) {
    warn('Selection may not have persisted correctly — verify with: buddy pets show')
  }
}

/**
 * Print help for the pets subcommand group.
 * Called when `buddy pets --help` or `buddy pets` (no subcommand) is used.
 */
export function runPetsHelp(): void {
  bullet('buddy pets list        — list valid buddy-managed, packaged, and Codex-compatible pets')
  bullet('buddy pets show        — print the currently selected pet and its source path')
  bullet('buddy pets use <id>    — validate and persist a pet selection')
}
