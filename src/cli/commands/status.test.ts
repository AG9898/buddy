/**
 * Unit tests for `buddy status` and the bare-`buddy` operational overview.
 *
 * Covers the running, stopped, missing-token, and partial-hook paths plus the
 * shared human/quiet/verbose/JSON rendering modes, and asserts that no token
 * value, filesystem path, or assistant configuration reaches the output.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CliError } from '../result.js'
import { configureOutput, renderResult, resetOutputContext } from '../output.js'

const { mockGetFromSidecar, mockGetHooksStatus, mockIsWSL, mockResolveCliVersion } = vi.hoisted(
  () => ({
    mockGetFromSidecar: vi.fn(),
    mockGetHooksStatus: vi.fn(),
    mockIsWSL: vi.fn(),
    mockResolveCliVersion: vi.fn(),
  }),
)

vi.mock('../sidecar-client.js', () => ({ getFromSidecar: mockGetFromSidecar }))
vi.mock('../../main/hooks-install.js', () => ({ getHooksStatus: mockGetHooksStatus }))
vi.mock('../env.js', () => ({ isWSL: mockIsWSL }))
vi.mock('../version.js', () => ({ resolveCliVersion: mockResolveCliVersion }))

const ALL_HOOKS = {
  'claude-code:PreToolUse': true,
  'claude-code:Stop': true,
  'codex-cli:PreToolUse': true,
  'codex-cli:Stop': true,
}

const PARTIAL_HOOKS = {
  'claude-code:PreToolUse': true,
  'claude-code:Stop': true,
  'codex-cli:PreToolUse': false,
  'codex-cli:Stop': false,
}

const RUNNING_SNAPSHOT = {
  app: { running: true, visible: true },
  pet: { id: 'penguin', name: 'Penguin', source: 'packaged' },
  window: { width: 356, height: 320 },
}

/** Capture one rendered result and return everything written to stdout. */
function render(result: Parameters<typeof renderResult>[0], options = {}): string {
  const chunks: string[] = []
  configureOutput({ color: false, stdout: { write: (chunk: string) => chunks.push(chunk) }, ...options })
  renderResult(result)
  return chunks.join('')
}

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  mockIsWSL.mockReturnValue(false)
  mockResolveCliVersion.mockReturnValue('1.0.2')
  mockGetHooksStatus.mockReturnValue(ALL_HOOKS)
  resetOutputContext()
})

afterEach(() => {
  resetOutputContext()
})

describe('runStatus()', () => {
  it('reports running state, active pet, window size, and hook coverage', async () => {
    mockGetFromSidecar.mockResolvedValue({ statusCode: 200, data: RUNNING_SNAPSHOT })
    const { runStatus } = await import('./status.js')

    const result = await runStatus()

    expect(mockGetFromSidecar).toHaveBeenCalledWith('/status', expect.any(Object))
    expect(result).toMatchObject({
      command: 'app.status',
      summary: 'buddy is running.',
      data: {
        version: '1.0.2',
        environment: 'windows',
        app: { running: true, visible: true },
        pet: { id: 'penguin', name: 'Penguin', source: 'packaged' },
        window: { width: 356, height: 320 },
        hooks: { installed: 4, total: 4, coverage: 'complete' },
        sidecar: { reachable: true, error: null },
      },
    })
    // A fully healthy install needs no next-step hint.
    expect(result.hint).toBeUndefined()
  })

  it('degrades to a stopped report when the sidecar is unreachable', async () => {
    mockGetFromSidecar.mockRejectedValue(
      new CliError('Could not connect to the buddy sidecar.', { code: 'sidecar.unreachable' }),
    )
    const { runStatus } = await import('./status.js')

    const result = await runStatus()

    expect(result.data).toMatchObject({
      app: { running: false, visible: false },
      pet: null,
      window: null,
      sidecar: { reachable: false, error: 'sidecar.unreachable' },
    })
    expect(result.summary).toBe('buddy is not running.')
    expect(result.hint).toBe('Start the app: buddy start')
  })

  it('reports a missing token without exposing the token value or its path', async () => {
    const tokenPath = 'C:\\Users\\dev\\.petdex-win\\runtime\\update-token'
    mockGetFromSidecar.mockRejectedValue(
      new CliError('Update token not found.', {
        code: 'sidecar.token_missing',
        hint: `Token path: ${tokenPath}`,
        data: { tokenPath },
      }),
    )
    const { runStatus } = await import('./status.js')

    const result = await runStatus()
    const output = render(result, { mode: 'verbose' })
    const json = JSON.stringify(result.data)

    expect(result.data.sidecar).toEqual({ reachable: false, error: 'sidecar.token_missing' })
    expect(result.hint).toContain('buddy start')
    for (const text of [output, json]) {
      expect(text).not.toContain(tokenPath)
      expect(text).not.toContain('update-token')
    }
  })

  it('summarizes partial hook coverage per assistant and suggests the fix', async () => {
    mockGetFromSidecar.mockResolvedValue({ statusCode: 200, data: RUNNING_SNAPSHOT })
    mockGetHooksStatus.mockReturnValue(PARTIAL_HOOKS)
    const { runStatus } = await import('./status.js')

    const result = await runStatus()

    expect(result.data.hooks).toEqual({
      installed: 2,
      total: 4,
      coverage: 'partial',
      targets: {
        'claude-code': { installed: 2, total: 2 },
        'codex-cli': { installed: 0, total: 2 },
      },
    })
    expect(result.hint).toBe('Install the missing hooks: buddy hooks install')
    expect(render(result)).toContain('claude-code 2/2')
  })

  it('reports the WSL environment and passes it to hook detection', async () => {
    mockIsWSL.mockReturnValue(true)
    mockGetFromSidecar.mockResolvedValue({ statusCode: 200, data: RUNNING_SNAPSHOT })
    const { runStatus } = await import('./status.js')

    const result = await runStatus()

    expect(result.data.environment).toBe('wsl')
    expect(mockGetHooksStatus).toHaveBeenCalledWith(expect.objectContaining({ runtime: 'wsl' }))
  })

  it('renders through normal, quiet, verbose, JSON, and no-color modes', async () => {
    mockGetFromSidecar.mockResolvedValue({ statusCode: 200, data: RUNNING_SNAPSHOT })
    const { runStatus } = await import('./status.js')
    const result = await runStatus()

    const normal = render(result)
    expect(normal).toContain('buddy is running.')
    expect(normal).toContain('Penguin (penguin, packaged)')
    expect(normal).toContain('356x320')
    expect(normal).not.toContain('\x1b[')
    expect(normal).not.toContain('GET /status')

    const quiet = render(result, { mode: 'quiet' })
    expect(quiet).toContain('buddy is running.')

    const verbose = render(result, { mode: 'verbose' })
    expect(verbose).toContain('GET /status → ok')

    const json: string[] = []
    configureOutput({ json: true, stdout: { write: (chunk: string) => json.push(chunk) } })
    renderResult(result)
    const payload = JSON.parse(json.join('')) as { ok: boolean; command: string }
    expect(payload.ok).toBe(true)
    expect(payload.command).toBe('app.status')
    expect(json.join('')).not.toContain('buddy is running.')
  })
})

