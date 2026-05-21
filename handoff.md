# Windows Floating Pet Handoff

## Goal

Build a Windows-only floating desktop pet inspired by two existing systems:

- Codex Desktop's built-in avatar overlay, which already works on Windows as a persistent transparent floating window.
- Petdex's hook-driven workflow, which wires Codex/Claude/Gemini/OpenCode events into pet state changes.

The intended project is not to patch Codex itself. The intended project is to create a standalone Windows desktop app and a small CLI/hook bridge that can react to Codex activity.

The target behavior:

- A floating pet stays visible even when the main Codex app window is minimized or hidden to tray.
- The pet disappears only when the pet app is explicitly closed or the process is fully terminated.
- The pet is transparent, frameless, always on top, and skipped from the taskbar.
- Mouse clicks pass through the transparent window except when the user is interacting with the pet, tray, resize handle, or context menu.
- Position, size, and open/closed state persist across restarts.
- Codex hooks can trigger states such as `idle`, `running`, `waiting`, `jumping`, `waving`, `failed`, and `review`.

## Why This Is Needed

Petdex installed successfully on this Windows machine, but its desktop runtime is not available for Windows yet.

Observed Petdex install location:

```text
C:\Users\AdenGuo\.petdex
```

Important files:

```text
C:\Users\AdenGuo\.petdex\bin\petdex.js
C:\Users\AdenGuo\.codex\hooks.json
C:\Users\AdenGuo\.codex\prompts\petdex.md
```

`petdex doctor` reported that the hooks are installed, but the desktop binary is missing:

```text
Desktop binary not found at C:\Users\AdenGuo\.petdex\bin\petdex-desktop.exe
Sidecar bundle not found at C:\Users\AdenGuo\.petdex\sidecar\server.js
```

Trying to install the desktop binary failed because the latest Petdex desktop release only ships macOS DMGs:

```text
No binary for win32-x64 in desktop-v0.2.0.
Available:
  Petdex-arm64.dmg
  Petdex-x64.dmg
```

So the opportunity is to build the missing Windows runtime.

## Codex Desktop Implementation Notes

Codex Desktop is installed on this machine as a Windows packaged Electron app:

```text
C:\Program Files\WindowsApps\OpenAI.Codex_26.519.2736.0_x64__2p2nqsd0c76g0\app\Codex.exe
```

The relevant packaged app bundle is:

```text
C:\Program Files\WindowsApps\OpenAI.Codex_26.519.2736.0_x64__2p2nqsd0c76g0\app\resources\app.asar
```

I extracted it locally for inspection to:

```text
C:\Users\AdenGuo\codex-asar-inspect
```

Main-process bundle inspected:

```text
C:\Users\AdenGuo\codex-asar-inspect\.vite\build\main-OHUH9Fwm.js
```

Avatar renderer bundle inspected:

```text
C:\Users\AdenGuo\codex-asar-inspect\webview\assets\avatar-overlay-page-rDiP16E4.js
```

Sprite/avatar rendering bundle inspected:

```text
C:\Users\AdenGuo\codex-asar-inspect\webview\assets\codex-avatar-5rBVLDei.js
```

Agents in WSL may not be able to read `C:\Program Files\WindowsApps` or the extracted bundle, so this document summarizes the important mechanics.

## Codex Avatar Overlay Architecture

Codex does not render the pet inside the main app window.

It creates a separate Electron `BrowserWindow` for the avatar overlay:

```text
Electron process
  ├─ primary Codex BrowserWindow
  ├─ tray keeps process alive on Windows
  └─ avatarOverlay BrowserWindow
       ├─ transparent
       ├─ frameless
       ├─ always on top
       ├─ skipped from taskbar
       ├─ normally non-focusable
       ├─ click-through outside interactive regions
       └─ restored from global state on startup
```

This is why the pet can remain visible while the main Codex window is minimized or hidden. The Electron process continues running, and the pet is its own top-level window.

## Persisted State

Codex stores avatar overlay state in:

```text
C:\Users\AdenGuo\.codex\.codex-global-state.json
```

The relevant keys are:

```text
electron-avatar-overlay-open
electron-avatar-overlay-bounds
```

Example observed persisted state:

```json
{
  "electron-avatar-overlay-open": true,
  "electron-avatar-overlay-bounds": {
    "x": 3484,
    "y": 731,
    "width": 356,
    "height": 320,
    "anchor": {
      "x": 3698,
      "y": 889,
      "width": 142,
      "height": 154
    },
    "displayBounds": {
      "x": 1920,
      "y": 0,
      "width": 1920,
      "height": 1080
    },
    "mascot": {
      "left": 214,
      "top": 158,
      "width": 142,
      "height": 154
    },
    "placement": "top-end",
    "tray": {
      "left": 80,
      "top": 23,
      "width": 276,
      "height": 131
    },
    "byResolution": {
      "1920x1080": {
        "x": 3484,
        "y": 731,
        "width": 356,
        "height": 320
      }
    }
  }
}
```

