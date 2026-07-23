/** Unit tests for typed buddy start outcomes. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import type { ChildProcess, SpawnOptions } from 'child_process'
import {
  configureOutput,
  renderResult,
  resetOutputContext,
  type OutputContextOptions,
} from '../output.js'

const {
  mockSpawn,
  mockIsWSL,
  mockResolveElectronAppPath,
  mockResolveElectronBin,
  mockResolvePackageRoot,
} = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockIsWSL: vi.fn(),
  mockResolveElectronAppPath: vi.fn(),
  mockResolveElectronBin: vi.fn(),
  mockResolvePackageRoot: vi.fn(),
}))

vi.mock('child_process', () => ({ spawn: mockSpawn }))
vi.mock('../env.js', () => ({ isWSL: mockIsWSL }))
vi.mock('../runtime.js', () => ({
  resolveElectronAppPath: mockResolveElectronAppPath,
  resolveElectronBin: mockResolveElectronBin,
  resolvePackageRoot: mockResolvePackageRoot,
}))

interface FakeChild {
  readonly process: ChildProcess
  readonly unref: ReturnType<typeof vi.fn>
  emitSpawn(): void
  emitError(cause: Error): void
  emitClose(code: number | null): void
  emitStderr(text: string): void
}

function makeFakeChild(): FakeChild {
  const child = new EventEmitter()
  const stderr = new EventEmitter()
  const unref = vi.fn()

  Object.defineProperties(child, {
    stderr: { value: stderr, writable: true },
    unref: { value: unref, writable: true },
  })

  return {
    process: child as unknown as ChildProcess,
    unref,
    emitSpawn: () => child.emit('spawn'),
    emitError: (cause) => child.emit('error', cause),
    emitClose: (code) => child.emit('close', code, null),
    emitStderr: (text) => stderr.emit('data', Buffer.from(text)),
  }
}

interface CapturedOutput {
  readonly stdout: string[]
  readonly stderr: string[]
}

function captureOutput(options: Omit<OutputContextOptions, 'stdout' | 'stderr'> = {}): CapturedOutput {
  const stdout: string[] = []
  const stderr: string[] = []
  configureOutput({
    ...options,
    stdout: { write: (chunk: string) => stdout.push(chunk) },
    stderr: { write: (chunk: string) => stderr.push(chunk) },
  })
  return { stdout, stderr }
}

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  mockIsWSL.mockReturnValue(false)
  mockResolvePackageRoot.mockReturnValue('/fake/buddy')
  mockResolveElectronBin.mockReturnValue('/fake/buddy/node_modules/electron/electron')
  mockResolveElectronAppPath.mockReturnValue('/fake/buddy')
  resetOutputContext()
})

afterEach(() => {
  resetOutputContext()
})

describe('runStart()', () => {
  it('waits for a Windows Electron spawn before returning a detached typed result', async () => {
    const child = makeFakeChild()
    mockSpawn.mockReturnValue(child.process)
    const { runStart } = await import('./start.js')

    const pending = runStart()
    child.emitSpawn()

    await expect(pending).resolves.toMatchObject({
      command: 'app.start',
      data: { environment: 'windows' },
      summary: 'buddy started.',
    })
    expect(mockSpawn).toHaveBeenCalledWith(
      '/fake/buddy/node_modules/electron/electron',
      ['/fake/buddy'],
      expect.objectContaining({ detached: true, stdio: 'ignore', cwd: '/fake/buddy' }),
    )
    expect(child.unref).toHaveBeenCalledOnce()
  })

  it('returns an actionable typed failure when the Electron runtime is missing', async () => {
    mockResolveElectronBin.mockReturnValue(null)
    const { runStart } = await import('./start.js')

    await expect(runStart()).rejects.toMatchObject({
      name: 'CliError',
      code: 'start.runtime_missing',
      hint: expect.stringContaining('npm install -g @ag9898/buddy'),
    })
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it('returns an actionable typed failure when the Windows child emits an error', async () => {
    const child = makeFakeChild()
    mockSpawn.mockReturnValue(child.process)
    const { runStart } = await import('./start.js')

    const pending = runStart()
    child.emitError(Object.assign(new Error('spawn EACCES'), { code: 'EACCES' }))

    await expect(pending).rejects.toMatchObject({
      name: 'CliError',
      code: 'start.spawn_failed',
      message: expect.stringContaining('spawn EACCES'),
      hint: expect.stringContaining('buddy start'),
    })
    expect(child.unref).not.toHaveBeenCalled()
  })

  it('returns a WSL typed result only after interop spawns and exits zero', async () => {
    mockIsWSL.mockReturnValue(true)
    const child = makeFakeChild()
    mockSpawn.mockReturnValue(child.process)
    const { runStart } = await import('./start.js')

    const pending = runStart()
    child.emitSpawn()
    child.emitClose(0)

    await expect(pending).resolves.toMatchObject({
      command: 'app.start',
      data: { environment: 'wsl' },
      summary: 'buddy started via WSL interop.',
    })
    expect(mockSpawn).toHaveBeenCalledWith(
      'cmd.exe',
      ['/c', 'start', '', 'buddy.exe'],
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] } as SpawnOptions),
    )
    expect(child.unref).not.toHaveBeenCalled()
  })

  it('returns an actionable typed failure when WSL interop exits non-zero', async () => {
    mockIsWSL.mockReturnValue(true)
    const child = makeFakeChild()
    mockSpawn.mockReturnValue(child.process)
    const { runStart } = await import('./start.js')

    const pending = runStart()
    child.emitStderr('buddy.exe was not found')
    child.emitSpawn()
    child.emitClose(1)

    await expect(pending).rejects.toMatchObject({
      name: 'CliError',
      code: 'start.wsl_interop_failed',
      data: { exitCode: 1, stderr: 'buddy.exe was not found' },
      hint: expect.stringContaining('WSL interop'),
    })
  })

  it('renders Windows launch results through normal, quiet, verbose, JSON, and no-color modes', async () => {
    const child = makeFakeChild()
    mockSpawn.mockReturnValue(child.process)
    const { runStart } = await import('./start.js')
    const pending = runStart()
    child.emitSpawn()
    const result = await pending

    const normal = captureOutput({ color: false })
    renderResult(result)
    expect(normal.stdout.join('')).toContain('buddy started.')
    expect(normal.stdout.join('')).not.toContain('\x1b[')

    const quiet = captureOutput({ mode: 'quiet', color: false })
    renderResult(result)
    expect(quiet.stdout.join('')).toContain('buddy started.')

    const verbose = captureOutput({ mode: 'verbose', color: false })
    renderResult(result)
    expect(verbose.stdout.join('')).toContain('Electron runtime: /fake/buddy/node_modules/electron/electron')

    const json = captureOutput({ json: true })
    renderResult(result)
    expect(JSON.parse(json.stdout.join(''))).toEqual({
      ok: true,
      command: 'app.start',
      data: { environment: 'windows' },
    })
    expect(json.stderr).toEqual([])
  })
})
