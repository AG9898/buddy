/** Unit tests for typed buddy state results through the shared sidecar client. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import type { ClientRequest, IncomingMessage } from 'http'
import { configureOutput, renderFailure, renderResult, resetOutputContext } from '../output.js'

const { mockReadFileSync, mockHttpRequest, mockResolveActivePetStateNames } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
  mockHttpRequest: vi.fn(),
  mockResolveActivePetStateNames: vi.fn(),
}))

vi.mock('fs', () => ({
  default: { readFileSync: mockReadFileSync },
  readFileSync: mockReadFileSync,
}))

vi.mock('http', () => ({
  default: { request: mockHttpRequest },
  request: mockHttpRequest,
}))

vi.mock('./pets.js', () => ({
  resolveActivePetStateNames: mockResolveActivePetStateNames,
}))

function reply(statusCode: number, body: string): void {
  mockHttpRequest.mockImplementation(
    (_url: string, _options: unknown, callback: (response: IncomingMessage) => void) => {
      const request = new EventEmitter() as ClientRequest & EventEmitter
      const response = new EventEmitter() as IncomingMessage & EventEmitter
      const end = vi.fn(() => {
        queueMicrotask(() => {
          ;(response as unknown as { statusCode: number }).statusCode = statusCode
          ;(response as unknown as { setEncoding: (encoding: string) => void }).setEncoding = vi.fn()
          callback(response)
          response.emit('data', body)
          response.emit('end')
        })
      })
      ;(request as unknown as { write: () => void }).write = vi.fn()
      ;(request as unknown as { end: typeof end }).end = end
      ;(request as unknown as { destroy: (error: Error) => void }).destroy = (error) => {
        queueMicrotask(() => request.emit('error', error))
      }
      return request
    },
  )
}

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.stubEnv('NO_COLOR', '1')
  vi.stubEnv('USERPROFILE', '/fake/userprofile')
  mockResolveActivePetStateNames.mockReturnValue(['idle', 'running', 'waiting'])
  resetOutputContext()
})

afterEach(() => {
  vi.unstubAllEnvs()
  resetOutputContext()
})

describe('runState()', () => {
  it('posts the state and returns a typed result for the entry boundary', async () => {
    mockReadFileSync.mockReturnValue('fake-token')
    reply(200, JSON.stringify({ ok: true }))
    const { runState } = await import('./state.js')

    const result = await runState('running')

    expect(result).toMatchObject({
      command: 'state.set',
      data: { state: 'running' },
      summary: 'State updated.',
    })
    expect(mockHttpRequest).toHaveBeenCalledWith(
      expect.stringContaining('/state'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Petdex-Update-Token': 'fake-token' }),
      }),
      expect.any(Function),
    )
    const request = mockHttpRequest.mock.results[0]?.value as { write: ReturnType<typeof vi.fn> }
    expect(JSON.parse(request.write.mock.calls[0]?.[0] as string)).toEqual({ state: 'running' })
  })

  it('accepts custom state names resolved from the selected pet', async () => {
    mockResolveActivePetStateNames.mockReturnValue(['idle', 'pouncing'])
    mockReadFileSync.mockReturnValue('fake-token')
    reply(200, JSON.stringify({ ok: true }))
    const { runState } = await import('./state.js')

    await expect(runState('pouncing')).resolves.toMatchObject({ data: { state: 'pouncing' } })
  })

  it('returns the shared missing-token and HTTP errors without calling process.exit', async () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    const { runState } = await import('./state.js')
    await expect(runState('running')).rejects.toMatchObject({
      name: 'CliError',
      code: 'sidecar.token_missing',
    })

    mockReadFileSync.mockReturnValue('fake-token')
    reply(401, JSON.stringify({ error: 'unauthorized' }))
    await expect(runState('running')).rejects.toMatchObject({
      name: 'CliError',
      code: 'sidecar.http_error',
      message: 'Sidecar returned HTTP 401.',
      hint: 'unauthorized',
    })
  })

  it('rejects invalid state names before contacting the sidecar with choices and a suggestion', async () => {
    const { runState } = await import('./state.js')

    await expect(runState('runing')).rejects.toMatchObject({
      name: 'CliError',
      code: 'state.invalid',
      hint: "Valid states: idle, running, waiting. Did you mean 'running'?",
      data: {
        state: 'runing',
        validStates: ['idle', 'running', 'waiting'],
        suggestion: 'running',
      },
    })
    expect(mockHttpRequest).not.toHaveBeenCalled()
  })

  it('renders invalid state failures for people', async () => {
    const { runState } = await import('./state.js')
    const stderr: string[] = []
    configureOutput({ color: false, stderr: { write: (chunk: string) => stderr.push(chunk) } })

    try {
      await runState('runing')
    } catch (error) {
      expect(renderFailure(error, 'state.set')).toBe(1)
    }

    expect(stderr.join('')).toContain("Invalid state 'runing'.")
    expect(stderr.join('')).toContain("Did you mean 'running'?")
  })

  it('renders normal, verbose, no-color, and JSON modes through the shared result layer', async () => {
    mockReadFileSync.mockReturnValue('fake-token')
    reply(200, JSON.stringify({ ok: true }))
    const { runState } = await import('./state.js')
    const result = await runState('waiting')

    const normal: string[] = []
    configureOutput({ color: false, stdout: { write: (chunk: string) => normal.push(chunk) } })
    renderResult(result)
    expect(normal.join('')).toContain('State updated.')
    expect(normal.join('')).toContain('State: waiting')
    expect(normal.join('')).not.toContain('\x1b[')

    const verbose: string[] = []
    configureOutput({ mode: 'verbose', color: false, stdout: { write: (chunk: string) => verbose.push(chunk) } })
    renderResult(result)
    expect(verbose.join('')).toContain('POST /state → HTTP 200')

    const json: string[] = []
    configureOutput({ json: true, stdout: { write: (chunk: string) => json.push(chunk) } })
    renderResult(result)
    expect(JSON.parse(json.join(''))).toEqual({
      ok: true,
      command: 'state.set',
      data: { state: 'waiting' },
    })
  })

  it('renders invalid state failures as the shared JSON error payload', async () => {
    const { runState } = await import('./state.js')
    const stdout: string[] = []
    configureOutput({
      json: true,
      stdout: { write: (chunk: string) => stdout.push(chunk) },
      stderr: { write: () => undefined },
    })

    try {
      await runState('unrelated-state')
    } catch (error) {
      expect(renderFailure(error, 'state.set')).toBe(1)
      expect(JSON.parse(stdout.join(''))).toEqual({
        ok: false,
        command: 'state.set',
        error: {
          code: 'state.invalid',
          message: "Invalid state 'unrelated-state'.",
          hint: 'Valid states: idle, running, waiting',
          data: {
            state: 'unrelated-state',
            validStates: ['idle', 'running', 'waiting'],
            suggestion: null,
          },
        },
      })
    }
  })
})
