import type { CommandDefinition, CommandMeta } from './types.js'

/**
 * Central registry for all bot commands.
 *
 * Provides O(1) lookup by name or alias and exposes metadata
 * for Discord slash-command registration.
 */
export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>()
  /** Maps every alias (and primary name) to the canonical name. */
  private readonly aliasMap = new Map<string, string>()

  /** Registers a command definition, indexing its name and aliases. */
  register(command: CommandDefinition): void {
    const key = command.name.toLowerCase()
    this.commands.set(key, command)
    this.aliasMap.set(key, key)

    for (const alias of command.aliases ?? []) {
      this.aliasMap.set(alias.toLowerCase(), key)
    }
  }

  /** Looks up a command by name or alias (case-insensitive). */
  get(nameOrAlias: string): CommandDefinition | undefined {
    const canonical = this.aliasMap.get(nameOrAlias.toLowerCase())
    if (!canonical) return undefined
    return this.commands.get(canonical)
  }

  /** Returns true when a name/alias maps to a registered command. */
  has(nameOrAlias: string): boolean {
    return this.aliasMap.has(nameOrAlias.toLowerCase())
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
      // e.g. "session_new" under group "session" → subcommand "new"
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
