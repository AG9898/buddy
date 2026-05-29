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

export function buddyStatePath(env: BuddyPathEnv = process.env, homeDir = os.homedir()): string {
  return path.join(buddyDataDir(env, homeDir), 'state.json')
}

export function buddyManagedPetsDir(
  env: BuddyPathEnv = process.env,
  homeDir = os.homedir(),
): string {
  return path.join(buddyDataDir(env, homeDir), 'pets')
}
