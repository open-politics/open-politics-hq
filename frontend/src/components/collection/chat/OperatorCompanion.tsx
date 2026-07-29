'use client'

/**
 * The HQ Operator's floating companion — a bottom-right window on every HQ route.
 *
 * It reads two things from `storeChat`: `placement` (open vs. the collapsed launcher)
 * and `conversationId`. The thread itself lives on the backend, so the chat just loads
 * `conversationId`; nothing here has to survive navigation. On `/hq/chat` the full-page
 * view owns the operator, so this companion stands down (one chat mount at a time).
 *
 * It carries `companion`, which makes whichever operator surface is mounted own the
 * shared `storeChat` conversationId + the B4 return channel; run/formula-scoped
 * `DockedChat` instances stay out of that.
 */
import React from 'react'
import { usePathname } from 'next/navigation'
import { useChatStore } from '@/zustand_stores/storeChat'
import { IntelligenceChat } from './Chat'
import { cn } from '@/lib/utils'
import { MessageSquare, Maximize2, Minimize2, Minus, Eye } from 'lucide-react'
import { useOperatorContext } from './useOperatorContext'

export function OperatorCompanion() {
  const placement = useChatStore((s) => s.placement)
  const conversationId = useChatStore((s) => s.conversationId)
  const openChat = useChatStore((s) => s.openChat)
  const collapseChat = useChatStore((s) => s.collapseChat)
  const [maximized, setMaximized] = React.useState(false)
  const pathname = usePathname()
  const windowRef = React.useRef<HTMLDivElement>(null)
  // What the operator currently has in view — shown in the header so the user shares
  // the operator's sense of "where we are". (Hooks must run before the early return.)
  const ctx = useOperatorContext()

  // Ctrl+K toggles the companion from anywhere: open lands the caret in the composer,
  // so it's one keystroke from any route to typing. Deliberately ctrl on macOS too
  // (not cmd) — cmd+K is the browser's, and this way the muscle memory is one shortcut
  // on every platform. Opening focuses on the next frame: the window is `hidden` until
  // the store update paints, and display:none can't take focus.
  React.useEffect(() => {
    if (pathname === '/hq/chat') return // the full-page view owns the operator here
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'k' || !e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      e.preventDefault()
      if (useChatStore.getState().placement === 'open') {
        collapseChat()
        return
      }
      openChat()
      requestAnimationFrame(() => windowRef.current?.querySelector('textarea')?.focus())
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pathname, openChat, collapseChat])

  // The dedicated chat page renders the operator full-page itself (same store
  // conversationId), so the floating companion stands down there.
  if (pathname === '/hq/chat') return null

  const open = placement === 'open'

  return (
    <>
      {/* The window — mounted whenever we're not on the chat page, so the thread + any
          live stream survive navigation between ordinary routes; hidden when collapsed. */}
      <div
        ref={windowRef}
        className={cn(
          'fixed bottom-4 right-4 z-40 flex flex-col overflow-hidden rounded-lg border bg-background shadow-2xl',
          'max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)]',
          maximized ? 'h-[85vh] w-[720px]' : 'h-[780px] w-[480px]',
          !open && 'hidden',
        )}
        role="dialog"
        aria-label="HQ Chat"
      >
        <div className="flex items-center gap-2 border-b px-2.5 py-1.5">
          <MessageSquare className="h-4 w-4 shrink-0 text-primary" />
          <span className="shrink-0 text-xs font-medium">Chat</span>
          {/* Context indicator — the surface (and focused item) the operator has in view. */}
          {ctx && (
            <div
              className="flex min-w-0 items-center gap-1  bg-muted/40 px-2 py-0.5 text-[11px] text-blue-500"
              title={`Operator context: ${ctx.label}${ctx.detail ? ` · ${ctx.detail}` : ''}`}
            >
              <Eye className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {ctx.label}
                {ctx.detail && <span className="text-blue-500"> · {ctx.detail}</span>}
              </span>
            </div>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <button
              className="rounded p-1 text-muted-foreground hover:bg-muted"
              title={maximized ? 'Restore size' : 'Maximize'}
              onClick={() => setMaximized((m) => !m)}
            >
              {maximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
            <button
              className="rounded p-1 text-muted-foreground hover:bg-muted"
              title="Minimize (Ctrl+K)"
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
          title="Open the HQ Chat (Ctrl+K)"
          onClick={openChat}
        >
          <MessageSquare className="h-4 w-4 text-primary" />
          {conversationId != null && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />}
        </button>
      )}
    </>
  )
}
