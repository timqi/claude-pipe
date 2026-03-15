import { describe, expect, it } from 'vitest'

import { CommandRegistry } from '../src/commands/registry.js'
import type { CommandDefinition } from '../src/commands/types.js'

function makeCommand(overrides?: Partial<CommandDefinition>): CommandDefinition {
  return {
    name: 'test',
    category: 'utility',
    description: 'A test command',
    permission: 'user',
    async execute() {
      return { content: 'ok' }
    },
    ...overrides
  }
}

describe('CommandRegistry', () => {
  it('registers and retrieves a command by name', () => {
    const registry = new CommandRegistry()
    const cmd = makeCommand({ name: 'ping' })
    registry.register(cmd)

    expect(registry.get('ping')).toBe(cmd)
    expect(registry.has('ping')).toBe(true)
  })

  it('is case-insensitive', () => {
    const registry = new CommandRegistry()
    registry.register(makeCommand({ name: 'Ping' }))

    expect(registry.has('PING')).toBe(true)
    expect(registry.has('ping')).toBe(true)
  })

  it('returns undefined for unknown commands', () => {
    const registry = new CommandRegistry()
    expect(registry.get('nonexistent')).toBeUndefined()
    expect(registry.has('nonexistent')).toBe(false)
  })

  it('lists all registered commands', () => {
    const registry = new CommandRegistry()
    registry.register(makeCommand({ name: 'a' }))
    registry.register(makeCommand({ name: 'b' }))

    const all = registry.all()
    expect(all).toHaveLength(2)
    expect(all.map((c) => c.name).sort()).toEqual(['a', 'b'])
  })

  it('generates serializable command metadata', () => {
    const registry = new CommandRegistry()
    registry.register(makeCommand({ name: 'ping', category: 'utility' }))
    registry.register(makeCommand({ name: 'session_clear', category: 'session' }))

    const meta = registry.toMeta()
    const ping = meta.find((m) => m.name === 'ping')
    const clearCmd = meta.find((m) => m.name === 'clear')

    expect(ping?.group).toBeUndefined()
    // Discord subcommand name strips group prefix: "session_clear" → "clear"
    expect(clearCmd?.name).toBe('clear')
    expect(clearCmd?.group).toBe('session')
  })
})
