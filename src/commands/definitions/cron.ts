import { Cron } from 'croner'

import type { CronJob } from '../../core/cron-store.js'
import type { CommandDefinition, CommandResult } from '../types.js'

const MAX_JOBS_PER_CHANNEL = 10

/** Validates a cron expression using croner's parser. Returns error message or undefined. */
function validateCron(expr: string): string | undefined {
  try {
    const c = new Cron(expr, { legacyMode: true })
    c.stop()
    return undefined
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

function formatJob(job: CronJob): string {
  const status = job.enabled ? '✅' : '⏸️'
  const lastRun = job.lastRunAt ? ` | last: ${job.lastRunAt.replace('T', ' ').slice(0, 19)}` : ''
  const error = job.lastError ? ` | err: ${job.lastError}` : ''
  let next = ''
  if (job.enabled) {
    try {
      const c = new Cron(job.schedule, { legacyMode: true })
      const nr = c.nextRun()
      c.stop()
      if (nr) next = ` | next: ${nr.toISOString().replace('T', ' ').slice(0, 16)}`
    } catch { /* invalid schedule */ }
  }
  return `${status} \`${job.id.slice(0, 8)}\` \`${job.schedule}\` ${job.prompt.slice(0, 60)}${job.prompt.length > 60 ? '…' : ''}${lastRun}${next}${error}`
}

export function cronAddCommand(
  addJob: (conversationKey: string, schedule: string, prompt: string) => Promise<CronJob>,
  listJobsByKey: (conversationKey: string) => CronJob[],
  reloadScheduler: () => void
): CommandDefinition {
  return {
    name: 'cron_add',
    category: 'cron',
    description: 'Add a scheduled cron job for this channel',
    usage: '/cron add "<schedule>" <prompt>\nSchedule uses standard 5-field cron syntax (min hour dom mon dow).\nExample: /cron add "0 9 * * 1-5" Summarize open PRs',
    args: [
      { name: 'schedule', description: 'Cron expression (5-field, quoted)', required: true },
      { name: 'prompt', description: 'Prompt to send to Claude', required: true }
    ],
    permission: 'admin',
    async execute(ctx): Promise<CommandResult> {
      let schedule: string
      let prompt: string

      // Try quoted forms first (CLI-friendly)
      const match = ctx.rawArgs.match(/^"([^"]+)"\s+(.+)$/s)
        ?? ctx.rawArgs.match(/^'([^']+)'\s+(.+)$/s)
      if (match) {
        schedule = match[1]!
        prompt = match[2]!
      } else {
        // 5-field cron: first 5 tokens = schedule, rest = prompt
        const parts = ctx.rawArgs.split(/\s+/)
        if (parts.length < 6) {
          return { content: 'Usage: /cron add <5-field schedule> <prompt>\nExample: /cron add */5 * * * * Check server status', error: true }
        }
        schedule = parts.slice(0, 5).join(' ')
        prompt = parts.slice(5).join(' ')
      }

      const cronErr = validateCron(schedule)
      if (cronErr) {
        return { content: `Invalid cron expression: ${cronErr}`, error: true }
      }

      const existing = listJobsByKey(ctx.conversationKey)
      if (existing.length >= MAX_JOBS_PER_CHANNEL) {
        return { content: `Limit of ${MAX_JOBS_PER_CHANNEL} cron jobs per channel reached.`, error: true }
      }

      const job = await addJob(ctx.conversationKey, schedule, prompt)
      reloadScheduler()
      return { content: `Cron job added: \`${job.id.slice(0, 8)}\` \`${job.schedule}\`\n${job.prompt}` }
    }
  }
}

