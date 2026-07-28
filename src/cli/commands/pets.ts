/**
 * buddy pets — enumerate and select pets from the buddy CLI.
 *
 * Subcommands:
 *   pets list           List valid buddy-managed, packaged, and Codex-compatible pets.
 *   pets current|show   Print the currently selected pet and its source path.
 *   pets use <id>       Validate, apply to a running app, and persist a selection.
 *
 * Every command returns a typed `CommandResult` and never writes to a stream or
 * calls `process.exit`; the CLI entry boundary renders the result through the
 * shared output layer, so all three honor `--json`, `--quiet`, `--verbose`, and
 * `--no-color` identically. Expected failures are thrown as `CliError`.
 *
 * Selection is stored in buddy-owned state (<buddy data dir>\state.json).
 * Never reads or writes Codex internal state.
 * No Electron imports in this module.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { discoverPets, type InvalidPetEntry, type PetEntry, type PetSource } from '../pets.js'
import { buddyStatePath } from '../../shared/buddy-paths.js'
import {
  CliError,
  commandResult,
  isCliError,
  type CommandResult,
  type ResultCheck,
} from '../result.js'
import { postToSidecar } from '../sidecar-client.js'

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

// ── Machine-readable payloads ──────────────────────────────────────────────────
// These shapes are the public `--json` contract for the pets commands.

/** One discovered, validated pet. */
export interface PetSummary {
  readonly id: string
  readonly name: string
  /** Raw discovery source, matching the `buddy status` vocabulary. */
  readonly source: PetSource
  readonly folder: string
  readonly spritesheet: string
  /** True when this pet is the stored selection. */
  readonly active: boolean
}

/** One pet folder that failed validation and was skipped. */
export interface InvalidPetSummary {
  readonly folder: string
  readonly source: PetSource
  readonly reason: string
}

export interface PetsListData {
  readonly pets: readonly PetSummary[]
  readonly invalid: readonly InvalidPetSummary[]
  /** Stored selection id, even when it no longer resolves. */
  readonly active: string | null
}

export interface PetsCurrentData {
  readonly active: string | null
  /** True when `active` still resolves to a valid discovered pet. */
  readonly resolved: boolean
  readonly pet: PetSummary | null
}

/**
 * How the saved selection reached the app.
 *
 * `live`       the running app accepted the authenticated live-selection request
 * `next-start` the app is stopped or unreachable, so the saved pet applies later
 */
export type PetsUseApplied = 'live' | 'next-start'

export interface PetsUseData {
  readonly pet: PetSummary
  readonly applied: PetsUseApplied
  /**
   * Sidecar error code explaining a deferred application (for example
   * `sidecar.unreachable`), or `null` when the selection applied live.
   */
  readonly reason: string | null
}

// ── Shaping helpers ────────────────────────────────────────────────────────────

/** Human-facing source label for a pet entry. */
function sourceLabel(source: PetSource): string {
  if (source === 'buddy') return 'buddy-managed'
  if (source === 'packaged') return 'packaged'
  return 'codex-compatible'
}

function toSummary(entry: PetEntry, activePetId: string | null): PetSummary {
  return {
    id: entry.id,
    name: entry.name,
    source: entry.source,
    folder: entry.folderPath,
    spritesheet: entry.spritesheetPath,
    active: entry.id === activePetId,
  }
}

function toInvalidSummary(entry: InvalidPetEntry): InvalidPetSummary {
  return { folder: entry.folderPath, source: entry.source, reason: entry.reason }
}

/** `Name (source)` plus the active marker, used for one human list row. */
function petRowValue(pet: PetSummary): string {
  const marker = pet.active ? '  *active' : ''
  return `${pet.name} (${sourceLabel(pet.source)})${marker}`
}

const PETS_DIR_HINT =
  'Add pets under the buddy pets directory, this package’s pets/, or %USERPROFILE%\\.codex\\pets'

// ── Command implementations ────────────────────────────────────────────────────

/**
 * buddy pets list
 *
 * Enumerate all valid pets from buddy-managed, packaged, and Codex-compatible
 * directories. The active selection is marked, and invalid folders are counted
 * in normal output with their reasons kept for `--verbose` and `--json`.
 */
