// Electron main process entry point.
// FEAT-01: BrowserWindow creation via avatar-window.ts.
// FEAT-07: state-store, sidecar, tray, and startup restore flow (out of scope here).

import { app } from 'electron'
import path from 'path'
import { createAvatarWindow } from './avatar-window'

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
})

// Prevent the process from quitting when all windows are closed on Windows/Linux.
// A tray icon (FEAT-07) will provide the only quit mechanism.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Keep alive until FEAT-07 tray is implemented; quit for now in dev.
    app.quit()
  }
})
