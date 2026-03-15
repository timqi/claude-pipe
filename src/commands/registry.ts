import type { CommandDefinition, CommandMeta } from './types.js'

/**
 * Central registry for all bot commands.
 *
 * Provides O(1) lookup by name or alias and exposes metadata
 * for Discord slash-command registration.
 */
export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>()

  /** Registers a command definition. */
  register(command: CommandDefinition): void {
    this.commands.set(command.name.toLowerCase(), command)
  }

  /** Looks up a command by name (case-insensitive). */
  get(name: string): CommandDefinition | undefined {
    return this.commands.get(name.toLowerCase())
  }

  /** Returns true when a name maps to a registered command. */
  has(name: string): boolean {
    return this.commands.has(name.toLowerCase())
  }

  /** Returns all registered command definitions. */
  all(): CommandDefinition[] {
    return [...this.commands.values()]
  }

  /**
   * Builds serializable metadata suitable for Discord slash-command registration.
   */
  toMeta(): CommandMeta[] {
    return this.all().map((cmd) => {
      const group = cmd.category !== 'utility' ? cmd.category : undefined
      // Strip group prefix from name for Discord subcommands
      // e.g. "session_clear" under group "session" → subcommand "new"
      const shortName =
        group && cmd.name.startsWith(`${group}_`)
          ? cmd.name.slice(group.length + 1)
          : cmd.name
      return {
        name: shortName,
        description: cmd.description,
        category: cmd.category,
        ...(group ? { group } : {}),
        ...(cmd.args?.length ? { args: cmd.args } : {})
      }
    })
  }
}
