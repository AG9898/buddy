import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidPetJson, PetSelectionError, resolveActivePet, selectActivePet } from './pet-assets'
import { loadState, type PetRecord } from './state-store'

const tempDirs: string[] = []

function makePetRecord(id: string): PetRecord {
  return {
    id,
    spritesheetPath: '',
    width: 142,
    height: 154,
    state: 'idle',
  }
}

function makePetJson(id: string): {
  id: string
  name: string
  spritesheet: string
  frameWidth: number
  frameHeight: number
  columns: number
  rows: number
  states: Record<string, { frames: Array<{ row: number; col: number; ms: number }> }>
} {
  return {
    id,
    name: id,
    spritesheet: 'spritesheet.webp',
    frameWidth: 32,
    frameHeight: 32,
    columns: 1,
    rows: 1,
    states: {
      idle: {
        frames: [{ row: 0, col: 0, ms: 100 }],
      },
    },
  }
}

function writePet(root: string, id: string): string {
  const folder = path.join(root, id)
  fs.mkdirSync(folder, { recursive: true })
  fs.writeFileSync(path.join(folder, 'pet.json'), JSON.stringify(makePetJson(id)), 'utf8')
  fs.writeFileSync(path.join(folder, 'spritesheet.webp'), 'sprite', 'utf8')
  return folder
}

beforeEach(() => {
  vi.unstubAllEnvs()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('isValidPetJson', () => {
  it('requires render dimensions and a state machine', () => {
    expect(isValidPetJson(makePetJson('valid'))).toBe(true)
    expect(isValidPetJson({ ...makePetJson('invalid'), frameWidth: undefined })).toBe(false)
    expect(isValidPetJson({ ...makePetJson('invalid'), states: {} })).toBe(false)
  })
})

describe('resolveActivePet', () => {
  it('loads a persisted valid buddy-managed pet', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-pets-'))
    tempDirs.push(tempDir)
    const managedPetsDir = path.join(tempDir, 'managed')
    writePet(managedPetsDir, 'custom-cat')
    vi.stubEnv('BUDDY_SPRITES_DIR', managedPetsDir)
    vi.stubEnv('USERPROFILE', tempDir)

    const activePet = resolveActivePet(makePetRecord('custom-cat'))

    expect(activePet.id).toBe('custom-cat')
    expect(activePet.source).toBe('buddy')
    expect(activePet.manifest.id).toBe('custom-cat')
    expect(activePet.initialState).toBe('idle')
    expect(activePet.spritesheetUrl).toMatch(/^file:\/\//)
    expect(activePet.spritesheetUrl).toContain('spritesheet.webp')
  })

  it('falls back to packaged default when the persisted pet is missing', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-pets-'))
    tempDirs.push(tempDir)
    vi.stubEnv('BUDDY_SPRITES_DIR', path.join(tempDir, 'empty'))
    vi.stubEnv('USERPROFILE', tempDir)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const activePet = resolveActivePet(makePetRecord('missing-pet'))

    expect(activePet.id).toBe('default')
    expect(activePet.source).toBe('packaged')
    expect(warn).toHaveBeenCalledWith(
      "Selected pet 'missing-pet' is missing or invalid; falling back to default.",
    )
  })

  it('preserves a valid persisted startup state for the resolved pet', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-pets-'))
    tempDirs.push(tempDir)
    const managedPetsDir = path.join(tempDir, 'managed')
    const folder = writePet(managedPetsDir, 'custom-cat')
    const petJson = makePetJson('custom-cat')
    petJson.states.running = { frames: [{ row: 0, col: 0, ms: 50 }] }
    fs.writeFileSync(path.join(folder, 'pet.json'), JSON.stringify(petJson), 'utf8')
    vi.stubEnv('BUDDY_SPRITES_DIR', managedPetsDir)
    vi.stubEnv('USERPROFILE', tempDir)

    const activePet = resolveActivePet({ ...makePetRecord('custom-cat'), state: 'running' })

    expect(activePet.initialState).toBe('running')
  })

  it('rejects spritesheet paths outside the pet folder', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-pets-'))
    tempDirs.push(tempDir)
    const managedPetsDir = path.join(tempDir, 'managed')
    const folder = writePet(managedPetsDir, 'escape-cat')
    fs.writeFileSync(path.join(tempDir, 'outside.webp'), 'sprite', 'utf8')
    const petJson = { ...makePetJson('escape-cat'), spritesheet: '../../outside.webp' }
    fs.writeFileSync(path.join(folder, 'pet.json'), JSON.stringify(petJson), 'utf8')
    vi.stubEnv('BUDDY_SPRITES_DIR', managedPetsDir)
    vi.stubEnv('USERPROFILE', tempDir)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const activePet = resolveActivePet(makePetRecord('escape-cat'))

    expect(activePet.id).toBe('default')
  })
})

describe('selectActivePet', () => {
  it('validates, persists, and returns only the renderer-safe active-pet payload', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-pets-'))
    tempDirs.push(tempDir)
    const managedPetsDir = path.join(tempDir, 'managed')
    writePet(managedPetsDir, 'custom-cat')
    vi.stubEnv('BUDDY_SPRITES_DIR', managedPetsDir)
    vi.stubEnv('BUDDY_DATA_DIR', path.join(tempDir, 'data'))
    vi.stubEnv('USERPROFILE', tempDir)

    const activePet = selectActivePet('custom-cat')

    expect(activePet).toMatchObject({
      id: 'custom-cat',
      source: 'buddy',
      manifest: { id: 'custom-cat' },
      initialState: 'idle',
    })
    expect(activePet.spritesheetUrl).toMatch(/^file:\/\//)
    expect(Object.keys(activePet).sort()).toEqual([
      'id',
      'initialState',
      'manifest',
      'source',
      'spritesheetUrl',
    ])
    expect(loadState().pet.id).toBe('custom-cat')
  })

  it('rejects unknown and path-escaping requested ids without changing the persisted selection', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-pets-'))
    tempDirs.push(tempDir)
    const managedPetsDir = path.join(tempDir, 'managed')
    writePet(managedPetsDir, 'custom-cat')
    vi.stubEnv('BUDDY_SPRITES_DIR', managedPetsDir)
    vi.stubEnv('BUDDY_DATA_DIR', path.join(tempDir, 'data'))
    vi.stubEnv('USERPROFILE', tempDir)

    selectActivePet('custom-cat')

    expect(() => selectActivePet('missing-pet')).toThrow(PetSelectionError)
    expect(() => selectActivePet('../custom-cat')).toThrow(PetSelectionError)
    expect(loadState().pet.id).toBe('custom-cat')
  })
})
