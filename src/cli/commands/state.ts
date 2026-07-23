/**
 * buddy state <name> — POST a pet state change to the running sidecar.
 *
 * Reads the update token from the token file, then POSTs {state:<name>}
 * to http://127.0.0.1:${BUDDY_PORT}/state with X-Petdex-Update-Token header.
 *
 * Works from both Windows (direct loopback) and WSL (via localhost passthrough).
 * No Electron imports in this module.
 */

import { commandResult, type CommandResult } from '../result.js'
import { postToSidecar } from '../sidecar-client.js'

export interface StateCommandData {
  readonly state: string
}

/** Send a state change and return an output-mode-independent typed result. */
export async function runState(stateName: string): Promise<CommandResult<StateCommandData>> {
  const response = await postToSidecar<{ ok: boolean }>('/state', { state: stateName })

  return commandResult(
    'state.set',
    { state: stateName },
    {
      summary: 'State updated.',
      details: [{ label: 'State', value: stateName }],
      verboseDetails: [`POST /state → HTTP ${response.statusCode}`],
    },
  )
}
