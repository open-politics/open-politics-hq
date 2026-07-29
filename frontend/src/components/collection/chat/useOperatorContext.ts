'use client'

import { usePathname } from 'next/navigation'
import { useAnnotationRunStore } from '@/zustand_stores/useAnnotationRunStore'
import { useDock } from '@/zustand_stores/storeDock'
import { useBundleStore } from '@/zustand_stores/storeBundles'
import { useExploreState } from '@/zustand_stores/storeExplore'

/**
 * What the operator currently has "in view" — the surface the user is on, plus the
 * focused item where there is one. It mirrors the page context the operator already
 * receives (pathname), so surfacing it in the companion header gives the user a
 * shared sense of what the operator can see and act on.
 *
 * Surface comes from the route; the item is read from whichever store owns focus on
 * that surface (the active run on the Analysis page, an open bundle in the sideview).
 * Extend the item switch as more surfaces expose a focused entity.
 */
/** The entity the user has focused/open — sent to the operator so it can act on
 *  "this run/bundle" without asking which. */
export interface OperatorFocus {
  kind: 'run' | 'bundle' | 'asset' | 'explore'
  id?: number
  name?: string
  query?: string
}

export interface OperatorContext {
  label: string
  detail?: string
  focus?: OperatorFocus
}

interface Surface {
  prefix: string
  key: string
  label: string
}

// Most-specific first; '/hq' (home) is matched exactly, separately.
const SURFACES: Surface[] = [
  { prefix: '/hq/infospaces/asset-manager', key: 'assets', label: 'Asset Manager' },
  { prefix: '/hq/infospaces/explore', key: 'explore', label: 'Content Explorer' },
  { prefix: '/hq/infospaces/annotation-runner', key: 'runner', label: 'Analysis' },
  { prefix: '/hq/infospaces/annotation-schemes', key: 'schemas', label: 'Schemas' },
  { prefix: '/hq/infospaces/packages', key: 'packages', label: 'Packages' },
  { prefix: '/hq/infospaces/flows', key: 'flows', label: 'Flows' },
  { prefix: '/hq/infospaces/enrichment', key: 'enrichment', label: 'Enrichment' },
  { prefix: '/hq/infospaces/infospace-manager', key: 'infospaces', label: 'Infospaces' },
]

function surfaceForPath(pathname: string): Surface | null {
  if (pathname === '/hq' || pathname === '/hq/') return { prefix: '/hq', key: 'home', label: 'Home' }
  return SURFACES.find((s) => pathname.startsWith(s.prefix)) ?? null
}

export function useOperatorContext(): OperatorContext | null {
  const pathname = usePathname()
  const activeRun = useAnnotationRunStore((s) => s.activeRun)
  const dockEntry = useDock((s) => s.entry)
  const bundles = useBundleStore((s) => s.bundles)
  const exploreQuery = useExploreState((s) => s.query)

  const surface = surfaceForPath(pathname ?? '')
  if (!surface) return null

  let detail: string | undefined
  let focus: OperatorFocus | undefined
  if (surface.key === 'explore') {
    // The Content Explorer is open — the operator drives the query bar (not a chat
    // search) and can bundle the current results.
    const q = exploreQuery?.trim() || undefined
    detail = q
    focus = { kind: 'explore', query: q }
  } else if (surface.key === 'runner' && activeRun) {
    // The run open on the Analysis page — "this run/dashboard" means this one.
    detail = activeRun.name
    focus = { kind: 'run', id: activeRun.id, name: activeRun.name ?? undefined }
  } else if (dockEntry?.key === 'bundleDetail' && dockEntry.init?.bundleId != null) {
    // A bundle open in the sideview (Asset Manager, or the app-wide dock elsewhere).
    const id = dockEntry.init.bundleId as number
    detail = bundles.find((b) => b.id === id)?.name
    focus = { kind: 'bundle', id, name: detail }
  } else if (dockEntry?.key === 'assetDetail' && dockEntry.init?.assetId != null) {
    // An asset open in the sideview — id carries even though we don't cheaply have a name.
    focus = { kind: 'asset', id: dockEntry.init.assetId as number }
  }

  return { label: surface.label, detail, focus }
}
