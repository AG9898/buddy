/**
 * Unit tests for src/cli/output.ts
 *
 * Verifies:
 *   - Status/success/warning/error helpers write to the correct streams
 *   - Plain ASCII fallback when NO_COLOR is set
 *   - Styled output when FORCE_COLOR is set
 *   - Separator, heading, check, subCheck, bullet, label helpers
 *   - Banner renders the canonical Buddy logo text
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/* ── Stream capture helpers ─────────────────────────────────────────────────── */

function captureStdout(): { lines: string[]; restore: () => void } {
  const lines: string[] = []
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = (chunk: unknown) => {
    lines.push(String(chunk))
    return true
  }
  return {
    lines,
    restore: () => {
      process.stdout.write = original
    },
  }
}

function captureStderr(): { lines: string[]; restore: () => void } {
  const lines: string[] = []
  const original = process.stderr.write.bind(process.stderr)
  process.stderr.write = (chunk: unknown) => {
    lines.push(String(chunk))
    return true
  }
  return {
    lines,
    restore: () => {
      process.stderr.write = original
    },
  }
}

/* ── Tests ─────────────────────────────────────────────────────────────────── */

// We re-import the module fresh for each test block to pick up env var changes.
// Vitest caches modules; use vi.resetModules() + dynamic import to force reloads.

describe('output module — plain mode (NO_COLOR)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('NO_COLOR', '1')
    vi.stubEnv('FORCE_COLOR', '')
    vi.stubEnv('CI', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('status() writes a line to stdout without ANSI codes', async () => {
    const { status } = await import('./output.js')
    const { lines, restore } = captureStdout()
    status('Checking sidecar...')
    restore()
    expect(lines.join('')).toContain('Checking sidecar...')
    expect(lines.join('')).not.toContain('\x1b[')
  })

  it('success() writes to stdout without ANSI codes', async () => {
    const { success } = await import('./output.js')
    const { lines, restore } = captureStdout()
    success('buddy started.')
    restore()
    expect(lines.join('')).toContain('buddy started.')
    expect(lines.join('')).not.toContain('\x1b[')
  })

  it('warn() writes to stdout without ANSI codes', async () => {
    const { warn } = await import('./output.js')
    const { lines, restore } = captureStdout()
    warn('Token file not found.')
    restore()
    expect(lines.join('')).toContain('Token file not found.')
    expect(lines.join('')).not.toContain('\x1b[')
  })

  it('error() writes to stderr without ANSI codes', async () => {
    const { error } = await import('./output.js')
    const { lines, restore } = captureStderr()
    error('Something went wrong.', 'Try: buddy start')
    restore()
    const output = lines.join('')
    expect(output).toContain('Something went wrong.')
    expect(output).toContain('Try: buddy start')
    expect(output).not.toContain('\x1b[')
  })

  it('check() writes pass/fail row to stdout', async () => {
    const { check } = await import('./output.js')
    const { lines, restore } = captureStdout()
    check('Electron process running', true)
    check('Sidecar reachable', false, 'Run: buddy start')
    restore()
    const output = lines.join('')
    expect(output).toContain('Electron process running')
    expect(output).toContain('Sidecar reachable')
    expect(output).toContain('Run: buddy start')
  })

  it('subCheck() writes an indented row to stdout', async () => {
    const { subCheck } = await import('./output.js')
    const { lines, restore } = captureStdout()
    subCheck('claudeCode.UserPromptSubmit', true)
    restore()
    expect(lines.join('')).toContain('claudeCode.UserPromptSubmit')
  })

  it('bullet() writes a bullet item to stdout', async () => {
    const { bullet } = await import('./output.js')
    const { lines, restore } = captureStdout()
    bullet('pets/default')
    restore()
    expect(lines.join('')).toContain('pets/default')
  })

  it('label() writes a key:value line to stdout', async () => {
    const { label } = await import('./output.js')
    const { lines, restore } = captureStdout()
    label('State', 'running')
    restore()
    expect(lines.join('')).toContain('State')
    expect(lines.join('')).toContain('running')
  })

  it('heading() writes the title and a separator', async () => {
    const { heading } = await import('./output.js')
    const { lines, restore } = captureStdout()
    heading('buddy doctor')
    restore()
    const output = lines.join('')
    expect(output).toContain('buddy doctor')
    expect(output).toContain('─')
  })

  it('printBanner() renders the canonical Buddy logo text', async () => {
    const { printBanner } = await import('./output.js')
    const { lines, restore } = captureStdout()
    printBanner()
    restore()
    const output = lines.join('')
    // Check for key fragments of the ASCII art and subtitle
    expect(output).toContain('____')
    expect(output).toContain('Windows floating desktop pet')
  })
})

