import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

import type { ClaudePipeConfig } from '../../config/schema.js'
import type { ClaudeSessionService, ClaudeSessionSummary } from '../../core/claude-sessions.js'
import type { ActiveTurnInfo } from '../../core/model-client.js'
import type { SessionStore } from '../../core/session-store.js'
import type { WorkspaceStore } from '../../core/workspace-store.js'
import { resolveWorkspace } from '../../core/workspace.js'
import type { CommandDefinition, CommandResult } from '../types.js'

/**
 * /setproj <path>
 * Map current chat to a project directory, clear session, show status.
 *
 * If path starts with '/', treated as absolute. Otherwise resolved relative to $HOME.
 */
export function setProjCommand(
  config: ClaudePipeConfig,
  workspaceStore: WorkspaceStore,
  sessionStore: SessionStore,
  startNewSession: (conversationKey: string) => Promise<void>,
  getStatus: (conversationKey: string) => Promise<{
    model: string
    workspace: string
    currentWorkspace: string
    channels: string[]
    sessionInfo: ClaudeSessionSummary | undefined
    activeTurns: ActiveTurnInfo[]
  }>
): CommandDefinition {
  return {
    name: 'setproj',
    category: 'utility',
    description: 'Set workspace to ~/code/<path> and start fresh',
    usage: '/setproj <path> — resolves to ~/code/<path>, creates dir if needed',
    args: [{ name: 'path', description: 'Path under ~/code/', required: true }],
    permission: 'admin',
    async execute(ctx): Promise<CommandResult> {
      const rawPath = ctx.args.join(' ')
      if (!rawPath) {
        return { content: 'Usage: /setproj <path>', error: true }
      }

      const base = path.join(os.homedir(), 'code')
      const resolved = path.resolve(base, rawPath)

      if (!resolved.startsWith(base + '/')) {
        return { content: 'Path must resolve under $HOME/code/.', error: true }
      }

      // Create directory if it doesn't exist
      fs.mkdirSync(resolved, { recursive: true })

      // Map chat to workspace
      await workspaceStore.set(ctx.conversationKey, resolved)

      // Clear session
      await startNewSession(ctx.conversationKey)

      // Show status
      const status = await getStatus(ctx.conversationKey)
      const lines = [
        '**Project set:**',
        `• Workspace: ${resolved}`,
        `• Model: ${status.model}`,
        `• Session: cleared`,
        `• Channels: ${status.channels.join(', ')}`
      ]

      return { content: lines.join('\n') }
    }
  }
}
