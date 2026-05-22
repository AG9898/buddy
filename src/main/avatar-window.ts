// Transparent overlay BrowserWindow factory for the buddy pet app.
// See docs/ARCHITECTURE.md and handoff.md for required window options.

import { BrowserWindow, ipcMain, screen } from 'electron'
import path from 'path'

// IPC channel name constants — never use raw strings elsewhere.
export const IPC_PTR_INTERACTIVE_CHANGED = 'ptr-interactive-changed'
export const IPC_DRAG_START = 'drag-start'
export const IPC_DRAG_MOVE = 'drag-move'
export const IPC_DRAG_END = 'drag-end'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

interface DragState {
  offsetX: number
  offsetY: number
}

let avatarWindow: BrowserWindow | null = null
let dragState: DragState | null = null

/**
 * Create the transparent, frameless, always-on-top avatar overlay BrowserWindow.
 * Call showInactive() to display without stealing focus.
 * All window options follow the spec in docs/ARCHITECTURE.md.
 */
export function createAvatarWindow(bounds?: Partial<WindowBounds>): BrowserWindow {
  const win = new BrowserWindow({
    width: bounds?.width ?? 356,
    height: bounds?.height ?? 320,
    x: bounds?.x,
    y: bounds?.y,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    show: false,
    thickFrame: false,
    roundedCorners: false,
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Reinforce floating behavior.
  win.setVisibleOnAllWorkspaces(true)
  win.setAlwaysOnTop(true, 'floating')
  win.setMenuBarVisibility(false)

  // Default: all mouse events pass through the transparent window.
  win.setIgnoreMouseEvents(true, { forward: true })

  // Toggle click-through based on renderer signal.
  ipcMain.on(IPC_PTR_INTERACTIVE_CHANGED, (_event, interactive: boolean) => {
    if (interactive) {
      win.setIgnoreMouseEvents(false)
      // Refresh cursor at current mouse position so the renderer picks up the change.
      const point = screen.getCursorScreenPoint()
      const bounds_ = win.getContentBounds()
      const x = point.x - bounds_.x
      const y = point.y - bounds_.y
      if (x >= 0 && y >= 0 && x <= bounds_.width && y <= bounds_.height) {
        win.webContents.sendInputEvent({
          type: 'mouseMove',
          x,
          y,
          movementX: 0,
          movementY: 0,
        })
      }
    } else {
      win.setIgnoreMouseEvents(true, { forward: true })
    }
  })

  // Drag: record initial pointer offset within the window.
  ipcMain.on(IPC_DRAG_START, (_event, payload: { pointerWindowX: number; pointerWindowY: number }) => {
    dragState = {
      offsetX: payload.pointerWindowX,
      offsetY: payload.pointerWindowY,
    }
  })

  // Drag: reposition window to follow screen cursor.
  ipcMain.on(IPC_DRAG_MOVE, () => {
    if (!dragState) return
    const point = screen.getCursorScreenPoint()
    win.setBounds({
      ...win.getBounds(),
      x: point.x - dragState.offsetX,
      y: point.y - dragState.offsetY,
    })
  })

  // Drag: clear drag state.
  ipcMain.on(IPC_DRAG_END, () => {
    dragState = null
  })

  // Display using showInactive so the pet never steals focus.
  win.showInactive()

  avatarWindow = win
  return win
}

/** Returns the current avatar window instance, or null if not yet created. */
export function getAvatarWindow(): BrowserWindow | null {
  return avatarWindow
}
