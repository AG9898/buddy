// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/svelte'
import App from './App.svelte'

function makePet(id: string, initialState = 'idle'): ActivePet {
  return {
    id,
    source: 'buddy',
    spritesheetUrl: `file:///pets/${id}.webp`,
    initialState,
    manifest: {
      id,
      name: id,
      spritesheet: `${id}.webp`,
      frameWidth: 32,
      frameHeight: 32,
      columns: 2,
      rows: 1,
      states: {
        idle: { frames: [{ row: 0, col: 0, ms: 100 }] },
        running: { frames: [{ row: 0, col: 1, ms: 100 }] },
      },
    },
  }
}

let activePetListener: ((payload: ActivePet) => void) | undefined
let resolveInitialPet: ((pet: ActivePet) => void) | undefined

const removeStateListener = vi.fn()
const removeActivePetListener = vi.fn()
const petApi = {
  setState: vi.fn(),
  onStateChange: vi.fn(() => removeStateListener),
  onActivePetChange: vi.fn((callback: (payload: ActivePet) => void) => {
    activePetListener = callback
    return removeActivePetListener
  }),
  getActivePet: vi.fn(),
  setPointerInteractive: vi.fn(),
  dragStart: vi.fn(),
  dragMove: vi.fn(),
  dragEnd: vi.fn(),
  rendererReady: vi.fn(),
  resizeStart: vi.fn(),
  resizeMove: vi.fn(),
  resizeEnd: vi.fn(),
}

beforeEach(() => {
  activePetListener = undefined
  resolveInitialPet = undefined
  vi.clearAllMocks()
  Object.defineProperty(window, 'petApi', { configurable: true, value: petApi })
})

afterEach(() => {
  cleanup()
})

describe('App live pet reload', () => {
  it('replaces the manifest and spritesheet without repeating the renderer-ready handshake', async () => {
    petApi.getActivePet.mockResolvedValue(makePet('default'))
    const { container, unmount } = render(App)

    await waitFor(() => {
      expect(container.querySelector('[data-avatar-mascot]')?.getAttribute('style')).toContain(
        'file:///pets/default.webp',
      )
    })

    activePetListener?.(makePet('custom-cat', 'running'))

    await waitFor(() => {
      const sprite = container.querySelector('[data-avatar-mascot]') as HTMLElement
      expect(sprite.style.backgroundImage).toContain('custom-cat.webp')
      expect(sprite.style.backgroundPosition).toBe('100% 0%')
    })
    expect(petApi.rendererReady).toHaveBeenCalledTimes(1)

    unmount()
    expect(removeStateListener).toHaveBeenCalledOnce()
    expect(removeActivePetListener).toHaveBeenCalledOnce()
  })

  it('keeps a live selection when the startup invoke resolves afterward', async () => {
    petApi.getActivePet.mockImplementation(
      () => new Promise<ActivePet>((resolve) => (resolveInitialPet = resolve)),
    )
    const { container } = render(App)

    activePetListener?.(makePet('custom-cat', 'running'))
    resolveInitialPet?.(makePet('default'))

    await waitFor(() => {
      expect(container.querySelector('[data-avatar-mascot]')?.getAttribute('style')).toContain(
        'file:///pets/custom-cat.webp',
      )
    })
    expect(petApi.rendererReady).toHaveBeenCalledTimes(1)
  })
})
