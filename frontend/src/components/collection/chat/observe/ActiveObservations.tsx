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
    <div className="fixed bottom-4 right-4 z-50 flex w-72 flex-col gap-2">
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
