import type { ClaudePipeConfig } from '../config/schema.js'
import type { WorkspaceStore } from './workspace-store.js'

/** Resolves the effective workspace for a conversation key. */
export function resolveWorkspace(
  config: ClaudePipeConfig,
  conversationKey: string,
  workspaceStore?: WorkspaceStore
): string {
  const override = workspaceStore?.get(conversationKey)
  if (override) return override
  return config.workspace
}
