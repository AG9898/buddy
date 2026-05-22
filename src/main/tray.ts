// FEAT-05: system tray icon with Show/Hide/Quit context menu

import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron'
import path from 'path'
import fs from 'fs'

/**
 * Flag set to true by the Quit menu item so the 'close' handler in main.ts
 * knows to allow the window to close and the process to exit.
 */
export let isQuitting = false

let tray: Tray | null = null

/**
 * Returns a NativeImage for the tray icon. Uses build/tray-icon.png when it
 * exists; otherwise creates a 16×16 solid-white placeholder image at runtime
 * so the tray can be created without requiring a pre-built asset.
 */
function getTrayIcon(): Electron.NativeImage {
  const iconPath = path.join(__dirname, '../../build/tray-icon.png')
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath)
  }
  // 16×16 fully opaque white RGBA buffer used as a placeholder.
  const size = 16
  const rgba = Buffer.alloc(size * size * 4, 0xff)
  return nativeImage.createFromBuffer(rgba, { width: size, height: size })
}

/**
 * Create the system tray icon with Show Pet / Hide Pet / Quit context menu.
 * Should be called once after the BrowserWindow is created.
 *
 * @param win - The avatar BrowserWindow to control.
 * @returns The created Tray instance.
 */
export function createTray(win: BrowserWindow): Tray {
  const icon = getTrayIcon()
  tray = new Tray(icon)
  tray.setToolTip('buddy')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Pet',
      click: () => {
        win.showInactive()
      },
    },
    {
      label: 'Hide Pet',
      click: () => {
        win.hide()
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)

  return tray
}

/** Returns the current Tray instance, or null if not yet created. */
export function getTray(): Tray | null {
  return tray
}
