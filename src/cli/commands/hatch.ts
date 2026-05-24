/**
 * buddy hatch - generate custom pet assets from a text description.
 *
 * Delegates visual generation to Codex CLI so Codex owns the $imagegen route.
 * buddy keeps only the local deterministic hatch-pet packaging workflow.
 */

import { spawn, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DEFAULT_CODEX_COMMAND = 'codex'
const CODEX_COMMAND_ENV = 'BUDDY_CODEX_COMMAND'

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
  const spritesheetPath = path.join(absoluteOutputDir, 'spritesheet.webp')
  const petJsonPath = path.join(absoluteOutputDir, 'pet.json')
  const iconPath = path.join(root, 'build/icon.ico')

  return `Use the hatch-pet skill to generate buddy pet assets.

User pet concept:
${prompt}

Runtime constraints:
- Work in repository root: ${root}
- Use skill directory: ${skillDir}
- Generate visuals through Codex $imagegen. Do not call Anthropic SDKs or ask buddy for image-provider secrets.
- Keep deterministic packaging in the hatch-pet scripts.
- Use ${path.join(skillDir, 'scripts/package_for_buddy.py')} for buddy packaging.
- Use ${path.join(skillDir, 'scripts/make_icon.py')} to create the Windows icon from the canonical base image.
- Write pet assets to: ${absoluteOutputDir}
- Required final files:
  - ${spritesheetPath}
  - ${petJsonPath}
  - ${iconPath}
- Stream concise progress and stop with a clear error if any required output cannot be produced.
`
}

export async function runHatch(prompt: string, outputDir: string): Promise<void> {
  const command = codexCommand()
  const root = repoRoot()
  const skillDir = resolveSkillDir(root)
  const skillMdPath = path.join(skillDir, 'SKILL.md')

  if (!fs.existsSync(skillMdPath)) {
    throw new Error(
      `hatch-pet skill not found at ${skillMdPath}.\n` +
        'Install or sync the canonical hatch-pet skill into .codex/skills/hatch-pet before running buddy hatch.',
    )
  }

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

  const codexPrompt = buildCodexPrompt(prompt, root, skillDir, outputDir)
  const args = [
    'exec',
    '--cd',
    root,
    '--sandbox',
    'workspace-write',
    '-',
  ]

  console.log(`Hatching pet from prompt: "${prompt}"`)
  console.log(`Codex command: ${command}`)
  console.log(`Skill dir: ${skillDir}`)
  console.log(`Output dir: ${path.resolve(root, outputDir)}\n`)

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: process.platform === 'win32',
    })

    child.on('error', (error) => {
      reject(
        new Error(
          `Failed to start Codex CLI: ${error.message}\n` +
            `Set ${CODEX_COMMAND_ENV} to the full Codex executable path if needed.`,
        ),
      )
    })
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(
        new Error(
          `Codex hatch run failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}.`,
        ),
      )
    })

    child.stdin.end(codexPrompt)
  })

  console.log('\nDone.')
}