For a standalone project, use a simpler app-specific state file, for example:

```text
%USERPROFILE%\.petdex-win\state.json
```

Suggested schema:

```json
{
  "open": true,
  "bounds": {
    "x": 1600,
    "y": 760,
    "width": 356,
    "height": 320
  },
  "pet": {
    "id": "hirono-bear",
    "spritesheetPath": "C:\\Users\\AdenGuo\\.codex\\pets\\hirono-bear\\spritesheet.png",
    "width": 142,
    "height": 154,
    "state": "idle"
  },
  "byResolution": {
    "1920x1080": {
      "x": 1600,
      "y": 760,
      "width": 356,
      "height": 320
    }
  }
}
```

## Startup Restore Flow

Codex has a renderer/main handshake:

1. Renderer becomes ready.
2. Renderer sends `electron-avatar-overlay-restore-ready`.
3. Main process checks `electron-avatar-overlay-open`.
4. If true, main process reopens the avatar overlay.

Equivalent standalone flow:

```js
app.whenReady().then(async () => {
  const state = loadState();
  createTray();
  startLocalSidecar();

  if (state.open) {
    await avatarOverlay.open();
  }
});
```

Important detail: Codex does not show the overlay until the renderer is ready. This avoids showing a blank transparent window.

## Electron Window Options

Codex maps `appearance: "avatarOverlay"` to window options equivalent to:

```js
{
  frame: false,
  transparent: true,
  hasShadow: false,
  resizable: false,
  minimizable: false,
  maximizable: false,
  fullscreenable: false,
  skipTaskbar: true,
  alwaysOnTop: true
}
```

On Windows it also uses behavior equivalent to:

```js
{
  thickFrame: false,
  roundedCorners: false,
  accentColor: false,
  autoHideMenuBar: true,
  backgroundColor: "#00000000"
}
```

Recommended standalone Electron creation code:

```js
const win = new BrowserWindow({
  width: state.bounds?.width ?? 356,
  height: state.bounds?.height ?? 320,
  x: state.bounds?.x,
  y: state.bounds?.y,
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
  backgroundColor: "#00000000",
  autoHideMenuBar: true,
  webPreferences: {
    preload: path.join(__dirname, "preload.js"),
    contextIsolation: true,
    nodeIntegration: false
  }
});
```

After creation, Codex reinforces the floating behavior:

```js
win.setVisibleOnAllWorkspaces(true);
win.setAlwaysOnTop(true, "floating");
win.setMenuBarVisibility(false);
```

When ready to display:

```js
win.moveTop();
win.showInactive();
```

`showInactive()` matters because the pet appears without stealing focus from the user's current window.

## Main Window Close vs App Quit

Codex has a normal main app window plus tray behavior.

On Windows, when the primary window is closed and the app can hide to tray, Codex prevents the close and hides the main window:

```js
mainWindow.on("close", (event) => {
  if (process.platform === "win32" && !isAppQuitting && canHideLastWindowToTray()) {
    event.preventDefault();
    mainWindow.hide();
  }
});
```

The avatar overlay survives because the Electron process is still alive.

For a standalone pet app, do the same:

- Create a tray icon.
- On close, hide the pet or main control window instead of quitting.
- Only quit on explicit tray menu `Quit`.

Example:

```js
let isQuitting = false;

app.on("before-quit", () => {
  isQuitting = true;
});

win.on("close", (event) => {
  if (!isQuitting) {
    event.preventDefault();
    saveState({ open: false });
    win.hide();
  }
});
```

If the pet window itself is the primary visible surface, closing it should probably mean "sleep pet" instead of "quit app".

## Click-Through / Pointer Interactivity

Codex normally makes the transparent avatar window click-through:

```js
win.setIgnoreMouseEvents(true, { forward: true });
```

When the renderer detects the pointer is over an interactive region, it tells main:

```text
avatar-overlay-pointer-interaction-changed
```

Main then toggles mouse passthrough:

```js
function applyPointerInteractivityPolicy() {
  const shouldPassThrough = !pointerInteractive;

  if (shouldPassThrough) {
    win.setIgnoreMouseEvents(true, { forward: true });
  } else {
    win.setIgnoreMouseEvents(false);
    refreshCursorAtCurrentMousePosition(win);
  }
}
```

Codex refreshes the cursor by sending a synthetic mouse move to the renderer:

