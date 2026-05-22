import { contextBridge, ipcRenderer } from 'electron'

// IPC channel name constants — all channel strings are defined here.
// Main process and renderer must import from here; never hardcode channel strings.
export const CH_STATE_SET = 'state-set'
export const CH_STATE_CHANGE = 'pet:state-change'
export const CH_PTR_INTERACTIVE = 'ptr-interactive-changed'
export const CH_DRAG_START = 'drag-start'
export const CH_DRAG_MOVE = 'drag-move'
export const CH_DRAG_END = 'drag-end'
/** Sent by the renderer on mount to signal it is live and ready to display. */
export const CH_RENDERER_READY = 'renderer-ready'

contextBridge.exposeInMainWorld('petApi', {
  /**
   * Send a new pet state name to the main process.
   */
  setState(state: string): void {
    ipcRenderer.send(CH_STATE_SET, state)
  },

  /**
   * Register a callback to be invoked each time the main process pushes a state change.
   * Adds a new listener on every call — callers must manage cleanup if needed.
   */
  onStateChange(cb: (payload: { state: string }) => void): void {
    ipcRenderer.on(CH_STATE_CHANGE, (_event, payload: { state: string }) => {
      cb(payload)
    })
  },

  /**
   * Signal whether the pointer is currently over an interactive region.
   * When true, click-through is disabled so the pet can receive pointer events.
   */
  setPointerInteractive(interactive: boolean): void {
    ipcRenderer.send(CH_PTR_INTERACTIVE, interactive)
  },

  /**
   * Notify main that a drag operation has started.
   * offsetX/offsetY are the pointer coordinates relative to the window.
   */
  dragStart(offsetX: number, offsetY: number): void {
    ipcRenderer.send(CH_DRAG_START, { pointerWindowX: offsetX, pointerWindowY: offsetY })
  },

  /**
   * Notify main to reposition the window to follow the current cursor position.
   */
  dragMove(): void {
    ipcRenderer.send(CH_DRAG_MOVE)
  },

  /**
   * Notify main that the drag operation has ended.
   */
  dragEnd(): void {
    ipcRenderer.send(CH_DRAG_END)
  },

  /**
   * Notify main that the renderer is mounted and ready to be shown.
   * Call once from the root component's onMount lifecycle hook.
   */
  rendererReady(): void {
    ipcRenderer.send(CH_RENDERER_READY)
  },
})
