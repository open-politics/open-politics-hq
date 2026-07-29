'use client'

import { useEffect, useRef } from 'react'
import { commandRegistry, type CommandHandler } from '@/lib/commandRegistry'

/**
 * Register a surface's imperative verbs with the command bus so the HQ operator can
 * drive them by directive. `navigate` gets the user to a page; these operate it —
 * open an item, unfold the tree to a target, set an axis, add a panel.
 *
 * Handlers register under `${namespace}:${action}` and tear down on unmount. They
 * read through a ref, so a handler always sees the latest closure (current state /
 * store actions) without re-registering on every render. The *set* of actions is
 * snapshotted at mount — keep it fixed for a given surface (that's the natural
 * shape: a page's vocabulary doesn't change while it's open).
 *
 * A directive that arrives in the gap between the operator navigating and the page
 * mounting is buffered by the registry and flushed here on register — so
 * "open the asset manager, then reveal bundle 42" lands even though the reveal
 * directive fired before this surface existed.
 *
 * Pass `{ enabled }` for a surface whose state loads asynchronously (e.g. a dashboard
 * that must fetch its run first): registration waits until `enabled` is true, so a
 * buffered directive flushes only once the verbs can actually act.
 *
 * @example
 *   useSurfaceCommands('assets', {
 *     reveal: (p) => revealBundle(Number(p?.bundle_id)),
 *     search: (p) => setSearch(String(p?.query ?? '')),
 *   })
 */
export function useSurfaceCommands(
  namespace: string,
  handlers: Record<string, CommandHandler>,
  options?: { enabled?: boolean },
): void {
  const enabled = options?.enabled ?? true
  const ref = useRef(handlers)
  ref.current = handlers

  useEffect(() => {
    if (!enabled) return
    const stable: Record<string, CommandHandler> = {}
    for (const action of Object.keys(ref.current)) {
      stable[action] = (payload) => ref.current[action]?.(payload)
    }
    return commandRegistry.registerSurface(namespace, stable)
    // Register once the surface is enabled; handlers stay fresh via the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, enabled])
}
