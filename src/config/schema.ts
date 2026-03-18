import { z } from 'zod'

const channelSchema = z.object({
  enabled: z.boolean(),
  token: z.string(),
  allowFrom: z.array(z.string())
})

const discordChannelSchema = channelSchema

const cliChannelSchema = z.object({
  enabled: z.boolean().default(false),
  allowFrom: z.array(z.string()).default([])
})

/**
 * Runtime configuration schema for Claude Pipe.
 */
export const configSchema = z.object({
  model: z.string(),
  workspace: z.string(),
  channels: z.object({
    discord: discordChannelSchema,
    cli: cliChannelSchema.optional()
  }),
  summaryPrompt: z
    .object({
      enabled: z.boolean().default(true),
      template: z
        .string()
        .default(
          'Workspace: {{workspace}}\n' +
            'Request: {{request}}\n' +
            'Provide a concise summary with key files and actionable insights.'
        )
    })
    .default({
      enabled: true,
      template:
        'Workspace: {{workspace}}\n' +
        'Request: {{request}}\n' +
        'Provide a concise summary with key files and actionable insights.'
    }),
  transcriptLog: z
    .object({
      enabled: z.boolean().default(false),
      path: z.string(),
      maxBytes: z.number().int().positive().optional(),
      maxFiles: z.number().int().positive().optional()
    })
    .default({
      enabled: false,
      path: '',
      maxBytes: 1_000_000,
      maxFiles: 3
    }),
  personality: z
    .object({
      name: z.string(),
      traits: z.string()
    })
    .optional(),
  logLevel: z.enum(['verbose', 'status', 'off']).default('verbose'),
  env: z.record(z.string(), z.string()).optional(),
  sessionStorePath: z.string(),
  maxToolIterations: z.number().int().positive().default(20),
  heartbeat: z
    .object({
      enabled: z.boolean().default(true),
      intervalMinutes: z.number().int().positive().default(30),
      defaultChatId: z.string().optional(),
      defaultChannel: z.enum(['discord', 'cli']).optional()
    })
    .default({
      enabled: true,
      intervalMinutes: 30
    })
})

export type ClaudePipeConfig = z.infer<typeof configSchema>