describe('runOverview()', () => {
  it('adds suggested commands while keeping the status JSON payload identical', async () => {
    mockGetFromSidecar.mockResolvedValue({ statusCode: 200, data: RUNNING_SNAPSHOT })
    const { runOverview, runStatus } = await import('./status.js')

    const overview = await runOverview()
    const status = await runStatus()

    expect(overview.command).toBe('app.status')
    expect(overview.data).toEqual(status.data)
    expect(overview.nextSteps).toEqual([
      'buddy pets list',
      'buddy size 1.5',
      'buddy stop',
      'buddy --help',
    ])

    const human = render(overview)
    expect(human).toContain('buddy stop')
    expect(human).toContain('buddy --help')

    // Suggestions are hints: dropped by --quiet and never mixed into JSON.
    expect(render(overview, { mode: 'quiet' })).not.toContain('buddy --help')

    const json: string[] = []
    configureOutput({ json: true, stdout: { write: (chunk: string) => json.push(chunk) } })
    renderResult(overview)
    expect(json.join('')).not.toContain('buddy --help')
  })

  it('suggests starting the app when it is stopped', async () => {
    mockGetFromSidecar.mockRejectedValue(
      new CliError('Could not connect to the buddy sidecar.', { code: 'sidecar.unreachable' }),
    )
    const { runOverview } = await import('./status.js')

    const overview = await runOverview()

    expect(overview.nextSteps).toEqual(['buddy start', 'buddy pets list', 'buddy --help'])
  })
})

describe('parseStatusSnapshot()', () => {
  it('accepts a complete snapshot and rejects malformed bodies', async () => {
    const { parseStatusSnapshot } = await import('./status.js')

    expect(parseStatusSnapshot(RUNNING_SNAPSHOT)).toEqual({
      running: true,
      visible: true,
      pet: { id: 'penguin', name: 'Penguin', source: 'packaged' },
      window: { width: 356, height: 320 },
    })

    for (const bad of [null, 'ok', {}, { app: {} }, { app: { running: 'yes' } }]) {
      expect(parseStatusSnapshot(bad)).toBeNull()
    }

    // Partial bodies degrade field by field instead of failing the whole read.
    expect(parseStatusSnapshot({ app: { running: true }, window: { width: 0, height: 320 } })).toEqual(
      { running: true, visible: false, pet: null, window: null },
    )
  })

  it('treats an unparseable body as an unavailable sidecar', async () => {
    mockGetFromSidecar.mockResolvedValue({ statusCode: 200, data: { unexpected: true } })
    const { runStatus } = await import('./status.js')

    const result = await runStatus()

    expect(result.data.sidecar).toEqual({ reachable: false, error: 'sidecar.invalid_response' })
    expect(result.data.app.running).toBe(false)
  })
})
