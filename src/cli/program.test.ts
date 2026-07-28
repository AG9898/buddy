/**
 * Unit tests for src/cli/program.ts
 *
 * Verifies:
 *   - Bare `buddy` records the operational overview, with the banner reserved
 *     for interactive terminals
 *   - `buddy --version` matches package.json
 *   - Root help groups commands by workflow and lists examples
 *   - Nested help (`buddy pets --help`, `buddy hooks install --help`) works
 *   - Typo and missing-argument errors exit non-zero with actionable messages
 *
 * These tests construct the program directly; they never parse process.argv.
 * The status collector is mocked so the root surface never performs real
 * sidecar or hook-configuration I/O.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommanderError, type Command } from 'commander'
import { createProgram, resolveCliVersion } from './program.js'
import { getOutputContext, resetOutputContext, type OutputContext } from './output.js'
import { takeResult, clearResult } from './result.js'

const { mockRunOverview, mockRunStatus, mockRunPetsCurrent, mockRunPetsList, mockRunPetsUse } =
  vi.hoisted(() => ({
    mockRunOverview: vi.fn(),
    mockRunStatus: vi.fn(),
    mockRunPetsCurrent: vi.fn(),
    mockRunPetsList: vi.fn(),
    mockRunPetsUse: vi.fn(),
  }))

vi.mock('./commands/status.js', () => ({
  runOverview: mockRunOverview,
  runStatus: mockRunStatus,
}))

// Pet commands read the filesystem, so routing tests use doubles instead.
vi.mock('./commands/pets.js', () => ({
  runPetsCurrent: mockRunPetsCurrent,
  runPetsList: mockRunPetsList,
  runPetsUse: mockRunPetsUse,
}))

const OVERVIEW_RESULT = {
  command: 'app.status',
  data: { version: '1.0.2', app: { running: false, visible: false } },
  summary: 'buddy is not running.',
  nextSteps: ['buddy start', 'buddy --help'],
}

const PETS_CURRENT_RESULT = {
  command: 'pets.current',
  data: { active: 'default', resolved: true, pet: null },
  summary: 'Active pet: Default.',
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

interface RunResult {
  stdout: string
  stderr: string
  code: string | null
  exitCode: number | undefined
}

/** Apply exitOverride/output capture to the whole command tree. */
function instrument(cmd: Command, write: { out: string[]; err: string[] }): void {
  cmd.exitOverride()
  cmd.configureOutput({
    writeOut: (str) => write.out.push(str),
    writeErr: (str) => write.err.push(str),
  })
  for (const sub of cmd.commands) instrument(sub, write)
}

async function run(argv: string[]): Promise<RunResult> {
  const write = { out: [] as string[], err: [] as string[] }
  const program = createProgram()
  instrument(program, write)

  let code: string | null = null
  let exitCode: number | undefined
  try {
    await program.parseAsync(argv, { from: 'user' })
  } catch (err) {
    if (!(err instanceof CommanderError)) throw err
    code = err.code
    exitCode = err.exitCode
  }

  return { stdout: write.out.join(''), stderr: write.err.join(''), code, exitCode }
}

