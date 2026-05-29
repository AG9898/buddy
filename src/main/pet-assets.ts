import fs from 'fs'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import type { PetRecord } from './state-store'
import { buddyManagedPetsDir } from '../shared/buddy-paths'

export interface PetFrame {
  row: number
  col: number
  ms: number
}

export interface PetAnimState {
  frames: PetFrame[]
  once?: boolean
  fallback?: string
}

export interface PetJson {
  id: string
  name: string
  spritesheet: string
  frameWidth: number
  frameHeight: number
  columns: number
  rows: number
  states: Record<string, PetAnimState>
}

export type PetSource = 'buddy' | 'packaged' | 'codex'

interface PetCandidate {
  id: string
  folderPath: string
  source: PetSource
  petJson: PetJson
  spritesheetPath: string
}

export interface ActivePetAsset {
  id: string
  source: PetSource
  manifest: PetJson
  spritesheetUrl: string
  initialState: string
}

function buddyPetsDir(): string {
  const override = process.env['BUDDY_SPRITES_DIR']
  if (override) return override
  return buddyManagedPetsDir(process.env, os.homedir())
}

function codexPetsDir(): string {
  const base = process.env['USERPROFILE'] ?? os.homedir()
  return path.join(base, '.codex', 'pets')
}

export function packagedPetsDir(): string {
  return path.resolve(__dirname, '../../pets')
}

function isValidFrame(obj: unknown): obj is PetFrame {
  if (typeof obj !== 'object' || obj === null) return false
  const frame = obj as Record<string, unknown>
  return (
    typeof frame['row'] === 'number' &&
    typeof frame['col'] === 'number' &&
    typeof frame['ms'] === 'number'
  )
}

function isValidAnimState(obj: unknown): obj is PetAnimState {
  if (typeof obj !== 'object' || obj === null) return false
  const state = obj as Record<string, unknown>
  return Array.isArray(state['frames']) && state['frames'].length > 0 && state['frames'].every(isValidFrame)
}

export function isValidPetJson(obj: unknown): obj is PetJson {
  if (typeof obj !== 'object' || obj === null) return false
  const pet = obj as Record<string, unknown>
  if (typeof pet['id'] !== 'string' || pet['id'].trim() === '') return false
  if (typeof pet['name'] !== 'string' || pet['name'].trim() === '') return false
  if (typeof pet['spritesheet'] !== 'string' || pet['spritesheet'].trim() === '') return false
  if (typeof pet['frameWidth'] !== 'number' || pet['frameWidth'] <= 0) return false
  if (typeof pet['frameHeight'] !== 'number' || pet['frameHeight'] <= 0) return false
  if (typeof pet['columns'] !== 'number' || pet['columns'] <= 0) return false
  if (typeof pet['rows'] !== 'number' || pet['rows'] <= 0) return false
  if (typeof pet['states'] !== 'object' || pet['states'] === null) return false

  const states = pet['states'] as Record<string, unknown>
  const stateNames = Object.keys(states)
  return stateNames.length > 0 && stateNames.every((name) => isValidAnimState(states[name]))
}

function listSubdirectories(dirPath: string): string[] {
  try {
    return fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dirPath, entry.name))
  } catch {
    return []
  }
}

function validatePetFolder(folderPath: string, source: PetSource): PetCandidate | null {
  try {
    const petJsonPath = path.join(folderPath, 'pet.json')
    const parsed: unknown = JSON.parse(fs.readFileSync(petJsonPath, 'utf8'))
    if (!isValidPetJson(parsed)) return null

    const folderRoot = path.resolve(folderPath)
    const spritesheetPath = path.resolve(folderRoot, parsed.spritesheet)
    const relativeSpritesheetPath = path.relative(folderRoot, spritesheetPath)
    if (
      relativeSpritesheetPath.startsWith('..') ||
      path.isAbsolute(relativeSpritesheetPath) ||
      !fs.statSync(spritesheetPath).isFile()
    ) {
      return null
    }

    return {
      id: parsed.id,
      folderPath,
      source,
      petJson: parsed,
      spritesheetPath,
    }
  } catch {
    return null
  }
}

function scanPets(): PetCandidate[] {
  const sources: Array<{ dir: string; source: PetSource }> = [
    { dir: buddyPetsDir(), source: 'buddy' },
    { dir: packagedPetsDir(), source: 'packaged' },
    { dir: codexPetsDir(), source: 'codex' },
  ]

  return sources.flatMap(({ dir, source }) =>
    listSubdirectories(dir)
      .map((folderPath) => validatePetFolder(folderPath, source))
      .filter((candidate): candidate is PetCandidate => candidate !== null),
  )
}

function toActivePetAsset(candidate: PetCandidate, initialState: string): ActivePetAsset {
  return {
    id: candidate.id,
    source: candidate.source,
    manifest: candidate.petJson,
    spritesheetUrl: pathToFileURL(candidate.spritesheetPath).href,
    initialState: candidate.petJson.states[initialState] ? initialState : 'idle',
  }
}

export function resolveActivePet(pet: PetRecord): ActivePetAsset {
  const selectedId = pet.id?.trim() || 'default'
  const candidates = scanPets()
  const selected = candidates.find((candidate) => candidate.id === selectedId)
  if (selected) return toActivePetAsset(selected, pet.state)

  const defaultPet = candidates.find((candidate) => candidate.id === 'default')
  if (!defaultPet) {
    throw new Error('Default pet assets are missing or invalid.')
  }

  if (selectedId !== 'default') {
    console.warn(`Selected pet '${selectedId}' is missing or invalid; falling back to default.`)
  }

  return toActivePetAsset(defaultPet, pet.state)
}
