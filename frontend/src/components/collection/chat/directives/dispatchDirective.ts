import { commandRegistry } from '@/lib/commandRegistry'
import { useChatStore } from '@/zustand_stores/storeChat'
import type { UIDirective } from './types'
import type { ToolExecution } from '@/hooks/useIntelligenceChat'

/** Extract a tool execution's UI directive, if its structured_content carries one. */
export function directiveFromExecution(exec: ToolExecution): UIDirective | null {
  const sc = exec.structured_content as any
  const d = sc?.ui_directive
  if (d && typeof d === 'object' && typeof d.command === 'string') {
    return d as UIDirective
  }
  return null
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
