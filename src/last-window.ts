import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const LAST_WINDOW_DIR = path.join(os.homedir(), '.db', '1focus', 'vscode', 'last_window_open')
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g

function sanitizeWindowName(windowName: string) {
  const replaced = windowName.replace(INVALID_FILENAME_CHARS, '_').trim()
  return replaced.length ? replaced : 'window'
}

export async function writeLastWindowMarker(windowLabel: string) {
  const trimmed = windowLabel.trim()
  if (!trimmed)
    return

  await mkdir(LAST_WINDOW_DIR, { recursive: true })
  const existing = await readdir(LAST_WINDOW_DIR)
  await Promise.all(existing.map(async (entry) => {
    try {
      await unlink(path.join(LAST_WINDOW_DIR, entry))
    }
    catch {
      // ignore deletion errors, directory will be overwritten on next write
    }
  }))

  const fileName = sanitizeWindowName(trimmed)
  const filePath = path.join(LAST_WINDOW_DIR, fileName)
  await writeFile(filePath, trimmed, 'utf8')
}
