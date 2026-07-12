/**
 * A UI directive is a small typed instruction a backend tool attaches to its
 * result (`structured_content.ui_directive`) to drive the frontend — navigate,
 * open a prefilled form, observe a live resource. Dispatched by name through the
 * command registry (see `@/lib/commandRegistry`).
 */
export interface UIDirective {
  /**
   * Registry command id: 'navigate' | 'open_form' | 'observe' | 'stage_sources'
   * (+ future). 'stage_sources' registers the pending return but draws nothing —
   * its tool renders an inline confirm card in the chat (see SourceConfirmCard).
   */
  command: string
  payload?: Record<string, unknown>
  /** Stage-then-confirm (B4): the model waits for the staged form's outcome. */
  await_return?: boolean
  /** Correlation id echoed back when the staged action resolves. */
  return_token?: string
}
