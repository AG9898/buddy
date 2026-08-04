/** Unit tests for explicit npm-backed buddy updates. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import type { ChildProcess } from 'child_process'
import {
  configureOutput,
  renderFailure,
  renderResult,
  resetOutputContext,
  type OutputContextOptions,
} from '../output.js'

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }))

vi.mock('child_process', () => ({ spawn: mockSpawn }))

interface FakeChild {
  readonly process: ChildProcess
  emitClose(code: number | null): void
  emitError(cause: Error): void
  emitStderr(text: string): void
}

function makeFakeChild(): FakeChild {
  const child = new EventEmitter()
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  Object.defineProperties(child, {
    stdout: { value: stdout, writable: true },
    stderr: { value: stderr, writable: true },
  })

  return {
    process: child as unknown as ChildProcess,
    emitClose: (code) => child.emit('close', code, null),
    emitError: (cause) => child.emit('error', cause),
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
  resetOutputContext()
})

afterEach(() => {
  resetOutputContext()
})

describe('runUpdate()', () => {
  it('uses the platform npm executable with fixed global-install arguments', async () => {
    const child = makeFakeChild()
    mockSpawn.mockReturnValue(child.process)
    const { runUpdate } = await import('./update.js')

    const pending = runUpdate()
    child.emitClose(0)

    await expect(pending).resolves.toMatchObject({
      command: 'app.update',
      data: { package: '@ag9898/buddy', version: 'latest' },
    })
    expect(mockSpawn).toHaveBeenCalledWith(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['install', '--global', '@ag9898/buddy@latest'],
      { stdio: 'pipe', shell: false },
    )
  })

  it('reports an unavailable npm executable as an actionable typed error', async () => {
    const child = makeFakeChild()
    mockSpawn.mockReturnValue(child.process)
    const { runUpdate } = await import('./update.js')

    const pending = runUpdate()
    child.emitError(Object.assign(new Error('spawn npm ENOENT'), { code: 'ENOENT' }))

    await expect(pending).rejects.toMatchObject({
      name: 'CliError',
      code: 'update.npm_unavailable',
      hint: expect.stringContaining('Install Node.js'),
    })
  })

  it('reports npm permission errors from spawning or npm output', async () => {
    const spawnFailure = makeFakeChild()
    mockSpawn.mockReturnValueOnce(spawnFailure.process)
    const { runUpdate } = await import('./update.js')

    const spawnPending = runUpdate()
    spawnFailure.emitError(Object.assign(new Error('spawn npm EACCES'), { code: 'EACCES' }))
    await expect(spawnPending).rejects.toMatchObject({ code: 'update.npm_permission_denied' })

    const npmFailure = makeFakeChild()
    mockSpawn.mockReturnValueOnce(npmFailure.process)
    const npmPending = runUpdate()
    npmFailure.emitStderr('npm error EACCES: permission denied')
    npmFailure.emitClose(1)
    await expect(npmPending).rejects.toMatchObject({
      code: 'update.npm_permission_denied',
      data: { exitCode: 1 },
    })
  })

  it('reports non-zero npm exits with their exit code', async () => {
    const child = makeFakeChild()
    mockSpawn.mockReturnValue(child.process)
    const { runUpdate } = await import('./update.js')

    const pending = runUpdate()
    child.emitClose(2)

    await expect(pending).rejects.toMatchObject({
      code: 'update.npm_failed',
      data: { exitCode: 2 },
    })
  })

  it('renders successful and failed updates through human, quiet, and JSON output', async () => {
    const successChild = makeFakeChild()
    mockSpawn.mockReturnValueOnce(successChild.process)
    const { runUpdate } = await import('./update.js')

    const successPending = runUpdate()
    successChild.emitClose(0)
    const success = await successPending

    const normal = captureOutput({ color: false })
    renderResult(success)
    expect(normal.stdout.join('')).toContain('buddy updated to the latest npm release.')

    const quiet = captureOutput({ mode: 'quiet', color: false })
    renderResult(success)
    expect(quiet.stdout.join('')).toContain('buddy updated to the latest npm release.')

    const json = captureOutput({ json: true })
    renderResult(success)
    expect(JSON.parse(json.stdout.join(''))).toEqual({
      ok: true,
      command: 'app.update',
      data: { package: '@ag9898/buddy', version: 'latest' },
    })

    const failedChild = makeFakeChild()
    mockSpawn.mockReturnValueOnce(failedChild.process)
    const failedPending = runUpdate()
    failedChild.emitClose(1)
    const failure = await failedPending.catch((error: unknown) => error)

    const failureNormal = captureOutput({ color: false })
    expect(renderFailure(failure, 'app.update')).toBe(1)
    expect(failureNormal.stderr.join('')).toContain('npm could not update buddy')

    const failureQuiet = captureOutput({ mode: 'quiet', color: false })
    expect(renderFailure(failure, 'app.update')).toBe(1)
    expect(failureQuiet.stderr.join('')).toContain('npm could not update buddy')

    const failureJson = captureOutput({ json: true })
    expect(renderFailure(failure, 'app.update')).toBe(1)
    expect(JSON.parse(failureJson.stdout.join(''))).toMatchObject({
      ok: false,
      command: 'app.update',
      error: { code: 'update.npm_failed' },
    })
  })
})
