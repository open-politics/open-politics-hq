'use client'

/**
 * Inline text-vs-semantic chooser — the chat half of `navigate(explore, ask_mode=true)`.
 *
 * The operator stages this ONLY when semantic search might yield more; the user picks a
 * mode (default: text) and the card runs the explorer search with it. Same liveness
 * contract as the other staged cards: pending return → actionable; else a quiet chip.
 */

import React from 'react'
import type { ToolExecution } from '@/hooks/useIntelligenceChat'
import { useChatStore } from '@/zustand_stores/storeChat'
import { commandRegistry } from '@/lib/commandRegistry'
import { Button } from '@/components/ui/button'
import { Search, Sparkles, CheckCircle2, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export function isStagedSearchMode(exec: ToolExecution): boolean {
  const d = (exec.structured_content as any)?.ui_directive
  const cmd = Array.isArray(d) ? d[0]?.command : d?.command
  return cmd === 'stage_search_mode'
}

function readDirective(sc: any): any {
  const d = sc?.ui_directive
  return Array.isArray(d) ? d.find((x) => x?.command === 'stage_search_mode') ?? {} : (d ?? {})
}

type Mode = 'text' | 'semantic'

export function SearchModeCard({ execution }: { execution: ToolExecution }) {
  const sc = execution.structured_content as any
  const directive = React.useMemo(() => readDirective(sc), [sc])
  const token: string | undefined = directive.return_token
  const query: string = directive.payload?.query ?? ''
  const path: string = directive.payload?.path ?? '/hq/infospaces/explore'

  const pending = useChatStore((s) => (token ? s.pendingReturns[token] : undefined))
  const resolveReturn = useChatStore((s) => s.resolveReturn)
  const [mode, setMode] = React.useState<Mode>('text')
  const [settled, setSettled] = React.useState<{ mode: Mode; cancelled?: boolean } | null>(null)

  const run = (chosen: Mode) => {
    const q = chosen === 'semantic' ? `~${query}` : query
    commandRegistry.dispatch('navigate', { to: `${path}?q=${encodeURIComponent(q)}` })
    if (token) resolveReturn(token, { status: 'searched', mode: chosen, query })
    setSettled({ mode: chosen })
  }
  const dismiss = () => {
    if (token) resolveReturn(token, { status: 'cancelled' })
    setSettled({ mode, cancelled: true })
  }

  if (settled || !pending) {
    const cancelled = settled?.cancelled
    return (
      <div className={cn('flex items-center gap-2 rounded-md border px-3.5 py-2.5 text-sm', cancelled ? 'text-muted-foreground' : 'border-primary/30 bg-primary/[0.03]')}>
        {cancelled ? <XCircle className="size-4 shrink-0 text-muted-foreground" /> : <CheckCircle2 className="size-4 shrink-0 text-primary" />}
        <span className="min-w-0 truncate">
          {cancelled ? 'Dismissed search' : <>Searched <strong>{query}</strong> · {settled?.mode === 'semantic' ? 'semantic' : 'text'}</>}
        </span>
      </div>
    )
  }

  const Option = ({ value, icon: Icon, title, blurb }: { value: Mode; icon: any; title: string; blurb: string }) => (
    <button
      onClick={() => setMode(value)}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-md border p-2.5 text-left transition-colors',
        mode === value ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
      )}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', mode === value ? 'text-primary' : 'text-muted-foreground')} />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {title}
          {value === 'text' && <span className="rounded-full border px-1.5 text-[10px] text-muted-foreground">default</span>}
        </span>
        <span className="block text-xs text-muted-foreground">{blurb}</span>
      </span>
    </button>
  )

  return (
    <div className="overflow-hidden rounded-lg border border-primary/30 bg-primary/[0.03]">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-sm font-medium">
        <Search className="size-4 shrink-0 text-primary/80" />
        <span className="min-w-0 truncate">How should I search “{query}”?</span>
      </div>
      <div className="space-y-2 p-3">
        <Option value="text" icon={Search} title="Text search" blurb="Exact words & phrases — precise and fast." />
        <Option value="semantic" icon={Sparkles} title="Semantic search" blurb="Meaning-based — surfaces related documents even without the exact words." />
      </div>
      <div className="flex items-center justify-end gap-2 border-t px-3 py-2.5">
        <Button variant="ghost" size="sm" onClick={dismiss} className="text-sm">Dismiss</Button>
        <Button size="sm" onClick={() => run(mode)} className="min-w-24 text-sm">Search</Button>
      </div>
    </div>
  )
}
