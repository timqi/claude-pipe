import * as path from 'node:path'

import { getConfigDir, readSettings, settingsExist } from './settings.js'
import { configSchema, type ClaudePipeConfig } from './schema.js'

/**
 * Loads runtime configuration from `~/.claude-pipe/settings.json`.
 */
export function loadConfig(): ClaudePipeConfig {
  const defaultSummaryTemplate =
    'Workspace: {{workspace}}\n' +
    'Request: {{request}}\n' +
    'Provide a concise summary with key files and actionable insights.'

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

  if (!s.allowFrom || s.allowFrom.length === 0) {
    throw new Error(
      'allowFrom is empty — all messages would be rejected. Add at least one user ID to settings.json.'
    )
  }

  const discordEnabled = s.channel === 'discord'
  const cliEnabled = s.channel === 'cli'

  const configDir = getConfigDir()

  return configSchema.parse({
    model: s.model,
    channels: {
      discord: {
        enabled: discordEnabled,
        token: discordEnabled ? (process.env.CLAUDEPIPE_DISCORD_TOKEN || s.token) : '',
        allowFrom: discordEnabled ? s.allowFrom : []
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
