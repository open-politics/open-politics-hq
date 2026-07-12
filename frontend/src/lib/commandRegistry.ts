/**
 * The frontend command bus — the mirror of the backend event bus
 * (`core/events.py`): dispatch-by-name → registered handler, zero coupling to
 * the caller. A tool result's `ui_directive` (routed by the chat's directive
 * interceptor) and, later, a ⌘K palette both dispatch through this one registry.
 *
 * Plain singleton (like `ToolResultRegistry`) so non-React callers use it
 * directly. Only `navigate` needs React scope (router.push) — a mount-only
 * <CommandRegistryBridge/> captures it into `navigateFn`.
 */
import { useDock, type DockKey } from '@/zustand_stores/storeDock'
import { useObservations } from '@/zustand_stores/storeObservations'

export type CommandHandler = (payload?: any) => void | Promise<void>

class CommandRegistry {
  private handlers = new Map<string, CommandHandler>()

  register(id: string, run: CommandHandler): void {
    this.handlers.set(id, run)
  }

  dispatch(id: string, payload?: any): void {
    const handler = this.handlers.get(id)
    if (!handler) {
      console.warn(`[commandRegistry] no handler registered for "${id}"`)
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

// ── Built-in commands (registered on module load) ────────────────────────────

commandRegistry.register('navigate', (p) => {
  const to = p?.to ?? p?.route
  if (typeof to === 'string' && navigateFn) navigateFn(to)
})

commandRegistry.register('open_form', (p) => {
  // payload: { key: DockKey, init?: any } — opens the prefilled dock form.
  if (p?.key) useDock.getState().open({ key: p.key as DockKey, init: p.init })
})

// A staged batch of sources the model wants confirmed *inline in the chat*, not in
// the dock. The dispatch still registers the pending return (that's the liveness
// signal the inline card reads); rendering is owned by the tool's own inline card
// (SourceConfirmCard → form for one, checklist for many). So the command itself is a
// no-op — it exists only to keep dispatch-by-name uniform and silence the warning.
commandRegistry.register('stage_sources', () => {})

commandRegistry.register('observe', (p) => {
  // Open a floating live watcher (rendered by <ActiveObservations/>).
  const topic = p?.topic
  const resourceId = p?.resource_id ?? p?.resourceId
  if (topic && resourceId != null) {
    useObservations.getState().add({ topic, resourceId, label: p?.label as string | undefined })
  }
})
