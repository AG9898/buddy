# Windows Testing Notes

This file tracks Windows-specific local build issues found while testing on a locked-down
work computer where the user does not have administrator privileges and cannot enable
Windows Developer Mode.

## Current Build Status

The app compile step succeeds:

```powershell
npm run build:app
```

The full package command currently fails in the default environment:

```powershell
npm run build
```

`electron-vite build` completes, then `electron-builder` fails during Windows packaging.

## Issue 1: electron-builder winCodeSign symlink extraction

Observed error:

```text
ERROR: Cannot create symbolic link : A required privilege is not held by the client.
... electron-builder\Cache\winCodeSign\...\darwin\10.12\lib\libcrypto.dylib
... electron-builder\Cache\winCodeSign\...\darwin\10.12\lib\libssl.dylib
```

Cause:

`electron-builder` downloads and extracts `winCodeSign-2.6.0.7z`. That archive contains
symlinks. On this Windows machine, creating symlinks requires either administrator rights
or Developer Mode, neither of which is available.

Local workaround:

```powershell
npx electron-builder --win --config.win.signAndEditExecutable=false --publish never
```

This bypasses the resource-editing/signing path that pulls in the `winCodeSign` helper.

Tradeoff:

- Good enough for local smoke builds.
- Not appropriate for release builds that need signed executables or customized executable
  metadata.
- Release packaging should run on CI or a Windows machine with symlink privileges.

Suggested code adjustment:

Add a local Windows build script that disables executable signing/resource editing:

```json
"build:win:local": "electron-vite build && electron-builder --win --config.win.signAndEditExecutable=false --publish never"
```

## Issue 2: Missing build/icon.ico

After bypassing the symlink issue, the full installer build reaches this error:

```text
cannot find specified resource "build/icon.ico"
```

Current config references `build/icon.ico` in `electron-builder.yml`:

```yaml
win:
  icon: build/icon.ico
nsis:
  installerIcon: build/icon.ico
  uninstallerIcon: build/icon.ico
```

But the repository currently has no root `build/` directory and no `build/icon.ico`.

Temporary local workaround:

```powershell
npx electron-builder --win `
  --config.win.signAndEditExecutable=false `
  --config.win.icon=null `
  --config.nsis.installerIcon=null `
  --config.nsis.uninstallerIcon=null `
  --publish never
```

This completed successfully and produced:

```text
dist\buddy Setup 0.1.0.exe
dist\win-unpacked\buddy.exe
```

Suggested code adjustment:

- Add a real `build/icon.ico`, or
- Remove the icon fields from `electron-builder.yml` until an icon exists, or
- Add a separate local build config that intentionally uses the default Electron icon.

## Issue 3: Missing default spritesheet

The renderer references:

```text
pets/default/spritesheet.webp
```

But the repo currently contains:

```text
pets/default/pet.json
```

and does not contain:

```text
pets/default/spritesheet.webp
```

Observed warning during `npm run build:app`:

```text
new URL('../../pets/default/spritesheet.webp', import.meta.url) doesn't exist at build time,
it will remain unchanged to be resolved at runtime.
```

Suggested code adjustment:

- Add the missing default spritesheet asset, or
- Change `PetSprite.svelte` to resolve packaged pet assets from a runtime-safe path, or
- Add a placeholder spritesheet for local development and tests.

## Recommended Local Test Sequence

For this locked-down Windows machine:

```powershell
npm install
npm test
npm run lint
npm run build:app
npx electron-builder --win `
  --config.win.signAndEditExecutable=false `
  --config.win.icon=null `
  --config.nsis.installerIcon=null `
  --config.nsis.uninstallerIcon=null `
  --publish never
```

Once the icon and spritesheet issues are fixed, prefer a project script instead of the
long inline `electron-builder` command.
