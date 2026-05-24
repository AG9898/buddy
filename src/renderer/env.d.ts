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
  /** Notify main that a resize operation has started with the current window dimensions. */
  resizeStart(initialWidth: number, initialHeight: number): void
  /** Notify main to update the window size based on cursor screen position. */
  resizeMove(screenX: number, screenY: number): void
  /** Notify main that the resize operation has ended; main saves the final bounds. */
  resizeEnd(): void
}

declare global {
  interface Window {
    petApi: PetApi
  }
}

export {}
