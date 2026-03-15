import type { ClaudeSessionService, ClaudeSessionSummary } from '../../core/claude-sessions.js'
import type { CommandDefinition, CommandContext, CommandResult } from '../types.js'

function formatSessionInfo(session: ClaudeSessionSummary): string {
  const shortId = session.sessionId.slice(0, 8)
  const lines = [
    `═══════════════════════════════`,
    `✦ Session: ${shortId}`,
    `═══════════════════════════════`,
    `  "${session.recentContext}"`,
    `  Model: ${session.model || 'unknown'}`,
    `  Messages: ${session.userMessageCount} user / ${session.assistantMessageCount} assistant`,
    `  Last active: ${session.lastActive || 'unknown'}`,
  ]
  if (session.gitBranch) {
    lines.push(`  Branch: ${session.gitBranch}`)
  }
  return lines.join('\n')
}

/**
 * /session_clear
 * Clears conversation history and starts a fresh Claude session for the current chat.
 */
export function sessionClearCommand(
  startNewSession: (conversationKey: string) => Promise<void>
): CommandDefinition {
  return {
    name: 'session_clear',
    category: 'session',
    description: 'Clear conversation history and start a new session',
    usage: '/session_clear — clears conversation history and starts fresh',
    permission: 'user',
    async execute(ctx: CommandContext): Promise<CommandResult> {
      await startNewSession(ctx.conversationKey)
      return { content: '═══════════════════════════════\n✦ New session started\n═══════════════════════════════' }
    }
  }
}

/**
 * /session_list
 * Lists Claude sessions in the current workspace.
 */
export function sessionListCommand(
  getWorkspace: (conversationKey: string) => string,
  sessionService: ClaudeSessionService,
  getSessionId: (conversationKey: string) => string | undefined
): CommandDefinition {
  return {
    name: 'session_list',
    category: 'session',
    description: 'List Claude sessions in the current workspace',
    permission: 'user',
    async execute(ctx: CommandContext): Promise<CommandResult> {
      const workspace = getWorkspace(ctx.conversationKey)
      const sessions = await sessionService.list(workspace)
      if (sessions.length === 0) {
        return { content: 'No sessions found for this workspace.' }
      }
      const currentSessionId = getSessionId(ctx.conversationKey)
      const cap = 20
      const shown = sessions.slice(0, cap)
      const lines = shown.map((s, i) => {
        const shortId = s.sessionId.slice(0, 8)
        const msg = s.recentContext.length > 50 ? s.recentContext.slice(0, 50) + '…' : s.recentContext
        const date = s.lastActive ? s.lastActive.slice(0, 10) : 'unknown'
        const active = currentSessionId === s.sessionId ? ' *' : ''
        return `${i + 1}. \`${shortId}\`${active} — "${msg}" (${date})`
      })
      let header = `**Sessions in ${workspace} (${sessions.length}):**`
      if (sessions.length > cap) {
        header += ` (showing ${cap} most recent)`
      }
      return { content: `${header}\n${lines.join('\n')}` }
    }
  }
}

/**
 * /session_select <session_id>
 * Switch to a different Claude session by ID (prefix match supported).
 */
export function sessionSelectCommand(
  getWorkspace: (conversationKey: string) => string,
  sessionService: ClaudeSessionService,
  setSession: (conversationKey: string, sessionId: string) => Promise<void>
): CommandDefinition {
  return {
    name: 'session_select',
    category: 'session',
    description: 'Switch to a session by ID',
    usage: '/session_select <id> — switch to a session (prefix match supported)',
    args: [{ name: 'session_id', description: 'Session ID or prefix', required: true }],
    permission: 'user',
    async execute(ctx: CommandContext): Promise<CommandResult> {
      const prefix = ctx.args[0]
      if (!prefix) {
        return { content: 'Usage: /session select <session_id>', error: true }
      }
      const workspace = getWorkspace(ctx.conversationKey)
      const resolved = await sessionService.resolve(workspace, prefix)
      if ('error' in resolved) {
        return { content: resolved.error, error: true }
      }
      const session = await sessionService.get(workspace, resolved.id)
      if (!session) {
        return { content: 'Failed to read session details.', error: true }
      }
      await setSession(ctx.conversationKey, resolved.id)
      const history = await sessionService.recentHistory(workspace, resolved.id, 3)
      const parts = [formatSessionInfo(session)]
      if (history.length > 0) {
        parts.push('', '**Recent history:**')
        for (const entry of history) {
          const label = entry.role === 'user' ? '**User:**' : '**Claude:**'
          parts.push(`${label}\n${entry.text}`)
        }
      }
      return { content: parts.join('\n') }
    }
  }
}

/**
 * /session_delete [session_id]
 * Deletes a session by ID, or the current chat's session if no ID given.
 */
export function sessionDeleteCommand(
  getWorkspace: (conversationKey: string) => string,
  sessionService: ClaudeSessionService,
  getSessionId: (conversationKey: string) => string | undefined,
  clearSession: (conversationKey: string) => Promise<void>
): CommandDefinition {
  return {
    name: 'session_delete',
    category: 'session',
    description: 'Delete a session by ID or the current session',
    usage: '/session_delete [session_id]',
    args: [{ name: 'session_id', description: 'Session ID or prefix (omit to delete current)', required: false }],
    permission: 'user',
    async execute(ctx: CommandContext): Promise<CommandResult> {
      const workspace = getWorkspace(ctx.conversationKey)
      const currentSessionId = getSessionId(ctx.conversationKey)
      const prefix = ctx.args[0]

      if (prefix) {
        // Delete a specific session by ID
        const resolved = await sessionService.resolve(workspace, prefix)
        if ('error' in resolved) {
          return { content: resolved.error, error: true }
        }
        await sessionService.delete(workspace, resolved.id)
        // If the deleted session is the current one, clear the binding
        if (currentSessionId === resolved.id) {
          await clearSession(ctx.conversationKey)
        }
        return { content: `Session \`${resolved.id.slice(0, 8)}\` deleted.` }
      }

      // No arg — delete current session
      if (!currentSessionId) {
        return { content: 'No active session for this chat.', error: true }
      }
      await sessionService.delete(workspace, currentSessionId)
      await clearSession(ctx.conversationKey)
      return { content: `Session \`${currentSessionId.slice(0, 8)}\` deleted.` }
    }
  }
}
