import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

type WorkspaceMap = Record<string, string>

/**
 * File-backed workspace map.
 *
 * Maps conversation keys (e.g. "discord:123") to workspace paths.
 * Uses atomic temp+rename writes, same pattern as SessionStore.
 */
export class WorkspaceStore {
  private readonly path: string
  private map: WorkspaceMap = {}

  constructor(path: string) {
    this.path = path
  }

  /** Loads persisted map and ensures data directory exists. */
  async init(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    try {
      const raw = await readFile(this.path, 'utf-8')
      this.map = JSON.parse(raw) as WorkspaceMap
    } catch {
      this.map = {}
    }
  }

  /** Gets workspace for a conversation key, or undefined if not mapped. */
  get(conversationKey: string): string | undefined {
    return this.map[conversationKey]
  }

  /** Returns a shallow copy of all mappings. */
  entries(): Readonly<WorkspaceMap> {
    return { ...this.map }
  }

  /** Sets workspace for a conversation key and persists to disk. */
  async set(conversationKey: string, workspace: string): Promise<void> {
    this.map[conversationKey] = workspace
    await this.persist()
  }

  /** Removes workspace mapping and persists if it existed. */
  async remove(conversationKey: string): Promise<void> {
    if (!(conversationKey in this.map)) return
    delete this.map[conversationKey]
    await this.persist()
  }

  /** Bulk-imports mappings without overwriting existing entries. */
  async importFrom(mappings: Record<string, string>): Promise<void> {
    let changed = false
    for (const [key, value] of Object.entries(mappings)) {
      if (!(key in this.map)) {
        this.map[key] = value
        changed = true
      }
    }
    if (changed) await this.persist()
  }

  private async persist(): Promise<void> {
    const tmp = `${this.path}.tmp.${process.pid}.${Date.now()}`
    await writeFile(tmp, JSON.stringify(this.map, null, 2), 'utf-8')
    await rename(tmp, this.path)
  }
}
