// FEAT-06: local HTTP server on 127.0.0.1:BUDDY_PORT
// Handles POST /state (token-authenticated) and GET /health (unauthenticated).

import http from 'http'
import fs from 'fs'
import crypto from 'crypto'
import type { BrowserWindow } from 'electron'
import { CH_STATE_CHANGE, CH_CLI_RESIZE } from '../shared/ipc-channels'
import { buddyRuntimeDir, buddyTokenPath } from '../shared/buddy-paths'
import { PetSelectionError, selectActivePet, type ActivePetAsset } from './pet-assets'

// ── Token helpers ─────────────────────────────────────────────────────────────

function tokenDir(): string {
  return buddyRuntimeDir(process.env, process.env['HOME'] ?? '')
}

function tokenPath(): string {
  return buddyTokenPath(process.env, process.env['HOME'] ?? '')
}

function loadOrCreateToken(): string {
  const dir = tokenDir()
  const file = tokenPath()

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  if (fs.existsSync(file)) {
    return fs.readFileSync(file, 'utf8').trim()
  }

  // First run: generate and persist a new 32-char hex token.
  const token = crypto.randomBytes(16).toString('hex') // 32 hex chars
  fs.writeFileSync(file, token, { encoding: 'utf8', mode: 0o600 })
  return token
}

// ── JSON response helper ──────────────────────────────────────────────────────

