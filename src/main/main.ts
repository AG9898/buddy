// Electron main process entry point.
// FEAT-01: BrowserWindow creation via avatar-window.ts.
// FEAT-05: system tray (Show/Hide/Quit) and close-to-hide behaviour.

import { app } from 'electron'
import path from 'path'
import { createAvatarWindow } from './avatar-window'
import { createTray, isQuitting } from './tray'

// Default window bounds (356×320 px) — overridden by persisted state in FEAT-07.
const DEFAULT_WIDTH = 356
const DEFAULT_HEIGHT = 320

app.whenReady().then(() => {
  const win = createAvatarWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  })

  // Load the Svelte renderer.
  if (process.env['ELECTRON_RENDERER_URL']) {
    // Dev: electron-vite injects this env var pointing at the Vite dev server.
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    // Production: load the built renderer index.html.
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // Create the system tray icon; it keeps the process alive when the window is hidden.
  createTray(win)

  // Intercept the system close button: hide instead of quit unless isQuitting is set.
  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      win.hide()
    }
  })
})

// Keep the process alive when all windows are closed — the tray provides the quit path.
app.on('window-all-closed', () => {
  // Do not quit here; the Quit tray item is the only exit path.
  // On macOS the convention is to keep the app running even without windows,
  // so no special-case is needed.
})
