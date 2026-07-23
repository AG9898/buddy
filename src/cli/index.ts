#!/usr/bin/env node
/**
 * buddy CLI executable entry point.
 *
 * This module is intentionally thin and is the *only* place that owns terminal
 * output and `process.exitCode`. It builds the Commander program from
 * program.ts, parses process.argv, renders the typed result recorded by the
 * command that ran, and converts thrown expected errors into a concise message
 * plus a non-zero exit code.
 *
 * Command structure lives in program.ts and command outcomes are typed in
 * result.ts, so tests can construct and parse the CLI without consuming
 * process.argv or terminating the test process.
 *
 * No Electron imports anywhere in src/cli/ — safe to run in WSL node.
 */

import { createProgram } from './program.js'
import { renderFailure, renderResult } from './output.js'
import { takeCommand, takeResult } from './result.js'

async function main(): Promise<void> {
  try {
    await createProgram().parseAsync(process.argv)
    const result = takeResult()
    if (result) renderResult(result)
  } catch (err) {
    process.exitCode = renderFailure(err, takeCommand())
  }
}

void main()