describe('output module — error() hint is optional', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('NO_COLOR', '1')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('error() without hint writes only the message line', async () => {
    const { error } = await import('./output.js')
    const { lines, restore } = captureStderr()
    error('Fatal error occurred.')
    restore()
    const output = lines.join('')
    expect(output).toContain('Fatal error occurred.')
    // Should not have an arrow hint line
    expect(output.split('\n').filter((l) => l.includes('->')).length).toBe(0)
  })
})

describe('output module — separator()', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('NO_COLOR', '1')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('separator() returns a string of dashes', async () => {
    const { separator } = await import('./output.js')
    const sep = separator()
    expect(sep).toMatch(/─+/)
    expect(sep.length).toBeGreaterThan(10)
  })
})

/* ── Output modes ───────────────────────────────────────────────────────────
   These drive the context explicitly through injected streams instead of
   patching process.stdout, so stdout/stderr separation is unambiguous.
──────────────────────────────────────────────────────────────────────────── */

interface Sink {
  out: string[]
  err: string[]
}

function sink(): Sink {
  return { out: [], err: [] }
}

type OutputModule = typeof import('./output.js')

/** Load output.js fresh and install a context writing into `s`. */
async function withContext(
  s: Sink,
  options: Partial<Parameters<OutputModule['configureOutput']>[0]> = {},
): Promise<OutputModule> {
  const mod = await import('./output.js')
  mod.configureOutput({
    stdout: { write: (chunk: string) => s.out.push(chunk) },
    stderr: { write: (chunk: string) => s.err.push(chunk) },
    ...options,
  })
  return mod
}

describe('output modes', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('NO_COLOR', '1')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('normal mode writes progress, results, and hints to stdout', async () => {
    const s = sink()
    const o = await withContext(s)
    o.status('Working...')
    o.success('Done.')
    o.hint('Try: buddy start')
    o.detail('verbose only')

    const out = s.out.join('')
    expect(out).toContain('Working...')
    expect(out).toContain('Done.')
    expect(out).toContain('Try: buddy start')
    // Verbose detail stays hidden in normal mode.
    expect(out).not.toContain('verbose only')
    expect(s.err.join('')).toBe('')
  })

  it('quiet mode suppresses progress and hints but keeps results', async () => {
    const s = sink()
    const o = await withContext(s, { mode: 'quiet' })
    o.status('Working...')
    o.heading('buddy doctor')
    o.hint('Try: buddy start')
    o.success('Done.')
    o.label('State', 'running')

    const out = s.out.join('')
    expect(out).not.toContain('Working...')
    expect(out).not.toContain('buddy doctor')
    expect(out).not.toContain('Try: buddy start')
    expect(out).toContain('Done.')
    expect(out).toContain('running')
  })

  it('quiet mode still reports errors on stderr', async () => {
    const s = sink()
    const o = await withContext(s, { mode: 'quiet' })
    o.error('Sidecar unreachable.', 'Run: buddy start')

    expect(s.out.join('')).toBe('')
    expect(s.err.join('')).toContain('Sidecar unreachable.')
    expect(s.err.join('')).toContain('Run: buddy start')
  })

  it('verbose mode reveals detail lines', async () => {
    const s = sink()
    const o = await withContext(s, { mode: 'verbose' })
    o.detail('spawning codex exec')

    expect(s.out.join('')).toContain('spawning codex exec')
  })

  it('json mode emits exactly one parseable result on stdout', async () => {
    const s = sink()
    const o = await withContext(s, { json: true })
    // Human helpers must not reach stdout in JSON mode.
    o.status('Working...')
    o.success('Done.')
    o.heading('buddy pets')
    o.renderResult({ command: 'pets.list', data: { pets: ['default'] }, summary: 'Done.' })

    expect(s.out).toHaveLength(1)
    const payload = JSON.parse(s.out[0] as string) as {
      ok: boolean
      command: string
      data: { pets: string[] }
    }
    expect(payload).toEqual({ ok: true, command: 'pets.list', data: { pets: ['default'] } })
  })

  it('json mode isolates warnings and verbose diagnostics to stderr', async () => {
    const s = sink()
    const o = await withContext(s, { json: true, mode: 'verbose' })
    o.warn('Token file missing.')
    o.detail('resolved path C:\\pets')

    expect(s.out.join('')).toBe('')
    const err = s.err.join('')
    expect(err).toContain('Token file missing.')
    expect(err).toContain('resolved path')
  })

  it('json mode renders failures as a parseable payload with the message on stderr', async () => {
    const s = sink()
    const o = await withContext(s, { json: true })
    const { CliError } = await import('./result.js')

    const exitCode = o.renderFailure(
      new CliError('Sidecar unreachable.', {
        code: 'sidecar.unreachable',
        hint: 'Run: buddy start',
        exitCode: 3,
        data: { port: 7777 },
      }),
      'state.set',
    )

    expect(exitCode).toBe(3)
    expect(s.out).toHaveLength(1)
    expect(JSON.parse(s.out[0] as string)).toEqual({
      ok: false,
      command: 'state.set',
      error: {
        code: 'sidecar.unreachable',
        message: 'Sidecar unreachable.',
        hint: 'Run: buddy start',
        data: { port: 7777 },
      },
    })
    expect(s.err.join('')).toContain('Sidecar unreachable.')
  })

  it('renderResult prints summary, details, and hint in human mode', async () => {
    const s = sink()
    const o = await withContext(s)
    o.renderResult({
      command: 'pets.show',
      data: { id: 'penguin' },
      summary: 'Selected pet: penguin',
      details: [{ label: 'Source', value: 'pets/penguin' }],
      hint: 'Run: buddy start',
    })

    const out = s.out.join('')
    expect(out).toContain('Selected pet: penguin')
    expect(out).toContain('Source')
    expect(out).toContain('pets/penguin')
    expect(out).toContain('Run: buddy start')
  })

  it('renderFailure defaults to exit code 1 for untyped errors', async () => {
    const s = sink()
    const o = await withContext(s)
    expect(o.renderFailure(new Error('boom'))).toBe(1)
    expect(s.err.join('')).toContain('boom')
    // Untyped errors still render without a stack trace in normal mode.
    expect(s.err.join('')).not.toContain('at ')
  })
})

