import type { ClaudePipeConfig } from '../../config/schema.js'
import type { CommandDefinition, CommandResult } from '../types.js'
import type { CommandRegistry } from '../registry.js'

/**
 * /help [command]
 * Lists all commands or shows detailed help for a specific command.
 */
export function helpCommand(registry: CommandRegistry): CommandDefinition {
  return {
    name: 'help',
    category: 'utility',
    description: 'Show available commands or help for a specific command',
    usage: '/help [command]',
    aliases: [],
    permission: 'user',
    async execute(ctx): Promise<CommandResult> {
      if (ctx.args.length > 0 && ctx.args[0]) {
        const target = registry.get(ctx.args[0])
        if (!target) {
          return { content: `Unknown command: \`${ctx.args[0]}\``, error: true }
        }
        const lines = [
          `**/${target.name}** — ${target.description}`,
          ...(target.usage ? [`Usage: ${target.usage}`] : []),
          ...(target.aliases && target.aliases.length > 0
            ? [`Aliases: ${target.aliases.map((a) => `/${a}`).join(', ')}`]
            : []),
          `Permission: ${target.permission}`
        ]
        return { content: lines.join('\n') }
      }

      const grouped = new Map<string, CommandDefinition[]>()
      for (const cmd of registry.all()) {
        const list = grouped.get(cmd.category) ?? []
        list.push(cmd)
        grouped.set(cmd.category, list)
      }

      const sections: string[] = []
      for (const [category, commands] of grouped) {
        const heading = category.charAt(0).toUpperCase() + category.slice(1)
        const items = commands.map((c) => `  /${c.name} — ${c.description}`)
        sections.push(`**${heading}:**\n${items.join('\n')}`)
      }

      return { content: sections.join('\n\n') }
    }
  }
}

/**
 * /status
 * Reports basic runtime status.
 */
export function statusCommand(
  getStatus: (conversationKey: string) => {
    model: string
    workspace: string
    currentWorkspace: string
    channels: string[]
    sessions: Array<{ key: string; workspace: string; updatedAt: string }>
  }
): CommandDefinition {
  return {
    name: 'status',
    category: 'utility',
    description: 'Show bot runtime status',
    aliases: [],
    permission: 'user',
    async execute(ctx): Promise<CommandResult> {
      const status = getStatus(ctx.conversationKey)
      const lines = [
        '**Status:**',
        `• Model: ${status.model}`,
        `• Workspace: ${status.currentWorkspace}`,
        `• Default workspace: ${status.workspace}`,
        `• Channels: ${status.channels.join(', ')}`
      ]
      if (status.sessions.length > 0) {
        lines.push('', '**Active sessions:**')
        for (const s of status.sessions) {
          lines.push(`• ${s.key} → ${s.workspace} (${s.updatedAt})`)
        }
      } else {
        lines.push('', 'No active sessions.')
      }
      return { content: lines.join('\n') }
    }
  }
}

/**
 * /reload
 * Reloads configuration from disk without restarting.
 */
export function reloadCommand(
  config: ClaudePipeConfig,
  reloadConfig: () => ClaudePipeConfig
): CommandDefinition {
  return {
    name: 'reload',
    category: 'utility',
    description: 'Reload configuration from disk',
    aliases: [],
    permission: 'admin',
    async execute(): Promise<CommandResult> {
      try {
        const fresh = reloadConfig()
        // Mutate the live config object in-place
        Object.assign(config, fresh)
        const parts = [
          'Configuration reloaded.',
          `- Model: ${config.model}`,
          `- Workspace: ${config.workspace}`
        ]
        if (config.personality?.name) {
          parts.push(`- Personality: ${config.personality.name} — ${config.personality.traits}`)
        }
        return { content: parts.join('\n') }
      } catch (error) {
        return {
          content: `Reload failed: ${error instanceof Error ? error.message : String(error)}`,
          error: true
        }
      }
    }
  }
}

/**
 * /ping
 * Simple health-check.
 */
export function pingCommand(): CommandDefinition {
  return {
    name: 'ping',
    category: 'utility',
    description: 'Health check — replies with pong',
    aliases: [],
    permission: 'user',
    async execute(): Promise<CommandResult> {
      return { content: 'pong 🏓' }
    }
  }
}

/**
 * /stop
 * Cancels the in-progress Claude turn for the current conversation.
 */
export function stopCommand(
  cancelTurn: (conversationKey: string) => void
): CommandDefinition {
  return {
    name: 'stop',
    category: 'utility',
    description: 'Cancel the in-progress Claude turn for this chat',
    aliases: ['cancel'],
    permission: 'user',
    async execute(ctx): Promise<CommandResult> {
      cancelTurn(ctx.conversationKey)
      return { content: 'Stopped.' }
    }
  }
}

/**
 * /restart
 * Restarts the bot process. Relies on a process manager (systemd, PM2, etc.) to bring it back up.
 */
export function restartCommand(): CommandDefinition {
  return {
    name: 'restart',
    category: 'utility',
    description: 'Restart the bot process',
    aliases: [],
    permission: 'admin',
    async execute(): Promise<CommandResult> {
      setImmediate(() => process.exit(0))
      return { content: 'Restarting...' }
    }
  }
}
