/**
 * program.ts — Commander program construction for the buddy CLI.
 *
 * This module builds the command tree but never reads `process.argv` and never
 * exits the process. `src/cli/index.ts` is the thin executable boundary that
 * parses argv and turns thrown errors into terminal output plus an exit code.
 * Tests import `createProgram()` and parse explicit argument arrays instead.
 *
 * No Electron imports anywhere in src/cli/ — safe to run in WSL node.
 */

import { Command, Help, Option, type Command as CommandType } from 'commander'
import { runStart } from './commands/start.js'
import { runStop } from './commands/stop.js'
import { runHooksInstall, runHooksStatus, runHooksUninstall } from './commands/hooks.js'
import { runState } from './commands/state.js'
import { runDoctor } from './commands/doctor.js'
import {
  buddyManagedPetOutputDir,
  packagedPresetOutputDir,
  petIdFromPrompt,
  runHatch,
  validatePetId,
} from './commands/hatch.js'
import { runPetsCurrent, runPetsList, runPetsUse } from './commands/pets.js'
import { runSize } from './commands/size.js'
import { runOverview, runStatus } from './commands/status.js'
import {
  bannerText,
  bold,
  configureOutput,
  dim,
  getOutputContext,
  orange,
  printBanner,
  type OutputContextOptions,
} from './output.js'
import { recordCommand, recordResult } from './result.js'
import { resolveCliVersion } from './version.js'

// Re-exported so callers and tests keep one import site for the CLI surface.
export { resolveCliVersion }

/* ── Command groups ──────────────────────────────────────────────────────────
   Root help lists commands by workflow instead of one flat alphabetical block.
───────────────────────────────────────────────────────────────────────────── */

interface CommandGroup {
  title: string
  commands: readonly string[]
}

const COMMAND_GROUPS: readonly CommandGroup[] = [
  { title: 'App lifecycle', commands: ['start', 'stop', 'size'] },
  { title: 'Pet management', commands: ['pets', 'hatch'] },
  { title: 'Integrations', commands: ['hooks', 'state'] },
  { title: 'Diagnostics', commands: ['status', 'doctor'] },
]

const ROOT_EXAMPLES = [
  'buddy start',
  'buddy status',
  'buddy pets use penguin',
  'buddy hatch "a small orange cat"',
  'buddy size 1.5',
  'buddy doctor',
]

/* ── Help rendering ──────────────────────────────────────────────────────── */

function heading(title: string): string {
  return bold(orange(title))
}

function renderRows(
  rows: ReadonlyArray<[string, string]>,
  width = rows.reduce((max, [term]) => Math.max(max, term.length), 0),
  indent = '  ',
): string[] {
  return rows.map(([term, description]) =>
    description ? `${indent}${term.padEnd(width)}  ${description}` : `${indent}${term}`,
  )
}

/**
 * Grouped root help: usage, description, options, workflow-grouped commands,
 * and examples. Subcommands keep Commander's default help layout.
 */
function formatRootHelp(cmd: CommandType, helper: Help): string {
  const lines: string[] = []

  lines.push(`${heading('Usage')}: ${helper.commandUsage(cmd)}`, '')

  const description = helper.commandDescription(cmd)
  if (description) lines.push(description, '')

  const optionRows = helper
    .visibleOptions(cmd)
    .map((option): [string, string] => [helper.optionTerm(option), helper.optionDescription(option)])
  if (optionRows.length > 0) {
    lines.push(heading('Options'), ...renderRows(optionRows), '')
  }

  const visible = helper.visibleCommands(cmd)
  const byName = new Map(visible.map((sub) => [sub.name(), sub]))
  const grouped = new Set<string>()
  // One shared column width so every group stays aligned with the others.
  const commandWidth = visible.reduce(
    (max, sub) => Math.max(max, helper.subcommandTerm(sub).length),
    0,
  )

  for (const group of COMMAND_GROUPS) {
    const rows = group.commands
      .map((name) => byName.get(name))
      .filter((sub): sub is CommandType => sub !== undefined)
      .map((sub): [string, string] => {
        grouped.add(sub.name())
        return [helper.subcommandTerm(sub), helper.subcommandDescription(sub)]
      })
    if (rows.length > 0) {
      lines.push(heading(group.title), ...renderRows(rows, commandWidth), '')
    }
  }

  const ungrouped = visible
    .filter((sub) => !grouped.has(sub.name()))
    .map((sub): [string, string] => [helper.subcommandTerm(sub), helper.subcommandDescription(sub)])
  if (ungrouped.length > 0) {
    lines.push(heading('Other'), ...renderRows(ungrouped, commandWidth), '')
  }

  lines.push(heading('Examples'), ...ROOT_EXAMPLES.map((example) => `  ${dim(example)}`), '')

  return lines.join('\n')
}

