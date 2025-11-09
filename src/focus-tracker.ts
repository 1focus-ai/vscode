import { mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const DB_DIR = path.join(os.homedir(), 'Library', 'Application Support', '1focus')
const DB_PATH = path.join(DB_DIR, 'window-focus.db')
const MAX_ROWS = 500

let ensurePromise: Promise<void> | null = null

export class SqliteUnavailableError extends Error {
  constructor(message = 'sqlite3 CLI not found on PATH. Install it (macOS ships it by default) to enable window tracking.') {
    super(message)
    this.name = 'SqliteUnavailableError'
  }
}

interface RunSqlOptions {
  expectJson?: boolean
}

interface RawFocusRecord {
  sessionId: string
  windowTitle?: string | null
  workspaceName?: string | null
  workspacePath?: string | null
  activeFile?: string | null
  focusedAt: number
  appId?: string | null
}

export interface FocusRecord {
  sessionId: string
  windowTitle?: string | null
  workspaceName?: string | null
  workspacePath?: string | null
  activeFile?: string | null
  focusedAt: number
  appId?: string | null
}

export async function recordFocusEvent(entry: {
  sessionId: string
  windowTitle: string
  workspacePath?: string | null
  activeFile?: string | null
  appId?: string | null
}) {
  if (!entry.windowTitle?.trim())
    return

  await ensureDb()

  const workspaceName = extractWorkspaceName(entry.windowTitle)
  const timestamp = Date.now()

  const sql = `
    INSERT INTO window_focus (session_id, window_title, workspace_name, workspace_path, active_file, focused_at, app_id)
    VALUES (
      ${sqlValue(entry.sessionId)},
      ${sqlValue(entry.windowTitle)},
      ${sqlValue(workspaceName)},
      ${sqlValue(entry.workspacePath)},
      ${sqlValue(entry.activeFile)},
      ${timestamp},
      ${sqlValue(entry.appId)}
    );
    DELETE FROM window_focus
    WHERE id NOT IN (
      SELECT id FROM window_focus ORDER BY focused_at DESC LIMIT ${MAX_ROWS}
    );
  `

  await runSql(sql)
}

export async function getLastNonDotWindow(excludeSessionId: string, options?: { appId?: string | null }): Promise<FocusRecord | null> {
  await ensureDb()

  const appFilter = options?.appId ? `AND app_id = ${sqlValue(options.appId)}` : ''

  const sql = `
    WITH candidate AS (
      SELECT session_id, window_title, workspace_name, workspace_path, active_file, focused_at, app_id
      FROM window_focus
      WHERE session_id != ${sqlValue(excludeSessionId)}
        AND (workspace_name IS NULL OR workspace_name = '' OR workspace_name NOT LIKE '%.')
        ${appFilter}
      ORDER BY focused_at DESC
      LIMIT 1
    )
    SELECT json_object(
      'sessionId', session_id,
      'windowTitle', window_title,
      'workspaceName', workspace_name,
      'workspacePath', workspace_path,
      'activeFile', active_file,
      'focusedAt', focused_at,
      'appId', app_id
    )
    FROM candidate;
  `

  const result = (await runSql(sql)).trim()
  if (!result)
    return null

  try {
    const record = JSON.parse(result) as RawFocusRecord
    if (!record || !record.windowTitle)
      return null
    return record
  }
  catch {
    return null
  }
}

function extractWorkspaceName(windowTitle: string) {
  const emDash = ' \u2014 '
  if (windowTitle.includes(emDash)) {
    const segment = windowTitle.split(emDash).pop()
    return segment ? segment.trim() : null
  }

  const plainDash = ' - '
  if (windowTitle.includes(plainDash)) {
    const segment = windowTitle.split(plainDash).pop()
    return segment ? segment.trim() : null
  }

  return null
}

function sqlValue(value?: string | null) {
  if (value === undefined || value === null)
    return 'NULL'
  return `'${value.replace(/'/g, "''")}'`
}

async function ensureDb() {
  if (ensurePromise)
    return ensurePromise

  ensurePromise = (async () => {
    mkdirSync(DB_DIR, { recursive: true })
    const sql = `
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS window_focus (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        window_title TEXT,
        workspace_name TEXT,
        workspace_path TEXT,
        active_file TEXT,
        focused_at INTEGER NOT NULL,
        app_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_window_focus_focused_at ON window_focus(focused_at);
    `
    await runSql(sql)
    await ensureColumnExists('app_id', 'TEXT')
  })()

  ensurePromise.catch(() => {
    ensurePromise = null
  })

  return ensurePromise
}

function runSql(sql: string, options?: RunSqlOptions) {
  return new Promise<string>((resolve, reject) => {
    const args = ['-batch']
    if (options?.expectJson)
      args.push('-json')
    args.push(DB_PATH)

    const child = spawn('sqlite3', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', chunk => (stdout += chunk.toString()))
    child.stderr.on('data', chunk => (stderr += chunk.toString()))
    child.once('error', (error) => {
      reject(new SqliteUnavailableError(error.message))
    })
    child.once('close', (code) => {
      if (code === 0) {
        resolve(stdout)
        return
      }
      reject(new Error(stderr.trim() || `sqlite3 exited with code ${code ?? 'unknown'}`))
    })

    child.stdin.end(sql)
  })
}

async function ensureColumnExists(columnName: string, declaration: string) {
  try {
    await runSql(`ALTER TABLE window_focus ADD COLUMN ${columnName} ${declaration};`)
  }
  catch (error) {
    if (error instanceof Error && /duplicate column name/i.test(error.message))
      return
    throw error
  }
}
