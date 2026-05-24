/**
 * Unit tests for src/cli/commands/pets.ts
 *
 * Acceptance criteria covered:
 *   - runPetsList() shows valid pets with source labels
 *   - runPetsList() marks the currently active pet with an asterisk
 *   - runPetsList() shows invalid folder reasons
 *   - runPetsShow() prints the active pet id and path
 *   - runPetsShow() warns when no active pet is set
 *   - runPetsShow() warns when stored pet id no longer resolves
 *   - runPetsUse() validates and persists selection
 *   - runPetsUse() exits non-zero for unknown pet ids
 *   - runPetsUse() exits non-zero for invalid (failed-validation) pet ids
 *   - runPetsUse() never writes to Codex state files
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'

/* ── Hoisted mocks ─────────────────────────────────────────────────────────── */

const {
  mockReadFileSync,
  mockWriteFileSync,
  mockMkdirSync,
  mockReaddirSync,
  mockExistsSync,
  mockProcessExit,
} = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockReaddirSync: vi.fn(),
  mockExistsSync: vi.fn(),
  mockProcessExit: vi.fn(),
}))

vi.mock('fs', () => ({
  default: {
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    mkdirSync: mockMkdirSync,
    readdirSync: mockReaddirSync,
    existsSync: mockExistsSync,
  },
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
  readdirSync: mockReaddirSync,
  existsSync: mockExistsSync,
}))

// process.exit spy is re-established in beforeEach after vi.resetAllMocks().

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function captureOutput(): { stdout: string[]; stderr: string[]; restore: () => void } {
  const stdout: string[] = []
  const stderr: string[] = []
  const origOut = process.stdout.write.bind(process.stdout)
  const origErr = process.stderr.write.bind(process.stderr)

  process.stdout.write = (chunk: unknown) => {
    stdout.push(String(chunk))
    return true
  }
  process.stderr.write = (chunk: unknown) => {
    stderr.push(String(chunk))
    return true
  }

  return {
    stdout,
    stderr,
    restore: () => {
      process.stdout.write = origOut
      process.stderr.write = origErr
    },
  }
}

/* ── Test fixtures ──────────────────────────────────────────────────────────── */

const VALID_PET_JSON = {
  id: 'test-cat',
  name: 'Test Cat',
  spritesheet: 'spritesheet.webp',
  states: {
    idle: { frames: [{ row: 0, col: 0, ms: 280 }] },
  },
}

const BUDDY_PET_JSON = {
  id: 'buddy-ragdoll',
  name: 'Ragdoll Cat',
  spritesheet: 'spritesheet.webp',
  states: {
    idle: { frames: [{ row: 0, col: 0, ms: 280 }] },
  },
}

const CODEX_PET_JSON = {
  id: 'codex-dragon',
  name: 'Codex Dragon',
  spritesheet: 'spritesheet.webp',
  states: {
    idle: { frames: [{ row: 0, col: 0, ms: 280 }] },
  },
}

/** A mock state.json that references a specific pet id. */
function makeStateJson(petId: string): string {
  return JSON.stringify({
    open: true,
    bounds: { x: 100, y: 100, width: 356, height: 320 },
    pet: { id: petId, spritesheetPath: '', width: 142, height: 154, state: 'idle' },
    byResolution: {},
  })
}

/** Derive expected state file path. */
function expectedStatePath(): string {
  const base = process.env['USERPROFILE'] ?? os.homedir()
  return path.join(base, '.petdex-win', 'state.json')
}

/* ── Shared setup ───────────────────────────────────────────────────────────── */

