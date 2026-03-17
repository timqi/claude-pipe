import { config as loadEnv } from 'dotenv'
import * as path from 'node:path'

import { getConfigDir, readSettings, settingsExist } from './settings.js'
import { configSchema, type ClaudePipeConfig } from './schema.js'

/**
 * Loads runtime configuration from `~/.claude-pipe/settings.json`.
 *
 * Environment variables from `~/.claude-pipe/.env` and local `.env` are loaded
 * for secrets (e.g. DISCORD_TOKEN) but all other config comes from settings.json.
 */
export function loadConfig(): ClaudePipeConfig {
  const defaultSummaryTemplate =
    'Workspace: {{workspace}}\n' +
    'Request: {{request}}\n' +
    'Provide a concise summary with key files and actionable insights.'

  // Load env from ~/.claude-pipe/.env first, then local .env for secrets.
  loadEnv({ path: path.join(getConfigDir(), '.env') })
  loadEnv()

  if (!settingsExist()) {
    throw new Error(
      'No settings.json found. Run `claude-pipe --reconfigure` to create one.'
    )
  }

  const s = readSettings()

  // Apply env vars from settings to process.env (don't override existing vars)
  if (s.env) {
    for (const [key, value] of Object.entries(s.env)) {
      if (process.env[key] === undefined) {
        process.env[key] = value
      }
    }
  }

  if ((s.channel as string) === 'telegram') {
    throw new Error(
      'Telegram is no longer supported. Run `claude-pipe --reconfigure` to choose Discord or CLI.'
    )
  }

  const discordEnabled = s.channel === 'discord'
  const cliEnabled = s.channel === 'cli'

  const configDir = getConfigDir()

  return configSchema.parse({
    model: s.model,
    workspace: s.workspace,
    channelWorkspaces: s.channelWorkspaces,
    channels: {
      discord: {
        enabled: discordEnabled,
        token: discordEnabled ? s.token : '',
        allowFrom: discordEnabled ? s.allowFrom : [],
        allowChannels: discordEnabled ? s.allowChannels : undefined
      },
      cli: {
        enabled: cliEnabled,
        allowFrom: cliEnabled ? s.allowFrom : []
      }
    },
    summaryPrompt: {
      enabled: true,
      template: defaultSummaryTemplate
    },
    personality: s.personality,
    sessionStorePath: path.join(configDir, 'sessions.json'),
    transcriptLog: {
      enabled: s.transcriptLog?.enabled ?? false,
      path: s.transcriptLog?.path ?? path.join(configDir, 'transcript.jsonl'),
      maxBytes: s.transcriptLog?.maxBytes ?? 1_000_000,
      maxFiles: s.transcriptLog?.maxFiles ?? 3
    },
    logLevel: s.logLevel ?? 'verbose',
    maxToolIterations: 20
  })
}
