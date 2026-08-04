/**
 * buddy state <name> — POST a pet state change to the running sidecar.
 *
 * Reads the update token from the token file, then POSTs {state:<name>}
 * to http://127.0.0.1:${BUDDY_PORT}/state with X-Petdex-Update-Token header.
 *
 * Works from both Windows (direct loopback) and WSL (via localhost passthrough).
 * No Electron imports in this module.
 */

import { resolveActivePetStateNames } from './pets.js'
import { CliError, commandResult, type CommandResult } from '../result.js'
import { postToSidecar } from '../sidecar-client.js'

export interface StateCommandData {
  readonly state: string
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      )
    }
    previous = current
  }

  return previous[right.length]!
}

function closestStateName(stateName: string, validStateNames: readonly string[]): string | null {
  const closest = validStateNames
    .map((name) => ({ name, distance: editDistance(stateName, name) }))
    .sort((left, right) => left.distance - right.distance)[0]

  if (!closest || closest.distance > Math.max(1, Math.ceil(stateName.length * 0.4))) return null
  return closest.name
}

/** Send a state change and return an output-mode-independent typed result. */
export async function runState(stateName: string): Promise<CommandResult<StateCommandData>> {
  const validStateNames = resolveActivePetStateNames()
  if (!validStateNames.includes(stateName)) {
    const suggestion = closestStateName(stateName, validStateNames)
    throw new CliError(`Invalid state '${stateName}'.`, {
      code: 'state.invalid',
      hint: `Valid states: ${validStateNames.join(', ')}${suggestion ? `. Did you mean '${suggestion}'?` : ''}`,
      data: { state: stateName, validStates: validStateNames, suggestion },
    })
  }

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
