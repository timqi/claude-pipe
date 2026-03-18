import type { WorkspaceStore } from '../../core/workspace-store.js'
import type { CommandDefinition, CommandResult } from '../types.js'

/**
 * /lsproj
 * Lists all channel→workspace mappings, resolving Discord channel names concurrently.
 */
export function lsProjCommand(
  workspaceStore: WorkspaceStore,
  getChannelName: (chatId: string) => Promise<string | undefined>
): CommandDefinition {
  return {
    name: 'lsproj',
    category: 'utility',
    description: 'List all channel→workspace mappings',
    permission: 'user',
    async execute(): Promise<CommandResult> {
      const entries = Object.entries(workspaceStore.entries())
      if (entries.length === 0) {
        return { content: 'No workspace mappings.' }
      }

      // Resolve all channel names concurrently
      const resolved = await Promise.all(
        entries.map(async ([key, workspace]) => {
          const chatId = key.includes(':') ? key.split(':')[1] : undefined
          const name = chatId ? await getChannelName(chatId) : undefined
          const label = name ? `#${name}` : key
          return `• ${label} → ${workspace}`
        })
      )

      return { content: resolved.join('\n') }
    }
  }
}
