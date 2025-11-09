import { spawn } from 'node:child_process'

const FRONTMOST_DELIMITER = '__1F_SPLIT__'

const PROCESS_GROUPS = [
  { appId: 'cursor', processName: 'Cursor' },
  { appId: 'cursor-insiders', processName: 'Cursor - Insiders' },
  { appId: 'vscode', processName: 'Code' },
  { appId: 'vscode', processName: 'Visual Studio Code' },
  { appId: 'vscode-insiders', processName: 'Code - Insiders' },
  { appId: 'vscode-insiders', processName: 'Visual Studio Code - Insiders' },
] as const

export type SupportedAppId = typeof PROCESS_GROUPS[number]['appId']

const PROCESS_LIST_APPLESCRIPT = `{${PROCESS_GROUPS.map(({ appId, processName }) => `{ "${escapeAppleScriptString(appId)}", "${escapeAppleScriptString(processName)}" }`).join(', ')}}`

const ENV_APP_NAME_MAP: Record<string, SupportedAppId> = {
  Cursor: 'cursor',
  'Cursor - Insiders': 'cursor-insiders',
  'Visual Studio Code': 'vscode',
  'Code - OSS': 'vscode',
  'VSCodium': 'vscode',
  'Code - Insiders': 'vscode-insiders',
  'Visual Studio Code - Insiders': 'vscode-insiders',
}

export interface FrontmostWindowInfo {
  title: string
  appId: SupportedAppId
}

export function inferAppIdFromEnv(appName?: string | null): SupportedAppId | null {
  if (!appName)
    return null
  return ENV_APP_NAME_MAP[appName] ?? null
}

function isSupportedAppId(value: string): value is SupportedAppId {
  return PROCESS_GROUPS.some(group => group.appId === value)
}

function runOsascript(script: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn('osascript', [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', chunk => (stdout += chunk.toString()))
    child.stderr.on('data', chunk => (stderr += chunk.toString()))
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim())
        return
      }
      const message = stderr.trim() || `osascript exited with code ${code ?? 'unknown'}`
      reject(new Error(message))
    })

    child.stdin.end(script)
  })
}

function escapeAppleScriptString(value?: string | null) {
  if (!value)
    return ''
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export async function getFrontmostCursorWindowTitle(): Promise<FrontmostWindowInfo | null> {
  if (process.platform !== 'darwin')
    return null

  try {
    const script = `
      set delimiter to "${FRONTMOST_DELIMITER}"
      set candidates to ${PROCESS_LIST_APPLESCRIPT}
      tell application "System Events"
        repeat with entry in candidates
          set targetAppId to item 1 of entry
          set processName to item 2 of entry
          if (exists process processName) then
            tell process processName
              if frontmost is true then
                if (count of windows) is 0 then return ""
                set frontWindowTitle to (name of front window) as text
                return targetAppId & delimiter & frontWindowTitle
              end if
            end tell
          end if
        end repeat
      end tell
    `
    const payload = await runOsascript(script)
    if (!payload.length)
      return null
    const [rawAppId, ...rawTitleParts] = payload.split(FRONTMOST_DELIMITER)
    if (!rawAppId || !rawTitleParts.length)
      return null
    const trimmedTitle = rawTitleParts.join(FRONTMOST_DELIMITER).trim()
    const trimmedAppId = rawAppId.trim()
    if (!trimmedTitle.length || !isSupportedAppId(trimmedAppId))
      return null
    return {
      appId: trimmedAppId,
      title: trimmedTitle,
    }
  }
  catch {
    return null
  }
}

export async function focusCursorWindow(options: { windowTitle?: string | null, workspaceName?: string | null, appId?: SupportedAppId | null }) {
  if (process.platform !== 'darwin')
    throw new Error('Window switching is only supported on macOS.')

  const targetTitle = escapeAppleScriptString(options.windowTitle)
  const workspaceName = escapeAppleScriptString(options.workspaceName)
  const targetAppId = escapeAppleScriptString(options.appId ?? '')

  const script = `
    on matchesWindow(theTitle, targetTitle, targetWorkspace)
      if targetTitle is not "" and theTitle = targetTitle then
        return true
      end if
      if targetWorkspace is "" then return false
      set dashChunk to (character id 8212) & " "
      if theTitle ends with dashChunk & targetWorkspace then
        return true
      end if
      if theTitle ends with targetWorkspace then
        return true
      end if
      return false
    end matchesWindow

    on candidateProcesses()
      return ${PROCESS_LIST_APPLESCRIPT}
    end candidateProcesses

    on orderedCandidates(targetId)
      set sourceList to candidateProcesses()
      set orderedList to {}
      if targetId is not "" then
        repeat with entry in sourceList
          if item 1 of entry is targetId then
            set orderedList to orderedList & {entry}
          end if
        end repeat
      end if
      repeat with entry in sourceList
        if targetId is "" or item 1 of entry is not targetId then
          set orderedList to orderedList & {entry}
        end if
      end repeat
      return orderedList
    end orderedCandidates

    set wantedTitle to "${targetTitle}"
    set wantedWorkspace to "${workspaceName}"
    set wantedAppId to "${targetAppId}"

    tell application "System Events"
      set triedProcess to false
      repeat with entry in orderedCandidates(wantedAppId)
        set processName to item 2 of entry
        if (exists process processName) then
          set triedProcess to true
          tell process processName
            if (count of windows) is 0 then next repeat
            set frontmost to true
            repeat with w in windows
              set currentTitle to (name of w) as text
              if matchesWindow(currentTitle, wantedTitle, wantedWorkspace) then
                perform action "AXRaise" of w
                set frontmost to true
                return
              end if
            end repeat
          end tell
        end if
      end repeat
    end tell

    if triedProcess then
      error "Unable to find a Cursor or VS Code window that matches the recorded history."
    else
      error "Cursor or VS Code is not running."
    end if
  `

  await runOsascript(script)
}
