import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { CronScheduler } from '../src/core/cron-scheduler.js'
import type { CronStore } from '../src/core/cron-store.js'
import { MessageBus } from '../src/core/bus.js'
import type { WorkspaceStore } from '../src/core/workspace-store.js'
import type { Logger } from '../src/core/types.js'

function makeMockStore(jobs: Array<{ id: string; conversationKey: string; schedule: string; prompt: string; enabled: boolean }>): CronStore {
  return {
    list: () => jobs.map((j) => ({ ...j, createdAt: '2026-01-01T00:00:00Z' })),
    listByKey: vi.fn(),
    get: vi.fn(),
    find: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    update: vi.fn(async () => true),
    init: vi.fn()
  } as unknown as CronStore
}

function makeMockWorkspaceStore(map: Record<string, string>): WorkspaceStore {
  return {
    get: (key: string) => map[key],
    entries: () => ({ ...map }),
    set: vi.fn(),
    remove: vi.fn(),
    init: vi.fn(),
    importFrom: vi.fn()
  } as unknown as WorkspaceStore
}

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}

describe('CronScheduler', () => {
  let bus: MessageBus

  beforeEach(() => {
    bus = new MessageBus()
    vi.clearAllMocks()
  })

  it('starts and stops without error', () => {
    const store = makeMockStore([])
    const ws = makeMockWorkspaceStore({})
    const scheduler = new CronScheduler(store, bus, ws, mockLogger)

    scheduler.start()
    scheduler.stop()
  })

  it('schedules enabled jobs on start', () => {
    const store = makeMockStore([
      { id: 'job1', conversationKey: 'discord:42', schedule: '0 9 * * *', prompt: 'test', enabled: true },
      { id: 'job2', conversationKey: 'discord:42', schedule: '0 10 * * *', prompt: 'test2', enabled: false }
    ])
    const ws = makeMockWorkspaceStore({ 'discord:42': '/tmp/test' })
    const scheduler = new CronScheduler(store, bus, ws, mockLogger)

    scheduler.start()
    // Should log 1 scheduled (only enabled)
    expect(mockLogger.info).toHaveBeenCalledWith('cron.started', { count: 1 })
    scheduler.stop()
  })

  it('logs error for invalid cron expression', () => {
    const store = makeMockStore([
      { id: 'bad', conversationKey: 'discord:42', schedule: 'not a cron', prompt: 'test', enabled: true }
    ])
    const ws = makeMockWorkspaceStore({})
    const scheduler = new CronScheduler(store, bus, ws, mockLogger)

    scheduler.start()
    expect(mockLogger.error).toHaveBeenCalledWith('cron.schedule_error', expect.objectContaining({ id: 'bad' }))
    scheduler.stop()
  })

  it('reload clears and reschedules', () => {
    const store = makeMockStore([])
    const ws = makeMockWorkspaceStore({})
    const scheduler = new CronScheduler(store, bus, ws, mockLogger)

    scheduler.start()
    scheduler.reload()
    // Should be called twice (start + reload)
    expect(mockLogger.info).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })
})
