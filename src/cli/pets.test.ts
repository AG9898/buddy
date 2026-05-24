/**
 * Unit tests for src/cli/pets.ts
 *
 * Acceptance criteria:
 *   - discoverPets() lists valid pets from buddy-managed directory
 *   - discoverPets() lists valid Codex-compatible pets from Codex directory
 *   - Invalid folders are reported with concise reasons
 *   - Discovery does not read or write Codex internal state files
 *   - validatePetFolder() checks pet.json, referenced spritesheet, and state-machine fields
 *   - buddyPetsDir() / codexPetsDir() resolve correct paths
 *   - isValidPetJson() validates required fields
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'

/* ── Hoisted mocks ─────────────────────────────────────────────────────────── */

const { mockReadFileSync, mockReaddirSync, mockExistsSync } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
  mockReaddirSync: vi.fn(),
  mockExistsSync: vi.fn(),
}))

vi.mock('fs', () => ({
  default: {
    readFileSync: mockReadFileSync,
    readdirSync: mockReaddirSync,
    existsSync: mockExistsSync,
  },
  readFileSync: mockReadFileSync,
  readdirSync: mockReaddirSync,
  existsSync: mockExistsSync,
}))

import {
  isValidPetJson,
  validatePetFolder,
  discoverPets,
  buddyPetsDir,
  codexPetsDir,
  packagedPetsDir,
} from './pets.js'

/* ── Test fixtures ─────────────────────────────────────────────────────────── */

const VALID_PET_JSON = {
  id: 'test-cat',
  name: 'Test Cat',
  spritesheet: 'spritesheet.webp',
  frameWidth: 192,
  frameHeight: 208,
  columns: 8,
  rows: 9,
  states: {
    idle: {
      frames: [
        { row: 0, col: 0, ms: 280 },
        { row: 0, col: 1, ms: 110 },
      ],
    },
    running: {
      frames: [{ row: 1, col: 0, ms: 120 }],
    },
  },
}

/* ── isValidPetJson() ─────────────────────────────────────────────────────── */

describe('isValidPetJson()', () => {
  it('returns true for a valid pet.json object', () => {
    expect(isValidPetJson(VALID_PET_JSON)).toBe(true)
  })

  it('returns false when id is missing', () => {
    const bad = { ...VALID_PET_JSON, id: '' }
    expect(isValidPetJson(bad)).toBe(false)
  })

  it('returns false when name is missing', () => {
    const bad = { ...VALID_PET_JSON, name: '' }
    expect(isValidPetJson(bad)).toBe(false)
  })

  it('returns false when spritesheet is missing', () => {
    const bad = { ...VALID_PET_JSON, spritesheet: '' }
    expect(isValidPetJson(bad)).toBe(false)
  })

  it('returns false when states is missing', () => {
    const { states: _states, ...bad } = VALID_PET_JSON
    expect(isValidPetJson(bad)).toBe(false)
  })

  it('returns false when states is empty', () => {
    const bad = { ...VALID_PET_JSON, states: {} }
    expect(isValidPetJson(bad)).toBe(false)
  })

  it('returns false when a state has no frames', () => {
    const bad = {
      ...VALID_PET_JSON,
      states: {
        idle: { frames: [] },
      },
    }
    expect(isValidPetJson(bad)).toBe(false)
  })

  it('returns false when a frame is missing ms', () => {
    const bad = {
      ...VALID_PET_JSON,
      states: {
        idle: { frames: [{ row: 0, col: 0 }] },
      },
    }
    expect(isValidPetJson(bad)).toBe(false)
  })

  it('returns false for null', () => {
    expect(isValidPetJson(null)).toBe(false)
  })

  it('returns false for a string', () => {
    expect(isValidPetJson('hello')).toBe(false)
  })
})

/* ── validatePetFolder() ─────────────────────────────────────────────────── */

describe('validatePetFolder()', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns a PetEntry for a valid folder', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify(VALID_PET_JSON))
    mockExistsSync.mockReturnValue(true)

    const result = validatePetFolder('/pets/test-cat', 'buddy')
    expect('reason' in result).toBe(false)
    if (!('reason' in result)) {
      expect(result.id).toBe('test-cat')
      expect(result.name).toBe('Test Cat')
      expect(result.source).toBe('buddy')
      expect(result.folderPath).toBe('/pets/test-cat')
      expect(result.spritesheetPath).toBe(path.join('/pets/test-cat', 'spritesheet.webp'))
    }
  })

  it('returns InvalidPetEntry when pet.json is missing', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const result = validatePetFolder('/pets/missing', 'buddy')
    expect('reason' in result).toBe(true)
    if ('reason' in result) {
      expect(result.reason).toContain('pet.json missing')
    }
  })

  it('returns InvalidPetEntry when pet.json is invalid JSON', () => {
    mockReadFileSync.mockReturnValue('not valid json {{')

    const result = validatePetFolder('/pets/bad-json', 'buddy')
    expect('reason' in result).toBe(true)
    if ('reason' in result) {
      expect(result.reason).toContain('not valid JSON')
    }
  })

  it('returns InvalidPetEntry when pet.json is missing required fields', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ id: '', name: 'X', states: {} }))

    const result = validatePetFolder('/pets/bad-schema', 'buddy')
    expect('reason' in result).toBe(true)
    if ('reason' in result) {
      expect(result.reason).toContain('missing required fields')
    }
  })

  it('returns InvalidPetEntry when spritesheet file is missing', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify(VALID_PET_JSON))
    mockExistsSync.mockReturnValue(false)

    const result = validatePetFolder('/pets/no-sprite', 'buddy')
    expect('reason' in result).toBe(true)
    if ('reason' in result) {
      expect(result.reason).toContain('spritesheet not found')
    }
  })

  it('labels codex source entries correctly', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify(VALID_PET_JSON))
    mockExistsSync.mockReturnValue(true)

    const result = validatePetFolder('/codex/pets/test-cat', 'codex')
    expect('reason' in result).toBe(false)
    if (!('reason' in result)) {
      expect(result.source).toBe('codex')
    }
  })
})