```js
function refreshCursorAtCurrentMousePosition(win) {
  const point = screen.getCursorScreenPoint();
  const bounds = win.getContentBounds();
  const x = point.x - bounds.x;
  const y = point.y - bounds.y;

  if (x >= 0 && y >= 0 && x <= bounds.width && y <= bounds.height) {
    win.webContents.sendInputEvent({
      type: "mouseMove",
      x,
      y,
      movementX: 0,
      movementY: 0
    });
  }
}
```

Renderer-side concept:

```js
const interactiveSelectors = [
  "[data-avatar-overlay-hit-region]",
  "[data-avatar-mascot='true']",
  ".resize-handle",
  ".notification-tray"
];

window.addEventListener("pointermove", (event) => {
  const isInteractive = interactiveSelectors.some((selector) =>
    event.target.closest(selector)
  );

  window.petApi.setPointerInteractive(isInteractive);
});
```

In a simple version, the whole pet can be interactive and the rest of the transparent window can be click-through.

## Dragging

Codex handles drag in the renderer and sends events to main:

```text
avatar-overlay-drag-start
avatar-overlay-drag-move
avatar-overlay-drag-end
avatar-overlay-drag-release
```

The main process uses Electron's screen cursor position, not just renderer coordinates, to move the actual window.

Simpler standalone approach:

```js
ipcMain.on("drag-start", (_, payload) => {
  dragState = {
    offsetX: payload.pointerWindowX,
    offsetY: payload.pointerWindowY
  };
});

ipcMain.on("drag-move", () => {
  if (!dragState) return;

  const point = screen.getCursorScreenPoint();
  win.setBounds({
    ...win.getBounds(),
    x: point.x - dragState.offsetX,
    y: point.y - dragState.offsetY
  });
});

ipcMain.on("drag-end", () => {
  dragState = null;
  saveBounds(win.getBounds());
});
```

Codex also implements momentum on release. That is optional for a first Windows version.

## Layout and Bounds

Codex tracks:

- `anchor`: the mascot's screen-space position and size.
- `windowBounds`: the full transparent overlay bounds.
- `mascot`: mascot rectangle inside the overlay window.
- `tray`: notification tray rectangle inside the overlay window.
- `placement`: `top-start`, `top-end`, `bottom-start`, `bottom-end`.
- `displayBounds`: monitor bounds.
- `byResolution`: saved bounds per monitor resolution.

For a minimal implementation, start with:

```js
{
  windowBounds: { x, y, width: 356, height: 320 },
  mascotBounds: { left: 214, top: 158, width: 142, height: 154 }
}
```

Then evolve later to support tray placement and multi-monitor restore.

Important: save bounds on:

- close
- drag end
- resize end
- display changed
- app quit

## Renderer Pet Animation

Codex uses sprite sheets and CSS `background-position`.

Built-in Codex sprite configuration:

```js
const columns = 8;
const rows = 9;
```

States include:

```text
idle
jumping
running
running-left
running-right
waving
waiting
failed
review
```

Conceptual renderer:

```html
<div
  id="pet"
  data-avatar-mascot="true"
  style="
    width: 142px;
    height: 154px;
    background-image: url('./spritesheet.webp');
    background-size: 800% 900%;
    background-position: 0% 0%;
  "
></div>
```

Animation loop:

```js
const framesByState = {
  idle: [
    { row: 0, col: 0, ms: 280 },
    { row: 0, col: 1, ms: 110 }
  ],
  running: [
    { row: 7, col: 0, ms: 120 },
    { row: 7, col: 1, ms: 120 }
  ],
  waiting: [
    { row: 6, col: 0, ms: 150 },
    { row: 6, col: 1, ms: 150 }
  ]
};

function setFrame(el, frame) {
  el.style.backgroundPosition =
    `${(frame.col / 7) * 100}% ${(frame.row / 8) * 100}%`;
}
```

Codex custom pets live under:

```text
C:\Users\AdenGuo\.codex\pets
```

Current selected custom pet in Codex config:

```text
selected-avatar-id = "custom:hirono-bear"
```

Config path:

```text
C:\Users\AdenGuo\.codex\config.toml
```

Current custom pet metadata:

```text
C:\Users\AdenGuo\.codex\pets\hirono-bear\pet.json
```

A Windows pet app can either:

- use Codex-compatible pet folders from `.codex\pets`
- use its own `%USERPROFILE%\.petdex-win\pets`
- support both

## Hook Integration

Petdex already installed Codex hooks at:

```text
C:\Users\AdenGuo\.codex\hooks.json
```

Those hooks currently call:

```text
node "$HOME/.petdex/bin/petdex.js" bubble ...
```

or fallback to:

```text
POST http://127.0.0.1:7777/state
```

For a Windows-only app, use the same model:

```text
Codex hook -> small CLI -> local sidecar -> Electron renderer
```

Suggested commands:

