'use client'

/**
 * Inline schema confirmation — the chat half of the `analysis_hub(schema.stage)`
 * stage-then-confirm loop, mirroring `SourceConfirmCard`.
 *
 * The model stages a schema seed (posture=confirm) and *waits*. Instead of sending
 * the user to the full editor, we co-author it right here: a lean field editor with
 * a live preview, confirmed inline. Liveness comes from the pending-return channel
 * (`storeChat`) — a still-pending token means the model is waiting (show the form);
 * no pending token means settled or replayed history (show a quiet chip). Confirming
 * resolves the token, which `Chat.tsx` feeds back as a `<form_result>` to resume.
 */

import React from 'react'
import type { ToolExecution } from '@/hooks/useIntelligenceChat'
import { SchemaForm } from '@/components/collection/intake/schemas/SchemaForm'
import type { SchemaFormInit } from '@/components/collection/intake/schemas/useSchemaForm'
import { useChatStore } from '@/zustand_stores/storeChat'
import { CheckCircle2, ListChecks, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

/** True for an `analysis_hub` result the model staged for inline schema confirmation. */
export function isStagedSchema(exec: ToolExecution): boolean {
  const d = (exec.structured_content as any)?.ui_directive
  const cmd = Array.isArray(d) ? d[0]?.command : d?.command
  return cmd === 'stage_schema'
}

function readDirective(sc: any): any {
  const d = sc?.ui_directive
  return Array.isArray(d) ? d.find((x) => x?.command === 'stage_schema') ?? {} : (d ?? {})
}

export function SchemaConfirmCard({ execution }: { execution: ToolExecution }) {
  const sc = execution.structured_content as any
  const directive = React.useMemo(() => readDirective(sc), [sc])
  const token: string | undefined = directive.return_token
  const init = (directive.payload ?? {}) as SchemaFormInit

  const pending = useChatStore((s) => (token ? s.pendingReturns[token] : undefined))
  const resolveReturn = useChatStore((s) => s.resolveReturn)
  const [settled, setSettled] = React.useState<{ status: 'created' | 'cancelled'; label: string } | null>(null)

  const seedName = init?.name || 'schema'

  const finish = (status: 'created' | 'cancelled', result?: any) => {
    if (token) {
      resolveReturn(
        token,
        status === 'created'
          ? { status, schemaId: result?.id, name: result?.name ?? seedName }
          : { status },
      )
    }
    setSettled({
      status,
      label: status === 'created' ? `Created schema ${result?.name ?? seedName}` : `Dismissed ${seedName}`,
    })
  }

  // Not live-actionable — settled, or replayed history (directives never re-fire on
  // reload, so there's no pending token). Show a quiet chip.
  if (settled || !pending) {
    const cancelled = settled?.status === 'cancelled'
    const label = settled?.label ?? `Schema ${seedName}`
    return (
      <div className={cn('flex items-center gap-2 rounded-md border px-3 py-2 text-sm', cancelled ? 'text-muted-foreground' : 'border-primary/30 bg-primary/[0.03]')}>
        {cancelled ? (
          <XCircle className="size-4 shrink-0 text-muted-foreground" />
        ) : settled?.status === 'created' ? (
          <CheckCircle2 className="size-4 shrink-0 text-primary" />
        ) : (
          <ListChecks className="size-4 shrink-0 text-primary/70" />
        )}
        <span className="min-w-0 truncate">{label}</span>
      </div>
    )
  }

  return (
    <SchemaForm
      init={init}
      mode="inline"
      fullscreen={false}
      escalate={() => {}}
      close={() => finish('cancelled')}
      onSuccess={(result) => finish('created', result)}
    />
  )
}