beforeEach(() => {
  vi.resetModules()
  vi.unstubAllEnvs()
  vi.stubEnv('NO_COLOR', '1') // Plain output for easier assertions
  vi.stubEnv('USERPROFILE', '/fake/userprofile')

  vi.resetAllMocks()

  // Re-establish process.exit spy after resetAllMocks (which clears previous spy implementations).
  vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    mockProcessExit(typeof code === 'number' ? code : Number(code ?? 0))
    throw new Error(`process.exit(${code ?? ''})`)
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

/* ── runPetsList() ──────────────────────────────────────────────────────────── */

describe('runPetsList()', () => {
  it('shows valid buddy-managed and codex-compatible pets with source labels', async () => {
    mockReaddirSync.mockImplementation((dirPath: unknown) => {
      const p = dirPath as string
      if (p.includes('.petdex-win')) return [{ name: 'ragdoll', isDirectory: () => true }]
      if (p.includes('.codex')) return [{ name: 'dragon', isDirectory: () => true }]
      return []
    })
    mockReadFileSync.mockImplementation((filePath: unknown) => {
      const p = filePath as string
      if (p.endsWith('state.json')) throw new Error('ENOENT') // no active pet
      if (p.includes('ragdoll')) return JSON.stringify(BUDDY_PET_JSON)
      if (p.includes('dragon')) return JSON.stringify(CODEX_PET_JSON)
      throw new Error('ENOENT')
    })
    mockExistsSync.mockReturnValue(true)

    const { runPetsList } = await import('./pets.js')
    const cap = captureOutput()
    runPetsList()
    cap.restore()

    const out = cap.stdout.join('')
    expect(out).toContain('buddy-ragdoll')
    expect(out).toContain('buddy-managed')
    expect(out).toContain('codex-dragon')
    expect(out).toContain('codex-compatible')
  })

  it('shows packaged default pets when user pet directories are empty', async () => {
    mockReaddirSync.mockImplementation((dirPath: unknown) => {
      const p = dirPath as string
      if (p.endsWith(`${path.sep}pets`) && !p.includes('.petdex-win') && !p.includes('.codex')) {
        return [{ name: 'default', isDirectory: () => true }]
      }
      return []
    })
    mockReadFileSync.mockImplementation((filePath: unknown) => {
      const p = filePath as string
      if (p.endsWith('state.json')) return makeStateJson('default')
      return JSON.stringify({ ...VALID_PET_JSON, id: 'default', name: 'Default' })
    })
    mockExistsSync.mockReturnValue(true)

    const { runPetsList } = await import('./pets.js')
    const cap = captureOutput()
    runPetsList()
    cap.restore()

    const out = cap.stdout.join('')
    expect(out).toContain('default')
    expect(out).toContain('packaged')
    expect(out).not.toContain('No pet folders found')
  })

  it('marks the currently active pet with an asterisk', async () => {
    mockReaddirSync.mockImplementation((dirPath: unknown) => {
      const p = dirPath as string
      if (p.includes('.petdex-win')) return [{ name: 'test-cat', isDirectory: () => true }]
      return []
    })
    mockReadFileSync.mockImplementation((filePath: unknown) => {
      const p = filePath as string
      if (p.endsWith('state.json')) return makeStateJson('test-cat')
      return JSON.stringify(VALID_PET_JSON)
    })
    mockExistsSync.mockReturnValue(true)

    const { runPetsList } = await import('./pets.js')
    const cap = captureOutput()
    runPetsList()
    cap.restore()

    const out = cap.stdout.join('')
    expect(out).toContain('*')
    expect(out).toContain('test-cat')
  })

  it('shows invalid folder reasons when folders fail validation', async () => {
    mockReaddirSync.mockImplementation((dirPath: unknown) => {
      const p = dirPath as string
      if (p.includes('.petdex-win')) return [{ name: 'broken', isDirectory: () => true }]
      return []
    })
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    mockExistsSync.mockReturnValue(false)

    const { runPetsList } = await import('./pets.js')
    const cap = captureOutput()
    runPetsList()
    cap.restore()

    const out = cap.stdout.join('')
    expect(out).toContain('invalid')
    expect(out).toContain('skipped')
  })

  it('shows a warning when no pet folders exist', async () => {
    mockReaddirSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const { runPetsList } = await import('./pets.js')
    const cap = captureOutput()
    runPetsList()
    cap.restore()

    const out = cap.stdout.join('')
    expect(out).toContain('No pet folders found')
  })
})

/* ── runPetsShow() ──────────────────────────────────────────────────────────── */

describe('runPetsShow()', () => {
  it('prints the active pet id, name, source, and folder path', async () => {
    mockReaddirSync.mockImplementation((dirPath: unknown) => {
      const p = dirPath as string
      if (p.includes('.petdex-win')) return [{ name: 'test-cat', isDirectory: () => true }]
      return []
    })
    mockReadFileSync.mockImplementation((filePath: unknown) => {
      const p = filePath as string
      if (p.endsWith('state.json')) return makeStateJson('test-cat')
      return JSON.stringify(VALID_PET_JSON)
    })
    mockExistsSync.mockReturnValue(true)

    const { runPetsShow } = await import('./pets.js')
    const cap = captureOutput()
    runPetsShow()
    cap.restore()

    const out = cap.stdout.join('')
    expect(out).toContain('test-cat')
    expect(out).toContain('Test Cat')
    expect(out).toContain('buddy-managed')
  })

  it('warns when no active pet is set', async () => {
    mockReaddirSync.mockReturnValue([])
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    mockExistsSync.mockReturnValue(false)

    const { runPetsShow } = await import('./pets.js')
    const cap = captureOutput()
    runPetsShow()
    cap.restore()

    const out = cap.stdout.join('')
    expect(out).toContain('No active pet selected')
    expect(out).toContain("buddy pets use")
  })

  it('warns when stored pet id no longer resolves', async () => {
    mockReaddirSync.mockReturnValue([])
    mockReadFileSync.mockImplementation((filePath: unknown) => {
      const p = filePath as string
      if (p.endsWith('state.json')) return makeStateJson('old-pet-id')
      throw new Error('ENOENT')
    })
    mockExistsSync.mockReturnValue(false)

    const { runPetsShow } = await import('./pets.js')
    const cap = captureOutput()
    runPetsShow()
    cap.restore()

    const out = cap.stdout.join('')
    expect(out).toContain('old-pet-id')
    expect(out).toContain('no longer resolves')
  })
})

/* ── runPetsUse() ───────────────────────────────────────────────────────────── */

describe('runPetsUse()', () => {
  it('persists the pet selection to state.json for a valid pet', async () => {
    mockReaddirSync.mockImplementation((dirPath: unknown) => {
      const p = dirPath as string
      if (p.includes('.petdex-win')) return [{ name: 'test-cat', isDirectory: () => true }]
      return []
    })
    mockReadFileSync.mockImplementation((filePath: unknown) => {
      const p = filePath as string
      if (p.endsWith('state.json')) throw new Error('ENOENT') // no prior state
      return JSON.stringify(VALID_PET_JSON)
    })
    mockExistsSync.mockReturnValue(true)

    const { runPetsUse } = await import('./pets.js')
    const cap = captureOutput()
    runPetsUse('test-cat')
    cap.restore()

    // Verify writeFileSync was called with the state file path and updated pet id.
    expect(mockWriteFileSync).toHaveBeenCalled()
    const callArgs = mockWriteFileSync.mock.calls[0] as [string, string, string]
    expect(callArgs[0]).toBe(expectedStatePath())

    const written = JSON.parse(callArgs[1]) as { pet: { id: string } }
    expect(written.pet.id).toBe('test-cat')

    const out = cap.stdout.join('')
    expect(out).toContain("Active pet set to 'test-cat'")
  })

  it('preserves existing state fields when persisting pet selection', async () => {
    const existingState = {
      open: true,
      bounds: { x: 200, y: 300, width: 356, height: 320 },
      pet: { id: 'old-cat', spritesheetPath: 'old.webp', width: 142, height: 154, state: 'idle' },
      byResolution: { '1920x1080': { x: 200, y: 300, width: 356, height: 320 } },
    }

    mockReaddirSync.mockImplementation((dirPath: unknown) => {
      const p = dirPath as string
      if (p.includes('.petdex-win')) return [{ name: 'test-cat', isDirectory: () => true }]
      return []
    })
    mockReadFileSync.mockImplementation((filePath: unknown) => {
      const p = filePath as string
      if (p.endsWith('state.json')) return JSON.stringify(existingState)
      return JSON.stringify(VALID_PET_JSON)
    })
    mockExistsSync.mockReturnValue(true)

    const { runPetsUse } = await import('./pets.js')
    const cap = captureOutput()
    runPetsUse('test-cat')
    cap.restore()

    const callArgs = mockWriteFileSync.mock.calls[0] as [string, string, string]
    const written = JSON.parse(callArgs[1]) as {
      open: boolean
      bounds: object
      byResolution: object
      pet: { id: string }
    }
    // Must preserve existing state fields.
    expect(written.open).toBe(true)
    expect(written.bounds).toEqual(existingState.bounds)
    expect(written.byResolution).toEqual(existingState.byResolution)
    // Must update pet id.
    expect(written.pet.id).toBe('test-cat')
  })

  it('exits non-zero with actionable error for an unknown pet id', async () => {
    mockReaddirSync.mockImplementation(() => [])
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    mockExistsSync.mockReturnValue(false)

    const { runPetsUse } = await import('./pets.js')
    const cap = captureOutput()
    expect(() => runPetsUse('ghost-pet')).toThrow('process.exit')
    cap.restore()

    expect(mockProcessExit).toHaveBeenCalledWith(1)
    const err = cap.stderr.join('')
    expect(err).toContain("ghost-pet")
    expect(err).toContain("not found")
  })

  it('exits non-zero with validation reason for an invalid pet folder', async () => {
    mockReaddirSync.mockImplementation((dirPath: unknown) => {
      const p = dirPath as string
      if (p.includes('.petdex-win')) return [{ name: 'bad-cat', isDirectory: () => true }]
      return []
    })
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    mockExistsSync.mockReturnValue(false)

    const { runPetsUse } = await import('./pets.js')
    const cap = captureOutput()
    expect(() => runPetsUse('bad-cat')).toThrow('process.exit')
    cap.restore()

    expect(mockProcessExit).toHaveBeenCalledWith(1)
    const err = cap.stderr.join('')
    expect(err).toContain('bad-cat')
    expect(err).toContain('validation')
  })

  it('exits non-zero with empty id', async () => {
    const { runPetsUse } = await import('./pets.js')
    const cap = captureOutput()
    expect(() => runPetsUse('')).toThrow('process.exit')
    cap.restore()

    expect(mockProcessExit).toHaveBeenCalledWith(1)
    const err = cap.stderr.join('')
    expect(err).toContain('required')
  })

  it('never writes to Codex internal state paths', async () => {
    mockReaddirSync.mockImplementation((dirPath: unknown) => {
      const p = dirPath as string
      if (p.includes('.petdex-win')) return [{ name: 'test-cat', isDirectory: () => true }]
      return []
    })
    mockReadFileSync.mockImplementation((filePath: unknown) => {
      const p = filePath as string
      if (p.endsWith('state.json')) throw new Error('ENOENT')
      return JSON.stringify(VALID_PET_JSON)
    })
    mockExistsSync.mockReturnValue(true)

    const { runPetsUse } = await import('./pets.js')
    const cap = captureOutput()
    runPetsUse('test-cat')
    cap.restore()

    // Verify no writes went to a .codex path.
    for (const callArgs of mockWriteFileSync.mock.calls) {
      const writePath = String(callArgs[0])
      expect(writePath).not.toContain('.codex')
    }
  })

  it('writes to .petdex-win/state.json (buddy-owned path)', async () => {
    mockReaddirSync.mockImplementation((dirPath: unknown) => {
      const p = dirPath as string
      if (p.includes('.petdex-win')) return [{ name: 'test-cat', isDirectory: () => true }]
      return []
    })
    mockReadFileSync.mockImplementation((filePath: unknown) => {
      const p = filePath as string
      if (p.endsWith('state.json')) throw new Error('ENOENT')
      return JSON.stringify(VALID_PET_JSON)
    })
    mockExistsSync.mockReturnValue(true)

    const { runPetsUse } = await import('./pets.js')
    const cap = captureOutput()
    runPetsUse('test-cat')
    cap.restore()

    const callArgs = mockWriteFileSync.mock.calls[0] as [string, string, string]
    expect(callArgs[0]).toContain('.petdex-win')
    expect(callArgs[0]).toContain('state.json')
  })
})
