import { Cron } from 'croner'

import type { CronStore } from './cron-store.js'
import type { MessageBus } from './bus.js'
import type { WorkspaceStore } from './workspace-store.js'
import type { ChannelName, Logger } from './types.js'

/**
 * Schedules cron jobs and injects their prompts into the MessageBus
 * as synthetic inbound messages.
 *
 * Execution is handled by AgentLoop (same serialization, cancellation, etc.).
 * The scheduler only decides *when* to inject.
 */
export class CronScheduler {
  private jobs = new Map<string, Cron>()
  /** Tracks conversation keys with a cron message currently queued or processing. */
  private activeRuns = new Set<string>()

  constructor(
    private readonly cronStore: CronStore,
    private readonly bus: MessageBus,
    private readonly workspaceStore: WorkspaceStore,
    private readonly logger: Logger
  ) {}

  /** Loads all enabled jobs from store and schedules them. */
  start(): void {
    this.stopAll()
    for (const job of this.cronStore.list()) {
      if (!job.enabled) continue
      this.scheduleJob(job.id, job.schedule, job.conversationKey, job.prompt)
    }
    this.logger.info('cron.started', { count: this.jobs.size })
  }

  /** Re-reads the store and reschedules everything. */
  reload(): void {
    this.start()
  }

  /** Stops all scheduled jobs. */
  stop(): void {
    this.stopAll()
    this.logger.info('cron.stopped')
  }

  /** Clears the active-run flag for a conversation key (called after turn completes). */
  clearActive(conversationKey: string): void {
    this.activeRuns.delete(conversationKey)
  }

  private scheduleJob(id: string, schedule: string, conversationKey: string, prompt: string): void {
    try {
      const cron = new Cron(schedule, { legacyMode: true }, () => {
        void this.fire(id, conversationKey, prompt)
      })
      this.jobs.set(id, cron)
    } catch (err) {
      this.logger.error('cron.schedule_error', {
        id,
        schedule,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  private async fire(id: string, conversationKey: string, prompt: string): Promise<void> {
    // Skip if same conversation already has a cron run in-flight
    if (this.activeRuns.has(conversationKey)) {
      this.logger.warn('cron.skipped_active', { id, conversationKey })
      return
    }

    // Resolve workspace — skip if unmapped
    const workspace = this.workspaceStore.get(conversationKey)
    if (!workspace) {
      this.logger.warn('cron.no_workspace', { id, conversationKey })
      await this.cronStore.update(id, { lastError: 'No workspace mapped' })
      return
    }

    // Parse channel and chatId from conversationKey
    const colonIdx = conversationKey.indexOf(':')
    if (colonIdx === -1) {
      this.logger.error('cron.invalid_key', { id, conversationKey })
      return
    }
    const channel = conversationKey.slice(0, colonIdx) as ChannelName
    const chatId = conversationKey.slice(colonIdx + 1)

    this.activeRuns.add(conversationKey)
    this.logger.info('cron.fired', { id, conversationKey, prompt: prompt.slice(0, 80) })

    await this.cronStore.update(id, { lastRunAt: new Date().toISOString() })

    // Inject as synthetic inbound message — AgentLoop handles everything from here
    await this.bus.publishInbound({
      channel,
      chatId,
      senderId: `cron:${id}`,
      content: prompt,
      timestamp: new Date().toISOString(),
      metadata: { cronJobId: id }
    })
  }

  private stopAll(): void {
    for (const cron of this.jobs.values()) {
      cron.stop()
    }
    this.jobs.clear()
  }
}