function examples(...lines: string[]): string {
  return [`\n${heading('Examples')}`, ...lines.map((line) => `  ${dim(line)}`)].join('\n')
}

/**
 * Report an unmatched first argument as an unknown command.
 * Prefers Commander's own reporter so "did you mean" suggestions are preserved.
 */
function failUnknownCommand(program: CommandType): void {
  const internal = program as unknown as { unknownCommand?: () => void }
  if (typeof internal.unknownCommand === 'function') {
    internal.unknownCommand()
    return
  }
  program.error(`error: unknown command '${program.args[0] ?? ''}'`, {
    code: 'commander.unknownCommand',
  })
}

/* ── Global output options ───────────────────────────────────────────────────
   Commander does not parse ancestor options on subcommands, so the four output
   flags are registered on every command in the tree. That makes both
   `buddy --json pets list` and `buddy pets list --json` valid.
───────────────────────────────────────────────────────────────────────────── */

/** Register `--verbose`, `--quiet`, `--json`, and `--no-color` on one command. */
function addGlobalOutputOptions(cmd: CommandType): void {
  cmd
    .addOption(
      new Option(
        '--verbose',
        'Show subprocess, path, and diagnostic detail (also BUDDY_LOG_LEVEL=debug)',
      ).conflicts('quiet'),
    )
    .addOption(
      new Option('--quiet', 'Suppress progress and hints; keep results and errors').conflicts(
        'verbose',
      ),
    )
    .addOption(new Option('--json', 'Emit one JSON result on stdout; diagnostics on stderr'))
    .addOption(new Option('--no-color', 'Disable ANSI styling (same as NO_COLOR)'))
}

/** Apply the global output options to a command and all of its descendants. */
function addGlobalOutputOptionsDeep(cmd: CommandType): void {
  addGlobalOutputOptions(cmd)
  for (const sub of cmd.commands) addGlobalOutputOptionsDeep(sub)
}

/** The command plus each of its ancestors, leaf first. */
function commandChain(cmd: CommandType): CommandType[] {
  const chain: CommandType[] = []
  for (let current: CommandType | null = cmd; current; current = current.parent) {
    chain.push(current)
  }
  return chain
}

/**
 * Resolve the effective output options for an invocation.
 *
 * Only values Commander recorded from the command line count, so a flag set
 * anywhere in the chain wins over every command's inert default. This avoids
 * `optsWithGlobals()`, where ancestor defaults would overwrite a flag passed on
 * the subcommand itself.
 */
function resolveOutputOptions(cmd: CommandType): OutputContextOptions {
  let verbose = false
  let quiet = false
  let json = false
  let noColor = false

  for (const current of commandChain(cmd)) {
    const fromCli = (key: string): boolean => current.getOptionValueSource(key) === 'cli'
    if (fromCli('verbose')) verbose = true
    if (fromCli('quiet')) quiet = true
    if (fromCli('json')) json = true
    // `--no-color` is the only way `color` is set from the command line.
    if (fromCli('color')) noColor = true
  }

  // Commander's own .conflicts() only covers a single command; this catches the
  // split form, e.g. `buddy --verbose pets list --quiet`.
  if (verbose && quiet) {
    cmd.error("error: option '--quiet' cannot be used with option '--verbose'", {
      code: 'commander.conflictingOption',
    })
  }

  const mode = verbose ? 'verbose' : quiet ? 'quiet' : 'normal'
  return noColor ? { mode, json, color: false } : { mode, json }
}

