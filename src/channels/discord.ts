import {
  ChannelType,
  Client,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  REST,
  Routes,
  type ChatInputCommandInteraction,
  MessageFlags,
  type Message
} from 'discord.js'

import type { CommandMeta } from '../commands/types.js'
import type { ClaudePipeConfig } from '../config/schema.js'
import { MessageBus } from '../core/bus.js'
import { retry } from '../core/retry.js'
import { chunkText } from '../core/text-chunk.js'
import type { FileAttachment, InboundMessage, Logger, OutboundMessage, SentMessage } from '../core/types.js'
import { isSenderAllowed, type Channel } from './base.js'

const DISCORD_MESSAGE_MAX = 1800
const SEND_RETRY_ATTEMPTS = 3
const SEND_RETRY_BACKOFF_MS = 200

/** Separates the status footer (e.g. `\n\n-# 22:39:48 · Done`) from body text. */
const FOOTER_RE = /\n\n-# \d{2}:\d{2}:\d{2} · .+$/

function splitFooter(content: string): { body: string; footer: string } {
  const match = FOOTER_RE.exec(content)
  if (!match) return { body: content, footer: '' }
  return { body: content.slice(0, match.index), footer: match[0] }
}

/**
 * Discord adapter using discord.js gateway client + channel send API.
 */
export class DiscordChannel implements Channel {
  readonly name = 'discord' as const
  private client: Client | null = null
  /** Pending deferred interactions keyed by chatId, so send() can resolve them. */
  private pendingInteractions = new Map<string, ChatInputCommandInteraction>()
  /** Tracks overflow chunk message IDs per primary message, so editMessage can clean them up. */
  private overflowMessages = new Map<string, string[]>()

  constructor(
    private readonly config: ClaudePipeConfig,
    private readonly bus: MessageBus,
    private readonly logger: Logger
  ) {}

