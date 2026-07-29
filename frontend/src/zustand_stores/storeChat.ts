import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Operator session state — just enough for the operator to follow you around.
 *
 * The operator has two surfaces: a floating companion (`OperatorCompanion`, in the
 * app shell) on every route, and a full-page view on `/hq/chat`. They're never both
 * mounted at once (the page stands the companion down), so there's no double-SSE.
 *
 * The thread does NOT live in React — it's identified by `conversationId` here and
 * persisted on the backend. So whichever surface mounts simply re-hydrates from
 * `{ placement (open/collapsed), conversationId }`.
 *
 * Those two fields are persisted to `localStorage`, so the operator's open state and
 * active conversation survive not just client-side navigation but full page reloads /
 * refreshes too — otherwise a full document load (e.g. a not-yet-compiled route in dev,
 * or a browser refresh) would reset the store and collapse the operator. Everything
 * else here is transient and deliberately NOT persisted.
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
  // The floating companion's visible form (persisted).
  placement: ChatPlacement
  // The active conversation (persisted) — the id both surfaces re-hydrate from.
  conversationId: number | null
  agent?: string
  // A prompt to hand a chat surface from outside (the home "Ask" bar, `/hq/chat?prompt=`).
  // The surface consumes it (sends it, then clears). Transient.
  seedPrompt: string | null
  // B4 — stage-then-confirm return channel. A QUEUE, not a slot: several staged
  // forms (e.g. multiple sources) can resolve independently and none is dropped. Transient.
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

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
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
    }),
    {
      name: 'hq-operator',
      // Only the two durable bits ride along; the return channel + seed prompt are
      // per-session and must not be replayed from storage.
      partialize: (s) => ({ placement: s.placement, conversationId: s.conversationId }),
    },
  ),
)
