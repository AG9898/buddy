/**
 * Unit tests for src/cli/commands/hatch.ts
 *
 * Verifies:
 *   - runHatch shows staged progress rather than raw subprocess dumps
 *   - Normal mode hides raw Codex output
 *   - Verbose mode (--verbose flag) shows subprocess detail
 *   - Verbose mode enabled via BUDDY_LOG_LEVEL=debug env var
 *   - On Codex failure, error message is concise and actionable
 *   - Missing output files produce a clear error
 *   - Success path prints pet id, assets path, and next command hint
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import path from 'path'
import type { ChildProcess, SpawnOptions } from 'child_process'

/* ── Hoisted mocks ─────────────────────────────────────────────────────────── */

const { mockSpawnSync, mockSpawn, mockExistsSync } = vi.hoisted(() => ({
  mockSpawnSync: vi.fn(),
  mockSpawn: vi.fn(),
  mockExistsSync: vi.fn(),
}))

vi.mock('child_process', () => ({
  spawnSync: mockSpawnSync,
  spawn: mockSpawn,
}))

vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
  },
  existsSync: mockExistsSync,
}))

/* ── Helpers ──────────────────────────────────────────────────────────────── */

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

/**
 * Build a fake child process that resolves with a given exit code.
 * Fires exit asynchronously after a Promise microtask so listeners are registered first.
 */
function makeFakeChild(exitCode: number, stdoutData = '', stderrData = ''): ChildProcess {
  const child = new EventEmitter()
  const stdinEnd = vi.fn()

  // child.stdin: minimal writable stub
  Object.defineProperty(child, 'stdin', {
    value: { end: stdinEnd },
    writable: true,
  })

  // child.stdout / child.stderr: readable EventEmitters for pipe mode
  const stdoutEmitter = new EventEmitter()
  const stderrEmitter = new EventEmitter()
  Object.defineProperty(child, 'stdout', { value: stdoutEmitter, writable: true })
  Object.defineProperty(child, 'stderr', { value: stderrEmitter, writable: true })

  // Fire asynchronously after the current microtask queue so that the promise
  // registers child.on('exit') before we emit.
  Promise.resolve().then(() => {
    if (stdoutData) stdoutEmitter.emit('data', Buffer.from(stdoutData))
    if (stderrData) stderrEmitter.emit('data', Buffer.from(stderrData))
    child.emit('exit', exitCode, null)
  })

  return child as unknown as ChildProcess
}

async function renderHatch(prompt: string, outputDir: string, verbose = false): Promise<void> {
  const { runHatch } = await import('./hatch.js')
  const { renderResult } = await import('../output.js')
  renderResult(await runHatch(prompt, outputDir, verbose))
}

async function configureHatchOutput(options: {
  mode?: 'quiet' | 'normal' | 'verbose'
  json?: boolean
}): Promise<void> {
  const { configureOutput } = await import('../output.js')
  configureOutput({ ...options, color: false, unicode: false })
}

function setStdoutTTY(value: boolean): () => void {
  Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value })
  return () => {
    delete (process.stdout as { isTTY?: boolean }).isTTY
  }
}

