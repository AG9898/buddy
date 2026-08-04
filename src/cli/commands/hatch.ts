/**
 * buddy hatch - generate custom pet assets from a text description.
 *
 * Delegates visual generation to Codex CLI so Codex owns the $imagegen route.
 * buddy keeps only the local deterministic hatch-pet packaging workflow.
 *
 * Normal mode shows concise progress via the shared output layer.
 * Pass --verbose (or set BUDDY_LOG_LEVEL=debug) to see raw subprocess output.
 */

import { spawn, spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createInterface } from 'readline/promises'
import { fileURLToPath } from 'url'
import { buddyManagedPetsDir } from '../../shared/buddy-paths.js'
import {
  getOutputContext,
  stage,
  startProgressSpinner,
  verboseRaw,
} from '../output.js'
import { commandResult, type CommandResult } from '../result.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DEFAULT_CODEX_COMMAND = 'codex'
const CODEX_COMMAND_ENV = 'BUDDY_CODEX_COMMAND'
const PET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/
const HATCH_RUN_DIR = '.hatch-run'

function isVerbose(): boolean {
  return (
    process.env['BUDDY_LOG_LEVEL']?.toLowerCase() === 'debug' ||
    process.env['BUDDY_VERBOSE'] === '1'
  )
}

function repoRoot(): string {
  try {
    const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      shell: process.platform === 'win32',
    })
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim()
  } catch {
    // Fall through to process cwd.
  }
  return process.cwd()
}

/** Turn a hatch description into a stable folder-safe id. */
export function petIdFromPrompt(prompt: string): string {
  const normalized = prompt
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')

  return normalized || 'custom-pet'
}

/** Validate user-controlled pet ids before using them as a directory segment. */
export function validatePetId(id: string): string {
  const normalized = id.trim().toLowerCase()
  if (!PET_ID_PATTERN.test(normalized)) {
    throw new Error(
      'Pet id must be 1–48 lowercase letters, numbers, or hyphens, and must start with a letter or number.',
    )
  }
  return normalized
}

/** Default destination for a user-created pet. */
export function buddyManagedPetOutputDir(id: string): string {
  return path.join(buddyManagedPetsDir(process.env, os.homedir()), validatePetId(id))
}

/** Explicit maintainer-only destination for updating a bundled preset in a source checkout. */
export function packagedPresetOutputDir(id: string): string {
  return path.join(repoRoot(), 'pets', validatePetId(id))
}

function resolveSkillDir(root: string): string {
  if (process.env.BUDDY_SKILL_DIR) return process.env.BUDDY_SKILL_DIR

  const fromRoot = path.join(root, '.codex/skills/hatch-pet')
  if (fs.existsSync(path.join(fromRoot, 'SKILL.md'))) return fromRoot

  const fromBuild = path.resolve(__dirname, '../../.codex/skills/hatch-pet')
  if (fs.existsSync(path.join(fromBuild, 'SKILL.md'))) return fromBuild

  return fromRoot
}

function codexCommand(): string {
  return process.env[CODEX_COMMAND_ENV]?.trim() || DEFAULT_CODEX_COMMAND
}

function runCodexCheck(command: string, args: string[], failureMessage: string): void {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })

  if (result.status === 0) return

  const detail = [result.stderr, result.stdout, result.error?.message].filter(Boolean).join('\n')
  throw new Error(
    `${failureMessage}\n\n` +
      `Checked command: ${command} ${args.join(' ')}\n` +
      `Set ${CODEX_COMMAND_ENV} to the full Codex executable path if it is installed under a non-standard name.\n` +
      `Run "codex login" or "codex doctor" to repair Codex authentication if needed.` +
      (detail ? `\n\nCodex output:\n${detail.trim()}` : ''),
  )
}

