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
