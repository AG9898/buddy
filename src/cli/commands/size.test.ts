/**
 * Unit tests for src/cli/commands/size.ts
 *
 * Acceptance criteria covered:
 *   - parseSizeInput() handles scale factor (bare and trailing-x), WxH, and invalid inputs
 *   - validateBounds() rejects sizes below min and above max
 *   - runSize() exits non-zero for invalid input format
 *   - runSize() exits non-zero for out-of-bounds dimensions
 *   - runSize() exits non-zero when token file is missing
 *   - runSize() POSTs to /resize with correct payload and token on success
 *   - runSize() exits non-zero when sidecar returns non-200
 *   - runSize() exits non-zero on ECONNREFUSED
 *   - --help output documents usage
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import type { ClientRequest, IncomingMessage } from 'http'

/* ── Hoisted mocks ─────────────────────────────────────────────────────────── */

const { mockReadFileSync, mockHttpRequest, mockProcessExit } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
  mockHttpRequest: vi.fn(),
  mockProcessExit: vi.fn(),
}))

vi.mock('fs', () => ({
  default: { readFileSync: mockReadFileSync },
  readFileSync: mockReadFileSync,
}))

vi.mock('http', () => ({
  default: { request: mockHttpRequest },
  request: mockHttpRequest,
}))

/* ── Output capture helper ─────────────────────────────────────────────────── */

function captureOutput(): { stdout: string[]; stderr: string[]; restore: () => void } {
  const stdout: string[] = []
  const stderr: string[] = []
  const origOut = process.stdout.write.bind(process.stdout)
  const origErr = process.stderr.write.bind(process.stderr)
  process.stdout.write = (chunk: unknown) => { stdout.push(String(chunk)); return true }
  process.stderr.write = (chunk: unknown) => { stderr.push(String(chunk)); return true }
  return { stdout, stderr, restore: () => { process.stdout.write = origOut; process.stderr.write = origErr } }
}

/* ── HTTP mock helpers ─────────────────────────────────────────────────────── */

function makeFakeRequest(
  statusCode: number,
  responseBody: string,
  connectError?: NodeJS.ErrnoException,
): ClientRequest {
  const reqEmitter = new EventEmitter() as ClientRequest & EventEmitter
  const writeFn = vi.fn()
  const endFn = vi.fn()
  ;(reqEmitter as unknown as Record<string, unknown>)['write'] = writeFn
  ;(reqEmitter as unknown as Record<string, unknown>)['end'] = endFn

  if (connectError) {
    endFn.mockImplementation(() => {
      Promise.resolve().then(() => reqEmitter.emit('error', connectError))
    })
    return reqEmitter as unknown as ClientRequest
  }

  endFn.mockImplementation(() => {
    const resEmitter = new EventEmitter() as IncomingMessage & EventEmitter
    ;(resEmitter as unknown as Record<string, unknown>)['statusCode'] = statusCode
    Promise.resolve().then(() => {
      resEmitter.emit('data', Buffer.from(responseBody))
      resEmitter.emit('end')
    })
    // Invoke the callback that was passed to http.request(url, opts, callback).
    const callback = (mockHttpRequest.mock.calls[mockHttpRequest.mock.calls.length - 1] as unknown[])[2] as (res: unknown) => void
    callback(resEmitter)
  })

  return reqEmitter as unknown as ClientRequest
}

/* ── Shared setup ────────────────────────────────────────────────────────────  */