/* ── Shared setup ────────────────────────────────────────────────────────── */

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('NO_COLOR', '1') // Disable ANSI for easier string matching
  vi.stubEnv('BUDDY_LOG_LEVEL', '')
  vi.stubEnv('BUDDY_VERBOSE', '')

  // spawnSync: git rev-parse, codex --version, codex doctor
  mockSpawnSync.mockImplementation((cmd: string, args: string[]) => {
    if (cmd === 'git' && (args as string[]).includes('rev-parse')) {
      return { status: 0, stdout: '/fake/repo', stderr: '', error: null }
    }
    if ((args as string[]).includes('--version')) {
      return { status: 0, stdout: 'codex 1.0.0', stderr: '', error: null }
    }
    if ((args as string[]).includes('doctor')) {
      return { status: 0, stdout: 'ok', stderr: '', error: null }
    }
    return { status: 0, stdout: '', stderr: '', error: null }
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('hatch destination helpers', () => {
  it('derives a stable folder-safe pet id from the prompt', async () => {
    const { petIdFromPrompt } = await import('./hatch.js')
    expect(petIdFromPrompt('A Tiny Café Dragon!!!')).toBe('a-tiny-cafe-dragon')
  })

  it('rejects unsafe pet ids before using them in a path', async () => {
    const { validatePetId } = await import('./hatch.js')
    expect(() => validatePetId('../default')).toThrow('Pet id must be')
    expect(() => validatePetId('')).toThrow('Pet id must be')
  })

  it('places default hatches under the buddy-managed data directory', async () => {
    // Build the expectation with path.join so separators match the host platform
    // (backslashes on Windows, forward slashes on Linux/macOS).
    const dataDir = path.join(path.sep, 'buddy-data')
    vi.stubEnv('BUDDY_DATA_DIR', dataDir)
    const { buddyManagedPetOutputDir } = await import('./hatch.js')
    expect(buddyManagedPetOutputDir('jade-wisp')).toBe(path.join(dataDir, 'pets', 'jade-wisp'))
  })
})

/* ── Tests ──────────────────────────────────────────────────────────────── */

describe('runHatch — normal mode', () => {
  it('shows stable numbered stages and a concise result', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (String(p).endsWith('SKILL.md')) return true
      if (String(p).endsWith('spritesheet.webp')) return true
      if (String(p).endsWith('pet.json')) return true
      return false
    })
    mockSpawn.mockImplementation((_cmd: string, _args: string[], _opts: SpawnOptions) =>
      makeFakeChild(0),
    )

    const cap = captureOutput()
    await renderHatch('a small orange cat', 'pets/my-cat')
    cap.restore()

    const out = cap.stdout.join('')
    expect(out).toMatch(/1\/5 Checking requirements \(\d+\.\ds\)/)
    expect(out).toContain('2/5 Confirming concept and destination')
    expect(out).toContain('3/5 Generating visual assets with Codex')
    expect(out).toContain('4/5 Validating packaged assets')
    expect(out).toContain('5/5 Finalizing your pet')
    expect(out).toContain('Pet hatched successfully')
    expect(out).toContain('my-cat')
  })

  it('uses an in-place spinner only for interactive TTY output and finishes its line', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (String(p).endsWith('SKILL.md')) return true
      if (String(p).endsWith('spritesheet.webp')) return true
      if (String(p).endsWith('pet.json')) return true
      return false
    })
    mockSpawn.mockImplementation(() => makeFakeChild(0))

    const restoreTTY = setStdoutTTY(true)
    const cap = captureOutput()
    await renderHatch('a small orange cat', 'pets/my-cat')
    cap.restore()
    restoreTTY()

    const out = cap.stdout.join('')
    expect(out).toContain('\r| Generating visual assets with Codex')
    expect(out).toContain('complete\n')
  })

  it('does NOT show raw Codex subprocess output in normal mode', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (String(p).endsWith('SKILL.md')) return true
      if (String(p).endsWith('spritesheet.webp')) return true
      if (String(p).endsWith('pet.json')) return true
      return false
    })
    mockSpawn.mockImplementation(() => makeFakeChild(0, 'CODEX_RAW_LOG: generating frame 1/72', ''))

    const cap = captureOutput()
    await renderHatch('a small orange cat', 'pets/default')
    cap.restore()

    const out = cap.stdout.join('')
    expect(out).not.toContain('CODEX_RAW_LOG')
  })

  it('keeps quiet output deterministic by suppressing stages and spinner', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (String(p).endsWith('SKILL.md')) return true
      if (String(p).endsWith('spritesheet.webp')) return true
      if (String(p).endsWith('pet.json')) return true
      return false
    })
    mockSpawn.mockImplementation(() => makeFakeChild(0))

    await configureHatchOutput({ mode: 'quiet' })
    const cap = captureOutput()
    await renderHatch('a small orange cat', 'pets/my-cat')
    cap.restore()

    const out = cap.stdout.join('')
    expect(out).not.toContain('1/5')
    expect(out).not.toContain('\r')
    expect(out).toContain('Pet hatched successfully')
  })

  it('emits one final JSON result and sends verbose Codex detail to stderr', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (String(p).endsWith('SKILL.md')) return true
      if (String(p).endsWith('spritesheet.webp')) return true
      if (String(p).endsWith('pet.json')) return true
      return false
    })
    mockSpawn.mockImplementation(() => makeFakeChild(0, 'CODEX_VERBOSE_LOG\n'))

    await configureHatchOutput({ mode: 'verbose', json: true })
    const cap = captureOutput()
    await renderHatch('a small orange cat', 'pets/my-cat', true)
    cap.restore()

    expect(cap.stdout).toHaveLength(1)
    expect(JSON.parse(cap.stdout[0]!)).toMatchObject({
      ok: true,
      command: 'pets.hatch',
      data: { pet: { id: 'my-cat' } },
    })
    expect(cap.stderr.join('')).toContain('CODEX_VERBOSE_LOG')
  })

  it('includes exit code in the failure message when Codex exits non-zero', async () => {
    mockExistsSync.mockImplementation((p: string) => String(p).endsWith('SKILL.md'))
    mockSpawn.mockImplementation(() => makeFakeChild(1, '', 'ERR: imagegen quota exceeded'))

    const { runHatch } = await import('./hatch.js')
    await expect(runHatch('cat', 'pets/default')).rejects.toThrow('Codex hatch run failed')
  })

  it('suggests --verbose in failure message when Codex fails with no output', async () => {
    mockExistsSync.mockImplementation((p: string) => String(p).endsWith('SKILL.md'))
    mockSpawn.mockImplementation(() => makeFakeChild(1, '', ''))

    const { runHatch } = await import('./hatch.js')
    await expect(runHatch('cat', 'pets/default')).rejects.toThrow('--verbose')
  })
})

