'use client'

/**
 * Inline source confirmation — the chat half of the `sources_hub(create)`
 * stage-then-confirm loop.
 *
 * The model stages one or more recurring sources (posture=confirm) and *waits*.
 * Instead of throwing the user out to the right dock, we confirm right here in the
 * conversation: one source → the rich inline form; many → a checklist you send off
 * together. Either way the confirm button lives inline.
 *
 * Liveness comes from the pending-return channel (`storeChat`). Directives fire
 * only on the live stream, never on history reload, so:
 *   • a return token still pending  → the model is waiting → show the actionable UI
 *   • no pending token (resolved, or replayed history) → show a settled summary chip
 * committing/dismissing resolves the token, which `Chat.tsx` feeds back to the model
 * as a `<form_result>` so it resumes.
 */

import React from 'react'
import type { ToolExecution } from '@/hooks/useIntelligenceChat'
import { SourceForm } from '@/components/collection/intake/sources/SourceForm'
import { SourceChecklist, type StagedSourceInit, type CreatedSource } from './SourceChecklist'
import { useChatStore } from '@/zustand_stores/storeChat'
import { useSourceStore } from '@/zustand_stores/storeSources'
import { CheckCircle2, Radio, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

/** True for a `sources_hub` result the model staged for inline confirmation. */
export function isStagedSource(exec: ToolExecution): boolean {
  const d = (exec.structured_content as any)?.ui_directive
  return d?.command === 'stage_sources' || d?.command === 'stage_source'
}

/** Normalise the directive payload to a list of source inits (batch or legacy single). */
function readStagedSources(payload: any): StagedSourceInit[] {
  if (Array.isArray(payload?.sources)) return payload.sources
  if (payload?.kind) return [payload] // legacy single-source shape
  return []
}

export function SourceConfirmCard({ execution }: { execution: ToolExecution }) {
  const sc = execution.structured_content as any
  const directive = sc?.ui_directive ?? {}
  const token: string | undefined = directive.return_token
  const sources = React.useMemo(() => readStagedSources(directive.payload), [directive.payload])

  const pending = useChatStore((s) => (token ? s.pendingReturns[token] : undefined))
  const resolveReturn = useChatStore((s) => s.resolveReturn)
  const triggerSourceProcessing = useSourceStore((s) => s.triggerSourceProcessing)
  const [settled, setSettled] = React.useState<{ status: 'created' | 'cancelled'; label: string } | null>(null)

  const single = sources[0]
  const soloName = single?.name || sc?.name || 'source'

  // Single-source create: seed the bundle immediately (a fresh source otherwise sits
  // idle until its first poll) and carry {sourceId, name, bundleId} back to the model.
  const finishSingle = (status: 'created' | 'cancelled', result?: any) => {
    if (status === 'created' && result?.id) void triggerSourceProcessing(result.id)
    if (token) {
      resolveReturn(
        token,
        status === 'created'
          ? { status, sourceId: result?.id, name: result?.name ?? soloName, bundleId: result?.output_bundle_id ?? single?.bundleId }
          : { status },
      )
    }
    setSettled({ status, label: status === 'created' ? `Created recurring source ${result?.name ?? soloName}` : `Dismissed ${soloName}` })
  }

  // Batch: the checklist already created + seeded each source; carry the list back.
  const finishBatch = (created: CreatedSource[]) => {
    if (token) resolveReturn(token, { status: 'created', created })
    setSettled({ status: 'created', label: `Created ${created.length} recurring source${created.length === 1 ? '' : 's'}` })
  }
  const dismissBatch = () => {
    if (token) resolveReturn(token, { status: 'cancelled' })
    setSettled({ status: 'cancelled', label: 'Dismissed' })
  }

  // Not live-actionable — either we just settled it, or this is replayed history
  // (no pending return, since directives never re-fire on reload). Show a quiet chip.
  if (settled || !pending) {
    const cancelled = settled?.status === 'cancelled'
    const label = settled?.label ?? (sources.length > 1 ? `${sources.length} recurring sources` : `Recurring source ${soloName}`)
    return (
      <div className={cn('flex items-center gap-2 rounded-md border px-3 py-2 text-sm', cancelled ? 'text-muted-foreground' : 'border-primary/30 bg-primary/[0.03]')}>
        {cancelled ? (
          <XCircle className="size-4 shrink-0 text-muted-foreground" />
        ) : settled?.status === 'created' ? (
          <CheckCircle2 className="size-4 shrink-0 text-primary" />
        ) : (
          <Radio className="size-4 shrink-0 text-primary/70" />
        )}
        <span className="min-w-0 truncate">{label}</span>
      </div>
    )
  }

  // Many → checklist; one → the rich inline form.
  if (sources.length > 1) {
    return <SourceChecklist sources={sources} onDismiss={dismissBatch} onCreate={finishBatch} />
  }

  return (
    <SourceForm
      init={single ?? {}}
      mode="inline"
      fullscreen={false}
      escalate={() => {}}
      close={() => finishSingle('cancelled')}
      onSuccess={(result) => finishSingle('created', result)}
    />
  )
}