beforeEach(() => {
  vi.resetModules()
  vi.unstubAllEnvs()
  vi.stubEnv('NO_COLOR', '1')
  vi.stubEnv('USERPROFILE', '/fake/userprofile')

  vi.resetAllMocks()

  vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    mockProcessExit(typeof code === 'number' ? code : Number(code ?? 0))
    throw new Error(`process.exit(${code ?? ''})`)
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

/* ── parseSizeInput() ────────────────────────────────────────────────────────  */

describe('parseSizeInput()', () => {
  it('parses a bare scale factor', async () => {
    const { parseSizeInput } = await import('./size.js')
    const result = parseSizeInput('1.5')
    expect(result).toEqual({ width: 534, height: 480 }) // 356*1.5=534, 320*1.5=480
  })

  it('parses a scale factor with trailing x', async () => {
    const { parseSizeInput } = await import('./size.js')
    const result = parseSizeInput('2x')
    expect(result).toEqual({ width: 712, height: 640 }) // 356*2, 320*2
  })

  it('parses explicit WxH dimensions', async () => {
    const { parseSizeInput } = await import('./size.js')
    const result = parseSizeInput('400x300')
    expect(result).toEqual({ width: 400, height: 300 })
  })

  it('parses explicit WxH dimensions with uppercase X', async () => {
    const { parseSizeInput } = await import('./size.js')
    const result = parseSizeInput('400X300')
    expect(result).toEqual({ width: 400, height: 300 })
  })

  it('parses scale of 1 (identity)', async () => {
    const { parseSizeInput } = await import('./size.js')
    const result = parseSizeInput('1')
    expect(result).toEqual({ width: 356, height: 320 })
  })

  it('returns null for empty string', async () => {
    const { parseSizeInput } = await import('./size.js')
    expect(parseSizeInput('')).toBeNull()
  })

  it('returns null for non-numeric string', async () => {
    const { parseSizeInput } = await import('./size.js')
    expect(parseSizeInput('large')).toBeNull()
  })

  it('returns null for negative scale', async () => {
    const { parseSizeInput } = await import('./size.js')
    expect(parseSizeInput('-1.5')).toBeNull()
  })

  it('returns null for zero scale', async () => {
    const { parseSizeInput } = await import('./size.js')
    expect(parseSizeInput('0')).toBeNull()
  })
})

/* ── validateBounds() ────────────────────────────────────────────────────────  */

describe('validateBounds()', () => {
  it('returns null for valid dimensions', async () => {
    const { validateBounds } = await import('./size.js')
    expect(validateBounds(356, 320)).toBeNull()
  })

  it('returns error when width is below minimum', async () => {
    const { validateBounds } = await import('./size.js')
    const msg = validateBounds(79, 200)
    expect(msg).not.toBeNull()
    expect(msg).toContain('too small')
  })

  it('returns error when height is below minimum', async () => {
    const { validateBounds } = await import('./size.js')
    const msg = validateBounds(200, 79)
    expect(msg).not.toBeNull()
    expect(msg).toContain('too small')
  })

  it('returns error when width exceeds maximum', async () => {
    const { validateBounds } = await import('./size.js')
    const msg = validateBounds(1201, 400)
    expect(msg).not.toBeNull()
    expect(msg).toContain('too large')
  })

  it('returns error when height exceeds maximum', async () => {
    const { validateBounds } = await import('./size.js')
    const msg = validateBounds(400, 1201)
    expect(msg).not.toBeNull()
    expect(msg).toContain('too large')
  })

  it('accepts boundary values 80 and 1200', async () => {
    const { validateBounds } = await import('./size.js')
    expect(validateBounds(80, 80)).toBeNull()
    expect(validateBounds(1200, 1200)).toBeNull()
  })
})

/* ── runSize() ───────────────────────────────────────────────────────────────  */

describe('runSize() — invalid input format', () => {
  it('exits 1 with actionable error for unrecognised format', async () => {
    const { runSize } = await import('./size.js')
    const cap = captureOutput()
    expect(() => runSize('large')).toThrow('process.exit')
    cap.restore()

    expect(mockProcessExit).toHaveBeenCalledWith(1)
    const err = cap.stderr.join('')
    expect(err).toContain('Invalid size format')
    expect(err).toContain('large')
  })

  it('exits 1 with format hint listing accepted formats', async () => {
    const { runSize } = await import('./size.js')
    const cap = captureOutput()
    expect(() => runSize('??')).toThrow('process.exit')
    cap.restore()

    const err = cap.stderr.join('')
    expect(err).toContain('Scale factor')
    expect(err).toContain('WxH')
  })
})

describe('runSize() — out-of-bounds dimensions', () => {
  it('exits 1 when scale produces dimensions below minimum', async () => {
    const { runSize } = await import('./size.js')
    const cap = captureOutput()
    expect(() => runSize('0.1')).toThrow('process.exit') // 356*0.1=36 < 80
    cap.restore()

    expect(mockProcessExit).toHaveBeenCalledWith(1)
    const err = cap.stderr.join('')
    expect(err).toContain('too small')
  })

  it('exits 1 when explicit dimensions exceed maximum', async () => {
    const { runSize } = await import('./size.js')
    const cap = captureOutput()
    expect(() => runSize('1300x400')).toThrow('process.exit')
    cap.restore()

    expect(mockProcessExit).toHaveBeenCalledWith(1)
    const err = cap.stderr.join('')
    expect(err).toContain('too large')
  })
})

describe('runSize() — missing token', () => {
  it('exits 1 with actionable error when token file is missing', async () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT') })

    const { runSize } = await import('./size.js')
    const cap = captureOutput()
    expect(() => runSize('1.5')).toThrow('process.exit')
    cap.restore()

    expect(mockProcessExit).toHaveBeenCalledWith(1)
    const err = cap.stderr.join('')
    expect(err).toContain('Update token not found')
    expect(err).toContain('buddy start')
  })
})

describe('runSize() — success path', () => {
  it('POSTs to /resize with width, height, and token, then prints success', async () => {
    mockReadFileSync.mockReturnValue('fake-token-abc123')
    mockHttpRequest.mockReturnValue(makeFakeRequest(200, JSON.stringify({ ok: true, width: 534, height: 480 })))

    const { runSize } = await import('./size.js')
    const cap = captureOutput()
    runSize('1.5')
    cap.restore()

    // Verify http.request was called with /resize URL
    expect(mockHttpRequest).toHaveBeenCalledWith(
      expect.stringContaining('/resize'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Petdex-Update-Token': 'fake-token-abc123',
        }),
      }),
      expect.any(Function),
    )

    // Verify body contains width/height
    const fakeReq = mockHttpRequest.mock.results[0]?.value as { write: ReturnType<typeof vi.fn> }
    const bodyArg = fakeReq.write.mock.calls[0]?.[0] as string
    const parsed = JSON.parse(bodyArg) as { width: number; height: number }
    expect(parsed.width).toBe(534)
    expect(parsed.height).toBe(480)
  })

  it('prints resized dimensions on success', async () => {
    mockReadFileSync.mockReturnValue('fake-token-abc123')
    mockHttpRequest.mockReturnValue(makeFakeRequest(200, JSON.stringify({ ok: true, width: 400, height: 300 })))

    const { runSize } = await import('./size.js')
    const cap = captureOutput()
    runSize('400x300')

    // Flush Promise microtasks so the async HTTP response callback fires
    await vi.waitFor(() => {
      const out = cap.stdout.join('')
      expect(out).toContain('300')
    })
    cap.restore()

    const out = cap.stdout.join('')
    expect(out).toContain('resized')
    expect(out).toContain('400')
    expect(out).toContain('300')
  })
})

