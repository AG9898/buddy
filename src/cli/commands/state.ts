/**
 * buddy state <name> — POST a pet state change to the running sidecar.
 *
 * Reads the update token from the token file, then POSTs {state:<name>}
 * to http://127.0.0.1:${BUDDY_PORT}/state with X-Petdex-Update-Token header.
 *
 * Works from both Windows (direct loopback) and WSL (via localhost passthrough).
 * No Electron imports in this module.
 */

import fs from 'fs'
import http from 'http'
import os from 'os'
import { sidecarBaseUrl } from '../env.js'
import { buddyTokenPath } from '../../shared/buddy-paths.js'
import { success, error, label } from '../output.js'

/** Absolute path to the shared update token file. */
function resolveTokenPath(): string {
  return buddyTokenPath(process.env, os.homedir())
}

function readToken(): string | null {
  const tokenFile = resolveTokenPath()
  try {
    return fs.readFileSync(tokenFile, 'utf8').trim()
  } catch {
    return null
  }
}

export function runState(stateName: string): void {
  const token = readToken()
  if (!token) {
    const tokenFile = resolveTokenPath()
    error(
      'Update token not found.',
      `Start the buddy app first to generate the token: buddy start\n  Token path: ${tokenFile}`,
    )
    process.exit(1)
  }

  const url = `${sidecarBaseUrl()}/state`
  const body = JSON.stringify({ state: stateName })

  const req = http.request(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Petdex-Update-Token': token,
      },
    },
    (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString()
      })
      res.on('end', () => {
        if (res.statusCode === 200) {
          success('State updated.')
          label('State', stateName)
        } else {
          error(
            `Sidecar returned HTTP ${res.statusCode ?? 'unknown'}.`,
            data.trim() || 'Check that the buddy app is running.',
          )
          process.exit(1)
        }
      })
    },
  )

  req.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'ECONNREFUSED') {
      error(
        'Could not connect to the buddy sidecar.',
        'Ensure the buddy app is running: buddy start',
      )
    } else {
      error(`Connection error: ${err.message}`)
    }
    process.exit(1)
  })

  req.write(body)
  req.end()
}
