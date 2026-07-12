'use client'

/**
 * ObserveWatcher — a live inline view of a backend resource (run / ingestion job)
 * via the presence stream. Reuses `useStream` (the same SSE presence infra the
 * rest of HQ uses). Mounted by the observe tool-result renderer and by the
 * `observe` command's floating watchers.
 */
import { useState } from 'react'
import { useStream } from '@/hooks/useStream'
import { useInfospaceStore } from '@/zustand_stores/storeInfospace'
import { cn } from '@/lib/utils'
import { Loader2, CheckCircle2, XCircle } from 'lucide-react'

interface ObserveWatcherProps {
  topic: string
  resourceId: string | number
  label?: string
  className?: string
}

const TERMINAL = new Set(['completed', 'complete', 'failed', 'error'])

export function ObserveWatcher({ topic, resourceId, label, className }: ObserveWatcherProps) {
  const { activeInfospace } = useInfospaceStore()
  const infospaceId = activeInfospace?.id
  const [status, setStatus] = useState<string>('connecting')
  const [progress, setProgress] = useState<number | null>(null)
  const [message, setMessage] = useState<string>('')

  const done = TERMINAL.has(status)
  const failed = status === 'failed' || status === 'error'

  useStream<any>({
    infospaceId: infospaceId ?? 0,
    topic,
    resourceId,
    enabled: !!infospaceId && !done,
    onEvent: (e) => {
      setStatus(e.type)
      const d = (e.data || {}) as Record<string, any>
      if (typeof d.progress_pct === 'number') {
        setProgress(d.progress_pct)
      } else if (typeof d.progress_current === 'number' && typeof d.progress_total === 'number' && d.progress_total > 0) {
        setProgress(Math.round((d.progress_current / d.progress_total) * 100))
      }
      if (d.message) setMessage(String(d.message))
    },
  })

  return (
    <div className={cn('rounded-md border p-2 text-xs', className)}>
      <div className="flex items-center gap-2">
        {done
          ? (failed ? <XCircle className="h-3.5 w-3.5 text-red-500" /> : <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />)
          : <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        <span className="font-medium">{label || `${topic} #${resourceId}`}</span>
        <span className="ml-auto text-muted-foreground">{status}</span>
      </div>
      {progress !== null && (
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded bg-muted">
          <div
            className={cn('h-full transition-all', failed ? 'bg-red-500' : 'bg-primary')}
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}
      {message && <div className="mt-1 truncate text-muted-foreground">{message}</div>}
    </div>
  )
}
