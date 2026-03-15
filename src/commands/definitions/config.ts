import type { CommandDefinition, CommandResult } from '../types.js'

/**
 * /config_set <key> <value>
 * Sets a runtime configuration value.
 */
export function configSetCommand(
  setConfigValue: (key: string, value: string) => boolean
): CommandDefinition {
  return {
    name: 'config_set',
    category: 'config',
    description: 'Set a runtime configuration value',
    usage: '/config_set <key> <value>',
    args: [
      { name: 'key', description: 'Configuration key', required: true },
      { name: 'value', description: 'Value to set', required: true }
    ],
    permission: 'admin',
    async execute(ctx): Promise<CommandResult> {
      const key = ctx.args[0]
      const value = ctx.args.slice(1).join(' ')
      if (!key || !value) {
        return { content: 'Usage: /config_set <key> <value>', error: true }
      }
      const ok = setConfigValue(key, value)
      if (!ok) {
        return { content: `Unknown configuration key: \`${key}\``, error: true }
      }
      return { content: `Configuration updated: \`${key}\` = \`${value}\`` }
    }
  }
}

/**
 * /config_get [key]
 * Shows current configuration values.
 */
export function configGetCommand(
  getConfigValue: (key?: string) => Record<string, string> | string | undefined
): CommandDefinition {
  return {
    name: 'config_get',
    category: 'config',
    description: 'Show current configuration values',
    usage: '/config_get [key]',
    args: [{ name: 'key', description: 'Configuration key', required: false }],
    permission: 'admin',
    async execute(ctx): Promise<CommandResult> {
      const key = ctx.args[0]
      const result = getConfigValue(key)

      if (result === undefined) {
        return { content: `Unknown configuration key: \`${key ?? ''}\``, error: true }
      }

      if (typeof result === 'string') {
        return { content: `\`${key ?? ''}\` = \`${result}\`` }
      }

      const lines = Object.entries(result).map(([k, v]) => `• \`${k}\` = \`${v}\``)
      return { content: `**Configuration:**\n${lines.join('\n')}` }
    }
  }
}
