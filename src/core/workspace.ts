import type { WorkspaceStore } from './workspace-store.js'

/** Resolves the effective workspace for a conversation key, or undefined if not mapped. */
export function resolveWorkspace(
  conversationKey: string,
  workspaceStore?: WorkspaceStore
): string | undefined {
  return workspaceStore?.get(conversationKey)
}
