/**
 * Unit tests for src/cli/commands/pets.ts
 *
 * Acceptance criteria covered:
 *   - runPetsList() returns a typed result: valid pets with source labels and the active marker
 *   - runPetsList() reports invalid folders (count in normal output, reasons under --verbose)
 *   - runPetsList() degrades to a "no pet folders" result instead of failing
 *   - runPetsCurrent() reports the active pet id, name, source, and folder
 *   - runPetsCurrent() reports "no active pet" and unresolved stored ids without failing
 *   - runPetsUse() validates, persists, and states that the pet applies on the next start
 *   - runPetsUse() throws typed CliErrors (code + exit 1) for empty, unknown, and invalid ids
 *   - runPetsUse() never writes to Codex state files
 *   - All three honor --json, --quiet, and --verbose through the shared renderer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import {
  configureOutput,
  renderFailure,
  renderResult,
  resetOutputContext,
  type OutputContextOptions,
} from '../output.js'

/* ── Hoisted mocks ─────────────────────────────────────────────────────────── */

const { mockReadFileSync, mockWriteFileSync, mockMkdirSync, mockReaddirSync, mockExistsSync } =
  vi.hoisted(() => ({
    mockReadFileSync: vi.fn(),
    mockWriteFileSync: vi.fn(),
    mockMkdirSync: vi.fn(),
    mockReaddirSync: vi.fn(),
    mockExistsSync: vi.fn(),
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

/* ── Helpers ────────────────────────────────────────────────────────────────── */

interface CapturedOutput {
  readonly stdout: string[]
  readonly stderr: string[]
}

/** Install a test output context so the shared renderer writes into arrays. */
function captureOutput(
  options: Omit<OutputContextOptions, 'stdout' | 'stderr'> = {},
): CapturedOutput {
  const stdout: string[] = []
  const stderr: string[] = []
  configureOutput({
    color: false,
    ...options,
    stdout: { write: (chunk: string) => stdout.push(chunk) },
    stderr: { write: (chunk: string) => stderr.push(chunk) },
  })
  return { stdout, stderr }
}

/** Parse the single JSON payload written to stdout in `--json` mode. */
function parsePayload(captured: CapturedOutput): Record<string, unknown> {
  expect(captured.stdout).toHaveLength(1)
  return JSON.parse(captured.stdout.join('')) as Record<string, unknown>
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

/**
 * Wire fs mocks so state.json reads reflect the most recent write.
 * `runPetsUse` reads the selection back after saving it.
 */
function withPersistedState(initialState: string | null, petJson: unknown): void {
  let stateJson = initialState
  mockWriteFileSync.mockImplementation((filePath: unknown, contents: unknown) => {
    if (String(filePath).endsWith('state.json')) stateJson = String(contents)
  })
  mockReadFileSync.mockImplementation((filePath: unknown) => {
    const p = filePath as string
    if (p.endsWith('state.json')) {
      if (stateJson === null) throw new Error('ENOENT')
      return stateJson
    }
    return JSON.stringify(petJson)
  })
}

/** Only the buddy-managed pets directory contains the named folders. */
function withBuddyPetFolders(...names: string[]): void {
  mockReaddirSync.mockImplementation((dirPath: unknown) => {
    const p = dirPath as string
    if (p.includes('.petdex-win')) return names.map((name) => ({ name, isDirectory: () => true }))
    return []
  })
}

/* ── Shared setup ───────────────────────────────────────────────────────────── */

beforeEach(() => {
  vi.resetModules()
  vi.unstubAllEnvs()
  vi.stubEnv('NO_COLOR', '1') // Plain output for easier assertions
  vi.stubEnv('USERPROFILE', '/fake/userprofile')

  vi.resetAllMocks()
})

afterEach(() => {
  vi.unstubAllEnvs()
  resetOutputContext()
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
    const captured = captureOutput()
    const result = runPetsList()
    renderResult(result)

    expect(result.command).toBe('pets.list')
    expect(result.data.active).toBeNull()
    expect(result.data.pets.map((pet) => pet.id)).toEqual(['buddy-ragdoll', 'codex-dragon'])

    const out = captured.stdout.join('')
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
    const captured = captureOutput()
    renderResult(runPetsList())

    const out = captured.stdout.join('')
    expect(out).toContain('default')
    expect(out).toContain('packaged')
    expect(out).not.toContain('No pet folders found')
  })

  it('marks the currently active pet', async () => {
    withBuddyPetFolders('test-cat')
    mockReadFileSync.mockImplementation((filePath: unknown) => {
      const p = filePath as string
      if (p.endsWith('state.json')) return makeStateJson('test-cat')
      return JSON.stringify(VALID_PET_JSON)
    })
    mockExistsSync.mockReturnValue(true)

    const { runPetsList } = await import('./pets.js')
    const captured = captureOutput()
    const result = runPetsList()
    renderResult(result)

    expect(result.data.active).toBe('test-cat')
    expect(result.data.pets[0]?.active).toBe(true)

    const out = captured.stdout.join('')
    expect(out).toContain('active')
    expect(out).toContain('test-cat')
  })

  it('counts invalid folders and keeps their reasons for --verbose and --json', async () => {
    withBuddyPetFolders('broken')
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    mockExistsSync.mockReturnValue(false)

    const { runPetsList } = await import('./pets.js')
    const captured = captureOutput({ mode: 'verbose' })
    const result = runPetsList()
    renderResult(result)

    expect(result.data.invalid).toHaveLength(1)
    expect(result.data.invalid[0]?.reason).toContain('pet.json')

    const out = captured.stdout.join('')
    expect(out).toContain('invalid')
    expect(out).toContain('skipped')
  })

  it('reports an empty environment without failing', async () => {
    mockReaddirSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const { runPetsList } = await import('./pets.js')
    const captured = captureOutput()
    const result = runPetsList()
    renderResult(result)

    expect(result.data.pets).toHaveLength(0)
    expect(captured.stdout.join('')).toContain('No pet folders found')
  })

  it('emits one JSON payload with the full discovery data', async () => {
    withBuddyPetFolders('test-cat')
    mockReadFileSync.mockImplementation((filePath: unknown) => {
      const p = filePath as string
      if (p.endsWith('state.json')) return makeStateJson('test-cat')
      return JSON.stringify(VALID_PET_JSON)
    })
    mockExistsSync.mockReturnValue(true)

    const { runPetsList } = await import('./pets.js')
    const captured = captureOutput({ json: true })
    renderResult(runPetsList())

    const payload = parsePayload(captured) as {
      ok: boolean
      command: string
      data: { active: string; pets: Array<{ id: string; source: string; active: boolean }> }
    }
    expect(payload.ok).toBe(true)
    expect(payload.command).toBe('pets.list')
    expect(payload.data.active).toBe('test-cat')
    expect(payload.data.pets[0]).toMatchObject({ id: 'test-cat', source: 'buddy', active: true })
  })
})

/* ── runPetsCurrent() ───────────────────────────────────────────────────────── */

describe('runPetsCurrent()', () => {
  it('prints the active pet id, name, source, and folder path', async () => {
    withBuddyPetFolders('test-cat')
    mockReadFileSync.mockImplementation((filePath: unknown) => {
      const p = filePath as string
      if (p.endsWith('state.json')) return makeStateJson('test-cat')
      return JSON.stringify(VALID_PET_JSON)
    })
    mockExistsSync.mockReturnValue(true)

    const { runPetsCurrent } = await import('./pets.js')
    const captured = captureOutput()
    const result = runPetsCurrent()
    renderResult(result)

    expect(result.command).toBe('pets.current')
    expect(result.data).toMatchObject({ active: 'test-cat', resolved: true })

    const out = captured.stdout.join('')
    expect(out).toContain('test-cat')
    expect(out).toContain('Test Cat')
    expect(out).toContain('buddy-managed')
  })

  it('reports when no active pet is set', async () => {
    mockReaddirSync.mockReturnValue([])
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    mockExistsSync.mockReturnValue(false)

    const { runPetsCurrent } = await import('./pets.js')
    const captured = captureOutput()
    const result = runPetsCurrent()
    renderResult(result)

    expect(result.data).toEqual({ active: null, resolved: false, pet: null })

    const out = captured.stdout.join('')
    expect(out).toContain('No active pet selected')
    expect(out).toContain('buddy pets use')
  })

  it('warns when the stored pet id no longer resolves', async () => {
    mockReaddirSync.mockReturnValue([])
    mockReadFileSync.mockImplementation((filePath: unknown) => {
      const p = filePath as string
      if (p.endsWith('state.json')) return makeStateJson('old-pet-id')
      throw new Error('ENOENT')
    })
    mockExistsSync.mockReturnValue(false)

    const { runPetsCurrent } = await import('./pets.js')
    const captured = captureOutput()
    const result = runPetsCurrent()
    renderResult(result)

    expect(result.data).toMatchObject({ active: 'old-pet-id', resolved: false, pet: null })

    const out = captured.stdout.join('')
    expect(out).toContain('old-pet-id')
    expect(out).toContain('no longer resolves')
  })

  it('returns the same data through the pets.current JSON payload', async () => {
    withBuddyPetFolders('test-cat')
    mockReadFileSync.mockImplementation((filePath: unknown) => {
      const p = filePath as string
      if (p.endsWith('state.json')) return makeStateJson('test-cat')
      return JSON.stringify(VALID_PET_JSON)
    })
    mockExistsSync.mockReturnValue(true)

    const { runPetsCurrent } = await import('./pets.js')
    const captured = captureOutput({ json: true })
    renderResult(runPetsCurrent())

    const payload = parsePayload(captured) as {
      command: string
      data: { active: string; resolved: boolean; pet: { id: string; name: string } }
    }
    expect(payload.command).toBe('pets.current')
    expect(payload.data.resolved).toBe(true)
    expect(payload.data.pet).toMatchObject({ id: 'test-cat', name: 'Test Cat' })
  })
})

/* ── runPetsUse() ───────────────────────────────────────────────────────────── */

describe('runPetsUse()', () => {
  it('persists the pet selection to state.json for a valid pet', async () => {
    withBuddyPetFolders('test-cat')
    withPersistedState(null, VALID_PET_JSON)
    mockExistsSync.mockReturnValue(true)

    const { runPetsUse } = await import('./pets.js')
    const captured = captureOutput()
    const result = runPetsUse('test-cat')
    renderResult(result)

    expect(mockWriteFileSync).toHaveBeenCalled()
    const callArgs = mockWriteFileSync.mock.calls[0] as [string, string, string]
    expect(callArgs[0]).toBe(expectedStatePath())

    const written = JSON.parse(callArgs[1]) as { pet: { id: string } }
    expect(written.pet.id).toBe('test-cat')

    expect(result.command).toBe('pets.use')
    expect(result.checks ?? []).toHaveLength(0)
    expect(captured.stdout.join('')).toContain("Active pet set to 'test-cat'")
  })

  it('states that the saved pet applies on the next start', async () => {
    withBuddyPetFolders('test-cat')
    withPersistedState(null, VALID_PET_JSON)
    mockExistsSync.mockReturnValue(true)

    const { runPetsUse } = await import('./pets.js')
    const captured = captureOutput()
    const result = runPetsUse('test-cat')
    renderResult(result)

    expect(result.data.applied).toBe('next-start')

    const out = captured.stdout.join('')
    expect(out).toContain('next buddy start')
    // Never claims the running pet changed until live selection ships.
    expect(out).not.toContain('applied live')
  })

  it('preserves existing state fields when persisting pet selection', async () => {
    const existingState = {
      open: true,
      bounds: { x: 200, y: 300, width: 356, height: 320 },
      pet: { id: 'old-cat', spritesheetPath: 'old.webp', width: 142, height: 154, state: 'idle' },
      byResolution: { '1920x1080': { x: 200, y: 300, width: 356, height: 320 } },
    }

    withBuddyPetFolders('test-cat')
    withPersistedState(JSON.stringify(existingState), VALID_PET_JSON)
    mockExistsSync.mockReturnValue(true)

    const { runPetsUse } = await import('./pets.js')
    captureOutput()
    runPetsUse('test-cat')

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

  it('fails with an actionable typed error for an unknown pet id', async () => {
    mockReaddirSync.mockImplementation(() => [])
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    mockExistsSync.mockReturnValue(false)

    const { runPetsUse } = await import('./pets.js')
    const captured = captureOutput()
    let exitCode = 0
    try {
      runPetsUse('ghost-pet')
    } catch (err) {
      exitCode = renderFailure(err, 'pets.use')
    }

    expect(exitCode).toBe(1)
    expect(mockWriteFileSync).not.toHaveBeenCalled()
    const err = captured.stderr.join('')
    expect(err).toContain('ghost-pet')
    expect(err).toContain('not found')
  })

  it('fails with the validation reason for an invalid pet folder', async () => {
    withBuddyPetFolders('bad-cat')
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    mockExistsSync.mockReturnValue(false)

    const { runPetsUse } = await import('./pets.js')
    const captured = captureOutput()
    let exitCode = 0
    try {
      runPetsUse('bad-cat')
    } catch (err) {
      exitCode = renderFailure(err, 'pets.use')
    }

    expect(exitCode).toBe(1)
    expect(mockWriteFileSync).not.toHaveBeenCalled()
    const err = captured.stderr.join('')
    expect(err).toContain('bad-cat')
    expect(err).toContain('validation')
  })

  it('fails with an empty id', async () => {
    const { runPetsUse } = await import('./pets.js')
    const captured = captureOutput()
    let exitCode = 0
    try {
      runPetsUse('')
    } catch (err) {
      exitCode = renderFailure(err, 'pets.use')
    }

    expect(exitCode).toBe(1)
    expect(captured.stderr.join('')).toContain('required')
  })

  it('emits the failure as the single JSON stdout payload', async () => {
    mockReaddirSync.mockImplementation(() => [])
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    mockExistsSync.mockReturnValue(false)

    const { runPetsUse } = await import('./pets.js')
    const captured = captureOutput({ json: true })
    try {
      runPetsUse('ghost-pet')
    } catch (err) {
      renderFailure(err, 'pets.use')
    }

    const payload = parsePayload(captured) as {
      ok: boolean
      command: string
      error: { code: string; data: { id: string } }
    }
    expect(payload.ok).toBe(false)
    expect(payload.command).toBe('pets.use')
    expect(payload.error.code).toBe('pets.not_found')
    expect(payload.error.data.id).toBe('ghost-pet')
  })

  it('never writes to Codex internal state paths', async () => {
    withBuddyPetFolders('test-cat')
    withPersistedState(null, VALID_PET_JSON)
    mockExistsSync.mockReturnValue(true)

    const { runPetsUse } = await import('./pets.js')
    captureOutput()
    runPetsUse('test-cat')

    // Verify no writes went to a .codex path.
    for (const callArgs of mockWriteFileSync.mock.calls) {
      const writePath = String(callArgs[0])
      expect(writePath).not.toContain('.codex')
    }
  })

  it('writes to .petdex-win/state.json (buddy-owned path)', async () => {
    withBuddyPetFolders('test-cat')
    withPersistedState(null, VALID_PET_JSON)
    mockExistsSync.mockReturnValue(true)

    const { runPetsUse } = await import('./pets.js')
    captureOutput()
    runPetsUse('test-cat')

    const callArgs = mockWriteFileSync.mock.calls[0] as [string, string, string]
    expect(callArgs[0]).toContain('.petdex-win')
    expect(callArgs[0]).toContain('state.json')
  })

  it('writes selected pet state under BUDDY_DATA_DIR when configured', async () => {
    const dataDir = path.join(path.sep, 'mnt', 'c', 'Users', 'TestUser', '.petdex-win')
    vi.stubEnv('BUDDY_DATA_DIR', dataDir)
    withBuddyPetFolders('test-cat')
    withPersistedState(null, VALID_PET_JSON)
    mockExistsSync.mockReturnValue(true)

    const { runPetsUse } = await import('./pets.js')
    captureOutput()
    runPetsUse('test-cat')

    const callArgs = mockWriteFileSync.mock.calls[0] as [string, string, string]
    expect(callArgs[0]).toBe(path.join(dataDir, 'state.json'))
  })

  it('keeps the selection result quiet-safe and verbose-aware', async () => {
    withBuddyPetFolders('test-cat')
    withPersistedState(null, VALID_PET_JSON)
    mockExistsSync.mockReturnValue(true)

    const { runPetsUse } = await import('./pets.js')

    const quiet = captureOutput({ mode: 'quiet' })
    renderResult(runPetsUse('test-cat'))
    const quietOut = quiet.stdout.join('')
    expect(quietOut).toContain("Active pet set to 'test-cat'")
    expect(quietOut).not.toContain('buddy stop, then buddy start')

    const verbose = captureOutput({ mode: 'verbose' })
    renderResult(runPetsUse('test-cat'))
    expect(verbose.stdout.join('')).toContain('Selection stored in')
  })
})
