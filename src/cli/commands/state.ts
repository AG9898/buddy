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
import path from 'path'
import { sidecarBaseUrl } from '../env.js'

/** Absolute path to the shared update token file. */
function resolveTokenPath(): string {
  // On Windows USERPROFILE is set; in WSL HOME is the Linux home.
  const base = process.env['USERPROFILE'] ?? os.homedir()
  return path.join(base, '.petdex-win', 'runtime', 'update-token')
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
    console.error(
      `Error: update token not found at ${tokenFile}\n` +
        'Ensure the buddy Electron app has been started at least once to generate the token.',
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
          console.log(`State set to: ${stateName}`)
        } else {
          console.error(
            `Error: sidecar returned HTTP ${res.statusCode ?? 'unknown'}: ${data.trim()}`,
          )
          process.exit(1)
        }
      })
    },
  )

  req.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'ECONNREFUSED') {
      console.error(
        'Error: Could not connect to the buddy sidecar.\n' +
          'Ensure the buddy app is running: buddy start',
      )
    } else {
      console.error(`Error: ${err.message}`)
    }
    process.exit(1)
  })

  req.write(body)
  req.end()
}