  /** Initializes and logs in the Discord bot when enabled. */
  async start(): Promise<void> {
    if (!this.config.channels.discord.enabled) return
    if (!this.config.channels.discord.token) {
      this.logger.warn('channel.discord.misconfigured', { reason: 'missing token' })
      return
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent
      ],
      partials: [Partials.Channel]
    })

    this.client.on('ready', () => {
      this.logger.info('channel.discord.ready', {
        user: this.client?.user?.tag ?? 'unknown'
      })
    })

    this.client.on('messageCreate', async (message) => {
      await this.onMessage(message)
    })

    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isChatInputCommand()) return
      await this.onInteraction(interaction as ChatInputCommandInteraction)
    })

    this.client.on('error', (error) => {
      this.logger.error('channel.discord.error', { error: error.message })
    })

    await this.client.login(this.config.channels.discord.token)
    this.logger.info('channel.discord.start')
  }

  /** Logs out and destroys the Discord client. */
  async stop(): Promise<void> {
    if (!this.client) return
    await this.client.destroy()
    this.client = null
    this.logger.info('channel.discord.stop')
  }

  /** Sends a text message to a Discord channel by ID. Returns a SentMessage for the last chunk. */
  async send(message: OutboundMessage): Promise<SentMessage | void> {
    if (!this.client || !this.config.channels.discord.enabled) return

    const channel = await this.client.channels.fetch(message.chatId)
    if (!channel) {
      this.logger.warn('channel.discord.send_failed', {
        reason: 'channel not found',
        chatId: message.chatId
      })
      return
    }

    if (!channel.isTextBased() || !('send' in channel) || typeof channel.send !== 'function') {
      this.logger.warn('channel.discord.send_failed', {
        reason: 'channel is not send-capable text channel',
        chatId: message.chatId
      })
      return
    }

    if (message.metadata?.kind === 'progress') {
      if ('sendTyping' in channel && typeof channel.sendTyping === 'function') {
        try {
          await retry(
            async () => {
              await channel.sendTyping()
            },
            {
              attempts: SEND_RETRY_ATTEMPTS,
              backoffMs: SEND_RETRY_BACKOFF_MS
            }
          )
        } catch (error) {
          this.logger.error('channel.discord.typing_failed', {
            chatId: message.chatId,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
      return
    }

    const pendingInteraction = this.pendingInteractions.get(message.chatId)
    if (pendingInteraction) {
      this.pendingInteractions.delete(message.chatId)
    }

    const { body, footer } = splitFooter(message.content)
    const chunks = chunkText(body, DISCORD_MESSAGE_MAX)

    let primaryMessageId: string | undefined
    const overflowIds: string[] = []
    let isFirstChunk = true
    for (let i = 0; i < chunks.length; i++) {
      const part = i === chunks.length - 1 ? chunks[i]! + footer : chunks[i]!
      try {
        await retry(
          async () => {
            // Resolve the deferred interaction for the first chunk,
            // then fall back to channel.send() for subsequent chunks.
            if (isFirstChunk && pendingInteraction) {
              const sent = await pendingInteraction.editReply({ content: part, flags: MessageFlags.SuppressEmbeds })
              if (sent && typeof sent === 'object' && 'id' in sent) {
                primaryMessageId = String(sent.id)
              }
            } else {
              const sent = await channel.send({ content: part, flags: MessageFlags.SuppressEmbeds })
              if (sent && typeof sent === 'object' && 'id' in sent) {
                const id = String(sent.id)
                if (!primaryMessageId) primaryMessageId = id
                else overflowIds.push(id)
              }
            }
            isFirstChunk = false
          },
          {
            attempts: SEND_RETRY_ATTEMPTS,
            backoffMs: SEND_RETRY_BACKOFF_MS
          }
        )
      } catch (error) {
        this.logger.error('channel.discord.send_failed', {
          chatId: message.chatId,
          error: error instanceof Error ? error.message : String(error)
        })
        break
      }
    }

    if (primaryMessageId) {
      if (overflowIds.length > 0) {
        this.overflowMessages.set(primaryMessageId, overflowIds)
      }
      return { channel: 'discord', chatId: message.chatId, messageId: primaryMessageId }
    }
  }

  /** Edits a previously sent Discord message, deleting old overflow and sending new overflow as needed. */
  async editMessage(sent: SentMessage, newContent: string): Promise<void> {
    if (!this.client || !this.config.channels.discord.enabled) return

    const channel = await this.client.channels.fetch(sent.chatId)
    if (!channel || !channel.isTextBased()) return

    // Delete previous overflow messages before re-editing
    const oldOverflow = this.overflowMessages.get(sent.messageId)
    if (oldOverflow && 'messages' in channel && channel.messages) {
      for (const id of oldOverflow) {
        try { await channel.messages.delete(id) } catch { /* already deleted or inaccessible */ }
      }
      this.overflowMessages.delete(sent.messageId)
    }

    const { body, footer } = splitFooter(newContent)
    const chunks = chunkText(body, DISCORD_MESSAGE_MAX)
    const last = chunks.length - 1
    try {
      if ('messages' in channel && channel.messages) {
        const msg = await channel.messages.fetch(sent.messageId)
        const firstContent = chunks.length === 1 ? (chunks[0] ?? body) + footer : (chunks[0] ?? body)
        await msg.edit({ content: firstContent })
      }
      // Send remaining chunks as new messages and track their IDs
      const newOverflow: string[] = []
      if ('send' in channel && typeof channel.send === 'function') {
        for (let i = 1; i < chunks.length; i++) {
          const part = i === last ? chunks[i]! + footer : chunks[i]!
          const overflow = await channel.send({ content: part, flags: MessageFlags.SuppressEmbeds })
          if (overflow && typeof overflow === 'object' && 'id' in overflow) {
            newOverflow.push(String(overflow.id))
          }
        }
      }
      if (newOverflow.length > 0) {
        this.overflowMessages.set(sent.messageId, newOverflow)
      }
    } catch (error) {
      this.logger.error('channel.discord.edit_failed', {
        chatId: sent.chatId,
        messageId: sent.messageId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  /** Discord does not support message drafts; this is a no-op. */
  async sendMessageDraft(_chatId: string, _text: string): Promise<SentMessage | void> {
    // Discord has no equivalent streaming draft API
  }

  /** Sends a file as a Discord attachment. */
  async sendFile(chatId: string, attachment: FileAttachment): Promise<SentMessage | void> {
    if (!this.client || !this.config.channels.discord.enabled) return

    const channel = await this.client.channels.fetch(chatId)
    if (!channel || !channel.isTextBased() || !('send' in channel) || typeof channel.send !== 'function') return

    try {
      const sent = await channel.send({
        content: attachment.caption ?? '',
        files: [attachment.filePath]
      })
      if (sent && typeof sent === 'object' && 'id' in sent) {
        return { channel: 'discord', chatId, messageId: String(sent.id) }
      }
    } catch (error) {
      this.logger.error('channel.discord.send_file_failed', {
        chatId,
        filePath: attachment.filePath,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  /** Resolves a Discord channel ID to its name. Returns undefined for DMs. */
  async getChannelName(chatId: string): Promise<string | undefined> {
    if (!this.client) return undefined
    try {
      const channel = await this.client.channels.fetch(chatId)
      if (!channel || !('name' in channel) || typeof channel.name !== 'string') return undefined
      return channel.name
    } catch {
      return undefined
    }
  }

  /**
   * Creates a private text channel in the same guild as the source channel.
   * Only the invoking user and the bot can see the new channel.
   */
  async createPrivateChannel(
    sourceChatId: string,
    channelName: string,
    userId: string
  ): Promise<{ channelId: string } | { error: string }> {
    if (!this.client) return { error: 'Discord client not connected.' }

    const sourceChannel = await this.client.channels.fetch(sourceChatId)
    if (!sourceChannel || !('guild' in sourceChannel) || !sourceChannel.guild) {
      return { error: 'Not supported in DMs.' }
    }

    const guild = sourceChannel.guild
    const botId = this.client.user?.id
    if (!botId) return { error: 'Bot user not available.' }

    try {
      const newChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
          { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
        ]
      })
      return { channelId: newChannel.id }
    } catch (error) {
      return { error: `Failed to create channel: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /** Deletes a Discord channel by ID. */
  async deleteChannel(chatId: string): Promise<{ ok: true } | { error: string }> {
    if (!this.client) return { error: 'Discord client not connected.' }
    try {
      const channel = await this.client.channels.fetch(chatId)
      if (!channel) return { error: 'Channel not found.' }
      if (!('delete' in channel) || typeof channel.delete !== 'function') {
        return { error: 'Cannot delete this channel type.' }
      }
      await channel.delete()
      return { ok: true }
    } catch (error) {
      return { error: `Failed to delete channel: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  private async onMessage(message: Message): Promise<void> {
    if (message.author.bot) return

    const senderId = message.author.id
    if (!isSenderAllowed(senderId, this.config.channels.discord.allowFrom)) {
      this.logger.warn('channel.discord.denied', { senderId })
      return
    }

    if (
      message.channel.type !== ChannelType.GuildText &&
      message.channel.type !== ChannelType.PublicThread &&
      message.channel.type !== ChannelType.PrivateThread &&
      message.channel.type !== ChannelType.DM
    ) {
      return
    }

    const inbound: InboundMessage = {
      channel: 'discord',
      senderId,
      chatId: message.channelId,
      content: message.content?.trim() || '[empty message]',
      timestamp: new Date().toISOString(),
      metadata: {
        messageId: message.id,
        guildId: message.guildId ?? undefined
      }
    }

    await this.bus.publishInbound(inbound)
  }

  /**
   * Handles Discord slash-command interactions.
   *
   * Converts `/command subcommand ...options` into a text-based command string
   * (e.g. `/session_clear`) and publishes it as an inbound message so the
   * unified command handler in AgentLoop processes it.
   */
  private async onInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
    const senderId = interaction.user.id
    if (!isSenderAllowed(senderId, this.config.channels.discord.allowFrom)) {
      this.logger.warn('channel.discord.denied', { senderId })
      await interaction.reply({ content: 'You are not authorised.', ephemeral: true })
      return
    }

    const subcommand = interaction.options.getSubcommand(false)
    const commandName = subcommand
      ? `/${interaction.commandName}_${subcommand}`
      : `/${interaction.commandName}`

    // Collect all option values — subcommand options are nested under data[0].options
    const rawOpts = subcommand
      ? (interaction.options.data[0]?.options ?? [])
      : interaction.options.data
    const argValues = rawOpts
      .filter((o) => o.value !== undefined)
      .map((o) => String(o.value))
    const content = argValues.length > 0
      ? `${commandName} ${argValues.join(' ')}`
      : commandName

    await interaction.deferReply()
    this.pendingInteractions.set(interaction.channelId, interaction)

    const inbound: InboundMessage = {
      channel: 'discord',
      senderId,
      chatId: interaction.channelId,
      content,
      timestamp: new Date().toISOString(),
      metadata: {
        interactionId: interaction.id,
        guildId: interaction.guildId ?? undefined
      }
    }

    await this.bus.publishInbound(inbound)
  }

  /**
   * Registers Discord application (slash) commands using the REST API.
   *
   * Should be called once during deployment, not on every start.
   * Accepts command metadata from {@link CommandRegistry.toMeta()}.
   */
  static async registerSlashCommands(
    token: string,
    applicationId: string,
    commands: CommandMeta[],
    logger: Logger
  ): Promise<void> {
    const grouped = new Map<string, CommandMeta[]>()
    const standalone: CommandMeta[] = []

    for (const cmd of commands) {
      if (cmd.group) {
        const list = grouped.get(cmd.group) ?? []
        list.push(cmd)
        grouped.set(cmd.group, list)
      } else {
        standalone.push(cmd)
      }
    }

    const body: Array<Record<string, unknown>> = []

    const buildOptions = (args?: Array<{ name: string; description: string; required?: boolean }>) =>
      args?.length
        ? args.map((arg) => ({
            type: 3, // STRING
            name: arg.name,
            description: arg.description,
            required: arg.required ?? true
          }))
        : undefined

    // Standalone commands (e.g. /help, /ping)
    for (const cmd of standalone) {
      const options = buildOptions(cmd.args)
      body.push({
        name: cmd.name,
        description: cmd.description,
        ...(options ? { options } : {})
      })
    }

    // Grouped commands as subcommands (e.g. /session new, /claude ask)
    for (const [group, cmds] of grouped) {
      body.push({
        name: group,
        description: `${group.charAt(0).toUpperCase() + group.slice(1)} commands`,
        options: cmds.map((cmd) => {
          const subOpts = buildOptions(cmd.args)
          return {
            type: 1, // SUB_COMMAND
            name: cmd.name,
            description: cmd.description,
            ...(subOpts ? { options: subOpts } : {})
          }
        })
      })
    }

    const rest = new REST({ version: '10' }).setToken(token)
    await rest.put(Routes.applicationCommands(applicationId), { body })
    logger.info('channel.discord.slash_commands_registered', { count: body.length })
  }

  /** Registers slash commands using the live bot client's token and application ID. */
  async registerCommands(commands: CommandMeta[]): Promise<void> {
    if (!this.client?.application) {
      throw new Error('Discord client not connected.')
    }
    const token = this.config.channels.discord.token
    const appId = this.client.application.id
    await DiscordChannel.registerSlashCommands(token, appId, commands, this.logger)
  }
}
