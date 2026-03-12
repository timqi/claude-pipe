import type { ClaudePipeConfig } from '../config/schema.js'

/** Resolves the effective workspace for a conversation key. */
export function resolveWorkspace(config: ClaudePipeConfig, conversationKey: string): string {
  const map = config.channelWorkspaces
  if (map && conversationKey in map) {
    return map[conversationKey] as string
  }
  return config.workspace
}
