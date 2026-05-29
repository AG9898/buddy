/**
 * buddy hooks install — write Claude Code and/or Codex CLI hook entries.
 *
 * On Windows: installs hooks that call `buddy state <name>`.
 * In WSL: installs hooks that call `petdex-bridge state <name>`.
 *
 * No Electron imports in this module.
 */

import { installHooks, type HookInstallResult } from '../../main/hooks-install.js'
import { isWSL } from '../env.js'

export function runHooksInstall(shellRcPath?: string): void {
  const inWSL = isWSL()

  const result: HookInstallResult = installHooks({
    claudeCode: true,
    codexCli: true,
    runtime: inWSL ? 'wsl' : 'windows',
    shellRcPath,
  })

  printResult(result, inWSL)

  if (result.errors.length > 0) {
    process.exit(1)
  }
}

function printResult(result: HookInstallResult, inWSL: boolean): void {
  console.log(`buddy hooks install (${inWSL ? 'WSL' : 'Windows'})`)
  console.log('─'.repeat(40))

  if (result.installed.length > 0) {
    console.log(`Installed (${result.installed.length}):`)
    for (const entry of result.installed) {
      console.log(`  + ${entry}`)
    }
  }

  if (result.skipped.length > 0) {
    console.log(`Already installed (${result.skipped.length}):`)
    for (const entry of result.skipped) {
      console.log(`  = ${entry}`)
    }
  }

  if (result.errors.length > 0) {
    console.error(`Errors (${result.errors.length}):`)
    for (const entry of result.errors) {
      console.error(`  ! ${entry}`)
    }
  }

  if (result.installed.length === 0 && result.errors.length === 0) {
    console.log('All hooks are already installed.')
  }
}
