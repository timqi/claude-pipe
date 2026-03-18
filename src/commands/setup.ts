import type { ClaudePipeConfig } from '../config/schema.js'
import { loadConfig } from '../config/load.js'
import type { ClaudeSessionService } from '../core/claude-sessions.js'
import type { ModelClient } from '../core/model-client.js'
import type { SessionStore } from '../core/session-store.js'
import type { WorkspaceStore } from '../core/workspace-store.js'
import { resolveWorkspace } from '../core/workspace.js'
import {
  sessionClearCommand,
  sessionListCommand,
  sessionSelectCommand,
  sessionDeleteCommand,
  sessionNewchatCommand,
  sessionDelchatCommand
} from './definitions/session.js'
import { helpCommand, statusCommand, pingCommand, reloadCommand, stopCommand, restartCommand, registerCommand } from './definitions/utility.js'
import { claudeAskCommand, claudeModelCommand } from './definitions/claude.js'
import { configSetCommand, configGetCommand } from './definitions/config.js'

import { setProjCommand } from './definitions/project.js'
import { CommandHandler } from './handler.js'
import { CommandRegistry } from './registry.js'
import type { CommandDefinition } from './types.js'

/**
 * Dependencies required by built-in commands.
 */
export interface CommandDependencies {
  config: ClaudePipeConfig
  claude: ModelClient
  sessionStore: SessionStore
  claudeSessionService: ClaudeSessionService
  workspaceStore: WorkspaceStore
  /** Creates a private Discord channel. Undefined when Discord is not available. */
  createDiscordChannel?: (sourceChatId: string, channelName: string, userId: string) => Promise<{ channelId: string } | { error: string }>
  /** Sends a message to a Discord channel. Undefined when Discord is not available. */
  sendToDiscordChannel?: (chatId: string, content: string) => Promise<void>
  /** Resolves a Discord channel ID to its name. Undefined when Discord is not available. */
  getDiscordChannelName?: (chatId: string) => Promise<string | undefined>
  /** Deletes a Discord channel. Undefined when Discord is not available. */
  deleteDiscordChannel?: (chatId: string) => Promise<{ ok: true } | { error: string }>
  /** Registers Discord slash commands. Undefined when Discord is not available. */
  registerDiscordCommands?: (commands: import('./types.js').CommandMeta[]) => Promise<void>
}

/**
 * Options for the command setup.
 */
export interface SetupCommandsOptions {
  /** Additional custom commands to register alongside built-ins. */
  customCommands?: CommandDefinition[]
  /** Sender IDs that have admin-level permission. */
  adminIds?: string[]
}

/**
 * Automatically registers all built-in commands and any custom commands,
 * then returns a ready-to-use {@link CommandHandler}.
 *
 * This replaces manual per-command wiring in the application bootstrap.
 */
export function setupCommands(
  deps: CommandDependencies,
  options: SetupCommandsOptions = {}
): { registry: CommandRegistry; handler: CommandHandler } {
  const { config, claude, sessionStore, claudeSessionService, workspaceStore } = deps
  const registry = new CommandRegistry()
  const getWorkspace = (key: string): string => resolveWorkspace(key, workspaceStore) ?? '(not set)'
  const startNewSession = async (key: string): Promise<void> => {
    await sessionStore.clear(key)
    await claude.startNewSession(key)
  }

  const getStatus = async (conversationKey: string) => {
    const currentWorkspace = resolveWorkspace(conversationKey, workspaceStore)
    const currentSessionId = sessionStore.get(conversationKey)?.sessionId
    let sessionInfo = undefined
    if (currentSessionId && currentWorkspace) {
      sessionInfo = await claudeSessionService.get(currentWorkspace, currentSessionId) ?? undefined
    }
    return {
      model: config.model,
      currentWorkspace: currentWorkspace ?? '(not set)',
      channels: [
        ...(config.channels.discord.enabled ? ['discord'] : []),
        ...(config.channels.cli?.enabled ? ['cli'] : [])
      ],
      sessionInfo,
      activeTurns: claude.getActiveTurns()
    }
  }

  // --- Session commands ---
  registry.register(sessionClearCommand((key) => claude.startNewSession(key)))
  registry.register(sessionListCommand(getWorkspace, claudeSessionService, (key) => sessionStore.get(key)?.sessionId))
  registry.register(
    sessionSelectCommand(getWorkspace, claudeSessionService, (key, sessionId) =>
      sessionStore.set(key, sessionId)
    )
  )
  registry.register(
    sessionDeleteCommand(getWorkspace, claudeSessionService, (key) => sessionStore.get(key)?.sessionId, (key) =>
      sessionStore.clear(key)
    )
  )

  // --- Claude commands ---
  registry.register(
    claudeAskCommand(async (conversationKey, prompt, channel, chatId) =>
      claude.runTurn(conversationKey, prompt, {
        workspace: resolveWorkspace(conversationKey, workspaceStore) ?? '.',
        channel,
        chatId
      })
    )
  )
  registry.register(claudeModelCommand(() => config.model))

  // --- Config commands ---
  const mutableConfig: Record<string, string> = {}
  registry.register(
    configSetCommand((key, value) => {
      const allowed = ['summaryPromptEnabled']
      if (!allowed.includes(key)) return false
      mutableConfig[key] = value
      return true
    })
  )
  registry.register(
    configGetCommand((key) => {
      if (key) return mutableConfig[key]
      return { model: config.model, ...mutableConfig }
    })
  )

  // --- Project command ---
  registry.register(setProjCommand(workspaceStore, sessionStore, startNewSession, getStatus))

  // --- Session newchat / delchat ---
  if (deps.createDiscordChannel && deps.sendToDiscordChannel && deps.getDiscordChannelName) {
    registry.register(sessionNewchatCommand(
      workspaceStore,
      deps.createDiscordChannel,
      deps.sendToDiscordChannel,
      deps.getDiscordChannelName
    ))
  }
  if (deps.deleteDiscordChannel) {
    registry.register(sessionDelchatCommand(workspaceStore, sessionStore, deps.deleteDiscordChannel))
  }

  // --- Utility commands ---
  registry.register(statusCommand(getStatus))
  registry.register(pingCommand())
  registry.register(reloadCommand(config, loadConfig))
  registry.register(stopCommand((key) => claude.cancelTurn(key)))
  registry.register(restartCommand())

  // --- Custom commands ---
  for (const cmd of options.customCommands ?? []) {
    registry.register(cmd)
  }

  // --- Register command (must be before help so it appears in the help list) ---
  if (deps.registerDiscordCommands) {
    registry.register(registerCommand(registry, deps.registerDiscordCommands))
  }

  // Help must be registered last so it can list all commands including custom ones
  registry.register(helpCommand(registry))

  const adminIds = options.adminIds ?? [
    ...config.channels.discord.allowFrom
  ]

  return { registry, handler: new CommandHandler(registry, adminIds) }
}
