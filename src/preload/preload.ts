import { contextBridge, ipcRenderer } from 'electron'
import {
  CH_ACTIVE_PET_CHANGE,
  CH_DRAG_END,
  CH_DRAG_MOVE,
  CH_DRAG_START,
  CH_ACTIVE_PET_GET,
  CH_PTR_INTERACTIVE,
  CH_RENDERER_READY,
  CH_RESIZE_END,
  CH_RESIZE_MOVE,
  CH_RESIZE_START,
  CH_STATE_CHANGE,
  CH_STATE_SET,
} from '../shared/ipc-channels'

contextBridge.exposeInMainWorld('petApi', {
  /**
   * Send a new pet state name to the main process.
   */
  setState(state: string): void {
    ipcRenderer.send(CH_STATE_SET, state)
  },

  /** Register a state-change listener and return its cleanup function. */
  onStateChange(cb: (payload: { state: string }) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: { state: string }) => {
      cb(payload)
    }
    ipcRenderer.on(CH_STATE_CHANGE, listener)
    return () => ipcRenderer.removeListener(CH_STATE_CHANGE, listener)
  },

  /** Register a validated active-pet update listener and return its cleanup function. */
  onActivePetChange(
    cb: (payload: {
      id: string
      source: 'buddy' | 'packaged' | 'codex'
      manifest: unknown
      spritesheetUrl: string
      initialState: string
    }) => void,
  ): () => void {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: {
        id: string
        source: 'buddy' | 'packaged' | 'codex'
        manifest: unknown
        spritesheetUrl: string
        initialState: string
      },
    ) => {
      cb(payload)
    }
    ipcRenderer.on(CH_ACTIVE_PET_CHANGE, listener)
    return () => ipcRenderer.removeListener(CH_ACTIVE_PET_CHANGE, listener)
  },

  /**
   * Request the resolved active pet manifest and renderer-safe spritesheet URL.
   */
  getActivePet(): Promise<{
    id: string
    source: 'buddy' | 'packaged' | 'codex'
    manifest: unknown
    spritesheetUrl: string
    initialState: string
  }> {
    return ipcRenderer.invoke(CH_ACTIVE_PET_GET)
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

  /**
   * Notify main that a resize operation has started.
   * initialWidth/initialHeight are the window dimensions at the moment the handle is grabbed.
   */
  resizeStart(initialWidth: number, initialHeight: number): void {
    ipcRenderer.send(CH_RESIZE_START, { initialWidth, initialHeight })
  },

  /**
   * Notify main to update the window size based on current pointer position.
   * screenX/screenY are the current cursor position in screen coordinates.
   */
  resizeMove(screenX: number, screenY: number): void {
    ipcRenderer.send(CH_RESIZE_MOVE, { screenX, screenY })
  },

  /**
   * Notify main that the resize operation has ended.
   * Main saves the final bounds to the state store.
   */
  resizeEnd(): void {
    ipcRenderer.send(CH_RESIZE_END)
  },
})