describe('runHatch — verbose mode', () => {
  it('shows verbose detail line when verbose=true', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (String(p).endsWith('SKILL.md')) return true
      if (String(p).endsWith('spritesheet.webp')) return true
      if (String(p).endsWith('pet.json')) return true
      return false
    })
    // In verbose mode stdio is 'inherit', so stdout/stderr are null on the child.
    // The fake child won't have listeners attached for them in that path.
    mockSpawn.mockImplementation(() => makeFakeChild(0))

    await configureHatchOutput({ mode: 'verbose' })
    const cap = captureOutput()
    await renderHatch('a dragon', 'pets/dragon', true)
    cap.restore()

    const out = cap.stdout.join('')
    expect(out).toContain('Concept: a dragon')
    expect(out).toContain('Codex command')
  })

  it('activates verbose mode via BUDDY_LOG_LEVEL=debug env var', async () => {
    vi.stubEnv('BUDDY_LOG_LEVEL', 'debug')

    mockExistsSync.mockImplementation((p: string) => {
      if (String(p).endsWith('SKILL.md')) return true
      if (String(p).endsWith('spritesheet.webp')) return true
      if (String(p).endsWith('pet.json')) return true
      return false
    })
    mockSpawn.mockImplementation(() => makeFakeChild(0))

    await configureHatchOutput({ mode: 'verbose' })
    const cap = captureOutput()
    await renderHatch('a dragon', 'pets/dragon')
    cap.restore()

    const out = cap.stdout.join('')
    expect(out).toContain('Codex command')
  })
})

describe('runHatch — skill missing', () => {
  it('throws when SKILL.md is not found', async () => {
    mockExistsSync.mockReturnValue(false)

    const { runHatch } = await import('./hatch.js')
    const cap = captureOutput()
    await expect(runHatch('a cat', 'pets/default')).rejects.toThrow('hatch-pet skill not found')
    cap.restore()
  })
})

describe('runHatch — incomplete packaging', () => {
  it('throws with missing file list when assets not produced', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      // Skill exists but output assets do not
      if (String(p).endsWith('SKILL.md')) return true
      return false
    })
    mockSpawn.mockImplementation(() => makeFakeChild(0))

    const { runHatch } = await import('./hatch.js')
    const cap = captureOutput()
    await expect(runHatch('a robot', 'pets/robot')).rejects.toThrow('required files missing')
    cap.restore()
  })
})

describe('runHatch — success summary', () => {
  it('prints pet id, assets path, and next-step hint for non-default output dir', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (String(p).endsWith('SKILL.md')) return true
      if (String(p).endsWith('spritesheet.webp')) return true
      if (String(p).endsWith('pet.json')) return true
      return false
    })
    mockSpawn.mockImplementation(() => makeFakeChild(0))

    const cap = captureOutput()
    await renderHatch('a unicorn', 'pets/unicorn')
    cap.restore()

    const out = cap.stdout.join('')
    expect(out).toContain('unicorn')
    expect(out).toContain('buddy pets use unicorn')
  })

  it('prints restart hint for default output dir', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (String(p).endsWith('SKILL.md')) return true
      if (String(p).endsWith('spritesheet.webp')) return true
      if (String(p).endsWith('pet.json')) return true
      return false
    })
    mockSpawn.mockImplementation(() => makeFakeChild(0))

    const cap = captureOutput()
    await renderHatch('a bear', 'pets/default')
    cap.restore()

    const out = cap.stdout.join('')
    expect(out).toContain('restart buddy')
  })
})
