import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SessionStore } from '../src/core/session-store.js'

describe('SessionStore', () => {
  it('persists and reloads session records', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'claude-pipe-test-'))
    const path = join(dir, 'sessions.json')

    const store = new SessionStore(path)
    await store.init()
    await store.set('discord:123', 'sess-abc')

    const raw = JSON.parse(await readFile(path, 'utf-8')) as Record<string, { sessionId: string }>
    expect(raw['discord:123']?.sessionId).toBe('sess-abc')

    const reloaded = new SessionStore(path)
    await reloaded.init()
    expect(reloaded.get('discord:123')?.sessionId).toBe('sess-abc')
  })

  it('clears an existing session record', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'claude-pipe-test-'))
    const path = join(dir, 'sessions.json')

    const store = new SessionStore(path)
    await store.init()
    await store.set('discord:123', 'sess-abc')
    await store.clear('discord:123')

    expect(store.get('discord:123')).toBeUndefined()

    const raw = JSON.parse(await readFile(path, 'utf-8')) as Record<string, { sessionId: string }>
    expect(raw['discord:123']).toBeUndefined()
  })
})
