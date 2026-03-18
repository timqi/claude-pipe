import { describe, expect, it, beforeEach } from 'vitest'
import { CronStore } from '../src/core/cron-store.js'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'

describe('CronStore', () => {
  let store: CronStore
  let storePath: string

  beforeEach(async () => {
    storePath = path.join(os.tmpdir(), `cron-test-${Date.now()}.json`)
    store = new CronStore(storePath)
    await store.init()
  })

  it('starts empty', () => {
    expect(store.list()).toEqual([])
  })

  it('adds and retrieves a job', async () => {
    const job = await store.add('discord:42', '0 9 * * *', 'hello')
    expect(job.id).toHaveLength(16)
    expect(job.conversationKey).toBe('discord:42')
    expect(job.schedule).toBe('0 9 * * *')
    expect(job.prompt).toBe('hello')
    expect(job.enabled).toBe(true)

    expect(store.get(job.id)).toEqual(job)
    expect(store.list()).toHaveLength(1)
  })

  it('lists by conversation key', async () => {
    await store.add('discord:42', '0 9 * * *', 'job1')
    await store.add('discord:99', '0 10 * * *', 'job2')
    await store.add('discord:42', '0 11 * * *', 'job3')

    expect(store.listByKey('discord:42')).toHaveLength(2)
    expect(store.listByKey('discord:99')).toHaveLength(1)
    expect(store.listByKey('discord:0')).toHaveLength(0)
  })

  it('removes a job', async () => {
    const job = await store.add('discord:42', '0 9 * * *', 'hello')
    expect(await store.remove(job.id)).toBe(true)
    expect(store.get(job.id)).toBeUndefined()
    expect(await store.remove(job.id)).toBe(false)
  })

  it('updates a job', async () => {
    const job = await store.add('discord:42', '0 9 * * *', 'hello')
    await store.update(job.id, { enabled: false })
    expect(store.get(job.id)!.enabled).toBe(false)

    await store.update(job.id, { lastRunAt: '2026-01-01T00:00:00Z', lastError: 'test error' })
    const updated = store.get(job.id)!
    expect(updated.lastRunAt).toBe('2026-01-01T00:00:00Z')
    expect(updated.lastError).toBe('test error')
  })

  it('finds by prefix', async () => {
    const job = await store.add('discord:42', '0 9 * * *', 'hello')
    const prefix = job.id.slice(0, 8)
    expect(store.find(prefix)?.id).toBe(job.id)
    expect(store.find(job.id)?.id).toBe(job.id)
    expect(store.find('nonexistent')).toBeUndefined()
  })

  it('persists to disk', async () => {
    await store.add('discord:42', '0 9 * * *', 'hello')

    const store2 = new CronStore(storePath)
    await store2.init()
    expect(store2.list()).toHaveLength(1)
    expect(store2.list()[0]!.prompt).toBe('hello')

    // cleanup
    fs.unlinkSync(storePath)
  })
})
