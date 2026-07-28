/**
 * version.ts — installed buddy version resolution.
 *
 * Kept separate from `program.ts` so command modules can report the version
 * without importing the Commander tree (which imports the commands themselves).
 *
 * No Electron imports anywhere in src/cli/ — safe to run in WSL node.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { resolvePackageRoot } from './runtime.js'

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))

export const FALLBACK_VERSION = '0.0.0'

/**
 * Read the buddy package version from package.json.
 *
 * The displayed version always comes from package metadata so it cannot drift
 * from package.json. This resolves correctly from both a source checkout
 * (src/cli/) and the built CommonJS bundle (out/cli/).
 */
export function resolveCliVersion(startDir: string = MODULE_DIR): string {
  try {
    const packageJsonPath = path.join(resolvePackageRoot(startDir), 'package.json')
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: unknown }
    return typeof parsed.version === 'string' && parsed.version.length > 0
      ? parsed.version
      : FALLBACK_VERSION
  } catch {
    return FALLBACK_VERSION
  }
}
