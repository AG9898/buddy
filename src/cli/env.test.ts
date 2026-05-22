/**
 * Unit tests for src/cli/env.ts
 * Acceptance criteria:
 *   - isWSL() returns true when process.platform is 'linux' and /proc/version contains 'Microsoft'
 *   - isWSL() returns false on non-linux platforms
 *   - isWSL() returns false when /proc/version is unreadable
 *   - isWSL() returns false when /proc/version does not contain 'Microsoft'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock fs before importing the module under test ─────────────────────────

const { mockReadFileSync } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
}))

vi.mock('fs', () => ({
  default: {
    readFileSync: mockReadFileSync,
  },
  readFileSync: mockReadFileSync,
}))

import { isWSL, buddyPort, sidecarBaseUrl } from './env.js'

describe('isWSL()', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns true on linux when /proc/version contains Microsoft', () => {
    vi.stubGlobal('process', {
      ...process,
      platform: 'linux',
    })
    mockReadFileSync.mockReturnValue(
      'Linux version 5.15.153.1-microsoft-standard-WSL2 (x86_64-linux-gnu-gcc) #1',
    )
    expect(isWSL()).toBe(true)
  })

  it('returns false on win32', () => {
    vi.stubGlobal('process', {
      ...process,
      platform: 'win32',
    })
    expect(isWSL()).toBe(false)
  })

  it('returns false on linux when /proc/version does not contain Microsoft', () => {
    vi.stubGlobal('process', {
      ...process,
      platform: 'linux',
    })
    mockReadFileSync.mockReturnValue('Linux version 6.1.0-18-amd64 (debian-kernel@lists.debian.org)')
    expect(isWSL()).toBe(false)
  })

  it('returns false on linux when /proc/version is unreadable', () => {
    vi.stubGlobal('process', {
      ...process,
      platform: 'linux',
    })
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file')
    })
    expect(isWSL()).toBe(false)
  })
})

describe('buddyPort()', () => {
  it('returns 7777 by default', () => {
    vi.stubEnv('BUDDY_PORT', '')
    expect(buddyPort()).toBe(7777)
  })

  it('returns the value of BUDDY_PORT when set', () => {
    vi.stubEnv('BUDDY_PORT', '8888')
    expect(buddyPort()).toBe(8888)
  })
})

describe('sidecarBaseUrl()', () => {
  it('uses 127.0.0.1 and the default port', () => {
    vi.stubEnv('BUDDY_PORT', '')
    expect(sidecarBaseUrl()).toBe('http://127.0.0.1:7777')
  })
})