function jsonReply(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

// ── Body reader (4 KB max) ────────────────────────────────────────────────────

const MAX_BODY_BYTES = 4 * 1024

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    let size = 0
    req.setEncoding('utf8')

    req.on('data', (chunk: string) => {
      size += Buffer.byteLength(chunk)
      if (size > MAX_BODY_BYTES) {
        reject(new Error('payload too large'))
        return
      }
      data += chunk
    })

    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

// ── Request handler ───────────────────────────────────────────────────────────

export interface SidecarOptions {
  /** Electron-owned service for validating, persisting, and resolving a pet selection. */
  selectPet?: (id: string) => ActivePetAsset
}

function makeHandler(
  win: BrowserWindow,
  token: string,
  selectPet: (id: string) => ActivePetAsset,
) {
  return async function handler(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const url = req.url ?? '/'
    const method = (req.method ?? 'GET').toUpperCase()

    // GET /health — no token required
    if (url === '/health') {
      if (method !== 'GET') {
        jsonReply(res, 405, { error: 'method not allowed' })
        return
      }
      jsonReply(res, 200, { status: 'ok' })
      return
    }

    // POST /state — token required
    if (url === '/state') {
      if (method !== 'POST') {
        jsonReply(res, 405, { error: 'method not allowed' })
        return
      }

      // Validate Content-Type
      const ct = req.headers['content-type'] ?? ''
      if (!ct.includes('application/json')) {
        jsonReply(res, 400, { error: 'Content-Type must be application/json' })
        return
      }

      // Validate token
      const incomingToken = req.headers['x-petdex-update-token'] ?? ''
      if (incomingToken !== token) {
        jsonReply(res, 401, { error: 'unauthorized' })
        return
      }

      // Read and parse body
      let rawBody: string
      try {
        rawBody = await readBody(req)
      } catch {
        jsonReply(res, 400, { error: 'request body too large or unreadable' })
        return
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(rawBody)
      } catch {
        jsonReply(res, 400, { error: 'invalid JSON' })
        return
      }

      // Validate state field
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        typeof (parsed as Record<string, unknown>)['state'] !== 'string' ||
        (parsed as Record<string, unknown>)['state'] === ''
      ) {
        jsonReply(res, 400, { error: 'missing or empty state field' })
        return
      }

      const state = (parsed as Record<string, string>)['state']

      // Forward to renderer via IPC
      if (!win.isDestroyed()) {
        win.webContents.send(CH_STATE_CHANGE, { state })
      }

      jsonReply(res, 200, { ok: true })
      return
    }

    // POST /resize — token required; resizes the BrowserWindow via main-process IPC
    if (url === '/resize') {
      if (method !== 'POST') {
        jsonReply(res, 405, { error: 'method not allowed' })
        return
      }

      const ct = req.headers['content-type'] ?? ''
      if (!ct.includes('application/json')) {
        jsonReply(res, 400, { error: 'Content-Type must be application/json' })
        return
      }

      const incomingToken = req.headers['x-petdex-update-token'] ?? ''
      if (incomingToken !== token) {
        jsonReply(res, 401, { error: 'unauthorized' })
        return
      }

      let rawBody: string
      try {
        rawBody = await readBody(req)
      } catch {
        jsonReply(res, 400, { error: 'request body too large or unreadable' })
        return
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(rawBody)
      } catch {
        jsonReply(res, 400, { error: 'invalid JSON' })
        return
      }

      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        typeof (parsed as Record<string, unknown>)['width'] !== 'number' ||
        typeof (parsed as Record<string, unknown>)['height'] !== 'number'
      ) {
        jsonReply(res, 400, { error: 'missing or invalid width/height fields' })
        return
      }

      const { width, height } = parsed as { width: number; height: number }

      // Bounds validation: enforce min/max size
      const MIN_SIZE = 80
      const MAX_SIZE = 1200
      if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width < MIN_SIZE ||
        height < MIN_SIZE ||
        width > MAX_SIZE ||
        height > MAX_SIZE
      ) {
        jsonReply(res, 400, {
          error: `width and height must each be between ${MIN_SIZE} and ${MAX_SIZE} pixels`,
        })
        return
      }

      // Forward to main process via IPC
      if (!win.isDestroyed()) {
        win.webContents.send(CH_CLI_RESIZE, { width: Math.round(width), height: Math.round(height) })
      }

      jsonReply(res, 200, { ok: true, width: Math.round(width), height: Math.round(height) })
      return
    }

    // POST /pets/use — token-authenticated live pet selection. The renderer
    // reload event is deliberately owned by the follow-up renderer task.
    if (url === '/pets/use') {
      if (method !== 'POST') {
        jsonReply(res, 405, { error: 'method not allowed' })
        return
      }

      const ct = req.headers['content-type'] ?? ''
      if (!ct.includes('application/json')) {
        jsonReply(res, 400, { error: 'Content-Type must be application/json' })
        return
      }

      const incomingToken = req.headers['x-petdex-update-token'] ?? ''
      if (incomingToken !== token) {
        jsonReply(res, 401, { error: 'unauthorized' })
        return
      }

      let rawBody: string
      try {
        rawBody = await readBody(req)
      } catch {
        jsonReply(res, 400, { error: 'request body too large or unreadable' })
        return
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(rawBody)
      } catch {
        jsonReply(res, 400, { error: 'invalid JSON' })
        return
      }

      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        typeof (parsed as Record<string, unknown>)['id'] !== 'string' ||
        (parsed as Record<string, string>)['id'] === ''
      ) {
        jsonReply(res, 400, { error: 'missing or invalid pet id' })
        return
      }

      try {
        const pet = selectPet((parsed as Record<string, string>)['id'])
        jsonReply(res, 200, { ok: true, pet })
      } catch (error) {
        if (error instanceof PetSelectionError) {
          jsonReply(res, 400, { error: error.message })
          return
        }
        throw error
      }
      return
    }

    // Everything else → 404
    jsonReply(res, 404, { error: 'not found' })
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start the local HTTP sidecar bound to 127.0.0.1 on BUDDY_PORT (default 7777).
 * Loads or creates the shared update token and begins serving requests.
 */
export function startSidecar(win: BrowserWindow, options: SidecarOptions = {}): http.Server {
  const token = loadOrCreateToken()
  const port = Number(process.env['BUDDY_PORT'] ?? 7777)
  const host = '127.0.0.1'

  const handler = makeHandler(win, token, options.selectPet ?? selectActivePet)

  const server = http.createServer((req, res) => {
    handler(req, res).catch(() => {
      if (!res.headersSent) {
        jsonReply(res, 500, { error: 'internal server error' })
      }
    })
  })

  server.listen(port, host)
  return server
}

/**
 * Gracefully shut down the sidecar server.
 */
export function stopSidecar(server: http.Server): void {
  server.close()
}
