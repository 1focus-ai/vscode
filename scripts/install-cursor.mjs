#!/usr/bin/env node

/**
 * Installs the freshly packaged VSIX into Cursor (or VS Code as a fallback).
 * Set SKIP_CURSOR_INSTALL=1 to bypass this automation.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

async function main() {
  if (process.env.SKIP_CURSOR_INSTALL) {
    console.log('[1Focus] SKIP_CURSOR_INSTALL=1 set, skipping Cursor install step.')
    return
  }

  const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  const vsixName = `${pkg.name}-${pkg.version}.vsix`
  const vsixPath = path.join(repoRoot, vsixName)

  if (!existsSync(vsixPath)) {
    throw new Error(`VSIX not found at ${vsixPath}. Did the package step succeed?`)
  }

  const candidates = [
    process.env.CURSOR_BIN,
    'cursor',
    'code',
  ].filter(Boolean)

  for (const binary of candidates) {
    const ok = await tryInstall(binary, vsixPath)
    if (ok) {
      console.log(`[1Focus] Installed ${vsixName} via "${binary}".`)
      return
    }
  }

  throw new Error('Unable to find a Cursor (or VS Code) CLI to install the extension. Set CURSOR_BIN to the CLI path.')
}

function tryInstall(binary, vsixPath) {
  return new Promise(resolve => {
    const child = spawn(binary, ['--install-extension', vsixPath], {
      stdio: 'inherit',
    })

    child.once('error', () => resolve(false))
    child.once('exit', code => resolve(code === 0))
  })
}

main().catch((error) => {
  console.error(`[1Focus] Failed to install VSIX: ${error.message}`)
  process.exit(1)
})