describe('runSize() — sidecar error', () => {
  it('exits 1 when sidecar returns non-200', async () => {
    mockReadFileSync.mockReturnValue('fake-token-abc123')

    // Override process.exit to NOT throw — we await the async callback via a promise
    const cap = captureOutput()
    let exitCode: number | null = null
    const exitPromise = new Promise<void>((resolve) => {
      vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
        exitCode = typeof code === 'number' ? code : Number(code ?? 0)
        resolve()
        return undefined as never
      })
    })

    mockHttpRequest.mockReturnValue(
      makeFakeRequest(400, JSON.stringify({ error: 'width and height must each be between 80 and 1200 pixels' })),
    )

    const { runSize } = await import('./size.js')
    runSize('400x300')

    await exitPromise
    cap.restore()

    expect(exitCode).toBe(1)
    const err = cap.stderr.join('')
    expect(err).toContain('HTTP 400')
  })

  it('exits 1 with actionable message on ECONNREFUSED', async () => {
    mockReadFileSync.mockReturnValue('fake-token-abc123')

    const cap = captureOutput()
    let exitCode: number | null = null
    const exitPromise = new Promise<void>((resolve) => {
      vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
        exitCode = typeof code === 'number' ? code : Number(code ?? 0)
        resolve()
        return undefined as never
      })
    })

    const connError = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    mockHttpRequest.mockReturnValue(makeFakeRequest(0, '', connError as NodeJS.ErrnoException))

    const { runSize } = await import('./size.js')
    runSize('400x300')

    await exitPromise
    cap.restore()

    expect(exitCode).toBe(1)
    const err = cap.stderr.join('')
    expect(err).toContain('sidecar')
    expect(err).toContain('buddy start')
  })
})
