'use client'

/**
 * Floating stack of active observe watchers (opened via the `observe` command).
 * Mounted once in the app shell, like DockHost. Tool-result observes render
 * inline in their tool card via ObserveRenderer instead.
 */
import { useObservations } from '@/zustand_stores/storeObservations'
import { ObserveWatcher } from './ObserveWatcher'
import { X } from 'lucide-react'

export function ActiveObservations() {
  const { observations, remove } = useObservations()
  if (observations.length === 0) return null
  return (
    // Sits a launcher-height above the companion rather than on top of it —
    // both used to anchor to `bottom-4 right-4`, so whichever rendered last won
    // and the other became unclickable.
    <div className="fixed right-4 bottom-[calc(4.75rem+var(--app-rail,0px))] z-50 flex w-72 max-w-[calc(100dvw-2rem)] flex-col gap-2">
      {observations.map((o) => (
        <div key={o.id} className="relative rounded-md bg-background shadow-lg">
          <button
            onClick={() => remove(o.id)}
            className="absolute -right-1.5 -top-1.5 rounded-full bg-muted p-0.5 shadow"
            aria-label="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
          <ObserveWatcher topic={o.topic} resourceId={o.resourceId} label={o.label} />
        </div>
      ))}
    </div>
  )
}
