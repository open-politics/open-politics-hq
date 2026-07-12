import { create } from 'zustand'

/**
 * Operator-companion session state, hoisted out of the Chat component.
 *
 * The operator chat is a GLOBAL companion: mounted once in the app shell
 * (`OperatorCompanion`, from `app/hq/layout.tsx`), so it never unmounts as you
 * navigate `/hq/*` — the thread survives every page change on its own. This store
 * holds only the cross-cutting bits: whether the window is `open` or `collapsed`
 * (the launcher), the active `conversationId` (so a fresh mount can re-seed it),
 * and the (B4) stage-then-confirm return channel.
 *
 * `placement` is just the companion's visible form; the single mount means there's
 * no double-SSE / double-auto_save to guard against.
 */
export type ChatPlacement = 'collapsed' | 'open'

export interface PendingReturn {
  token: string
  conversationId: number | null
  label?: string
}

export interface ResolvedReturn {
  token: string
  outcome: any
  conversationId: number | null
}

interface ChatState {
  // The global companion's visible form.
  placement: ChatPlacement
  conversationId: number | null
  agent?: string
  // A prompt to hand the companion from outside (the home "Ask" bar, `/hq/chat?prompt=`).
  // The companion consumes it (sends it, then clears) — the bridge that lets any route
  // start the operator talking without mounting its own chat.
  seedPrompt: string | null
  // B4 — stage-then-confirm return channel. A QUEUE, not a slot: several staged
  // forms (e.g. multiple sources) can resolve independently and none is dropped.
  pendingReturns: Record<string, PendingReturn>
  resolvedQueue: ResolvedReturn[]

  setPlacement: (p: ChatPlacement) => void
  openChat: () => void
  collapseChat: () => void
  toggleChat: () => void
  setSeedPrompt: (p: string | null) => void
  setConversationId: (id: number | null) => void
  addPendingReturn: (r: PendingReturn) => void
  resolveReturn: (token: string, outcome: any) => void
  consumeResolved: (token: string) => void
}

export const useChatStore = create<ChatState>((set) => ({
  placement: 'collapsed',
  conversationId: null,
  agent: undefined,
  seedPrompt: null,
  pendingReturns: {},
  resolvedQueue: [],

  setPlacement: (placement) => set({ placement }),
  openChat: () => set({ placement: 'open' }),
  collapseChat: () => set({ placement: 'collapsed' }),
  toggleChat: () => set((s) => ({ placement: s.placement === 'open' ? 'collapsed' : 'open' })),
  setSeedPrompt: (seedPrompt) => set({ seedPrompt }),
  setConversationId: (conversationId) => set({ conversationId }),
  addPendingReturn: (r) => set((s) => ({ pendingReturns: { ...s.pendingReturns, [r.token]: r } })),
  resolveReturn: (token, outcome) =>
    set((s) => {
      const pr = s.pendingReturns[token]
      if (!pr) return s // already resolved / unknown — no-op (safe on double-call / dismiss)
      const { [token]: _drop, ...rest } = s.pendingReturns
      return {
        pendingReturns: rest,
        resolvedQueue: [...s.resolvedQueue, { token, outcome, conversationId: pr.conversationId }],
      }
    }),
  consumeResolved: (token) =>
    set((s) => ({ resolvedQueue: s.resolvedQueue.filter((r) => r.token !== token) })),
}))
