import type { WorkspaceStore } from '../../core/workspace-store.js'
import type { CommandDefinition, CommandResult } from '../types.js'

/**
 * /workspace [set <path> | unset | list]
 * Manages per-conversation workspace mappings.
 */
export function workspaceCommand(
  workspaceStore: WorkspaceStore,
  defaultWorkspace: string
): CommandDefinition {
  return {
    name: 'workspace',
    category: 'config',
    description: 'Show, set, or unset workspace for this chat',
    usage: '/workspace [set <path> | unset | list]',
    args: [
      { name: 'action', description: 'set, unset, or list', required: false },
      { name: 'path', description: 'Workspace path (for set)', required: false }
    ],
    permission: 'admin',
    async execute(ctx): Promise<CommandResult> {
      const action = ctx.args[0]?.toLowerCase()

      if (action === 'set') {
        const wsPath = ctx.args.slice(1).join(' ')
        if (!wsPath) {
          return { content: 'Usage: /workspace set <path>', error: true }
        }
        await workspaceStore.set(ctx.conversationKey, wsPath)
        return { content: `Workspace set to \`${wsPath}\`` }
      }

      if (action === 'unset') {
        await workspaceStore.remove(ctx.conversationKey)
        return { content: `Workspace reset to default (\`${defaultWorkspace}\`)` }
      }

      if (action === 'list') {
        const entries = workspaceStore.entries()
        const keys = Object.keys(entries)
        if (keys.length === 0) {
          return { content: 'No workspace overrides. All chats use the default workspace.' }
        }
        const lines = keys.map((k) => `• ${k} → \`${entries[k]}\``)
        return { content: `**Workspace overrides:**\n${lines.join('\n')}\n\nDefault: \`${defaultWorkspace}\`` }
      }

      // No action — show current workspace for this chat
      const override = workspaceStore.get(ctx.conversationKey)
      if (override) {
        return { content: `Current: \`${override}\` (override)\nDefault: \`${defaultWorkspace}\`` }
      }
      return { content: `Current: \`${defaultWorkspace}\` (default)` }
    }
  }
}
