#!/usr/bin/env node
/**
 * buddy CLI executable entry point.
 *
 * This module is intentionally thin: it builds the Commander program from
 * program.ts, parses process.argv, and converts thrown expected errors into a
 * concise terminal message plus a non-zero exit code. All command structure
 * lives in program.ts so tests can construct and parse the CLI without
 * consuming process.argv at import time.
 *
 * No Electron imports anywhere in src/cli/ — safe to run in WSL node.
 */

import { createProgram } from './program.js'
import { error } from './output.js'

createProgram()
  .parseAsync(process.argv)
  .catch((err: unknown) => {
    error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
