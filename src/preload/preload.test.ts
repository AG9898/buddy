import { afterEach, describe, expect, it, vi } from 'vitest'
import { CH_ACTIVE_PET_CHANGE, CH_STATE_CHANGE } from '../shared/ipc-channels'

const { exposeInMainWorld, ipcOn, ipcRemoveListener } = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  ipcOn: vi.fn(),
  ipcRemoveListener: vi.fn(),
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: {
    invoke: vi.fn(),
    on: ipcOn,
    removeListener: ipcRemoveListener,
    send: vi.fn(),
  },
}))

import './preload'

type ExposedPetApi = {
  onStateChange: (callback: (payload: { state: string }) => void) => () => void
  onActivePetChange: (callback: (payload: { id: string }) => void) => () => void
}

function petApi(): ExposedPetApi {
  return exposeInMainWorld.mock.calls[0]?.[1] as ExposedPetApi
}

afterEach(() => {
  ipcOn.mockClear()
  ipcRemoveListener.mockClear()
})

describe('preload petApi subscriptions', () => {
  it('forwards a live active-pet update and removes its exact IPC listener', () => {
    const callback = vi.fn()
    const remove = petApi().onActivePetChange(callback)
    const listener = ipcOn.mock.calls[0]?.[1] as (event: unknown, payload: { id: string }) => void

    listener({}, { id: 'custom-cat' })
    remove()

    expect(ipcOn).toHaveBeenCalledWith(CH_ACTIVE_PET_CHANGE, listener)
    expect(callback).toHaveBeenCalledWith({ id: 'custom-cat' })
    expect(ipcRemoveListener).toHaveBeenCalledWith(CH_ACTIVE_PET_CHANGE, listener)
  })

  it('returns cleanup for state listeners as well', () => {
    const remove = petApi().onStateChange(vi.fn())
    const listener = ipcOn.mock.calls[0]?.[1]

    remove()

    expect(ipcRemoveListener).toHaveBeenCalledWith(CH_STATE_CHANGE, listener)
  })
})