function buildCodexPrompt(prompt: string, root: string, skillDir: string, outputDir: string): string {
  const absoluteOutputDir = path.resolve(root, outputDir)
  const runDir = path.join(absoluteOutputDir, HATCH_RUN_DIR)
  const spritesheetPath = path.join(absoluteOutputDir, 'spritesheet.webp')
  const petJsonPath = path.join(absoluteOutputDir, 'pet.json')

  return `Use the hatch-pet skill to generate buddy pet assets.

User pet concept:
${prompt}

Runtime constraints:
- Work in repository root: ${root}
- Use skill directory: ${skillDir}
- Generate visuals through Codex $imagegen. Do not call Anthropic SDKs or ask buddy for image-provider secrets.
- Keep deterministic packaging in the hatch-pet scripts.
- Use ${path.join(skillDir, 'scripts/package_for_buddy.py')} for buddy packaging.
- Use ${runDir} as the hatch-pet run directory. Keep intermediate artifacts there and package final pet assets into ${absoluteOutputDir}.
- Write pet assets to: ${absoluteOutputDir}
- Required final files:
  - ${spritesheetPath}
  - ${petJsonPath}
- Stream concise progress and stop with a clear error if any required output cannot be produced.
`
}

function destinationHasContent(outputDir: string): boolean {
  if (!fs.existsSync(outputDir)) return false

  try {
    return fs.readdirSync(outputDir).length > 0
  } catch {
    // An unreadable path could contain assets, so never risk overwriting it.
    return true
  }
}

async function confirmDestination(outputDir: string, yes: boolean): Promise<void> {
  if (!destinationHasContent(outputDir) || yes) return

  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    throw new Error(
      `Destination already contains content: ${outputDir}\n` +
        'Use --yes to replace it in a non-interactive run.',
    )
  }

  const prompt = createInterface({ input: process.stdin, output: process.stderr })
  try {
    const answer = await prompt.question(
      `Destination already contains content: ${outputDir}\nReplace it? [y/N] `,
    )
    if (!/^y(?:es)?$/i.test(answer.trim())) {
      throw new Error('Hatch cancelled; existing destination content was left unchanged.')
    }
  } finally {
    prompt.close()
  }
}

function cleanupInterruptedRun(skillDir: string, outputDir: string): void {
  const result = spawnSync(
    'python',
    [
      path.join(skillDir, 'scripts', 'cleanup_run.py'),
      '--run-dir',
      path.join(outputDir, HATCH_RUN_DIR),
      '--interrupted',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      shell: process.platform === 'win32',
    },
  )

  if (result.status !== 0) {
    verboseRaw(`Hatch cancellation cleanup could not complete: ${result.stderr || result.stdout}`)
  }
}

/**
 * Derive a short pet id from the output directory path.
 * e.g. "pets/my-cat" -> "my-cat"
 */
function petIdFromOutputDir(outputDir: string): string {
  return path.basename(outputDir)
}

export interface HatchCommandData {
  readonly pet: {
    readonly id: string
    readonly outputDir: string
  }
  readonly elapsedMs: number
}

