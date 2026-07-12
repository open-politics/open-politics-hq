"use client";

/**
 * TopbarSlot — the app-level command surface.
 *
 * The persistent top bar in ``app/hq/layout.tsx`` owns only the sidebar trigger.
 * Everything to its right is a single slot the active view fills with its own
 * toolbar (run command strip, run-history search, …). Views that don't claim it
 * fall back to the default chrome (breadcrumb + invitations bell).
 *
 * This generalises ``annotation/panels/PanelHeaderSlot`` up to the app shell:
 * a node that *lives* in a page renders in the layout's chrome, fully reactive,
 * with no state lifting — the toolbar keeps all its hooks/handlers/dialogs in the
 * page tree, only its rendered output is hoisted here.
 *
 * Two design details:
 *  - Split reader/writer contexts. ``TopbarSlot`` consumes only the (stable)
 *    setter, so pushing a node never re-renders the writer's subtree — the same
 *    loop-avoidance rationale documented in ``PanelHeaderSlot``.
 *  - Ownership guard. At app level the active route changes, and a late-unmounting
 *    old route would otherwise null out the new route's bar. Each writer carries an
 *    id; a clear only takes effect if that id still owns the slot.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
  type ReactNode,
} from 'react';

type Entry = { id: string; node: ReactNode };

// Sentinel default: lets a TopbarSlot detect it has no host provider above it
// and degrade to rendering in place instead of silently swallowing its content.
const NO_HOST = (_entry: Entry | null, _id: string) => {};

const NodeCtx = createContext<ReactNode>(null);
const SetCtx = createContext<(entry: Entry | null, id: string) => void>(NO_HOST);

export function TopbarSlotProvider({ children }: { children: ReactNode }) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const set = useCallback((next: Entry | null, id: string) => {
    setEntry((cur) => (next ? next : cur?.id === id ? null : cur));
  }, []);
  return (
    <SetCtx.Provider value={set}>
      <NodeCtx.Provider value={entry?.node ?? null}>{children}</NodeCtx.Provider>
    </SetCtx.Provider>
  );
}

/** Renders the active view's bar content, or the fallback chrome. */
export function TopbarSlotRenderer({ fallback }: { fallback?: ReactNode }) {
  return <>{useContext(NodeCtx) ?? fallback}</>;
}

/** A view claims the bar by rendering its toolbar as children. Renders nothing in place. */
export function TopbarSlot({ children }: { children: ReactNode }) {
  const set = useContext(SetCtx);
  const id = useId();
  const hosted = set !== NO_HOST;
  useEffect(() => {
    if (!hosted) return;
    set({ id, node: children }, id);
    return () => set(null, id);
  }, [hosted, set, id, children]);
  // With a host bar above, render nothing here (content is hoisted into the bar).
  // Without one, degrade gracefully: render in place rather than vanish.
  return hosted ? null : <>{children}</>;
}
