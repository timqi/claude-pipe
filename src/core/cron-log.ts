import { appendFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CRON_LOG_DIR = join(homedir(), '.claude-pipe', 'cronlogs')

/** Sanitizes a workspace path into a safe filename: /home/user/project → home-user-project */
function sanitizePath(workspace: string): string {
  return workspace.replace(/^\//, '').replace(/\//g, '-')
}

function timestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

let dirReady = false

async function ensureDir(): Promise<void> {
  if (dirReady) return
  await mkdir(CRON_LOG_DIR, { recursive: true })
  dirReady = true
}

/** Appends a log line to the cron log file for the given workspace. */
export async function appendCronLog(workspace: string, line: string): Promise<void> {
  try {
    await ensureDir()
    const file = join(CRON_LOG_DIR, `${sanitizePath(workspace)}.log`)
    await appendFile(file, line + '\n', 'utf-8')
  } catch {
    // Best-effort logging — don't break the caller
  }
}

/** Logs a one-line cron event (fire, skip, error). */
export async function logCronEvent(workspace: string, jobId: string, event: string, detail?: string): Promise<void> {
  const id = jobId.slice(0, 8)
  const parts = [`[${timestamp()}]`, id, event]
  if (detail) parts.push(detail)
  await appendCronLog(workspace, parts.join('  '))
}

/** Logs a multi-line cron turn output. */
export async function logCronOutput(workspace: string, jobId: string, output: string): Promise<void> {
  const id = jobId.slice(0, 8)
  const line = `[${timestamp()}]  ${id}  output:\n${output}\n---`
  await appendCronLog(workspace, line)
}
