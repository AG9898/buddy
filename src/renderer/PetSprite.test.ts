// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/svelte'
import PetSprite from './PetSprite.svelte'

function makePet(id: string, states: PetManifest['states']): PetManifest {
  return {
    id,
    name: id,
    spritesheet: `${id}.webp`,
    frameWidth: 32,
    frameHeight: 32,
    columns: 2,
    rows: 1,
    states,
  }
}

const petApi = {
  setState: vi.fn(),
  onStateChange: vi.fn(() => vi.fn()),
  onActivePetChange: vi.fn(() => vi.fn()),
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
  Object.defineProperty(window, 'petApi', { configurable: true, value: petApi })
})

afterEach(() => {
  cleanup()
})

describe('PetSprite active-pet changes', () => {
  it('restarts with the new manifest idle fallback when its current state is unavailable', async () => {
    const firstPet = makePet('first', {
      idle: { frames: [{ row: 0, col: 0, ms: 100 }] },
      running: { frames: [{ row: 0, col: 1, ms: 100 }] },
    })
    const replacementPet = makePet('replacement', {
      idle: { frames: [{ row: 0, col: 1, ms: 100 }] },
    })
    const { container, rerender } = render(PetSprite, {
      state: 'running',
      pet: firstPet,
      spritesheetUrl: 'file:///pets/first.webp',
    })

    await rerender({ pet: replacementPet, spritesheetUrl: 'file:///pets/replacement.webp' })

    await waitFor(() => {
      const sprite = container.querySelector('[data-avatar-mascot]') as HTMLElement
      expect(sprite.style.backgroundImage).toContain('replacement.webp')
      expect(sprite.style.backgroundPosition).toBe('100% 0%')
    })
  })
})
