import { constants as fsConstants } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

export interface FlowTask {
  name: string
  command: string
  description?: string
}

export interface FlowTaskResult {
  tasks: FlowTask[]
  flowRoot: string
}

/**
 * Locate a flow.toml starting from the provided path (walking up a few levels),
 * parse tasks, and return them alongside the directory that contains the file.
 */
export async function loadFlowTasks(startPath: string): Promise<FlowTaskResult> {
  const initial = await resolveStartPath(startPath)
  if (!initial)
    throw new Error('No workspace folder available to locate flow.toml.')

  const flowToml = await findFlowToml(initial)
  if (!flowToml)
    throw new Error('flow.toml not found in this workspace.')

  const content = await readFile(flowToml, 'utf8')
  const tasks = parseFlowToml(content)

  return {
    tasks,
    flowRoot: path.dirname(flowToml),
  }
}

async function resolveStartPath(startPath: string) {
  try {
    const stats = await stat(startPath)
    if (stats.isDirectory())
      return startPath
    if (stats.isFile())
      return path.dirname(startPath)
  }
  catch {
    // Ignore resolution errors; caller will surface a friendly message.
  }
  return null
}

async function findFlowToml(startPath: string) {
  const maxDepth = 12
  let current = path.resolve(startPath)

  for (let i = 0; i < maxDepth; i += 1) {
    const candidate = path.join(current, 'flow.toml')
    if (await fileExists(candidate))
      return candidate

    const parent = path.dirname(current)
    if (!parent || parent === current)
      break
    current = parent
  }

  return null
}

function parseFlowToml(content: string): FlowTask[] {
  const lines = content.split(/\r?\n/)
  const tasks: FlowTask[] = []
  let inTask = false
  let current: Partial<FlowTask> = {}
  let multilineKey: 'name' | 'command' | 'description' | null = null
  let multilineDelimiter: string | null = null
  let multilineBuffer: string[] = []

  const flush = () => {
    if (current.name && current.command)
      tasks.push({ name: current.name, command: current.command, description: current.description })
    current = {}
    multilineKey = null
    multilineDelimiter = null
    multilineBuffer = []
  }

  for (const rawLine of lines) {
    if (multilineKey) {
      // Preserve raw content inside multiline; look for closing delimiter.
      if (multilineDelimiter && rawLine.trimEnd().endsWith(multilineDelimiter)) {
        const closingIndex = rawLine.lastIndexOf(multilineDelimiter)
        const contentPortion = rawLine.slice(0, closingIndex)
        multilineBuffer.push(contentPortion)
        const value = multilineBuffer.join('\n')
        if (multilineKey === 'name')
          current.name = value
        else if (multilineKey === 'command')
          current.command = value
        else if (multilineKey === 'description')
          current.description = value
        multilineKey = null
        multilineDelimiter = null
        multilineBuffer = []
      }
      else {
        multilineBuffer.push(rawLine)
      }
      continue
    }

    const line = rawLine.split('#', 1)[0]?.trim() ?? ''
    if (!line)
      continue

    if (line === '[[tasks]]') {
      if (inTask)
        flush()
      inTask = true
      continue
    }

    if (line.startsWith('[') && line !== '[[tasks]]') {
      if (inTask)
        flush()
      inTask = false
      continue
    }

    if (!inTask)
      continue

    const multilineMatch = line.match(/^(\w+)\s*=\s*("""|''')\s*$/)
    if (multilineMatch) {
      const key = multilineMatch[1] as 'name' | 'command' | 'description'
      multilineKey = key
      multilineDelimiter = multilineMatch[2]
      multilineBuffer = []
      continue
    }

    current.name ??= extractTomlValue(line, 'name') ?? undefined
    current.command ??= extractTomlValue(line, 'command') ?? undefined
    current.description ??= extractTomlValue(line, 'description') ?? undefined
  }

  flush()
  return tasks
}

function extractTomlValue(line: string, key: string): string | null {
  const pattern = new RegExp(`^${escapeKey(key)}\\s*=\\s*(['"])(.*)\\1\\s*$`)
  const match = line.match(pattern)
  if (!match)
    return null

  const raw = match[2]
  return unescapeTomlValue(raw)
}

function escapeKey(key: string) {
  return key.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
}

function unescapeTomlValue(value: string) {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
}

async function fileExists(filePath: string) {
  try {
    await access(filePath, fsConstants.F_OK)
    return true
  }
  catch {
    return false
  }
}