export function cronListCommand(
  listJobs: (conversationKey: string) => CronJob[],
  listAllJobs: () => CronJob[]
): CommandDefinition {
  return {
    name: 'cron_list',
    category: 'cron',
    description: 'List cron jobs for this channel',
    args: [
      { name: 'all', description: 'Show all jobs across channels', required: false, type: 'boolean' }
    ],
    permission: 'user',
    async execute(ctx): Promise<CommandResult> {
      const showAll = ctx.args[0] === 'true'
      const jobs = showAll ? listAllJobs() : listJobs(ctx.conversationKey)
      if (jobs.length === 0) {
        return { content: showAll ? 'No cron jobs.' : 'No cron jobs for this channel.' }
      }
      return { content: jobs.map(formatJob).join('\n') }
    }
  }
}

export function cronDeleteCommand(
  findJob: (idOrPrefix: string) => CronJob | undefined,
  removeJob: (id: string) => Promise<boolean>,
  reloadScheduler: () => void
): CommandDefinition {
  return {
    name: 'cron_delete',
    category: 'cron',
    description: 'Delete a cron job',
    args: [
      { name: 'id', description: 'Job ID or prefix', required: true }
    ],
    permission: 'admin',
    async execute(ctx): Promise<CommandResult> {
      const idPrefix = ctx.args[0]
      if (!idPrefix) {
        return { content: 'Usage: /cron delete <id>', error: true }
      }

      const job = findJob(idPrefix)
      if (!job) {
        return { content: `No job found matching \`${idPrefix}\`.`, error: true }
      }
      if (job.conversationKey !== ctx.conversationKey) {
        return { content: 'That job belongs to a different channel.', error: true }
      }

      await removeJob(job.id)
      reloadScheduler()
      return { content: `Deleted cron job \`${job.id.slice(0, 8)}\`.` }
    }
  }
}

export function cronEnableCommand(
  findJob: (idOrPrefix: string) => CronJob | undefined,
  updateJob: (id: string, patch: Partial<Pick<CronJob, 'enabled'>>) => Promise<boolean>,
  reloadScheduler: () => void
): CommandDefinition {
  return {
    name: 'cron_enable',
    category: 'cron',
    description: 'Enable a cron job',
    args: [{ name: 'id', description: 'Job ID or prefix', required: true }],
    permission: 'admin',
    async execute(ctx): Promise<CommandResult> {
      return toggleJob(ctx.args[0], ctx.conversationKey, true, findJob, updateJob, reloadScheduler)
    }
  }
}

export function cronDisableCommand(
  findJob: (idOrPrefix: string) => CronJob | undefined,
  updateJob: (id: string, patch: Partial<Pick<CronJob, 'enabled'>>) => Promise<boolean>,
  reloadScheduler: () => void
): CommandDefinition {
  return {
    name: 'cron_disable',
    category: 'cron',
    description: 'Disable a cron job',
    args: [{ name: 'id', description: 'Job ID or prefix', required: true }],
    permission: 'admin',
    async execute(ctx): Promise<CommandResult> {
      return toggleJob(ctx.args[0], ctx.conversationKey, false, findJob, updateJob, reloadScheduler)
    }
  }
}

async function toggleJob(
  idPrefix: string | undefined,
  conversationKey: string,
  enabled: boolean,
  findJob: (idOrPrefix: string) => CronJob | undefined,
  updateJob: (id: string, patch: Partial<Pick<CronJob, 'enabled'>>) => Promise<boolean>,
  reloadScheduler: () => void
): Promise<CommandResult> {
  if (!idPrefix) {
    return { content: `Usage: /cron ${enabled ? 'enable' : 'disable'} <id>`, error: true }
  }

  const job = findJob(idPrefix)
  if (!job) {
    return { content: `No job found matching \`${idPrefix}\`.`, error: true }
  }
  if (job.conversationKey !== conversationKey) {
    return { content: 'That job belongs to a different channel.', error: true }
  }

  const ok = await updateJob(job.id, { enabled })
  if (!ok) return { content: 'Failed to update job.', error: true }
  reloadScheduler()
  return { content: `Cron job \`${job.id.slice(0, 8)}\` ${enabled ? 'enabled' : 'disabled'}.` }
}
