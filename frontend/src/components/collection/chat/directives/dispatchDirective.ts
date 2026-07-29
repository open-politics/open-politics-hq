import { commandRegistry } from '@/lib/commandRegistry'
import { useChatStore } from '@/zustand_stores/storeChat'
import type { UIDirective } from './types'
import type { ToolExecution } from '@/hooks/useIntelligenceChat'

/**
 * Extract a tool execution's UI directive(s). `structured_content.ui_directive` may
 * be a single directive or a list — a list lets one op both open an item AND drive a
 * surface (e.g. open the sideview + unfold the tree). Malformed entries are dropped.
 */
export function directivesFromExecution(exec: ToolExecution): UIDirective[] {
  const sc = exec.structured_content as any
  const raw = sc?.ui_directive
  if (!raw) return []
  const list = Array.isArray(raw) ? raw : [raw]
  return list.filter((d): d is UIDirective => !!d && typeof d === 'object' && typeof d.command === 'string')
}

/** Route a directive to the command registry (dispatch-by-name). */
export function dispatchDirective(d: UIDirective): void {
  // Stage-then-confirm: record the pending return BEFORE opening the form, so
  // the chat that owns this conversation can resume when it commits/cancels.
  if (d.await_return && d.return_token) {
    useChatStore.getState().addPendingReturn({
      token: d.return_token,
      conversationId: useChatStore.getState().conversationId,
    })
  }
  commandRegistry.dispatch(d.command, d.payload)
}
