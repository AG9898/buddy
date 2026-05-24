/**
 * Unit tests for src/main/state-store.ts.
 * Acceptance criteria:
 *   - loadState() returns valid defaults when state.json does not exist
 *   - saveState() creates the .petdex-win directory if it does not exist
 *   - A round-trip (saveState then loadState) preserves all fields without loss
 *   - saveBounds() updates byResolution keyed by the current screen resolution string
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import path from 'path'

// ---------------------------------------------------------------------------
// Declare mock functions before vi.mock calls.
// vi.mock factories are hoisted, but vi.hoisted lets us hoist variable init too.
// ---------------------------------------------------------------------------
const { mockReadFileSync, mockWriteFileSync, mockMkdirSync } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
}))

const MOCK_HOME = '/mock/home'

vi.mock('fs', () => ({
  default: {
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    mkdirSync: mockMkdirSync,
  },
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
}))

vi.mock('os', () => ({
  default: { homedir: () => MOCK_HOME },
  homedir: () => MOCK_HOME,
}))

// Import after mocks are in place.
import { loadState, saveState, saveBounds } from './state-store'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loadState', () => {
  it('returns default state when state.json does not exist', () => {
    mockReadFileSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    const state = loadState()

    expect(state.open).toBe(true)
    expect(state.bounds).toEqual({ x: 1600, y: 760, width: 356, height: 320 })
    expect(state.pet.id).toBe('default')
    expect(state.pet.state).toBe('idle')
    expect(state.byResolution).toEqual({})
  })

  it('returns default state when state.json contains invalid JSON', () => {
    mockReadFileSync.mockReturnValue('not-valid-json{')

    const state = loadState()

    expect(state.open).toBe(true)
    expect(state.bounds.width).toBe(356)
  })

  it('returns default state when state.json is structurally invalid', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ unexpected: true }))

    const state = loadState()

    expect(state.open).toBe(true)
  })

  it('returns persisted state when state.json is valid', () => {
    const persisted = {
      open: false,
      bounds: { x: 100, y: 200, width: 356, height: 320 },
      pet: { id: 'my-pet', spritesheetPath: '/path.webp', width: 142, height: 154, state: 'running' },
      byResolution: { '1920x1080': { x: 100, y: 200, width: 356, height: 320 } },
    }
    mockReadFileSync.mockReturnValue(JSON.stringify(persisted))

    const state = loadState()

    expect(state.open).toBe(false)
    expect(state.bounds.x).toBe(100)
    expect(state.pet.id).toBe('my-pet')
    expect(state.byResolution['1920x1080']).toBeDefined()
  })
})

describe('saveState', () => {
  it('creates the .petdex-win directory with recursive:true', () => {
    saveState({
      open: true,
      bounds: { x: 0, y: 0, width: 356, height: 320 },
      pet: { id: 'default', spritesheetPath: '', width: 142, height: 154, state: 'idle' },
      byResolution: {},
    })

    expect(mockMkdirSync).toHaveBeenCalledWith(path.join(MOCK_HOME, '.petdex-win'), { recursive: true })
  })

  it('writes to the correct state.json path', () => {
    saveState({
      open: true,
      bounds: { x: 0, y: 0, width: 356, height: 320 },
      pet: { id: 'default', spritesheetPath: '', width: 142, height: 154, state: 'idle' },
      byResolution: {},
    })

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      path.join(MOCK_HOME, '.petdex-win', 'state.json'),
      expect.any(String),
      'utf8',
    )
  })

  it('round-trip: saveState then loadState preserves all fields', () => {
    const original = {
      open: false,
      bounds: { x: 500, y: 300, width: 400, height: 350 },
      pet: { id: 'test-pet', spritesheetPath: '/some/path.webp', width: 100, height: 120, state: 'waving' },
      byResolution: { '2560x1440': { x: 500, y: 300, width: 400, height: 350 } },
    }

    // Capture what was written.
    let writtenJson = ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockWriteFileSync.mockImplementation((_p: any, data: any) => {
      writtenJson = data as string
    })

    saveState(original)

    // On next loadState, return the written JSON.
    mockReadFileSync.mockReturnValue(writtenJson)

    const loaded = loadState()

    expect(loaded).toEqual(original)
  })
})

describe('saveBounds', () => {
  it('updates byResolution with the provided resolution key', () => {
    // loadState will return defaults (file missing).
    mockReadFileSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    let writtenJson = ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockWriteFileSync.mockImplementation((_p: any, data: any) => {
      writtenJson = data as string
    })

    saveBounds({ x: 800, y: 400, width: 356, height: 320 }, '1920x1080')

    const saved = JSON.parse(writtenJson) as {
      bounds: { x: number; y: number }
      byResolution: Record<string, { x: number; y: number; width: number; height: number }>
    }
    expect(saved.bounds).toEqual({ x: 800, y: 400, width: 356, height: 320 })
    expect(saved.byResolution['1920x1080']).toEqual({ x: 800, y: 400, width: 356, height: 320 })
  })

  it('falls back to WxH key when no resolution key is provided', () => {
    mockReadFileSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    let writtenJson = ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockWriteFileSync.mockImplementation((_p: any, data: any) => {
      writtenJson = data as string
    })

    saveBounds({ x: 50, y: 50, width: 356, height: 320 })

    const saved = JSON.parse(writtenJson) as {
      byResolution: Record<string, unknown>
    }
    // Falls back to bounds WxH as key.
    expect(saved.byResolution['356x320']).toBeDefined()
  })
})
