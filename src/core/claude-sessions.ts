import { readdir, readFile, stat, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

export interface ClaudeSessionSummary {
  sessionId: string
  recentContext: string
  model: string
  lastActive: string
  gitBranch: string
  userMessageCount: number
  assistantMessageCount: number
}

export interface ConversationEntry {
  role: 'user' | 'assistant'
  text: string
}

export interface ClaudeSessionService {
  list(workspace: string): Promise<ClaudeSessionSummary[]>
  get(workspace: string, sessionIdOrPrefix: string): Promise<ClaudeSessionSummary | undefined>
  recentHistory(workspace: string, sessionId: string, count?: number): Promise<ConversationEntry[]>
  resolve(workspace: string, prefix: string): Promise<{ id: string } | { error: string }>
  delete(workspace: string, sessionId: string): Promise<void>
}

function encodeWorkspacePath(workspace: string): string {
  return path.resolve(workspace).replace(/[/.]/g, '-')
}

function getClaudeProjectDir(workspace: string): string {
  return path.join(homedir(), '.claude', 'projects', encodeWorkspacePath(workspace))
}

function hasTextContent(content: unknown): boolean {
  if (typeof content === 'string' && content.length > 0) return true
  if (Array.isArray(content)) {
    return content.some(
      (b) =>
        (typeof b === 'string' && b.length > 0) ||
        (b !== null && typeof b === 'object' && (b as Record<string, unknown>).type === 'text' &&
          typeof (b as Record<string, unknown>).text === 'string' &&
          ((b as Record<string, unknown>).text as string).length > 0)
    )
  }
  return false
}

function stripXmlTags(text: string): string {
  return text.replace(/<[^>]+>/g, '').trim()
}

function extractTextFromContent(content: unknown): string | undefined {
  let raw: string | undefined
  if (typeof content === 'string' && content.length > 0) {
    raw = content
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === 'string' && block.length > 0) { raw = block; break }
      if (
        block !== null && typeof block === 'object' &&
        block.type === 'text' && typeof block.text === 'string' && block.text.length > 0
      ) { raw = block.text as string; break }
    }
  }
  if (!raw) return undefined
  const cleaned = stripXmlTags(raw).replace(/\s+/g, ' ')
  return cleaned.length > 0 ? cleaned.slice(0, 80) : undefined
}

function extractFullText(content: unknown): string {
  const parts: string[] = []
  if (typeof content === 'string') {
    parts.push(content)
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === 'string') { parts.push(block); continue }
      if (
        block !== null && typeof block === 'object' &&
        block.type === 'text' && typeof block.text === 'string'
      ) { parts.push(block.text as string) }
    }
  }
  return stripXmlTags(parts.join('\n'))
}

function isToolResultContent(content: unknown): boolean {
  if (!Array.isArray(content)) return false
  return content.some((b) => b !== null && typeof b === 'object' && b.type === 'tool_result')
}

function extractRecentHistory(lines: string[], count: number): ConversationEntry[] {
  // Collect real user/assistant messages, skipping tool_result/tool_use entries.
  // Stop once we have enough user messages (each may have a paired assistant response).
  const entries: ConversationEntry[] = []
  let userCount = 0
  for (let i = lines.length - 1; i >= 0 && userCount < count; i--) {
    try {
      const obj = JSON.parse(lines[i]!)
      if (obj.type === 'user') {
        if (isToolResultContent(obj.message?.content)) continue
        if (!hasTextContent(obj.message?.content)) continue
        const text = extractFullText(obj.message?.content)
        if (text) { entries.push({ role: 'user', text }); userCount++ }
      } else if (obj.type === 'assistant') {
        if (!hasTextContent(obj.message?.content)) continue
        const text = extractFullText(obj.message?.content)
        if (text) entries.push({ role: 'assistant', text })
      }
    } catch {
      // skip malformed lines
    }
  }
  // Reverse to chronological order, then take last `count` pairs
  entries.reverse()
  // Find the start of the last N pairs (each pair = user + assistant)
  let pairCount = 0
  let startIdx = entries.length
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]!.role === 'user') {
      pairCount++
      startIdx = i
      if (pairCount >= count) break
    }
  }
  return entries.slice(startIdx)
}

function extractRecentUserMessages(lines: string[], count = 3): string {
  const messages: string[] = []
  for (let i = lines.length - 1; i >= 0 && messages.length < count; i--) {
    try {
      const obj = JSON.parse(lines[i]!)
      if (obj.type !== 'user') continue
      const text = extractTextFromContent(obj.message?.content)
      if (text) messages.push(text)
    } catch {
      // skip malformed lines
    }
  }
  if (messages.length === 0) return '(no message)'
  // Oldest first so the context reads chronologically
  messages.reverse()
  const joined = messages.join(' · ')
  return joined.length > 120 ? joined.slice(0, 120) + '…' : joined
}

