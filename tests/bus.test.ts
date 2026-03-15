import { describe, expect, it } from 'vitest'

import { MessageBus } from '../src/core/bus.js'

describe('MessageBus', () => {
  it('delivers inbound message to waiting consumer', async () => {
    const bus = new MessageBus()

    const consumer = bus.consumeInbound()
    await bus.publishInbound({
      channel: 'discord',
      senderId: 'u1',
      chatId: 'c1',
      content: 'hello',
      timestamp: new Date().toISOString()
    })

    await expect(consumer).resolves.toMatchObject({
      channel: 'discord',
      senderId: 'u1',
      chatId: 'c1',
      content: 'hello'
    })
  })

  it('preserves outbound FIFO ordering', async () => {
    const bus = new MessageBus()

    await bus.publishOutbound({ channel: 'discord', chatId: '1', content: 'first' })
    await bus.publishOutbound({ channel: 'discord', chatId: '1', content: 'second' })

    const first = await bus.consumeOutbound()
    const second = await bus.consumeOutbound()

    expect(first.content).toBe('first')
    expect(second.content).toBe('second')
  })
})
