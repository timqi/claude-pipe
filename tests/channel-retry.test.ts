import { describe, expect, it, vi, afterEach } from 'vitest'

import type { ClaudePipeConfig } from '../src/config/schema.js'
import { DiscordChannel } from '../src/channels/discord.js'
import { MessageBus } from '../src/core/bus.js'

function makeConfig(): ClaudePipeConfig {
  return {
    model: 'claude-sonnet-4-5',
    workspace: '/tmp/workspace',
    channels: {
      discord: { enabled: true, token: 'DTKN', allowFrom: [] }
    },
    tools: { execTimeoutSec: 60 },
    summaryPrompt: { enabled: true, template: 'Workspace: {{workspace}} Request: {{request}}' },
    transcriptLog: { enabled: false, path: '/tmp/transcript.jsonl' },
    sessionStorePath: '/tmp/sessions.json',
    maxToolIterations: 20
  }
}

describe('channel retry behavior', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('retries Discord send and succeeds on second attempt', async () => {
    const bus = new MessageBus()
    const channel = new DiscordChannel(makeConfig(), bus, logger)

    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(undefined)
    const fetch = vi.fn(async () => ({ isTextBased: () => true, send }))

    ;(channel as any).client = { channels: { fetch } }

    await channel.send({ channel: 'discord', chatId: 'abc', content: 'reply' })

    expect(send).toHaveBeenCalledTimes(2)
  })
})
