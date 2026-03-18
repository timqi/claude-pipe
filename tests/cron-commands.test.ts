import { describe, expect, it, vi } from 'vitest'

import {
  cronAddCommand,
  cronListCommand,
  cronDeleteCommand,
  cronEnableCommand,
  cronDisableCommand
} from '../src/commands/definitions/cron.js'
import type { CronJob } from '../src/core/cron-store.js'
import type { CommandContext } from '../src/commands/types.js'

function makeCtx(overrides?: Partial<CommandContext>): CommandContext {
  return {
    channel: 'discord',
    chatId: '42',
    senderId: 'u1',
    conversationKey: 'discord:42',
    args: [],
    rawArgs: '',
    ...overrides
  }
}

function makeJob(overrides?: Partial<CronJob>): CronJob {
  return {
    id: 'abcdef1234567890',
    conversationKey: 'discord:42',
    schedule: '0 9 * * 1-5',
    prompt: 'Summarize PRs',
    enabled: true,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides
  }
}

describe('cron_add', () => {
  it('adds a job with quoted schedule', async () => {
    const addJob = vi.fn(async () => makeJob())
    const listByKey = vi.fn(() => [])
    const reload = vi.fn()
    const cmd = cronAddCommand(addJob, listByKey, reload)

    const result = await cmd.execute(makeCtx({ rawArgs: '"0 9 * * 1-5" Summarize PRs', args: ['"0', '9', '*', '*', '1-5"', 'Summarize', 'PRs'] }))
    expect(result.error).toBeUndefined()
    expect(result.content).toContain('Cron job added')
    expect(addJob).toHaveBeenCalledWith('discord:42', '0 9 * * 1-5', 'Summarize PRs')
    expect(reload).toHaveBeenCalled()
  })

  it('rejects invalid cron expression', async () => {
    const cmd = cronAddCommand(vi.fn(), () => [], vi.fn())
    const result = await cmd.execute(makeCtx({ rawArgs: '"bad cron" do stuff', args: [] }))
    expect(result.error).toBe(true)
    expect(result.content).toContain('Invalid cron expression')
  })

  it('rejects when channel limit reached', async () => {
    const jobs = Array.from({ length: 10 }, (_, i) => makeJob({ id: `job${i}` }))
    const cmd = cronAddCommand(vi.fn(), () => jobs, vi.fn())
    const result = await cmd.execute(makeCtx({ rawArgs: '"0 9 * * *" test', args: [] }))
    expect(result.error).toBe(true)
    expect(result.content).toContain('Limit')
  })

  it('returns usage when no args', async () => {
    const cmd = cronAddCommand(vi.fn(), () => [], vi.fn())
    const result = await cmd.execute(makeCtx())
    expect(result.error).toBe(true)
    expect(result.content).toContain('Usage')
  })
})

describe('cron_list', () => {
  it('lists jobs for current channel', async () => {
    const job = makeJob()
    const cmd = cronListCommand(() => [job], () => [])

    const result = await cmd.execute(makeCtx())
    expect(result.content).toContain('abcdef12')
    expect(result.content).toContain('0 9 * * 1-5')
    expect(result.content).toContain('Summarize PRs')
  })

  it('shows empty message when no jobs', async () => {
    const cmd = cronListCommand(() => [], () => [])
    const result = await cmd.execute(makeCtx())
    expect(result.content).toContain('No cron jobs')
  })

  it('lists all jobs with "all" arg', async () => {
    const jobs = [makeJob(), makeJob({ id: 'other123456789012', conversationKey: 'discord:99' })]
    const cmd = cronListCommand(() => [], () => jobs)

    const result = await cmd.execute(makeCtx({ args: ['all'], rawArgs: 'all' }))
    expect(result.content).toContain('abcdef12')
    expect(result.content).toContain('other123')
  })
})

describe('cron_delete', () => {
  it('deletes a job', async () => {
    const job = makeJob()
    const findJob = vi.fn(() => job)
    const removeJob = vi.fn(async () => true)
    const reload = vi.fn()
    const cmd = cronDeleteCommand(findJob, removeJob, reload)

    const result = await cmd.execute(makeCtx({ args: ['abcdef12'], rawArgs: 'abcdef12' }))
    expect(result.content).toContain('Deleted')
    expect(removeJob).toHaveBeenCalledWith(job.id)
    expect(reload).toHaveBeenCalled()
  })

  it('rejects job from different channel', async () => {
    const job = makeJob({ conversationKey: 'discord:99' })
    const cmd = cronDeleteCommand(() => job, vi.fn(), vi.fn())

    const result = await cmd.execute(makeCtx({ args: ['abcdef12'], rawArgs: 'abcdef12' }))
    expect(result.error).toBe(true)
    expect(result.content).toContain('different channel')
  })

  it('returns error for unknown job', async () => {
    const cmd = cronDeleteCommand(() => undefined, vi.fn(), vi.fn())
    const result = await cmd.execute(makeCtx({ args: ['zzz'], rawArgs: 'zzz' }))
    expect(result.error).toBe(true)
    expect(result.content).toContain('No job found')
  })
})

describe('cron_enable / cron_disable', () => {
  it('enables a job', async () => {
    const job = makeJob({ enabled: false })
    const updateJob = vi.fn(async () => true)
    const reload = vi.fn()
    const cmd = cronEnableCommand(() => job, updateJob, reload)

    const result = await cmd.execute(makeCtx({ args: ['abcdef12'], rawArgs: 'abcdef12' }))
    expect(result.content).toContain('enabled')
    expect(updateJob).toHaveBeenCalledWith(job.id, { enabled: true })
    expect(reload).toHaveBeenCalled()
  })

  it('disables a job', async () => {
    const job = makeJob()
    const updateJob = vi.fn(async () => true)
    const reload = vi.fn()
    const cmd = cronDisableCommand(() => job, updateJob, reload)

    const result = await cmd.execute(makeCtx({ args: ['abcdef12'], rawArgs: 'abcdef12' }))
    expect(result.content).toContain('disabled')
    expect(updateJob).toHaveBeenCalledWith(job.id, { enabled: false })
  })

  it('rejects job from different channel', async () => {
    const job = makeJob({ conversationKey: 'discord:99' })
    const cmd = cronEnableCommand(() => job, vi.fn(), vi.fn())

    const result = await cmd.execute(makeCtx({ args: ['abcdef12'], rawArgs: 'abcdef12' }))
    expect(result.error).toBe(true)
    expect(result.content).toContain('different channel')
  })
})
