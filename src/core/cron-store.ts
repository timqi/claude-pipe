import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'

export interface CronJob {
  id: string
  conversationKey: string
  schedule: string
  prompt: string
  enabled: boolean
  createdAt: string
  lastRunAt?: string
  lastError?: string
}

type CronJobMap = Record<string, CronJob>

/**
 * File-backed cron job store.
 *
 * Maps job IDs to CronJob records.
 * Uses atomic temp+rename writes, same pattern as SessionStore/WorkspaceStore.
 */
export class CronStore {
  private readonly path: string
  private map: CronJobMap = {}

  constructor(path: string) {
    this.path = path
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    try {
      const raw = await readFile(this.path, 'utf-8')
      this.map = JSON.parse(raw) as CronJobMap
    } catch {
      this.map = {}
    }
  }

  get(id: string): CronJob | undefined {
    return this.map[id]
  }

  /** Finds a job by exact ID or unique prefix. Returns undefined if ambiguous. */
  find(idOrPrefix: string): CronJob | undefined {
    const exact = this.map[idOrPrefix]
    if (exact) return exact
    const matches = Object.values(this.map).filter((j) => j.id.startsWith(idOrPrefix))
    return matches.length === 1 ? matches[0] : undefined
  }

  list(): CronJob[] {
    return Object.values(this.map)
  }

  listByKey(conversationKey: string): CronJob[] {
    return Object.values(this.map).filter((j) => j.conversationKey === conversationKey)
  }

  async add(conversationKey: string, schedule: string, prompt: string): Promise<CronJob> {
    const id = randomBytes(8).toString('hex')
    const job: CronJob = {
      id,
      conversationKey,
      schedule,
      prompt,
      enabled: true,
      createdAt: new Date().toISOString()
    }
    this.map[id] = job
    await this.persist()
    return job
  }

  async remove(id: string): Promise<boolean> {
    if (!(id in this.map)) return false
    delete this.map[id]
    await this.persist()
    return true
  }

  async update(id: string, patch: Partial<Pick<CronJob, 'enabled' | 'lastRunAt' | 'lastError'>>): Promise<boolean> {
    const job = this.map[id]
    if (!job) return false
    Object.assign(job, patch)
    await this.persist()
    return true
  }

  private async persist(): Promise<void> {
    const tmp = `${this.path}.tmp.${process.pid}.${Date.now()}`
    await writeFile(tmp, JSON.stringify(this.map, null, 2), 'utf-8')
    await rename(tmp, this.path)
  }
}
