/**
 * Runtime path helpers for the CLI-launched Electron app.
 *
 * These helpers must work from both source checkouts and installed npm packages.
 * They intentionally avoid importing Electron APIs; the CLI only needs the
 * Electron executable path and the package root to launch the app.
 */

import fs from 'fs'
import path from 'path'

export function resolvePackageRoot(startDir = __dirname): string {
  let dir = startDir

  for (let i = 0; i < 8; i++) {
    const packageJsonPath = path.join(dir, 'package.json')
    if (fs.existsSync(packageJsonPath)) {
      return dir
    }

    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  return startDir
}

export function resolveElectronAppPath(packageRoot = resolvePackageRoot()): string {
  return packageRoot
}

export function resolveElectronBin(packageRoot = resolvePackageRoot()): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electronModulePath = require.resolve('electron', { paths: [packageRoot] })
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electronPath = require(electronModulePath) as unknown
    return typeof electronPath === 'string' && electronPath.length > 0 ? electronPath : null
  } catch {
    return null
  }
}
