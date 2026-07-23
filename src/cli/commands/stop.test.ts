/** Unit tests for graceful and verified-fallback buddy stop outcomes. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CliError } from '../result.js'
import { configureOutput, renderResult, resetOutputContext } from '../output.js'

const { mockExecFileSync, mockReadFileSync, mockIsWSL, mockPostToSidecar } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockIsWSL: vi.fn(),
  mockPostToSidecar: vi.fn(),
}))

vi.mock('child_process', () => ({ execFileSync: mockExecFileSync }))
vi.mock('fs', () => ({ default: { readFileSync: mockReadFileSync }, readFileSync: mockReadFileSync }))
vi.mock('../env.js', () => ({ isWSL: mockIsWSL }))
vi.mock('../sidecar-client.js', () => ({ postToSidecar: mockPostToSidecar }))

const processRecord = JSON.stringify({
  pid: 4242,
  executablePath: 'C:\\Program Files\\buddy\\electron.exe',
  appPath: 'C:\\Program Files\\buddy',
})

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  mockIsWSL.mockReturnValue(false)
  resetOutputContext()
})

afterEach(() => {
  resetOutputContext()
})

describe('runStop()', () => {
  it('uses the authenticated graceful sidecar route without process termination', async () => {
    mockPostToSidecar.mockResolvedValue({ statusCode: 200, data: { ok: true } })
    const { runStop } = await import('./stop.js')

    await expect(runStop()).resolves.toMatchObject({
      command: 'app.stop',
      data: { method: 'graceful', environment: 'windows' },
      summary: 'buddy stopped.',
    })
    expect(mockPostToSidecar).toHaveBeenCalledWith('/shutdown', {})
    expect(mockExecFileSync).not.toHaveBeenCalled()
  })

  it('rejects authorization failures rather than falling back to a process kill', async () => {
    mockPostToSidecar.mockRejectedValue(
      new CliError('Sidecar returned HTTP 401.', { code: 'sidecar.http_error' }),
    )
    const { runStop } = await import('./stop.js')

    await expect(runStop()).rejects.toMatchObject({ code: 'sidecar.http_error' })
    expect(mockExecFileSync).not.toHaveBeenCalled()
  })

  it('stops only an unreachable sidecar fallback whose PID is verified as buddy-owned', async () => {
    mockPostToSidecar.mockRejectedValue(
      new CliError('Could not connect to the buddy sidecar.', { code: 'sidecar.unreachable' }),
    )
    mockReadFileSync.mockReturnValue(processRecord)
    mockExecFileSync.mockImplementation((file: string) => (file === 'powershell.exe' ? '4242\n' : ''))
    const { runStop } = await import('./stop.js')

    await expect(runStop()).resolves.toMatchObject({
      data: { method: 'verified_pid_fallback', environment: 'windows' },
    })
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      1,
      'powershell.exe',
      expect.arrayContaining(['-NoProfile', '-NonInteractive', '-Command']),
      expect.objectContaining({ encoding: 'utf8', windowsHide: true }),
    )
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      2,
      'taskkill.exe',
      ['/PID', '4242', '/T', '/F'],
      expect.objectContaining({ windowsHide: true }),
    )
    expect(mockExecFileSync.mock.calls.flat().join(' ')).not.toContain('/IM')
  })

  it('uses the same Windows interop executables from WSL for the verified fallback', async () => {
    mockIsWSL.mockReturnValue(true)
    mockPostToSidecar.mockRejectedValue(
      new CliError('Could not connect to the buddy sidecar.', { code: 'sidecar.unreachable' }),
    )
    mockReadFileSync.mockReturnValue(processRecord)
    mockExecFileSync.mockImplementation((file: string) => (file === 'powershell.exe' ? '4242\n' : ''))
    const { runStop } = await import('./stop.js')

    await expect(runStop()).resolves.toMatchObject({
      data: { method: 'verified_pid_fallback', environment: 'wsl' },
    })
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'taskkill.exe',
      ['/PID', '4242', '/T', '/F'],
      expect.any(Object),
    )
  })

  it('treats a missing or unverifiable process record as an idempotent already-stopped result', async () => {
    mockPostToSidecar.mockRejectedValue(
      new CliError('Could not connect to the buddy sidecar.', { code: 'sidecar.unreachable' }),
    )
    mockReadFileSync.mockReturnValue(processRecord)
    mockExecFileSync.mockReturnValue('9999\n')
    const { runStop } = await import('./stop.js')

    await expect(runStop()).resolves.toMatchObject({
      data: { method: 'already_stopped' },
      summary: 'buddy is not running.',
    })
    expect(mockExecFileSync).toHaveBeenCalledTimes(1)
  })

  it('renders stop success through normal, quiet, verbose, JSON, and no-color modes', async () => {
    mockPostToSidecar.mockResolvedValue({ statusCode: 200, data: { ok: true } })
    const { runStop } = await import('./stop.js')
    const result = await runStop()

    const normal: string[] = []
    configureOutput({ color: false, stdout: { write: (chunk: string) => normal.push(chunk) } })
    renderResult(result)
    expect(normal.join('')).toContain('buddy stopped.')
    expect(normal.join('')).not.toContain('\x1b[')

    const quiet: string[] = []
    configureOutput({ mode: 'quiet', color: false, stdout: { write: (chunk: string) => quiet.push(chunk) } })
    renderResult(result)
    expect(quiet.join('')).toContain('buddy stopped.')

    const verbose: string[] = []
    configureOutput({ mode: 'verbose', color: false, stdout: { write: (chunk: string) => verbose.push(chunk) } })
    renderResult(result)
    expect(verbose.join('')).toContain('POST /shutdown → HTTP 200')

    const json: string[] = []
    configureOutput({ json: true, stdout: { write: (chunk: string) => json.push(chunk) } })
    renderResult(result)
    expect(JSON.parse(json.join(''))).toEqual({
      ok: true,
      command: 'app.stop',
      data: { method: 'graceful', environment: 'windows' },
    })
  })
})