describe('color resolution', () => {
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('styles output when color is supported (FORCE_COLOR)', async () => {
    vi.stubEnv('NO_COLOR', undefined as unknown as string)
    vi.stubEnv('FORCE_COLOR', '1')
    const s = sink()
    const o = await withContext(s)
    o.success('Done.')
    expect(s.out.join('')).toContain('\x1b[')
  })

  it('honors NO_COLOR even when stdout is a TTY', async () => {
    vi.stubEnv('NO_COLOR', '1')
    const s = sink()
    const o = await withContext(s)
    o.success('Done.')
    expect(s.out.join('')).not.toContain('\x1b[')
  })

  it('an explicit color:false override (--no-color) beats FORCE_COLOR', async () => {
    vi.stubEnv('NO_COLOR', undefined as unknown as string)
    vi.stubEnv('FORCE_COLOR', '1')
    const s = sink()
    const o = await withContext(s, { color: false })
    o.success('Done.')
    expect(s.out.join('')).not.toContain('\x1b[')
  })

  it('json mode disables color so stdout stays byte-stable', async () => {
    vi.stubEnv('NO_COLOR', undefined as unknown as string)
    vi.stubEnv('FORCE_COLOR', '1')
    const s = sink()
    const o = await withContext(s, { json: true })
    expect(o.getOutputContext().color).toBe(false)
    o.renderResult({ command: 'x', data: {} })
    expect(s.out.join('')).not.toContain('\x1b[')
  })

  it('stays plain when stdout is redirected (non-TTY, no color env)', async () => {
    vi.stubEnv('NO_COLOR', undefined as unknown as string)
    vi.stubEnv('FORCE_COLOR', undefined as unknown as string)
    vi.stubEnv('CI', undefined as unknown as string)
    const isTTY = process.stdout.isTTY
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true })
    try {
      const s = sink()
      const o = await withContext(s)
      expect(o.getOutputContext().color).toBe(false)
      o.success('Done.')
      expect(s.out.join('')).not.toContain('\x1b[')
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', { value: isTTY, configurable: true })
    }
  })

  it('styles output when stdout is an interactive TTY', async () => {
    vi.stubEnv('NO_COLOR', undefined as unknown as string)
    vi.stubEnv('FORCE_COLOR', undefined as unknown as string)
    vi.stubEnv('CI', undefined as unknown as string)
    const isTTY = process.stdout.isTTY
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    try {
      const s = sink()
      const o = await withContext(s)
      expect(o.getOutputContext().color).toBe(true)
      o.success('Done.')
      expect(s.out.join('')).toContain('\x1b[')
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', { value: isTTY, configurable: true })
    }
  })

  it('falls back to plain ASCII symbols when color is unavailable', async () => {
    vi.stubEnv('NO_COLOR', '1')
    const s = sink()
    const o = await withContext(s)
    o.success('Done.')
    o.bullet('pets/default')
    const out = s.out.join('')
    expect(out).toContain('OK')
    expect(out).not.toContain('✔')
  })
})
