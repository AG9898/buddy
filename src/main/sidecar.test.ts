import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import { once } from 'events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { buddyTokenPath } from '../shared/buddy-paths'
import { CH_ACTIVE_PET_CHANGE } from '../shared/ipc-channels'
import { loadState, saveState } from './state-store'
import { startSidecar } from './sidecar'

const tempDirs: string[] = []

function writePet(root: string, id: string, spritesheet = 'spritesheet.webp'): void {
  const folder = path.join(root, id)
  fs.mkdirSync(folder, { recursive: true })
  fs.writeFileSync(
    path.join(folder, 'pet.json'),
    JSON.stringify({
      id,
      name: id,
      spritesheet,
      frameWidth: 32,
      frameHeight: 32,
      columns: 1,
      rows: 1,
      states: { idle: { frames: [{ row: 0, col: 0, ms: 100 }] } },
    }),
    'utf8',
  )
  fs.writeFileSync(path.join(folder, 'spritesheet.webp'), 'sprite', 'utf8')
}

function fakeWindow({ visible = true, width = 356, height = 320 } = {}): BrowserWindow {
  return {
    isDestroyed: () => false,
    isVisible: () => visible,
    getBounds: () => ({ x: 100, y: 200, width, height }),
    webContents: { send: vi.fn() },
  } as unknown as BrowserWindow
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

async function postPetUse(
  server: http.Server,
  body: unknown,
  token?: string,
): Promise<{ statusCode: number; data: unknown }> {
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('sidecar did not expose a TCP port')
  const payload = JSON.stringify(body)

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port: address.port,
        path: '/pets/use',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...(token ? { 'X-Petdex-Update-Token': token } : {}),
        },
      },
      (response) => {
        let responseBody = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          responseBody += chunk
        })
        response.on('end', () => {
          resolve({ statusCode: response.statusCode ?? 0, data: JSON.parse(responseBody) })
        })
      },
    )
    request.on('error', reject)
    request.end(payload)
  })
}

async function getSidecar(
  server: http.Server,
  requestPath: string,
  token?: string,
): Promise<{ statusCode: number; data: unknown }> {
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('sidecar did not expose a TCP port')

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port: address.port,
        path: requestPath,
        method: 'GET',
        headers: token ? { 'X-Petdex-Update-Token': token } : undefined,
      },
      (response) => {
        let responseBody = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          responseBody += chunk
        })
        response.on('end', () => {
          resolve({ statusCode: response.statusCode ?? 0, data: JSON.parse(responseBody) })
        })
      },
    )
    request.on('error', reject)
    request.end()
  })
}

async function startTestSidecar(
  windowOptions?: { visible?: boolean; width?: number; height?: number },
): Promise<{ server: http.Server; token: string; window: BrowserWindow }> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-sidecar-'))
  tempDirs.push(tempDir)
  const managedPetsDir = path.join(tempDir, 'managed')
  writePet(managedPetsDir, 'custom-cat')
  writePet(managedPetsDir, 'escape-cat', '../../outside.webp')
  fs.writeFileSync(path.join(tempDir, 'outside.webp'), 'sprite', 'utf8')

  vi.stubEnv('BUDDY_SPRITES_DIR', managedPetsDir)
  vi.stubEnv('BUDDY_DATA_DIR', path.join(tempDir, 'data'))
  vi.stubEnv('BUDDY_PORT', '0')
  vi.stubEnv('USERPROFILE', tempDir)

  const window = fakeWindow(windowOptions)
  const server = startSidecar(window)
  await once(server, 'listening')
  const token = fs.readFileSync(buddyTokenPath(process.env, os.homedir()), 'utf8').trim()
  return { server, token, window }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe.sequential('GET /status', () => {
  it('requires the update token while health remains minimal and unauthenticated', async () => {
    const { server, token } = await startTestSidecar()
    try {
      await expect(getSidecar(server, '/status')).resolves.toEqual({
        statusCode: 401,
        data: { error: 'unauthorized' },
      })
      await expect(getSidecar(server, '/health')).resolves.toEqual({
        statusCode: 200,
        data: { status: 'ok' },
      })
      await expect(getSidecar(server, '/status', token)).resolves.toMatchObject({ statusCode: 200 })
    } finally {
      await closeServer(server)
    }
  })

  it('returns only the live app, resolved pet, and current window snapshot', async () => {
    const { server, token } = await startTestSidecar({ width: 480, height: 375 })
    try {
      await postPetUse(server, { id: 'custom-cat' }, token)

      await expect(getSidecar(server, '/status', token)).resolves.toEqual({
        statusCode: 200,
        data: {
          app: { running: true, visible: true },
          pet: { id: 'custom-cat', name: 'custom-cat', source: 'buddy' },
          window: { width: 480, height: 375 },
        },
      })
    } finally {
      await closeServer(server)
    }
  })

  it('reports a hidden window and resolves a missing persisted pet to the default asset', async () => {
    const { server, token } = await startTestSidecar({ visible: false })
    try {
      const state = loadState()
      saveState({ ...state, pet: { ...state.pet, id: 'missing-pet' } })

      await expect(getSidecar(server, '/status', token)).resolves.toEqual({
        statusCode: 200,
        data: {
          app: { running: true, visible: false },
          pet: { id: 'default', name: 'Ragdoll', source: 'packaged' },
          window: { width: 356, height: 320 },
        },
      })
    } finally {
      await closeServer(server)
    }
  })
})

describe.sequential('POST /pets/use', () => {
  it('persists a validated selection and returns only the active renderer payload', async () => {
    const { server, token, window } = await startTestSidecar()
    try {
      const response = await postPetUse(server, { id: 'custom-cat' }, token)

      expect(response.statusCode).toBe(200)
      expect(response.data).toMatchObject({
        ok: true,
        pet: {
          id: 'custom-cat',
          source: 'buddy',
          manifest: { id: 'custom-cat' },
          initialState: 'idle',
        },
      })
      const pet = (response.data as { pet: Record<string, unknown> }).pet
      expect(pet['spritesheetUrl']).toMatch(/^file:\/\//)
      expect(pet).not.toHaveProperty('folderPath')
      expect(loadState().pet.id).toBe('custom-cat')
      expect(window.webContents.send).toHaveBeenCalledWith(
        CH_ACTIVE_PET_CHANGE,
        expect.objectContaining({ id: 'custom-cat' }),
      )
    } finally {
      await closeServer(server)
    }
  })

  it('rejects unauthenticated, missing, invalid, and path-escaping selections without persisting them', async () => {
    const { server, token } = await startTestSidecar()
    try {
      expect((await postPetUse(server, { id: 'custom-cat' })).statusCode).toBe(401)
      expect((await postPetUse(server, {}, token)).statusCode).toBe(400)
      expect((await postPetUse(server, { id: 'missing-pet' }, token)).statusCode).toBe(400)
      expect((await postPetUse(server, { id: '../custom-cat' }, token)).statusCode).toBe(400)
      expect((await postPetUse(server, { id: 'escape-cat' }, token)).statusCode).toBe(400)
      expect(loadState().pet.id).toBe('default')
    } finally {
      await closeServer(server)
    }
  })
})