export function runPetsList(): CommandResult<PetsListData> {
  const { valid, invalid } = discoverPets()
  const activePetId = readActivePetId()

  const pets = valid.map((entry) => toSummary(entry, activePetId))
  const invalidPets = invalid.map(toInvalidSummary)
  const data: PetsListData = { pets, invalid: invalidPets, active: activePetId }

  const verboseDetails = [
    ...pets.map((pet) => `${pet.id}: ${pet.folder}`),
    ...invalidPets.map((entry) => `skipped ${entry.folder} — ${entry.reason}`),
  ]

  if (pets.length === 0) {
    return commandResult('pets.list', data, {
      summary:
        invalidPets.length > 0
          ? `No valid pets found; ${invalidPets.length} invalid folder(s) skipped.`
          : 'No pet folders found.',
      hint: PETS_DIR_HINT,
      verboseDetails,
    })
  }

  const details = pets.map((pet) => ({ label: pet.id, value: petRowValue(pet) }))
  if (invalidPets.length > 0) {
    details.push({
      label: 'Skipped',
      value: `${invalidPets.length} invalid folder(s) — run with --verbose for reasons`,
    })
  }

  return commandResult('pets.list', data, {
    summary: `${pets.length} pet(s) available.`,
    details,
    hint: activePetId
      ? `Active: ${activePetId} — change it with: buddy pets use <id>`
      : "No active pet set. Select one with: buddy pets use <id>",
    verboseDetails,
  })
}

/**
 * buddy pets current  (alias: buddy pets show)
 *
 * Report the stored selection. A missing or unresolvable selection is a
 * degraded read, not a failure, so the command still exits zero with an
 * actionable hint.
 */
export function runPetsCurrent(): CommandResult<PetsCurrentData> {
  const activePetId = readActivePetId()

  if (!activePetId) {
    return commandResult(
      'pets.current',
      { active: null, resolved: false, pet: null },
      {
        summary: 'No active pet selected.',
        hint: "Select one with: buddy pets use <id>",
      },
    )
  }

  const { valid } = discoverPets()
  const entry = valid.find((p) => p.id === activePetId)

  if (!entry) {
    // The stored id no longer resolves to a valid pet; Electron falls back to
    // the packaged default until a new selection is made.
    return commandResult(
      'pets.current',
      { active: activePetId, resolved: false, pet: null },
      {
        checks: [
          {
            label: `Stored pet id '${activePetId}' no longer resolves to a valid pet.`,
            status: 'warn',
            detail: 'buddy falls back to the packaged default pet until you reselect.',
          },
        ],
        summary: `Active pet '${activePetId}' is unresolved.`,
        hint: "Run 'buddy pets list', then reselect with: buddy pets use <id>",
      },
    )
  }

  const pet = toSummary(entry, activePetId)
  return commandResult(
    'pets.current',
    { active: activePetId, resolved: true, pet },
    {
      summary: `Active pet: ${pet.name}.`,
      details: [
        { label: 'Id', value: pet.id },
        { label: 'Name', value: pet.name },
        { label: 'Source', value: sourceLabel(pet.source) },
        { label: 'Folder', value: pet.folder },
      ],
      verboseDetails: [`Spritesheet: ${pet.spritesheet}`],
    },
  )
}

/**
 * Sidecar failures that mean "the app is not reachable right now".
 *
 * None of them says anything about the pet itself, so the CLI keeps the saved
 * selection and reports that it applies on the next start.
 */
const DEFERRED_SIDECAR_CODES: ReadonlySet<string> = new Set([
  'sidecar.token_missing',
  'sidecar.unreachable',
  'sidecar.timeout',
  'sidecar.connection_error',
])

type LiveSelectionOutcome =
  | { readonly applied: 'live'; readonly statusCode: number }
  | { readonly applied: 'next-start'; readonly reason: string; readonly detail: string }

/**
 * Ask the running app to apply the selection through `POST /pets/use`.
 *
 * Electron owns asset validation, so a rejection is surfaced as an actionable
 * failure rather than being re-derived (or ignored) here.
 */
