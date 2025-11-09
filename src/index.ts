import { spawn } from 'node:child_process'
import { defineExtension } from 'reactive-vscode'
import { commands, window, workspace } from 'vscode'
import type { OutputChannel } from 'vscode'
import { displayName } from './generated/meta'

const { activate, deactivate } = defineExtension(() => {
  const channel = window.createOutputChannel(displayName ?? '1Focus')
  let isRunning = false

  const commitPush = commands.registerCommand('1focus.commitPush', async () => {
    if (isRunning) {
      window.showWarningMessage('1Focus: commit & push already running.')
      return
    }

    const workspacePath = getTargetWorkspacePath()
    if (!workspacePath) {
      window.showErrorMessage('1Focus: open a workspace before running commit & push.')
      return
    }

    isRunning = true
    channel.clear()
    channel.appendLine(`[1Focus] Running "f commitPush" in ${workspacePath}`)

    try {
      await runCommitPush(workspacePath, channel)
      channel.appendLine('[1Focus] Command completed successfully.')
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      channel.appendLine(`[1Focus] Command failed: ${message}`)
      const openLog = 'Show log'
      const choice = await window.showErrorMessage('1Focus: f commitPush failed.', openLog)
      if (choice === openLog)
        channel.show(true)
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
    channel.appendLine('[1Focus] > f commitPush')

    const child = spawn('f', ['commitPush'], {
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

function getTargetWorkspacePath() {
  const activeDocument = window.activeTextEditor?.document
  if (activeDocument) {
    const folder = workspace.getWorkspaceFolder(activeDocument.uri)
    if (folder)
      return folder.uri.fsPath
  }

  return workspace.workspaceFolders?.[0]?.uri.fsPath
}
