/**
 * Unit tests for src/cli/program.ts
 *
 * Verifies:
 *   - Bare `buddy` prints the grouped landing/help surface exactly once
 *   - `buddy --version` matches package.json
 *   - Root help groups commands by workflow and lists examples
 *   - Nested help (`buddy pets --help`, `buddy hooks install --help`) works
 *   - Typo and missing-argument errors exit non-zero with actionable messages
 *
 * These tests construct the program directly; they never parse process.argv.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CommanderError, type Command } from 'commander'
import { createProgram, resolveCliVersion } from './program.js'
import { getOutputContext, resetOutputContext, type OutputContext } from './output.js'

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
  it('shows the grouped landing surface for a bare invocation', async () => {
    const result = await run([])

    expect(result.code).toBeNull()
    expect(result.stdout).toContain('Usage: buddy')
    expect(result.stdout).toContain('App lifecycle')
    expect(result.stdout).toContain('Pet management')
    expect(result.stdout).toContain('Integrations')
    expect(result.stdout).toContain('Diagnostics')
    expect(result.stdout).toContain('Examples')
    // Help must be rendered exactly once, not doubled by a banner wrapper.
    expect(result.stdout.match(/Usage: buddy/g)).toHaveLength(1)
    expect(result.stderr).toBe('')
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
    for (const name of ['start', 'stop', 'size', 'pets', 'hatch', 'hooks', 'state', 'doctor']) {
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
