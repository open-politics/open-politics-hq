'use client'

/**
 * The HQ Operator as a global companion.
 *
 * Mounted once in the app shell (`app/hq/layout.tsx`), so it lives on EVERY route
 * and never unmounts as you navigate `/hq/*` — the conversation and any live stream
 * survive page changes for free. Two visible forms:
 *   • collapsed → a slim launcher pill (bottom-right)
 *   • open      → a floating window (bottom-right; normal or maximized)
 *
 * The chat itself is ALWAYS mounted (the window is merely hidden when collapsed),
 * so collapsing never drops in-flight messages or the SSE stream — reopening shows
 * exactly where it left off. It carries `companion`, which is what makes it (and
 * only it) own the shared `storeChat` conversationId + the B4 return channel; the
 * run/formula-scoped `DockedChat` instances stay out of that.
 *
 * Directives the operator fires (`navigate`, `runDashboard`, …) drive the MAIN
 * content — the window just stays put on top.
 */
import React from 'react'
import { useChatStore } from '@/zustand_stores/storeChat'
import { IntelligenceChat } from './Chat'
import { cn } from '@/lib/utils'
import { Bot, Maximize2, Minimize2, Minus } from 'lucide-react'

export function OperatorCompanion() {
  const placement = useChatStore((s) => s.placement)
  const conversationId = useChatStore((s) => s.conversationId)
  const openChat = useChatStore((s) => s.openChat)
  const collapseChat = useChatStore((s) => s.collapseChat)
  const [maximized, setMaximized] = React.useState(false)

  const open = placement === 'open'

  return (
    <>
      {/* The window — always mounted so the thread + stream persist across
          collapse/expand and across navigation; only visually hidden when collapsed. */}
      <div
        className={cn(
          'fixed bottom-4 right-4 z-40 flex flex-col overflow-hidden rounded-lg border bg-background shadow-2xl',
          'max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)]',
          maximized ? 'h-[85vh] w-[720px]' : 'h-[640px] w-[420px]',
          !open && 'hidden',
        )}
        role="dialog"
        aria-label="HQ Operator"
      >
        <div className="flex items-center gap-2 border-b px-2.5 py-1.5">
          <Bot className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium">Operator</span>
          <div className="ml-auto flex items-center gap-0.5">
            <button
              className="rounded p-1 text-muted-foreground hover:bg-muted"
              title={maximized ? 'Restore size' : 'Maximize'}
              onClick={() => setMaximized((m) => !m)}
            >
              {maximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
            <button
              className="rounded p-1 text-muted-foreground hover:bg-muted"
              title="Minimize"
              onClick={collapseChat}
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <IntelligenceChat companion embedded initialConversationId={conversationId} className="h-full" />
        </div>
      </div>

      {/* The launcher — shown when collapsed. */}
      {!open && (
        <button
          className={cn(
            'fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border bg-background/95 px-3.5 py-2.5',
            'text-sm font-medium shadow-lg backdrop-blur transition-colors hover:bg-muted',
          )}
          title="Open the HQ Operator"
          onClick={openChat}
        >
          <Bot className="h-4 w-4 text-primary" />
          Operator
          {conversationId != null && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />}
        </button>
      )}
    </>
  )
}
