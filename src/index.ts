import { spawn } from 'node:child_process'
import { defineExtension } from 'reactive-vscode'
import { commands, window, workspace } from 'vscode'
import type { OutputChannel } from 'vscode'
import { displayName } from './generated/meta'

const { activate, deactivate } = defineExtension(() => {
  const channel = window.createOutputChannel(displayName ?? '1focus')
  let isRunning = false

  const commitPush = commands.registerCommand('1focus.commitPush', async () => {
    if (isRunning) {
      window.showWarningMessage('1focus: commit & push already running.')
      return
    }

    const workspaceFolder = workspace.workspaceFolders?.[0]
    if (!workspaceFolder) {
      window.showErrorMessage('1focus: open a workspace before running commit & push.')
      return
    }

    isRunning = true
    channel.clear()
    channel.show(true)
    channel.appendLine(`[1focus] Running "f commitPush" in ${workspaceFolder.uri.fsPath}`)

    try {
      await runCommitPush(workspaceFolder.uri.fsPath, channel)
      channel.appendLine('[1focus] Command completed successfully.')
      window.showInformationMessage('1focus: repository committed and pushed.')
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      channel.appendLine(`[1focus] Command failed: ${message}`)
      window.showErrorMessage('1focus: f commitPush failed. Check the 1focus output channel for details.')
    }
    finally {
      isRunning = false
    }
  })

  return [
    channel,
    commitPush,
  ]
})

export { activate, deactivate }

function runCommitPush(cwd: string, channel: OutputChannel) {
  return new Promise<void>((resolve, reject) => {
    const shell = process.env.SHELL ?? '/bin/bash'
    const child = spawn(shell, ['-lc', 'f commitPush'], {
      cwd,
      env: process.env,
    })

    child.stdout?.on('data', data => channel.append(data.toString()))
    child.stderr?.on('data', data => channel.append(data.toString()))
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`Exited with code ${code ?? 'unknown'}`))
    })
  })
}
