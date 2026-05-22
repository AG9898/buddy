/// <reference types="vite/client" />

interface PetApi {
  setState(state: string): void
  onStateChange(cb: (payload: { state: string }) => void): void
  setPointerInteractive(interactive: boolean): void
  dragStart(offsetX: number, offsetY: number): void
  dragMove(): void
  dragEnd(): void
  /** Signal the main process that the renderer is mounted and ready to be shown. */
  rendererReady(): void
}

declare global {
  interface Window {
    petApi: PetApi
  }
}

export {}