async function requestLiveSelection(petId: string): Promise<LiveSelectionOutcome> {
  try {
    const response = await postToSidecar<{ ok: boolean }>('/pets/use', { id: petId })
    return { applied: 'live', statusCode: response.statusCode }
  } catch (error) {
    if (!isCliError(error)) throw error

    if (DEFERRED_SIDECAR_CODES.has(error.code)) {
      return { applied: 'next-start', reason: error.code, detail: error.message }
    }

    // The app answered and refused the id: never claim the pet is now active.
    throw new CliError(`buddy is running but rejected pet '${petId}'.`, {
      code: 'pets.live_rejected',
      hint: `${error.hint ?? error.message} The saved pet selection was not changed.`,
      data: { id: petId, reason: error.code, ...(error.data ?? {}) },
      cause: error,
    })
  }
}

/**
 * buddy pets use <id>
 *
 * Validate the requested pet locally, ask a running app to apply it live, then
 * persist the selection to buddy-owned state.
 *
 * A running app confirms immediate application; a stopped or unreachable app
 * still keeps the saved selection and reports that it applies on the next start.
 */
export async function runPetsUse(id: string): Promise<CommandResult<PetsUseData>> {
  if (!id || id.trim() === '') {
    throw new CliError('Pet id is required.', {
      code: 'pets.id_required',
      hint: 'Usage: buddy pets use <id>',
    })
  }

  const petId = id.trim()
  const { valid, invalid } = discoverPets()

  // Check for valid match first.
  const entry = valid.find((p) => p.id === petId)

  if (!entry) {
    // A folder with that name may exist but have failed validation — say so.
    const invalidEntry = invalid.find((inv) => path.basename(inv.folderPath) === petId)
    if (invalidEntry) {
      throw new CliError(`Pet '${petId}' exists but failed validation.`, {
        code: 'pets.invalid',
        hint: `Reason: ${invalidEntry.reason}`,
        data: { id: petId, reason: invalidEntry.reason, folder: invalidEntry.folderPath },
      })
    }

    const available = valid.map((p) => p.id)
    throw new CliError(`Pet '${petId}' not found.`, {
      code: 'pets.not_found',
      hint:
        available.length > 0
          ? `Available pets: ${available.join(', ')}`
          : "Run 'buddy pets list' to see available pets.",
      data: { id: petId, available },
    })
  }

  // Live request first: a rejection must not leave a selection behind.
  const outcome = await requestLiveSelection(petId)

  try {
    saveActivePet(entry)
  } catch (err) {
    throw new CliError(
      `Failed to save pet selection: ${err instanceof Error ? err.message : String(err)}`,
      { code: 'pets.save_failed', hint: 'Check write access to the buddy data directory.', cause: err },
    )
  }

  const pet = toSummary(entry, entry.id)

  // Read back so a silently unwritten selection is reported instead of claimed.
  const checks: ResultCheck[] =
    readActivePetId() === entry.id
      ? []
      : [
          {
            label: 'Saved selection did not read back.',
            status: 'warn',
            detail: "Verify with: buddy pets current",
          },
        ]

  const baseDetails = [
    { label: 'Name', value: pet.name },
    { label: 'Source', value: sourceLabel(pet.source) },
    { label: 'Folder', value: pet.folder },
  ]

  if (outcome.applied === 'live') {
    return commandResult(
      'pets.use',
      { pet, applied: 'live', reason: null },
      {
        ...(checks.length > 0 ? { checks } : {}),
        summary: `Active pet set to '${pet.id}' and applied to the running app.`,
        details: [...baseDetails, { label: 'Applies', value: 'immediately — buddy is running' }],
        hint: 'Confirm the selection any time with: buddy pets current',
        verboseDetails: [
          `Selection stored in ${stateFilePath()}`,
          `POST /pets/use → HTTP ${outcome.statusCode}`,
        ],
      },
    )
  }

  return commandResult(
    'pets.use',
    { pet, applied: 'next-start', reason: outcome.reason },
    {
      ...(checks.length > 0 ? { checks } : {}),
      summary: `Active pet set to '${pet.id}'; applies on the next buddy start.`,
      details: [...baseDetails, { label: 'Applies', value: 'on the next buddy start' }],
      hint: 'Start buddy to see it: buddy start',
      verboseDetails: [
        `Selection stored in ${stateFilePath()}`,
        `Live selection skipped — ${outcome.reason}: ${outcome.detail}`,
      ],
    },
  )
}