```powershell
petdex-win state idle
petdex-win state running
petdex-win state waiting
petdex-win state jumping --duration 800
petdex-win state waving --duration 1500
petdex-win up
petdex-win down
petdex-win toggle
petdex-win doctor
petdex-win hooks install
```

Suggested local HTTP API:

```http
POST http://127.0.0.1:7777/state
Content-Type: application/json

{
  "state": "running",
  "duration": 800,
  "source": "codex"
}
```

Suggested Codex hook mapping:

```text
UserPromptSubmit  -> jumping
PreToolUse        -> running
PostToolUse       -> idle
PermissionRequest -> waiting
Stop              -> waving
```

The sidecar should be local-only:

```js
server.listen(7777, "127.0.0.1");
```

Use a token file for safety:

```text
%USERPROFILE%\.petdex-win\runtime\update-token
```

Require:

```http
X-Petdex-Update-Token: <token>
```

## Recommended Windows Project Structure

```text
petdex-win/
  package.json
  src/
    main/
      main.ts
      avatar-window.ts
      state-store.ts
      sidecar.ts
      tray.ts
      hooks-install.ts
    preload/
      preload.ts
    renderer/
      index.html
      app.tsx
      pet-sprite.tsx
      styles.css
  pets/
    default/
      pet.json
      spritesheet.webp
  dist/
```

Suggested packages:

```text
electron
electron-builder
typescript
vite
react
```

React is optional; a plain HTML/CSS/JS renderer is enough for v1.

## Minimal MVP

The first milestone should be intentionally small:

1. Create Electron transparent always-on-top pet window on Windows.
2. Render one sprite sheet.
3. Persist open state and bounds.
4. Add tray menu with `Show`, `Hide`, `Quit`.
5. Add local HTTP endpoint `/state`.
6. Add CLI command to send `/state`.
7. Add `hooks install` command that writes Codex hooks.
8. Verify Codex tool calls animate the pet.

Do not start with marketplace, OAuth, submissions, gallery, auto-updater, or multi-agent support. Those can come later.

## Important Differences From Codex

Codex can rely on its own internal app state, IPC, global state store, and renderer boot lifecycle.

The standalone app should not depend on Codex internals. It should treat Codex as an event source via hooks.

Codex state keys like `electron-avatar-overlay-open` are useful as design reference only. Do not write to Codex's `.codex-global-state.json` for this project.

## Risks / Open Questions

- Electron transparent windows on Windows can behave differently under HDR, scaling, and multiple monitors. Test 100%, 125%, and mixed DPI setups.
- `setIgnoreMouseEvents(true, { forward: true })` is essential for click-through, but interactive regions need careful toggling.
- Windows packaged app paths under `C:\Program Files\WindowsApps` are not reliable for agents, and access may be restricted.
- WSL agents may not be able to launch or inspect Windows GUI behavior directly. Prefer explicit Windows-side test instructions.
- If using Codex pet folders, confirm expected `pet.json` and sprite sheet names before hardcoding.
- Codex hooks may execute in different shells. Current Petdex hooks use POSIX-ish shell syntax, but Windows-specific hooks should be tested from Codex Desktop's actual hook execution environment.

## Useful Local Commands From Investigation

Check Petdex:

```powershell
node $HOME\.petdex\bin\petdex.js doctor
node $HOME\.petdex\bin\petdex.js hooks status
```

Inspect Codex app process:

```powershell
Get-Process | Where-Object { $_.ProcessName -match 'Codex|OpenAI|Electron' } |
  Select-Object ProcessName,Id,Path,MainWindowTitle
```

Extract Codex Electron bundle:

```powershell
npx --yes asar extract `
  'C:\Program Files\WindowsApps\OpenAI.Codex_26.519.2736.0_x64__2p2nqsd0c76g0\app\resources\app.asar' `
  $HOME\codex-asar-inspect
```

Search extracted bundle:

```powershell
rg -n "avatar-overlay|electron-avatar-overlay|alwaysOnTop|setIgnoreMouseEvents|showInactive|setVisibleOnAllWorkspaces" `
  $HOME\codex-asar-inspect\.vite\build\main-OHUH9Fwm.js
```

## Summary For Future Agents

The desired project is a Windows-native replacement for the missing Petdex desktop runtime.

Use Codex Desktop's avatar overlay implementation as the windowing model:

- separate Electron `BrowserWindow`
- `frame: false`
- `transparent: true`
- `alwaysOnTop: true`
- `skipTaskbar: true`
- `focusable: false`
- `showInactive()`
- `setIgnoreMouseEvents(true, { forward: true })`
- persisted open state and bounds
- tray keeps process alive

Use Petdex's installed hook model as the event source:

- hooks call a CLI or local HTTP endpoint
- sidecar updates the Electron renderer
- renderer changes animation state

Build the simplest Windows-only version first.
