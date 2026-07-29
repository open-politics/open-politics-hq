/**
 * The frontend command bus — the mirror of the backend event bus
 * (`core/events.py`): dispatch-by-name → registered handler, zero coupling to
 * the caller. A tool result's `ui_directive` (routed by the chat's directive
 * interceptor) and, later, a ⌘K palette both dispatch through this one registry.
 *
 * Two flavors of command live here:
 *
 * - **Global commands** (`navigate`, `open_form`, `open_item`, `observe`) are
 *   registered on module load and backed by an always-available host store
 *   (router, dock, observations). They work from any route.
 *
 * - **Surface commands** (`namespace:action`, e.g. `assets:reveal`) are the verbs
 *   a specific page owns. A mounted surface registers them via `useSurfaceCommands`
 *   and tears them down on unmount. Because the operator often *navigates* to a
 *   surface and *drives* it in the same turn — two directives, one turn — a surface
 *   command dispatched before its page has mounted is **buffered** and flushed the
 *   moment the surface registers (see `pending`). This is what lets "open the asset
 *   manager, then reveal bundle 42" work as a single operator gesture.
 *
 * Plain singleton (like `ToolResultRegistry`) so non-React callers use it
 * directly. Only `navigate` needs React scope (router.push) — a mount-only
 * <CommandRegistryBridge/> captures it into `navigateFn`.
 */
import { useDock, type DockKey } from '@/zustand_stores/storeDock'
import { useObservations } from '@/zustand_stores/storeObservations'

export type CommandHandler = (payload?: any) => void | Promise<void>

/**
 * How long a dispatched-but-unhandled surface command waits for its surface to
 * mount before it's considered stale. Long enough to cover navigate→route-mount,
 * short enough that a much-later visit to that surface doesn't replay an
 * abandoned intent.
 */
const SURFACE_INTENT_TTL_MS = 20_000

interface BufferedIntent {
  payload: any
  ts: number
}

class CommandRegistry {
  private handlers = new Map<string, CommandHandler>()
  // Surface commands dispatched before their surface mounted. Keyed by full
  // `namespace:action` id; only the latest intent per verb is kept.
  private pending = new Map<string, BufferedIntent>()

  register(id: string, run: CommandHandler): void {
    this.handlers.set(id, run)
    // A surface just mounted — flush any intent that arrived while it was gone.
    const buffered = this.pending.get(id)
    if (buffered) {
      this.pending.delete(id)
      if (Date.now() - buffered.ts <= SURFACE_INTENT_TTL_MS) {
        try {
          void run(buffered.payload)
        } catch (e) {
          console.error(`[commandRegistry] "${id}" threw on buffered flush`, e)
        }
      }
    }
  }

  /**
   * Remove a handler. When `run` is supplied, only clears if it's still the
   * registered one — so a late unmount can't stomp a fresh remount of the same
   * surface (mount/unmount can interleave across a client navigation).
   */
  unregister(id: string, run?: CommandHandler): void {
    if (run && this.handlers.get(id) !== run) return
    this.handlers.delete(id)
  }

  /**
   * Register a surface's verbs under `namespace:action`. Returns a disposer that
   * removes exactly these handlers. Registering flushes any buffered intent for
   * a verb (the navigate→mount bridge).
   */
  registerSurface(namespace: string, handlers: Record<string, CommandHandler>): () => void {
    const ids: Array<[string, CommandHandler]> = Object.entries(handlers).map(
      ([action, run]) => [`${namespace}:${action}`, run] as [string, CommandHandler],
    )
    for (const [id, run] of ids) this.register(id, run)
    return () => {
      for (const [id, run] of ids) this.unregister(id, run)
    }
  }

  dispatch(id: string, payload?: any): void {
    const handler = this.handlers.get(id)
    if (!handler) {
      // A namespaced surface command whose page hasn't mounted yet (the operator
      // just navigated). Buffer it — the surface flushes it on register. A plain
      // unknown command is almost always a typo, so warn on those instead.
      if (id.includes(':')) {
        this.pending.set(id, { payload, ts: Date.now() })
      } else {
        console.warn(`[commandRegistry] no handler registered for "${id}"`)
      }
      return
    }
    try {
      void handler(payload)
    } catch (e) {
      console.error(`[commandRegistry] "${id}" threw`, e)
    }
  }

  has(id: string): boolean {
    return this.handlers.has(id)
  }

  list(): string[] {
    return Array.from(this.handlers.keys())
  }
}

export const commandRegistry = new CommandRegistry()

// `navigate` needs router.push, which only exists in React scope. The bridge
// component captures it here so the singleton stays non-React.
let navigateFn: ((to: string) => void) | null = null
export function setNavigate(fn: ((to: string) => void) | null): void {
  navigateFn = fn
}

// ── Built-in global commands (registered on module load) ─────────────────────

commandRegistry.register('navigate', (p) => {
  const to = p?.to ?? p?.route
  if (typeof to === 'string' && navigateFn) navigateFn(to)
})

commandRegistry.register('open_form', (p) => {
  // payload: { key: DockKey, init?: any } — opens the prefilled dock form.
  if (p?.key) useDock.getState().open({ key: p.key as DockKey, init: p.init })
})

commandRegistry.register('open_item', (p) => {
  // Open an asset or bundle in the summonable sideview (dock). Works anywhere a
  // DockHost renders — the asset-manager's third column, or the layout's app dock.
  // payload: { asset_id?, bundle_id?, from_bundle_id? }
  const dock = useDock.getState()
  if (p?.bundle_id != null) {
    dock.openBundle(Number(p.bundle_id))
  } else if (p?.asset_id != null) {
    dock.openAsset(Number(p.asset_id), p?.from_bundle_id != null ? Number(p.from_bundle_id) : undefined)
  }
})

// A staged batch of sources the model wants confirmed *inline in the chat*, not in
// the dock. The dispatch still registers the pending return (that's the liveness
// signal the inline card reads); rendering is owned by the tool's own inline card
// (SourceConfirmCard → form for one, checklist for many). So the command itself is a
// no-op — it exists only to keep dispatch-by-name uniform and silence the warning.
commandRegistry.register('stage_sources', () => {})

// A staged schema the model wants co-authored inline (analysis_hub schema.stage).
// Same contract as stage_sources: the pending return is the liveness signal; the
// tool's own inline card (SchemaConfirmCard) owns rendering. No-op handler.
commandRegistry.register('stage_schema', () => {})

// A staged text-vs-semantic search chooser (navigate explore ask_mode=true). No-op;
// the inline SearchModeCard owns rendering and runs the search on confirm.
commandRegistry.register('stage_search_mode', () => {})

commandRegistry.register('observe', (p) => {
  // Open a floating live watcher (rendered by <ActiveObservations/>).
  const topic = p?.topic
  const resourceId = p?.resource_id ?? p?.resourceId
  if (topic && resourceId != null) {
    useObservations.getState().add({ topic, resourceId, label: p?.label as string | undefined })
  }
})
