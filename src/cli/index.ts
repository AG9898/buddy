#!/usr/bin/env node
/**
 * buddy CLI entry point.
 *
 * Subcommands:
 *   buddy start                  — launch the Electron pet window
 *   buddy stop                   — terminate the running Electron pet window
 *   buddy hooks install [--rc]   — write Claude Code / Codex CLI hook entries
 *   buddy state <name>           — POST a state change to the running sidecar
 *   buddy doctor                 — print a pass/fail health checklist
 *
 * Environment detection (isWSL) is handled per-command.
 * No Electron imports anywhere in src/cli/ — safe to run in WSL node.
 */

import commander from 'commander'
import { runStart } from './commands/start.js'
import { runStop } from './commands/stop.js'
import { runHooksInstall } from './commands/hooks.js'
import { runState } from './commands/state.js'
import { runDoctor } from './commands/doctor.js'

const { Command } = commander

const program = new Command()

program
  .name('buddy')
  .description('Windows floating desktop pet CLI')
  .version('0.1.0')

// ── buddy start ───────────────────────────────────────────────────────────────
program
  .command('start')
  .description(
    'Launch the buddy pet window. On Windows spawns the Electron app; ' +
      'in WSL invokes buddy.exe via WSL interop.',
  )
  .action(() => {
    runStart()
  })

// ── buddy stop ────────────────────────────────────────────────────────────────
program
  .command('stop')
  .description('Terminate the running buddy pet window.')
  .action(() => {
    runStop()
  })

// ── buddy hooks ───────────────────────────────────────────────────────────────
const hooks = program.command('hooks').description('Manage buddy shell hooks.')

hooks
  .command('install')
  .description(
    'Write Claude Code and Codex CLI hook entries. ' +
      'On Windows writes to ~/.claude/settings.json; ' +
      'in WSL also appends to ~/.zshrc or ~/.bashrc.',
  )
  .option('--rc <path>', 'Path to shell rc file (overrides default ~/.zshrc / ~/.bashrc)')
  .action(function (this: commander.Command) {
    const opts = this.opts() as { rc?: string }
    runHooksInstall(opts.rc)
  })

// ── buddy state ───────────────────────────────────────────────────────────────
program
  .command('state <name>')
  .description(
    'POST a pet state change to the running sidecar. ' +
      'Valid states: idle, running, waiting, jumping, waving, failed, review.',
  )
  .action((name: string) => {
    runState(name)
  })

// ── buddy doctor ──────────────────────────────────────────────────────────────
program
  .command('doctor')
  .description(
    'Print a pass/fail checklist: process running, sidecar health, ' +
      'token file present, hooks installed.',
  )
  .action(() => {
    runDoctor().catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    })
  })

program.parse(process.argv)