export async function runHatch(
  prompt: string,
  outputDir: string,
  verbose = false,
  yes = false,
): Promise<CommandResult<HatchCommandData>> {
  const startedAt = Date.now()
  const output = getOutputContext()
  const verboseMode = (verbose || isVerbose()) && output.mode !== 'quiet'
  const command = codexCommand()
  const root = repoRoot()
  const skillDir = resolveSkillDir(root)
  const skillMdPath = path.join(skillDir, 'SKILL.md')
  const absoluteOutputDir = path.resolve(root, outputDir)

  stage(1, 5, 'Checking requirements', startedAt)
  if (!fs.existsSync(skillMdPath)) {
    throw new Error(
      `hatch-pet skill not found at ${skillMdPath}.\n` +
        'Install or sync the canonical hatch-pet skill into .codex/skills/hatch-pet before running buddy hatch.',
    )
  }

  // This runs before any Codex process is checked or launched, preserving existing assets.
  await confirmDestination(absoluteOutputDir, yes)

  runCodexCheck(
    command,
    ['--version'],
    'Codex CLI is not available for buddy hatch.',
  )

  runCodexCheck(
    command,
    ['doctor', '--summary', '--ascii'],
    'Codex CLI is installed but not ready for buddy hatch.',
  )

  stage(2, 5, 'Confirming concept and destination', startedAt)
  stage(3, 5, 'Generating visual assets with Codex', startedAt)

  const codexPrompt = buildCodexPrompt(prompt, root, skillDir, outputDir)
  const args = [
    'exec',
    '--cd',
    root,
    '--sandbox',
    'workspace-write',
    '-',
  ]

  let codexOutput = ''

  const spinner = startProgressSpinner('Generating visual assets with Codex', startedAt)
  let generated = false
  let interrupted = false
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: root,
        stdio: [
          'pipe',
          verboseMode && !output.json ? 'inherit' : 'pipe',
          verboseMode && !output.json ? 'inherit' : 'pipe',
        ],
        shell: process.platform === 'win32',
      })
      const onInterrupt = () => {
        interrupted = true
        child.kill('SIGTERM')
      }
      const removeInterruptHandler = () => process.off('SIGINT', onInterrupt)

      process.once('SIGINT', onInterrupt)

      if (verboseMode && output.json) {
        // JSON reserves stdout for its one final payload; verbose child detail is diagnostic stderr.
        child.stdout?.on('data', (chunk: Buffer) => verboseRaw(chunk.toString()))
        child.stderr?.on('data', (chunk: Buffer) => verboseRaw(chunk.toString()))
      } else if (!verboseMode) {
        // Capture output silently — available for error reporting.
        child.stdout?.on('data', (chunk: Buffer) => {
          codexOutput += chunk.toString()
        })
        child.stderr?.on('data', (chunk: Buffer) => {
          codexOutput += chunk.toString()
        })
      }

      child.on('error', (err) => {
        removeInterruptHandler()
        reject(
          new Error(
            `Failed to start Codex CLI: ${err.message}\n` +
              `Set ${CODEX_COMMAND_ENV} to the full Codex executable path if needed.`,
          ),
        )
      })
      child.on('exit', (code, signal) => {
        removeInterruptHandler()
        if (interrupted) {
          reject(new Error('Hatch cancelled.'))
          return
        }
        if (code === 0) {
          resolve()
          return
        }
        const detail = codexOutput.trim()
        const suffix = detail
          ? `\n\nCodex output:\n${detail}`
          : verboseMode
            ? ''
            : '\n\nRe-run with --verbose to see subprocess output.'
        reject(
          new Error(
            `Codex hatch run failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}.${suffix}`,
          ),
        )
      })

      child.stdin?.end(codexPrompt)
    })
    generated = true
  } catch (error) {
    if (interrupted) cleanupInterruptedRun(skillDir, absoluteOutputDir)
    throw error
  } finally {
    spinner.stop(generated ? 'complete' : 'failed')
  }

  stage(4, 5, 'Validating packaged assets', startedAt)

  const spritesheetPath = path.join(absoluteOutputDir, 'spritesheet.webp')
  const petJsonPath = path.join(absoluteOutputDir, 'pet.json')

  const spritesheetOk = fs.existsSync(spritesheetPath)
  const petJsonOk = fs.existsSync(petJsonPath)

  if (!spritesheetOk || !petJsonOk) {
    const missing = [
      !spritesheetOk && spritesheetPath,
      !petJsonOk && petJsonPath,
    ].filter(Boolean).join(', ')
    throw new Error(
      `Hatch packaging incomplete — required files missing: ${missing}\n` +
        'The Codex run completed but did not produce all expected output files.',
    )
  }

  const petId = petIdFromOutputDir(outputDir)
  stage(5, 5, 'Finalizing your pet', startedAt)

  const relativeToManagedPets = path.relative(
    buddyManagedPetsDir(process.env, os.homedir()),
    absoluteOutputDir,
  )
  const isBuddyManagedPet =
    relativeToManagedPets !== '' &&
    !relativeToManagedPets.startsWith('..') &&
    !path.isAbsolute(relativeToManagedPets)

  const hint = isBuddyManagedPet
    ? `Activate it: buddy pets use ${petId}`
    : outputDir !== 'pets/default'
      ? `Move it to a buddy-managed pets directory, then run: buddy pets use ${petId}`
      : 'Assets were written to the default pet slot; restart buddy to see changes.'

  return commandResult(
    'pets.hatch',
    { pet: { id: petId, outputDir: absoluteOutputDir }, elapsedMs: Date.now() - startedAt },
    {
      summary: 'Pet hatched successfully.',
      details: [
        { label: 'Pet id', value: petId },
        { label: 'Assets', value: absoluteOutputDir },
      ],
      hint,
      verboseDetails: [
        `Concept: ${prompt}`,
        `Codex command: ${command}`,
        `Skill dir: ${skillDir}`,
      ],
    },
  )
}
