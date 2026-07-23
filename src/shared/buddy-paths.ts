import os from 'os'
import path from 'path'

export const BUDDY_DATA_DIR_ENV = 'BUDDY_DATA_DIR'

export interface BuddyPathEnv {
  BUDDY_DATA_DIR?: string
  USERPROFILE?: string
}

export function buddyDataDir(env: BuddyPathEnv = process.env, homeDir = os.homedir()): string {
  const override = env.BUDDY_DATA_DIR?.trim()
  if (override) return override

  const base = env.USERPROFILE?.trim() || homeDir
  return path.join(base, '.petdex-win')
}

export function buddyRuntimeDir(env: BuddyPathEnv = process.env, homeDir = os.homedir()): string {
  return path.join(buddyDataDir(env, homeDir), 'runtime')
}

export function buddyTokenPath(env: BuddyPathEnv = process.env, homeDir = os.homedir()): string {
  return path.join(buddyRuntimeDir(env, homeDir), 'update-token')
}

/**
 * Electron-owned process identity used only for the narrow, verified stop fallback.
 * The file contains the process id plus executable and app paths, never a token.
 */
export function buddyProcessPath(env: BuddyPathEnv = process.env, homeDir = os.homedir()): string {
  return path.join(buddyRuntimeDir(env, homeDir), 'process.json')
}

export function buddyStatePath(env: BuddyPathEnv = process.env, homeDir = os.homedir()): string {
  return path.join(buddyDataDir(env, homeDir), 'state.json')
}

export function buddyManagedPetsDir(
  env: BuddyPathEnv = process.env,
  homeDir = os.homedir(),
): string {
  return path.join(buddyDataDir(env, homeDir), 'pets')
}