function parseSession(sessionId: string, raw: string): ClaudeSessionSummary {
  const lines = raw.split('\n').filter(Boolean)
  let model = ''
  let lastActiveMs = 0
  let lastActive = ''
  let gitBranch = ''
  let userMessageCount = 0
  let assistantMessageCount = 0

  for (const line of lines) {
    try {
      const obj = JSON.parse(line)
      const ts = obj.timestamp as string | undefined
      if (ts) {
        const t = Date.parse(ts)
        if (!isNaN(t) && t > lastActiveMs) {
          lastActiveMs = t
          lastActive = ts
        }
      }

      if (obj.type === 'user') {
        if (hasTextContent(obj.message?.content)) {
          userMessageCount++
        }
        if (obj.gitBranch) gitBranch = obj.gitBranch
      } else if (obj.type === 'assistant') {
        assistantMessageCount++
        const m = obj.message?.model as string | undefined
        if (m) model = m
      }
    } catch {
      // skip malformed lines
    }
  }

  return {
    sessionId,
    recentContext: extractRecentUserMessages(lines),
    model,
    lastActive,
    gitBranch,
    userMessageCount,
    assistantMessageCount
  }
}

async function listJsonlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  return entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => e.name)
}

async function resolveSessionId(workspace: string, prefix: string): Promise<{ id: string } | { error: string }> {
  const dir = getClaudeProjectDir(workspace)
  let files: string[]
  try {
    files = await listJsonlFiles(dir)
  } catch {
    return { error: 'No sessions found for this workspace.' }
  }
  const ids = files.map((f) => f.replace(/\.jsonl$/, ''))
  const exact = ids.find((id) => id === prefix)
  if (exact) return { id: exact }
  const matches = ids.filter((id) => id.startsWith(prefix))
  if (matches.length === 1) return { id: matches[0]! }
  if (matches.length === 0) return { error: `No session matching "${prefix}".` }
  return {
    error: `Ambiguous prefix "${prefix}", matches: ${matches.map((m) => m.slice(0, 8)).join(', ')}`
  }
}

export function createClaudeSessionService(): ClaudeSessionService {
  return {
    async list(workspace: string): Promise<ClaudeSessionSummary[]> {
      const dir = getClaudeProjectDir(workspace)
      let files: string[]
      try {
        files = await listJsonlFiles(dir)
      } catch {
        return []
      }

      // Sort by mtime (newest first) so we only parse the most recent files
      const withMtime = await Promise.all(
        files.map(async (f) => {
          try {
            const s = await stat(path.join(dir, f))
            return { file: f, mtime: s.mtimeMs }
          } catch {
            return { file: f, mtime: 0 }
          }
        })
      )
      withMtime.sort((a, b) => b.mtime - a.mtime)
      const recent = withMtime.slice(0, 20)

      const sessions: ClaudeSessionSummary[] = []
      for (const { file } of recent) {
        try {
          const raw = await readFile(path.join(dir, file), 'utf-8')
          const sessionId = file.replace(/\.jsonl$/, '')
          sessions.push(parseSession(sessionId, raw))
        } catch {
          // skip unreadable files
        }
      }

      sessions.sort((a, b) => {
        if (b.lastActive > a.lastActive) return 1
        if (b.lastActive < a.lastActive) return -1
        return 0
      })
      return sessions
    },

    async get(workspace: string, sessionIdOrPrefix: string): Promise<ClaudeSessionSummary | undefined> {
      const result = await resolveSessionId(workspace, sessionIdOrPrefix)
      if ('error' in result) return undefined
      const dir = getClaudeProjectDir(workspace)
      try {
        const raw = await readFile(path.join(dir, `${result.id}.jsonl`), 'utf-8')
        return parseSession(result.id, raw)
      } catch {
        return undefined
      }
    },

    async recentHistory(workspace: string, sessionId: string, count = 3): Promise<ConversationEntry[]> {
      const dir = getClaudeProjectDir(workspace)
      try {
        const raw = await readFile(path.join(dir, `${sessionId}.jsonl`), 'utf-8')
        const lines = raw.split('\n').filter(Boolean)
        return extractRecentHistory(lines, count)
      } catch {
        return []
      }
    },

    resolve: resolveSessionId,

    async delete(workspace: string, sessionId: string): Promise<void> {
      const dir = getClaudeProjectDir(workspace)
      const filePath = path.join(dir, `${sessionId}.jsonl`)
      try {
        await unlink(filePath)
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err
        }
      }
    }
  }
}
