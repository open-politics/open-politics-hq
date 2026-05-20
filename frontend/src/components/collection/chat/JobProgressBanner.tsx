'use client'

/**
 * JobProgressBanner — live SSE-driven progress card for an IngestionJob.
 *
 * Generic over any IngestionJob (kind="bulk_urls", "directory", "archive", etc.).
 * Subscribes to the existing presence stream at
 * ``/api/v1/infospaces/{iid}/stream/ingestion_job/{jobId}``, which `ctx.job_progress`
 * pushes to from the @task. ``Last-Event-ID: 0`` replays past events from
 * the Redis ring buffer so we don't miss a job that finished before mount.
 *
 * Self-removes via ``onComplete`` when it sees a terminal event
 * (``completed`` | ``failed``). 30-second silence fallback: one-shot GET
 * for terminal-state assets that never produced stream events (legacy paths).
 */

import { useEffect, useRef, useState } from 'react'
import { Loader2, CheckCircle2, XCircle, Globe } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { connectSSE } from '@/lib/sse'
import { OpenAPI } from '@/client/core/OpenAPI'
import { cn } from '@/lib/utils'

export interface JobProgressBannerProps {
  jobId: number
  infospaceId: number
  /** Called when the banner observes a terminal event so the parent can drop it. */
  onComplete?: (status: 'completed' | 'failed') => void
  /** Optional custom label (defaults to "Scraping URLs"). */
  label?: string
  className?: string
}

interface JobProgressEvent {
  stage?: string
  message?: string
  progress_pct?: number
  processed?: number
  failed?: number
  total?: number
}

type Status = 'pending' | 'progress' | 'completed' | 'failed'

export function JobProgressBanner({
  jobId,
  infospaceId,
  onComplete,
  label = 'Scraping URLs',
  className,
}: JobProgressBannerProps) {
  const [state, setState] = useState<JobProgressEvent>({ progress_pct: 0, message: 'Connecting…' })
  const [status, setStatus] = useState<Status>('pending')
  const completedRef = useRef(false)

  useEffect(() => {
    const controller = new AbortController()

    const finalize = (next: 'completed' | 'failed') => {
      if (completedRef.current) return
      completedRef.current = true
      setStatus(next)
      // Brief settle so the user sees the terminal frame before dismissal.
      setTimeout(() => onComplete?.(next), 1200)
      controller.abort()
    }

    // Fallback poll: if the stream is silent for 30s, the job may have already
    // completed before the banner mounted (terminal cursor_state already in DB
    // but no stream events left to replay). Read the row directly to dismiss.
    const fallbackTimer = setTimeout(async () => {
      if (completedRef.current) return
      try {
        const url = `${OpenAPI.BASE}/api/v1/infospaces/${infospaceId}/ingestion-jobs/${jobId}`
        const headers: Record<string, string> = { Accept: 'application/json' }
        const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
        if (token) headers.Authorization = `Bearer ${token}`
        const resp = await fetch(url, { headers, credentials: 'include' })
        if (resp.ok) {
          const job = await resp.json()
          const terminal = job?.status?.toLowerCase?.()
          if (terminal === 'completed' || terminal === 'failed') {
            const cs = job?.cursor_state || {}
            setState({
              progress_pct: cs.progress_pct ?? (terminal === 'completed' ? 100 : 0),
              message: cs.message ?? terminal,
              processed: cs.processed,
              failed: cs.failed,
              total: cs.total,
              stage: cs.stage,
            })
            finalize(terminal as 'completed' | 'failed')
          }
        }
      } catch (err) {
        // Best-effort — if the fallback fails the banner stays until SSE wakes up
        // or the user navigates away.
      }
    }, 30_000)

    connectSSE({
      url: `${OpenAPI.BASE}/api/v1/infospaces/${infospaceId}/stream/ingestion_job/${jobId}`,
      method: 'GET',
      lastEventId: '0',  // replay any events emitted before we mounted
      signal: controller.signal,
      onEvent: (event) => {
        if (!event.data) return
        let payload: JobProgressEvent = {}
        try {
          payload = JSON.parse(event.data)
        } catch {
          return
        }
        setState((prev) => ({ ...prev, ...payload }))
        if (event.type === 'completed') finalize('completed')
        else if (event.type === 'failed') finalize('failed')
        else if (event.type === 'progress' || event.type === 'item_done' || event.type === 'item_started') {
          setStatus('progress')
        }
      },
      onError: () => {
        // Connection failed (auth, network) — leave the fallback timer to clean up.
      },
    }).catch(() => { /* swallowed — fallback handles it */ })

    return () => {
      clearTimeout(fallbackTimer)
      controller.abort()
    }
  }, [jobId, infospaceId, onComplete])

  const pct = Math.max(0, Math.min(100, state.progress_pct ?? 0))
  const isTerminal = status === 'completed' || status === 'failed'

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-md border bg-background/80 text-xs min-w-0 overflow-hidden transition-opacity',
        status === 'failed' && 'border-red-300 dark:border-red-800',
        status === 'completed' && 'border-green-300 dark:border-green-800',
        className,
      )}
    >
      <div className="shrink-0">
        {status === 'completed' ? (
          <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
        ) : status === 'failed' ? (
          <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
        ) : (
          <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
        )}
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 min-w-0">
          <Globe className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="font-medium truncate">{label}</span>
          {state.total != null && (
            <Badge variant="outline" className="text-[10px] h-4 px-1 shrink-0">
              {state.processed ?? 0}/{state.total}
            </Badge>
          )}
          {!isTerminal && (
            <span className="text-[10px] text-muted-foreground shrink-0">{pct}%</span>
          )}
        </div>
        {!isTerminal && <Progress value={pct} className="h-1" />}
        {state.message && (
          <div className="text-[10px] text-muted-foreground truncate">{state.message}</div>
        )}
      </div>
    </div>
  )
}