describe('createProgram', () => {
  beforeEach(() => {
    mockRunOverview.mockReset()
    mockRunStatus.mockReset()
    mockRunOverview.mockResolvedValue(OVERVIEW_RESULT)
    mockRunStatus.mockResolvedValue({ ...OVERVIEW_RESULT, nextSteps: undefined })
    mockRunPetsCurrent.mockReset()
    mockRunPetsList.mockReset()
    mockRunPetsUse.mockReset()
    mockRunPetsCurrent.mockReturnValue(PETS_CURRENT_RESULT)
    mockRunPetsList.mockReturnValue({ command: 'pets.list', data: { pets: [] } })
    mockRunPetsUse.mockReturnValue({ command: 'pets.use', data: { applied: 'next-start' } })
    clearResult()
  })

  it('routes pets current and its show alias to the same result', async () => {
    expect((await run(['pets', 'current'])).code).toBeNull()
    expect(takeResult()).toMatchObject({ command: 'pets.current' })

    expect((await run(['pets', 'show'])).code).toBeNull()
    expect(takeResult()).toMatchObject({ command: 'pets.current' })

    expect(mockRunPetsCurrent).toHaveBeenCalledTimes(2)
  })

  afterEach(() => {
    clearResult()
  })

  it('records the operational overview for a bare invocation', async () => {
    const result = await run([])

    expect(result.code).toBeNull()
    expect(mockRunOverview).toHaveBeenCalledTimes(1)
    expect(takeResult()).toMatchObject({ command: 'app.status' })
    // The overview replaces the help dump; `--help` still owns the command list.
    expect(result.stdout).not.toContain('Usage: buddy')
    expect(result.stderr).toBe('')
  })

  it('prints the banner for a bare invocation only on an interactive terminal', async () => {
    const original = process.stdout.isTTY
    const writes: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      writes.push(String(chunk))
      return true
    })

    try {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
      await run(['--no-color'])
      expect(writes.join('')).toContain('/_____/')

      writes.length = 0
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true })
      await run(['--no-color'])
      expect(writes.join('')).not.toContain('/_____/')

      // Redirected-but-TTY-forced JSON runs must stay banner-free as well.
      writes.length = 0
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
      await run(['--json'])
      expect(writes.join('')).not.toContain('/_____/')
    } finally {
      spy.mockRestore()
      Object.defineProperty(process.stdout, 'isTTY', { value: original, configurable: true })
      resetOutputContext()
    }
  })

  it('exposes buddy status as its own diagnostics command', async () => {
    const result = await run(['status'])

    expect(result.code).toBeNull()
    expect(mockRunStatus).toHaveBeenCalledTimes(1)
    expect(takeResult()).toMatchObject({ command: 'app.status' })
  })

  it('reports the version from package.json without a duplicated literal', async () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
    ) as { version: string }

    expect(resolveCliVersion()).toBe(pkg.version)

    const result = await run(['--version'])
    expect(result.code).toBe('commander.version')
    expect(result.stdout.trim()).toBe(pkg.version)
  })

  it('groups root help by workflow with concise command summaries', async () => {
    const result = await run(['--help'])

    expect(result.code).toBe('commander.helpDisplayed')
    expect(result.stdout).toContain('App lifecycle')
    expect(result.stdout).toContain('Pet management')
    expect(result.stdout).toContain('Integrations')
    expect(result.stdout).toContain('Diagnostics')
    for (const name of ['start', 'stop', 'size', 'pets', 'hatch', 'hooks', 'state', 'status', 'doctor']) {
      expect(result.stdout).toContain(name)
    }
    expect(result.stdout).toContain('Launch the buddy pet window')
    expect(result.stdout).toContain('buddy hatch "a small orange cat"')
    expect(result.stdout.match(/Usage: buddy/g)).toHaveLength(1)
  })

  it('renders nested help for command groups and leaf commands', async () => {
    const petsHelp = await run(['pets', '--help'])
    expect(petsHelp.code).toBe('commander.helpDisplayed')
    expect(petsHelp.stdout).toContain('buddy pets')
    expect(petsHelp.stdout).toContain('list')
    expect(petsHelp.stdout).toContain('use [options] <id>')
    // `show` stays available and help marks it as an alias of `current`.
    expect(petsHelp.stdout).toContain('current|show')
    expect(petsHelp.stdout).toContain('Examples')

    const installHelp = await run(['hooks', 'install', '--help'])
    expect(installHelp.code).toBe('commander.helpDisplayed')
    expect(installHelp.stdout).toContain('buddy hooks install')
    expect(installHelp.stdout).toContain('--rc <path>')
  })

  it('prints help without a banner when stdout is not a TTY', async () => {
    const result = await run(['--help'])
    expect(result.stdout).not.toContain('/_____/')
  })

  it('rejects an unknown command with a suggestion and non-zero exit', async () => {
    const result = await run(['stat'])

    expect(result.code).toBe('commander.unknownCommand')
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain("unknown command 'stat'")
    expect(result.stderr).toContain('start')
  })

  it('rejects a missing required argument with a non-zero exit', async () => {
    const result = await run(['state'])

    expect(result.code).toBe('commander.missingArgument')
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('missing required argument')
  })

  it('rejects an unknown option on a subcommand', async () => {
    const result = await run(['size', '1.5', '--nope'])

    expect(result.code).toBe('commander.unknownOption')
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('--nope')
  })
})

describe('global output options', () => {
  beforeEach(() => {
    resetOutputContext()
  })
  afterEach(() => {
    resetOutputContext()
  })

  /** Parse argv far enough to run the preAction hook, then read the context. */
  async function contextFor(argv: string[]): Promise<OutputContext> {
    const write = { out: [] as string[], err: [] as string[] }
    const program = createProgram()
    instrument(program, write)
    // `pets` is a group command whose action only prints help — safe to invoke.
    await program.parseAsync(argv, { from: 'user' })
    return getOutputContext()
  }

  it('are inherited by nested commands in both positions', async () => {
    // Declared on the leaf command...
    expect((await contextFor(['pets', '--json'])).json).toBe(true)
    // ...and on the root, ahead of the subcommand.
    expect((await contextFor(['--json', 'pets'])).json).toBe(true)
  })

  it('resolve --quiet and --verbose into the output mode', async () => {
    expect((await contextFor(['pets'])).mode).toBe('normal')
    expect((await contextFor(['pets', '--quiet'])).mode).toBe('quiet')
    expect((await contextFor(['pets', '--verbose'])).mode).toBe('verbose')
    // A flag set on the root still wins on the subcommand.
    expect((await contextFor(['--verbose', 'pets'])).mode).toBe('verbose')
  })

  it('disables color for --no-color', async () => {
    expect((await contextFor(['pets', '--no-color'])).color).toBe(false)
    expect((await contextFor(['--no-color', 'pets'])).color).toBe(false)
  })

  it('rejects --quiet with --verbose on the same command', async () => {
    const result = await run(['pets', '--quiet', '--verbose'])

    expect(result.code).toBe('commander.conflictingOption')
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('--quiet')
    expect(result.stderr).toContain('--verbose')
  })

  it('rejects --quiet and --verbose split across the command chain', async () => {
    const result = await run(['--verbose', 'pets', '--quiet'])

    expect(result.code).toBe('commander.conflictingOption')
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('cannot be used with')
  })

  it('lists the output options in root help', async () => {
    const result = await run(['--help'])

    for (const flag of ['--verbose', '--quiet', '--json', '--no-color']) {
      expect(result.stdout).toContain(flag)
    }
  })
})