/* ── Program construction ────────────────────────────────────────────────── */

/**
 * Build the buddy Commander program.
 *
 * The returned program is not parsed and does not touch `process.argv`;
 * callers decide what to parse and how to handle errors.
 */
export function createProgram(): CommandType {
  const program = new Command()

  program
    .name('buddy')
    .description('Windows floating desktop pet CLI')
    .version(resolveCliVersion(), '-V, --version', 'Print the installed buddy version')
    .showSuggestionAfterError(true)
    .configureHelp({
      formatHelp(cmd, helper) {
        return cmd === program
          ? formatRootHelp(cmd, helper)
          : Help.prototype.formatHelp.call(helper, cmd, helper)
      },
    })

  // Banner on the root help surface only, and only for interactive terminals so
  // redirected output and CI stay deterministic. Nested help stays compact.
  program.addHelpText('before', () => (process.stdout.isTTY === true ? bannerText() : ''))

  // Bare `buddy` is the operational overview: banner (interactive terminals
  // only) plus the same result `buddy status` produces, with suggested next
  // commands. Redirected and `--json` runs stay compact and deterministic.
  // A root action handler means Commander no longer rejects unmatched args on
  // its own, so unknown commands are reported explicitly here.
  program.action(async () => {
    if (program.args.length > 0) {
      failUnknownCommand(program)
      return
    }
    recordCommand('app.status')
    if (process.stdout.isTTY === true) printBanner()
    recordResult(await runOverview())
  })

  // ── buddy start ─────────────────────────────────────────────────────────────
  program
    .command('start')
    .description('Launch the buddy pet window')
    .addHelpText(
      'after',
      examples('buddy start', '# In WSL, start invokes the Windows app through WSL interop'),
    )
    .action(async () => {
      recordCommand('app.start')
      recordResult(await runStart())
    })

  // ── buddy stop ──────────────────────────────────────────────────────────────
  program
    .command('stop')
    .description('Stop the running buddy pet window')
    .action(async () => {
      recordCommand('app.stop')
      recordResult(await runStop())
    })

  // ── buddy size ──────────────────────────────────────────────────────────────
  program
    .command('size <scale-or-width>')
    .description('Resize the pet window by scale factor or explicit WxH')
    .addHelpText('after', examples('buddy size 1.5', 'buddy size 2x', 'buddy size 400x300'))
    .action(async (sizeArg: string) => {
      recordCommand('size.set')
      recordResult(await runSize(sizeArg))
    })

  // ── buddy pets ──────────────────────────────────────────────────────────────
  const pets = program
    .command('pets')
    .description('List and select pets')
    .addHelpText(
      'after',
      examples('buddy pets list', 'buddy pets current', 'buddy pets use penguin'),
    )
    .action(() => {
      pets.outputHelp()
    })

  pets
    .command('list')
    .description('List buddy-managed, packaged, and Codex-compatible pets')
    .action(() => {
      recordCommand('pets.list')
      recordResult(runPetsList())
    })

  // `show` is the original name, kept as a Commander alias so both spellings
  // run the same implementation and help renders `current|show`.
  pets
    .command('current')
    .alias('show')
    .description('Print the selected pet and its source path')
    .action(() => {
      recordCommand('pets.current')
      recordResult(runPetsCurrent())
    })

  pets
    .command('use <id>')
    .description('Validate and persist a pet selection')
    .action(async (id: string) => {
      recordCommand('pets.use')
      recordResult(await runPetsUse(id))
    })

  // ── buddy hatch ─────────────────────────────────────────────────────────────
  program
    .command('hatch <prompt>')
    .description('Generate a custom pet from a text description')
    .option('--id <id>', 'Name the buddy-managed pet (default: derived from the prompt)')
    .option('--output <dir>', 'Explicit output directory for pet.json and the spritesheet')
    .option('--package-preset <id>', 'Maintainer-only: write to this checkout’s pets/<id> preset')
    .addHelpText(
      'after',
      examples(
        'buddy hatch "a small orange cat"',
        'buddy hatch "a small orange cat" --id marmalade',
        'buddy hatch "a small orange cat" --output C:\\art\\my-cat',
      ),
    )
    .action(
      async (
        prompt: string,
        options: { output?: string; id?: string; packagePreset?: string },
      ) => {
        if (options.output && options.id) {
          throw new Error(
            'Use either --output or --id; --id names only the default buddy-managed destination.',
          )
        }
        if (options.output && options.packagePreset) {
          throw new Error('Use either --output or --package-preset, not both.')
        }
        if (options.id && options.packagePreset) {
          throw new Error('Use either --id or --package-preset, not both.')
        }

        const outputDir = options.output
          ? options.output
          : options.packagePreset
            ? packagedPresetOutputDir(options.packagePreset)
            : buddyManagedPetOutputDir(
                options.id ? validatePetId(options.id) : petIdFromPrompt(prompt),
              )

        // Verbosity now comes from the global --verbose flag resolved into the
        // shared output context, so hatch keeps no command-specific debug flag.
        await runHatch(prompt, outputDir, getOutputContext().mode === 'verbose')
      },
    )

  // ── buddy hooks ─────────────────────────────────────────────────────────────
  const hooks = program
    .command('hooks')
    .description('Manage Claude Code and Codex CLI hooks')
    .addHelpText(
      'after',
      examples('buddy hooks install', 'buddy hooks status', 'buddy hooks uninstall'),
    )
    .action(() => {
      hooks.outputHelp()
    })

  hooks
    .command('install')
    .description('Write Claude Code and Codex CLI hook entries')
    .option('--rc <path>', 'Deprecated; retained for older scripts and ignored')
    .action(function (this: CommandType) {
      const opts = this.opts() as { rc?: string }
      recordCommand('hooks.install')
      recordResult(runHooksInstall(opts.rc))
    })

  hooks
    .command('status')
    .description('Report hook coverage per assistant and event (read-only)')
    .action(() => {
      recordCommand('hooks.status')
      recordResult(runHooksStatus())
    })

  // Destructive, so it only ever runs on this explicit invocation — `doctor`
  // and `hooks status` never remove anything.
  hooks
    .command('uninstall')
    .description('Remove only the hook entries buddy owns')
    .action(() => {
      recordCommand('hooks.uninstall')
      recordResult(runHooksUninstall())
    })

  // ── buddy state ─────────────────────────────────────────────────────────────
  program
    .command('state <name>')
    .description('Send a pet state change to the running app')
    .addHelpText(
      'after',
      examples(
        'buddy state running',
        '# States: idle, running, waiting, jumping, waving, failed, review',
      ),
    )
    .action(async (name: string) => {
      recordCommand('state.set')
      recordResult(await runState(name))
    })

  // ── buddy status ────────────────────────────────────────────────────────────
  program
    .command('status')
    .description('Print app state, active pet, window size, and hook coverage')
    .addHelpText('after', examples('buddy status', 'buddy status --json'))
    .action(async () => {
      recordCommand('app.status')
      recordResult(await runStatus())
    })

  // ── buddy doctor ────────────────────────────────────────────────────────────
  program
    .command('doctor')
    .description('Check process, sidecar, token, and hook health')
    .addHelpText('after', examples('buddy doctor', 'buddy doctor --json'))
    .action(async () => {
      recordCommand('app.doctor')
      recordResult(await runDoctor())
    })

  // Global output flags are added last so they appear on every command, then
  // resolved once per invocation before any action handler runs.
  addGlobalOutputOptionsDeep(program)
  program.hook('preAction', (_thisCommand, actionCommand) => {
    configureOutput(resolveOutputOptions(actionCommand))
  })

  return program
}