/* ── discoverPets() ──────────────────────────────────────────────────────── */

describe('discoverPets()', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns buddy and codex pets when both directories have valid pets', () => {
    // Return one subdir per directory scan call
    mockReaddirSync.mockImplementation((dirPath: unknown) => {
      const p = dirPath as string
      if (p.includes('.petdex-win')) {
        return [{ name: 'ragdoll', isDirectory: () => true }]
      }
      if (p.includes('.codex')) {
        return [{ name: 'codex-cat', isDirectory: () => true }]
      }
      return []
    })
    mockReadFileSync.mockReturnValue(JSON.stringify(VALID_PET_JSON))
    mockExistsSync.mockReturnValue(true)

    const result = discoverPets()
    expect(result.valid.length).toBe(2)
    const sources = result.valid.map((p) => p.source)
    expect(sources).toContain('buddy')
    expect(sources).toContain('codex')
  })

  it('returns packaged pets from the buddy package pets directory', () => {
    mockReaddirSync.mockImplementation((dirPath: unknown) => {
      const p = dirPath as string
      if (p.endsWith(`${path.sep}pets`) && !p.includes('.petdex-win') && !p.includes('.codex')) {
        return [{ name: 'default', isDirectory: () => true }]
      }
      return []
    })
    mockReadFileSync.mockReturnValue(JSON.stringify({ ...VALID_PET_JSON, id: 'default' }))
    mockExistsSync.mockReturnValue(true)

    const result = discoverPets()
    expect(result.valid.length).toBe(1)
    expect(result.valid[0]?.id).toBe('default')
    expect(result.valid[0]?.source).toBe('packaged')
  })

  it('collects invalid entries with reasons', () => {
    mockReaddirSync.mockImplementation((dirPath: unknown) => {
      const p = dirPath as string
      if (p.includes('.petdex-win')) {
        return [{ name: 'broken', isDirectory: () => true }]
      }
      return []
    })
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    mockExistsSync.mockReturnValue(false)

    const result = discoverPets()
    expect(result.valid.length).toBe(0)
    expect(result.invalid.length).toBeGreaterThanOrEqual(1)
    expect(result.invalid[0]?.reason).toBeTruthy()
  })

  it('returns empty arrays when both directories are missing', () => {
    mockReaddirSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const result = discoverPets()
    expect(result.valid).toEqual([])
    expect(result.invalid).toEqual([])
  })

  it('returns buddy pets first, then codex pets', () => {
    mockReaddirSync.mockImplementation((dirPath: unknown) => {
      const p = dirPath as string
      if (p.includes('.petdex-win')) {
        return [{ name: 'buddy-pet', isDirectory: () => true }]
      }
      if (p.includes('.codex')) {
        return [{ name: 'codex-pet', isDirectory: () => true }]
      }
      return []
    })
    mockReadFileSync.mockReturnValue(JSON.stringify(VALID_PET_JSON))
    mockExistsSync.mockReturnValue(true)

    const result = discoverPets()
    expect(result.valid[0]?.source).toBe('buddy')
    expect(result.valid[1]?.source).toBe('codex')
  })
})

describe('packagedPetsDir()', () => {
  it('returns the package-level pets directory', () => {
    const dir = packagedPetsDir()
    expect(path.basename(dir)).toBe('pets')
  })
})

/* ── buddyPetsDir() / codexPetsDir() ─────────────────────────────────────── */

describe('buddyPetsDir()', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns default path under USERPROFILE when set', () => {
    vi.stubEnv('USERPROFILE', 'C:\\Users\\TestUser')
    vi.stubEnv('BUDDY_SPRITES_DIR', '')
    const dir = buddyPetsDir()
    expect(dir).toContain('.petdex-win')
    expect(dir).toContain('pets')
  })

  it('respects BUDDY_SPRITES_DIR override', () => {
    vi.stubEnv('BUDDY_SPRITES_DIR', '/custom/pets/dir')
    const dir = buddyPetsDir()
    expect(dir).toBe('/custom/pets/dir')
  })

  it('falls back to os.homedir() when USERPROFILE is not set', () => {
    // Delete USERPROFILE so the ?? fallback to os.homedir() is triggered
    const saved = process.env['USERPROFILE']
    delete process.env['USERPROFILE']
    vi.stubEnv('BUDDY_SPRITES_DIR', '')
    const dir = buddyPetsDir()
    if (saved !== undefined) process.env['USERPROFILE'] = saved
    expect(dir).toContain(os.homedir())
  })
})

describe('codexPetsDir()', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns path under USERPROFILE/.codex/pets when set', () => {
    vi.stubEnv('USERPROFILE', 'C:\\Users\\TestUser')
    const dir = codexPetsDir()
    expect(dir).toContain('.codex')
    expect(dir).toContain('pets')
  })

  it('falls back to os.homedir() when USERPROFILE is not set', () => {
    // Delete USERPROFILE so the ?? fallback to os.homedir() is triggered
    const saved = process.env['USERPROFILE']
    delete process.env['USERPROFILE']
    const dir = codexPetsDir()
    if (saved !== undefined) process.env['USERPROFILE'] = saved
    expect(dir).toContain(os.homedir())
  })
})
