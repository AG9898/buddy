import { describe, expect, it } from 'vitest'
import path from 'path'
import {
  buddyDataDir,
  buddyManagedPetsDir,
  buddyProcessPath,
  buddyRuntimeDir,
  buddyStatePath,
  buddyTokenPath,
} from './buddy-paths'

describe('buddy path helpers', () => {
  it('resolves the default buddy data directory from USERPROFILE', () => {
    expect(buddyDataDir({ USERPROFILE: '/Users/Ada' }, '/home/ada')).toBe(
      path.join('/Users/Ada', '.petdex-win'),
    )
  })

  it('falls back to the home directory when USERPROFILE is absent', () => {
    expect(buddyDataDir({}, '/home/ada')).toBe(path.join('/home/ada', '.petdex-win'))
  })

  it('uses BUDDY_DATA_DIR as the shared Windows or WSL data root', () => {
    expect(
      buddyDataDir(
        { USERPROFILE: '/Users/Ada', BUDDY_DATA_DIR: '/mnt/c/Users/Ada/.petdex-win' },
        '/home/ada',
      ),
    ).toBe('/mnt/c/Users/Ada/.petdex-win')
  })

  it('derives runtime, token, process, state, and pet paths under the same data root', () => {
    const env = { BUDDY_DATA_DIR: '/shared/.petdex-win' }

    expect(buddyRuntimeDir(env, '/home/ada')).toBe(path.join('/shared/.petdex-win', 'runtime'))
    expect(buddyTokenPath(env, '/home/ada')).toBe(
      path.join('/shared/.petdex-win', 'runtime', 'update-token'),
    )
    expect(buddyProcessPath(env, '/home/ada')).toBe(
      path.join('/shared/.petdex-win', 'runtime', 'process.json'),
    )
    expect(buddyStatePath(env, '/home/ada')).toBe(path.join('/shared/.petdex-win', 'state.json'))
    expect(buddyManagedPetsDir(env, '/home/ada')).toBe(path.join('/shared/.petdex-win', 'pets'))
  })
})
