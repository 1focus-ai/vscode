import { spawn } from 'node:child_process'
import { defineExtension } from 'reactive-vscode'
import { commands, env, window, workspace } from 'vscode'
import type { OutputChannel } from 'vscode'
import { displayName } from './generated/meta'
import { focusCursorWindow, getFrontmostCursorWindowTitle, inferAppIdFromEnv, type SupportedAppId } from './macos'
import { getLastNonDotWindow, recordFocusEvent, SqliteUnavailableError } from './focus-tracker'

const { activate, deactivate } = defineExtension(() => {
  const channel = window.createOutputChannel(displayName ?? '1Focus')
  let isRunning = false
  let warnedAboutSqlite = false
  let lastLoggedSignature: string | null = null
  let lastLoggedAt = 0
  const hostAppId = inferAppIdFromEnv(env.appName)

  const logWindowFocus = async (options?: { force?: boolean }) => {
    if (process.platform !== 'darwin') {
      if (options?.force)
        window.showWarningMessage('1Focus: focus logging only works on macOS.')
      return false
    }

    const frontmost = await getFrontmostCursorWindowTitle()
    const title = frontmost?.title
    const appId = frontmost?.appId

    if (!title || !appId) {
      if (options?.force)
        window.showWarningMessage('1Focus: could not detect the active Cursor/VS Code window.')
      return false
    }

    const signature = `${appId}:${title}`
    if (!options?.force && signature === lastLoggedSignature && (Date.now() - lastLoggedAt) < 500)
      return false

    lastLoggedSignature = signature
    lastLoggedAt = Date.now()

    try {
      const workspacePath = getTargetWorkspacePath()
      const activeFile = window.activeTextEditor?.document.uri.fsPath ?? undefined
      await recordFocusEvent({
        sessionId: env.sessionId,
        windowTitle: title,
        workspacePath,
        activeFile,
        appId,
      })
      const workspaceLabel = workspacePath ? ` [${workspacePath}]` : ''
      const fileLabel = activeFile ? ` (${activeFile})` : ''
      channel.appendLine(`[1Focus] Focus recorded: ${title}${workspaceLabel}${fileLabel}`)
      return true
    }
    catch (error) {
      if (error instanceof SqliteUnavailableError && !warnedAboutSqlite) {
        warnedAboutSqlite = true
        window.showWarningMessage('1Focus: sqlite3 CLI not found. Install Command Line Tools (xcode-select --install) to enable window switching.')
      }
      const message = error instanceof Error ? error.message : String(error)
      channel.appendLine(`[1Focus] Failed to record focus event: ${message}`)
      return false
    }
  }

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

  const focusLastWindow = commands.registerCommand('1focus.focusLastWindow', async () => {
    channel.appendLine('[1Focus] focusLastWindow invoked')
    try {
      const record = await getLastNonDotWindow(env.sessionId, { appId: hostAppId })
      if (!record) {
        channel.appendLine('[1Focus] No recorded windows available for focusLastWindow')
        window.showInformationMessage('1Focus: no other recorded windows yet.')
        return
      }
      channel.appendLine(`[1Focus] Candidate window: ${record.windowTitle ?? '(untitled)'} (workspace: ${record.workspaceName ?? 'unknown'})`)
      await focusCursorWindow({
        windowTitle: record.windowTitle,
        workspaceName: record.workspaceName,
        appId: (record.appId as SupportedAppId | undefined) ?? hostAppId ?? undefined,
      })
      channel.appendLine('[1Focus] Focused recorded editor window successfully')
    }
    catch (error) {
      if (error instanceof SqliteUnavailableError) {
        channel.appendLine('[1Focus] focusLastWindow error: sqlite3 CLI missing')
        window.showErrorMessage('1Focus: sqlite3 CLI not found. Install Command Line Tools (xcode-select --install) to enable window switching.')
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      const needsPermission = /not authorised|not authorized/i.test(message)
      const hint = needsPermission ? ' Grant Cursor or VS Code access via System Settings → Privacy & Security → Accessibility.' : ''
      channel.appendLine(`[1Focus] focusLastWindow error: ${message}${hint}`)
      window.showErrorMessage(`1Focus: ${message}${hint}`)
    }
  })

  const focusWatcher = window.onDidChangeWindowState((state) => {
    if (state.focused)
      void logWindowFocus()
  })

  const logWindowCommand = commands.registerCommand('1focus.logWindow', async () => {
    channel.appendLine('[1Focus] logWindow command invoked')
    const recorded = await logWindowFocus({ force: true })
    if (recorded)
      window.showInformationMessage('1Focus: current window logged. Check the 1Focus output channel for details.')
  })

  const logCurrentWindowCommand = commands.registerCommand('1focus.logCurrentWindow', async () => {
    channel.appendLine('[1Focus] logCurrentWindow command invoked')
    const recorded = await logWindowFocus({ force: true })
    if (recorded)
      window.showInformationMessage('1Focus: current window logged. Check the 1Focus output channel for details.')
  })

  void logWindowFocus()

  return [
    channel,
    commitPush,
    focusLastWindow,
    logWindowCommand,
    logCurrentWindowCommand,
    focusWatcher,
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
