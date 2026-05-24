// Electron main process entry point — FEAT-07: full startup wiring.
// Integrates all Phase 1 modules: state restore, avatar window, tray, sidecar,
// renderer-ready handshake, bounds saving, and graceful shutdown.

import { app, ipcMain, screen } from 'electron'
import type { Rectangle } from 'electron'
import http from 'http'
import path from 'path'
import { createAvatarWindow } from './avatar-window'
import { createTray } from './tray'
import { startSidecar, stopSidecar } from './sidecar'
import { loadState, saveState, saveBounds } from './state-store'
import { CH_DRAG_END, CH_RENDERER_READY, CH_RESIZE_END } from '../shared/ipc-channels'

// Track whether app.quit() was triggered via the tray Quit item so the
// 'close' handler knows to allow the window to close.
let isQuitting = false

// Reference to the sidecar server so we can stop it on quit.
let sidecarServer: http.Server | null = null

function clampBoundsToDisplay(bounds: Rectangle): Rectangle {
  const display = screen.getDisplayMatching(bounds)
  const area = display.workArea
  const width = Math.min(bounds.width, area.width)
  const height = Math.min(bounds.height, area.height)

  return {
    width,
    height,
    x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - height),
  }
}

app.whenReady().then(() => {
  // 1. Load persisted state — provides bounds and open/hidden flag.
  const state = loadState()
  const restoredBounds = clampBoundsToDisplay(state.bounds)
  if (
    restoredBounds.x !== state.bounds.x ||
    restoredBounds.y !== state.bounds.y ||
    restoredBounds.width !== state.bounds.width ||
    restoredBounds.height !== state.bounds.height
  ) {
    const display = screen.getDisplayMatching(restoredBounds)
    const res = `${display.bounds.width}x${display.bounds.height}`
    saveBounds(restoredBounds, res)
    state.bounds = restoredBounds
  }

  // 2. Create the overlay window at the last-saved bounds (show:false — renderer
  //    must signal ready before we call showInactive).
  const win = createAvatarWindow(state.bounds)

  // 3. Create the system tray (keeps the process alive when the window is hidden).
  createTray(win)

  // 4. Start the local HTTP sidecar (validates token, forwards events to renderer).
  sidecarServer = startSidecar(win)

  // 5. Wait for the renderer to signal it is mounted before showing the window.
  //    This prevents a brief blank transparent window from appearing.
  //    Register before loading the renderer so a fast dev server cannot win the race.
  ipcMain.once(CH_RENDERER_READY, () => {
    if (state.open) {
      win.moveTop()
      win.showInactive()
    }
  })

  // 6. Load the Svelte renderer.
  if (process.env['ELECTRON_RENDERER_URL']) {
    // Dev: electron-vite injects this env var pointing at the Vite dev server.
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    // Production: load the built renderer index.html.
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // 7. Save bounds on drag-end.
  ipcMain.on(CH_DRAG_END, () => {
    const b = win.getBounds()
    const display = screen.getDisplayNearestPoint({ x: b.x, y: b.y })
    const res = `${display.bounds.width}x${display.bounds.height}`
    saveBounds(b, res)
  })

  // 7b. Save bounds on resize-end.
  ipcMain.on(CH_RESIZE_END, () => {
    const b = win.getBounds()
    const display = screen.getDisplayNearestPoint({ x: b.x, y: b.y })
    const res = `${display.bounds.width}x${display.bounds.height}`
    saveBounds(b, res)
  })

  // 8. Save bounds when the display configuration changes (resolution, scale, etc.).
  screen.on('display-metrics-changed', () => {
    const b = win.getBounds()
    const display = screen.getDisplayNearestPoint({ x: b.x, y: b.y })
    const res = `${display.bounds.width}x${display.bounds.height}`
    saveBounds(b, res)
  })

  // 9. Intercept the window close button: hide (sleep) instead of quit unless
  //    isQuitting is set by the tray Quit item.
  win.on('close', (event) => {
    if (!isQuitting) {
      // Prevent close — sleep the pet.
      event.preventDefault()
      const currentState = loadState()
      saveState({ ...currentState, open: false })
      win.hide()
    } else {
      // Quitting: persist final state including current bounds and visibility.
      const b = win.getBounds()
      const currentState = loadState()
      saveState({ ...currentState, open: win.isVisible(), bounds: b })
    }
  })
})

// 10. Before the app quits: set isQuitting flag, save final state, stop sidecar.
app.on('before-quit', () => {
  isQuitting = true
  if (sidecarServer) {
    stopSidecar(sidecarServer)
    sidecarServer = null
  }
})

// Keep the process alive when all windows are closed — the tray is the only exit path.
app.on('window-all-closed', () => {
  // Do not quit here; the Quit tray item is the only exit path.
})
