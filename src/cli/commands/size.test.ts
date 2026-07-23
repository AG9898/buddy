/** Unit tests for typed buddy size results and the shared sidecar client. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import type { ClientRequest, IncomingMessage } from 'http'
import {
  configureOutput,
  renderResult,
  resetOutputContext,
  type OutputContextOptions,
} from '../output.js'

const { mockReadFileSync, mockHttpRequest } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
  mockHttpRequest: vi.fn(),
}))

vi.mock('fs', () => ({
  default: { readFileSync: mockReadFileSync },
  readFileSync: mockReadFileSync,
}))

vi.mock('http', () => ({
  default: { request: mockHttpRequest },
  request: mockHttpRequest,
}))

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

function reply(statusCode: number, body: string): void {
  mockHttpRequest.mockImplementation(
    (_url: string, _options: unknown, callback: (response: IncomingMessage) => void) => {
      const request = new EventEmitter() as ClientRequest & EventEmitter
      const response = new EventEmitter() as IncomingMessage & EventEmitter
      const write = vi.fn()
      const end = vi.fn(() => {
        queueMicrotask(() => {
          ;(response as unknown as { statusCode: number }).statusCode = statusCode
          ;(response as unknown as { setEncoding: (encoding: string) => void }).setEncoding = vi.fn()
          callback(response)
          response.emit('data', body)
          response.emit('end')
        })
      })
      ;(request as unknown as { write: typeof write }).write = write
      ;(request as unknown as { end: typeof end }).end = end
      ;(request as unknown as { destroy: (error: Error) => void }).destroy = (error) => {
        queueMicrotask(() => request.emit('error', error))
      }
      return request
    },
  )
}

function connectionFailure(error: NodeJS.ErrnoException): void {
  mockHttpRequest.mockImplementation(() => {
    const request = new EventEmitter() as ClientRequest & EventEmitter
    const write = vi.fn()
    const end = vi.fn(() => queueMicrotask(() => request.emit('error', error)))
    ;(request as unknown as { write: typeof write }).write = write
    ;(request as unknown as { end: typeof end }).end = end
    ;(request as unknown as { destroy: (timeout: Error) => void }).destroy = (timeout) => {
      queueMicrotask(() => request.emit('error', timeout))
    }
    return request
  })
}

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.stubEnv('NO_COLOR', '1')
  vi.stubEnv('USERPROFILE', '/fake/userprofile')
  resetOutputContext()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  resetOutputContext()
})

describe('parseSizeInput()', () => {
  it('parses scale factors and explicit dimensions', async () => {
    const { parseSizeInput } = await import('./size.js')

    expect(parseSizeInput('1.5')).toEqual({ width: 534, height: 480 })
    expect(parseSizeInput('2x')).toEqual({ width: 712, height: 640 })
    expect(parseSizeInput('400X300')).toEqual({ width: 400, height: 300 })
  })

  it('rejects empty, non-numeric, non-positive, and malformed values', async () => {
    const { parseSizeInput } = await import('./size.js')

    for (const input of ['', 'large', '-1.5', '0', '400 by 300']) {
      expect(parseSizeInput(input)).toBeNull()
    }
  })
})

describe('validateBounds()', () => {
  it('enforces the documented 80–1200 pixel range', async () => {
    const { validateBounds } = await import('./size.js')

    expect(validateBounds(80, 1200)).toBeNull()
    expect(validateBounds(79, 200)).toContain('too small')
    expect(validateBounds(200, 1201)).toContain('too large')
  })
})

describe('runSize()', () => {
  it('returns typed validation failures without terminating the process', async () => {
    const { runSize } = await import('./size.js')

    await expect(runSize('large')).rejects.toMatchObject({
      name: 'CliError',
      code: 'size.invalid_format',
      message: "Invalid size format: 'large'.",
    })
    await expect(runSize('1300x400')).rejects.toMatchObject({
      name: 'CliError',
      code: 'size.out_of_bounds',
    })
  })

  it('reports a missing token as a typed shared-client error', async () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    const { runSize } = await import('./size.js')

    await expect(runSize('1.5')).rejects.toMatchObject({
      name: 'CliError',
      code: 'sidecar.token_missing',
      hint: expect.stringContaining('buddy start'),
    })
  })

  it('posts the calculated dimensions with the token and returns a typed result', async () => {
    mockReadFileSync.mockReturnValue('fake-token-abc123')
    reply(200, JSON.stringify({ ok: true, width: 534, height: 480 }))
    const { runSize } = await import('./size.js')

    const result = await runSize('1.5')

    expect(result).toMatchObject({
      command: 'size.set',
      data: { width: 534, height: 480 },
      summary: 'Buddy resized.',
    })
    expect(mockHttpRequest).toHaveBeenCalledWith(
      expect.stringContaining('/resize'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Petdex-Update-Token': 'fake-token-abc123' }),
      }),
      expect.any(Function),
    )
    const request = mockHttpRequest.mock.results[0]?.value as { write: ReturnType<typeof vi.fn> }
    expect(JSON.parse(request.write.mock.calls[0]?.[0] as string)).toEqual({ width: 534, height: 480 })
  })

  it('preserves sidecar validation and connection recovery hints as typed errors', async () => {
    mockReadFileSync.mockReturnValue('fake-token')
    reply(400, JSON.stringify({ error: 'width and height must each be between 80 and 1200 pixels' }))
    const { runSize } = await import('./size.js')

    await expect(runSize('400x300')).rejects.toMatchObject({
      name: 'CliError',
      code: 'sidecar.http_error',
      message: 'Sidecar returned HTTP 400.',
      hint: 'width and height must each be between 80 and 1200 pixels',
    })

    connectionFailure(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))
    await expect(runSize('400x300')).rejects.toMatchObject({
      name: 'CliError',
      code: 'sidecar.unreachable',
      hint: 'Ensure the buddy app is running: buddy start',
    })
  })

  it('uses a bounded shared-client timeout', async () => {
    vi.useFakeTimers()
    mockReadFileSync.mockReturnValue('fake-token')
    const { postToSidecar } = await import('../sidecar-client.js')
    const request = new EventEmitter() as ClientRequest & EventEmitter
    ;(request as unknown as { write: () => void }).write = vi.fn()
    ;(request as unknown as { end: () => void }).end = vi.fn()
    ;(request as unknown as { destroy: (error: Error) => void }).destroy = (error) => {
      request.emit('error', error)
    }
    mockHttpRequest.mockReturnValue(request)

    const result = postToSidecar('/resize', { width: 400, height: 300 }, { timeoutMs: 25 })
    const expectTimeout = expect(result).rejects.toMatchObject({
      name: 'CliError',
      code: 'sidecar.timeout',
    })
    await vi.advanceTimersByTimeAsync(25)

    await expectTimeout
  })

  it('renders concise quiet/no-color output and JSON without contaminating stdout', async () => {
    mockReadFileSync.mockReturnValue('fake-token')
    reply(200, JSON.stringify({ ok: true, width: 400, height: 300 }))
    const { runSize } = await import('./size.js')
    const result = await runSize('400x300')

    const quiet = captureOutput({ mode: 'quiet', color: false })
    renderResult(result)
    expect(quiet.stdout.join('')).toContain('Buddy resized.')
    expect(quiet.stdout.join('')).not.toContain('\x1b[')

    const json = captureOutput({ json: true })
    renderResult(result)
    expect(JSON.parse(json.stdout.join(''))).toEqual({
      ok: true,
      command: 'size.set',
      data: { width: 400, height: 300 },
    })
    expect(json.stderr).toEqual([])
  })
})
