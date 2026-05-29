import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveElectronAppPath, resolveElectronBin, resolvePackageRoot } from './runtime.js'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-runtime-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('runtime path helpers', () => {
  it('walks from a built CLI directory to the package root', () => {
    const root = makeTempDir()
    const cliDir = path.join(root, 'out', 'cli')
    fs.mkdirSync(cliDir, { recursive: true })
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"cli-buddy"}')

    expect(resolvePackageRoot(cliDir)).toBe(root)
    expect(resolveElectronAppPath(root)).toBe(root)
  })

  it('returns null when Electron is absent from the package root', () => {
    const root = makeTempDir()
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"cli-buddy"}')

    expect(resolveElectronBin(root)).toBeNull()
  })
})
