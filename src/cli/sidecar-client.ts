/**
 * Shared token-authenticated client for buddy's local HTTP sidecar.
 *
 * Command modules use this for sidecar POSTs instead of each recreating token
 * lookup, request lifecycle handling, and user-facing connection errors.
 * No Electron imports — safe for Windows and WSL CLI execution.
 */

import fs from 'fs'
import http from 'http'
import os from 'os'
import { buddyTokenPath } from '../shared/buddy-paths.js'
import { sidecarBaseUrl } from './env.js'
import { CliError } from './result.js'

/** Default upper bound for a local sidecar request. */
export const SIDECAR_TIMEOUT_MS = 5_000

export interface SidecarResponse<T> {
  readonly statusCode: number
  readonly data: T
}

export interface SidecarRequestOptions {
  /** Override the request timeout for a caller with a different local deadline. */
  readonly timeoutMs?: number
}

/** Absolute path to the shared update token file. */
export function sidecarTokenPath(): string {
  return buddyTokenPath(process.env, os.homedir())
}

/** Load the update token or throw the shared actionable missing-token error. */
export function readSidecarToken(): string {
  const tokenFile = sidecarTokenPath()
  try {
    const token = fs.readFileSync(tokenFile, 'utf8').trim()
    if (token) return token
  } catch {
    // The actionable error below intentionally covers missing and unreadable files.
  }

  throw new CliError('Update token not found.', {
    code: 'sidecar.token_missing',
    hint: `Start the buddy app first to generate the token: buddy start\n  Token path: ${tokenFile}`,
    data: { tokenPath: tokenFile },
  })
}

function parseResponseBody(body: string): unknown {
  if (body.trim() === '') return undefined
  try {
    return JSON.parse(body) as unknown
  } catch {
    return undefined
  }
}

function responseDetail(body: string, parsed: unknown): string | undefined {
  if (typeof parsed === 'object' && parsed !== null) {
    const message = (parsed as Record<string, unknown>)['error']
    if (typeof message === 'string' && message.trim() !== '') return message.trim()
  }
  return body.trim() || undefined
}

function connectionError(value: unknown): CliError {
  const err = value instanceof Error ? value : new Error(String(value))
  const code = (err as NodeJS.ErrnoException).code

  if (code === 'ECONNREFUSED') {
    return new CliError('Could not connect to the buddy sidecar.', {
      code: 'sidecar.unreachable',
      hint: 'Ensure the buddy app is running: buddy start',
      cause: err,
    })
  }

  if (code === 'ETIMEDOUT') {
    return new CliError('Timed out waiting for the buddy sidecar.', {
      code: 'sidecar.timeout',
      hint: 'Ensure the buddy app is running and try again: buddy start',
      cause: err,
    })
  }

  return new CliError(`Connection error: ${err.message}`, {
    code: 'sidecar.connection_error',
    cause: err,
  })
}

/**
 * POST JSON to a protected sidecar endpoint and parse its JSON response.
 *
 * Expected failures are always `CliError`s so command implementations can
 * remain output-free and leave exit-code handling to the CLI entry boundary.
 */
export async function postToSidecar<T>(
  endpoint: string,
  payload: unknown,
  options: SidecarRequestOptions = {},
): Promise<SidecarResponse<T>> {
  const token = readSidecarToken()
  const body = JSON.stringify(payload)
  const timeoutMs = options.timeoutMs ?? SIDECAR_TIMEOUT_MS
  const url = `${sidecarBaseUrl()}${endpoint}`

  return new Promise<SidecarResponse<T>>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const settle = (callback: () => void): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      callback()
    }

    let request: http.ClientRequest
    try {
      request = http.request(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'X-Petdex-Update-Token': token,
          },
        },
        (response) => {
          let responseBody = ''
          response.setEncoding('utf8')
          response.on('data', (chunk: string) => {
            responseBody += chunk
          })
          response.on('error', (err) => {
            settle(() => reject(connectionError(err)))
          })
          response.on('end', () => {
            const parsed = parseResponseBody(responseBody)
            const statusCode = response.statusCode ?? 0

            if (statusCode !== 200) {
              settle(() => {
                reject(
                  new CliError(`Sidecar returned HTTP ${statusCode || 'unknown'}.`, {
                    code: 'sidecar.http_error',
                    hint: responseDetail(responseBody, parsed) ?? 'Check that the buddy app is running.',
                    data: { statusCode },
                  }),
                )
              })
              return
            }

            if (parsed === undefined) {
              settle(() => {
                reject(
                  new CliError('Sidecar returned an invalid JSON response.', {
                    code: 'sidecar.invalid_response',
                    hint: 'Ensure the buddy app is running and try again: buddy start',
                  }),
                )
              })
              return
            }

            settle(() => resolve({ statusCode, data: parsed as T }))
          })
        },
      )
    } catch (err) {
      reject(connectionError(err))
      return
    }

    timer = setTimeout(() => {
      const timeoutError = Object.assign(new Error('sidecar request timed out'), {
        code: 'ETIMEDOUT',
      }) as NodeJS.ErrnoException
      request.destroy(timeoutError)
    }, timeoutMs)

    request.on('error', (err) => {
      settle(() => reject(connectionError(err)))
    })
    request.write(body)
    request.end()
  })
}
