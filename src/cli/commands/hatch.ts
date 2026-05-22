/**
 * buddy hatch — generate custom pet assets from a text description.
 *
 * Calls the Anthropic API with the hatch-pet SKILL.md as system context,
 * running a tool-use agentic loop that can execute bash commands and
 * read/write files to drive the deterministic Python pipeline.
 *
 * Requires ANTHROPIC_API_KEY in the environment.
 * Image generation steps require the imagegen-adapter shim (ASSET-02).
 */

import Anthropic from '@anthropic-ai/sdk'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 8192

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'bash',
    description: 'Execute a shell command and return stdout + stderr. Timeout: 120s.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'Shell command to run' },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a file from the filesystem and return its contents.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute or relative path to the file' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file, creating parent directories as needed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute or relative path to the file' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
  },
]

function toolBash(command: string): string {
  try {
    return execSync(command, { encoding: 'utf8', timeout: 120_000 })
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string }
    return [
      err.stderr ? `STDERR:\n${err.stderr}` : '',
      err.stdout ? `STDOUT:\n${err.stdout}` : '',
      `ERROR: ${err.message ?? 'command failed'}`,
    ]
      .filter(Boolean)
      .join('\n')
  }
}

function toolReadFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch (e: unknown) {
    return `Error reading file: ${(e as Error).message}`
  }
}

function toolWriteFile(filePath: string, content: string): string {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content, 'utf8')
    return `Written: ${filePath}`
  } catch (e: unknown) {
    return `Error writing file: ${(e as Error).message}`
  }
}

function resolveSkillDir(): string {
  if (process.env.BUDDY_SKILL_DIR) return process.env.BUDDY_SKILL_DIR
  // When running from built output (out/cli/), skill dir is ../../.claude/skills/hatch-pet
  const fromBuild = path.resolve(__dirname, '../../.claude/skills/hatch-pet')
  if (fs.existsSync(fromBuild)) return fromBuild
  // Fallback: resolve from git root
  try {
    const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim()
    return path.join(root, '.claude/skills/hatch-pet')
  } catch {
    return path.resolve('.claude/skills/hatch-pet')
  }
}

function buildSystemPrompt(skillDir: string, outputDir: string): string {
  const skillMdPath = path.join(skillDir, 'SKILL.md')
  if (!fs.existsSync(skillMdPath)) {
    throw new Error(`SKILL.md not found at ${skillMdPath}`)
  }
  const skillMd = fs.readFileSync(skillMdPath, 'utf8')

  const repoRoot = (() => {
    try {
      return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim()
    } catch {
      return process.cwd()
    }
  })()

  return `${skillMd}

## Buddy Runtime Context

- SKILL_DIR: ${skillDir}
- REPO_ROOT: ${repoRoot}
- Output spritesheet: ${path.resolve(repoRoot, outputDir, 'spritesheet.webp')}
- Output pet.json: ${path.resolve(repoRoot, outputDir, 'pet.json')}
- Output icon: ${path.resolve(repoRoot, 'build/icon.ico')}
- Working directory: ${process.cwd()}

Use package_for_buddy.py (not the shell+jq Codex block) when packaging.
Use make_icon.py to produce build/icon.ico from the canonical base image.
$imagegen is not available in this runtime — the imagegen-adapter shim must be installed (ASSET-02) for image generation steps to work.`
}

export async function runHatch(prompt: string, outputDir: string): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is not set.')
    process.exit(1)
  }

  const client = new Anthropic({ apiKey })
  const skillDir = resolveSkillDir()

  let systemPrompt: string
  try {
    systemPrompt = buildSystemPrompt(skillDir, outputDir)
  } catch (e: unknown) {
    console.error((e as Error).message)
    process.exit(1)
  }

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }]

  console.log(`Hatching pet from prompt: "${prompt}"`)
  console.log(`Skill dir: ${skillDir}\n`)

  // Agentic tool-use loop
  for (;;) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      tools: TOOLS,
      messages,
    })

    for (const block of response.content) {
      if (block.type === 'text' && block.text) {
        process.stdout.write(block.text)
      }
    }

    if (response.stop_reason === 'end_turn') break
    if (response.stop_reason !== 'tool_use') break

    const toolUseBlocks = response.content.filter(
      (b: Anthropic.ContentBlock): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    )
    if (toolUseBlocks.length === 0) break

    messages.push({ role: 'assistant', content: response.content })

    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const block of toolUseBlocks) {
      const input = block.input as Record<string, string>
      let result: string

      switch (block.name) {
        case 'bash':
          console.log(`\n$ ${input.command}`)
          result = toolBash(input.command)
          if (result) console.log(result.slice(0, 500))
          break
        case 'read_file':
          result = toolReadFile(input.path)
          break
        case 'write_file':
          result = toolWriteFile(input.path, input.content)
          console.log(`\n${result}`)
          break
        default:
          result = `Unknown tool: ${block.name}`
      }

      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result })
    }

    messages.push({ role: 'user', content: toolResults })
  }

  console.log('\n\nDone.')
}
