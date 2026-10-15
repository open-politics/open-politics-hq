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
 *
 * Three forms, one mount — so the thread and any live stream survive every move:
 *
 * - **Small** — the floating window at the bottom right (`placement: 'open'`).
 * - **Resting** — otherwise: the next card down, one screen below the page and
 *   out of view, the way the next window in a scrolling tiler is. A handle in
 *   the gap under the page marks where it is; on a phone, the launcher.
 * - **Pulled up** (`drawerOpen`) — scrolled into view: by pushing down past the
 *   end of the page, or from the handle or a button. The page slides up with
 *   it and stays in view above it as the peek, which is the way back: push up
 *   over it or click it, push up past the top of the thread, or press Escape.
 *
 * Resting and pulled up are two ends of one strip, page and window together.
 * A push moves along it with the hand and lets go at either end
 * (`hooks/useChatStrip.ts`); a button or a key goes the whole way. The window
 * moves; nothing opens.
 */
import React from 'react'
import { usePathname } from 'next/navigation'
import { useChatStore } from '@/zustand_stores/storeChat'
import { IntelligenceChat } from './Chat'
import { cn } from '@/lib/utils'
import { MessageSquare, ChevronDown, ChevronUp, Minus, Eye, PictureInPicture2 } from 'lucide-react'
import { useOperatorContext } from './useOperatorContext'
import { HudButton, HUD_LABEL, HUD_NUM } from '@/components/ui/chrome'

export function OperatorCompanion() {
  const placement = useChatStore((s) => s.placement)
  const conversationId = useChatStore((s) => s.conversationId)
  const openChat = useChatStore((s) => s.openChat)
  const collapseChat = useChatStore((s) => s.collapseChat)
  const drawerOpen = useChatStore((s) => s.drawerOpen)
  const openDrawer = useChatStore((s) => s.openDrawer)
  const closeDrawer = useChatStore((s) => s.closeDrawer)
  const pathname = usePathname()
  const windowRef = React.useRef<HTMLDivElement>(null)

  const small = placement === 'open' && !drawerOpen
  const resting = !small && !drawerOpen
  // Leaving the small form is a change of shape, not a move along the strip:
  // the window lands at its new position rather than sliding there from the
  // pulled-up one its new box starts at.
  const wasSmall = React.useRef(small)
  const fromSmall = wasSmall.current && !small
  React.useEffect(() => {
    wasSmall.current = small
  })

  React.useEffect(() => {
    if (!drawerOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) closeDrawer()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [drawerOpen, closeDrawer])

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
      const { drawerOpen: pulled, placement: current } = useChatStore.getState()
      if (pulled) {
        closeDrawer()
        return
      }
      if (current === 'open') {
        collapseChat()
        return
      }
      openChat()
      requestAnimationFrame(() => windowRef.current?.querySelector('textarea')?.focus())
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pathname, openChat, collapseChat, closeDrawer])

  // The dedicated chat page renders the operator full-page itself (same store
  // conversationId), so the companion stands down there.
  if (pathname === '/hq/chat') return null

  return (
    <>
      <div
        ref={windowRef}
        className={cn(
          'fixed flex flex-col overflow-hidden bg-background',
          small
            ? cn(
                'right-4 bottom-[calc(1rem+var(--app-rail,0px))] z-40 rounded-lg border shadow-2xl',
                // `dvh`/`dvw` rather than `vh`/`vw`: on a phone `100vh` is the tallest
                // the viewport ever gets, so the window was sized past the bottom of
                // the screen whenever the URL bar was showing.
                'max-h-[calc(100dvh-2rem-var(--app-rail,0px))] max-w-[calc(100dvw-2rem)]',
                // A 480px window does not fit a 390px phone. Below `sm` it takes the
                // width it can get; the fixed size is for screens that have room.
                'h-[780px] w-[calc(100dvw-2rem)] sm:w-[480px]',
              )
            : cn(
                // The strip's lower card. Its box and corners are the page's
                // (`[data-chat-strip="window"]` in globals.css), so the edges
                // line up; resting, it is one screen down, out of view.
                'pb-[env(safe-area-inset-bottom)]',
                drawerOpen ? 'z-50' : 'z-30',
              ),
        )}
        // Its position is the strip's (`--chat-pull` in globals.css).
        data-chat-strip={small ? undefined : 'window'}
        style={small ? undefined : ({ '--chat-pull': drawerOpen ? 1 : 0, transition: fromSmall ? 'none' : undefined } as React.CSSProperties)}
        role={drawerOpen || small ? 'dialog' : 'region'}
        aria-label="HQ Chat"
        aria-modal={drawerOpen || undefined}
      >
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-hud-line px-3">
          <MessageSquare className="h-3.5 w-3.5 shrink-0 stroke-[1.5] text-hud-dim" />
          <span className={cn(HUD_LABEL, 'shrink-0 text-hud-fg')}>Chat</span>
          {/* What the operator has in view — the surface and the focused item. */}
          {ctx && (
            <span
              className={cn(HUD_NUM, 'flex min-w-0 items-center gap-1 text-hud-dimmer')}
              title={`Operator context: ${ctx.label}${ctx.detail ? ` · ${ctx.detail}` : ''}`}
            >
              <Eye className="h-3 w-3 shrink-0 stroke-[1.5]" />
              <span className="truncate">
                {ctx.label}
                {ctx.detail && <> · {ctx.detail}</>}
              </span>
            </span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            {drawerOpen ? (
              <HudButton size="sm" icon={ChevronDown} title="Back to the page (Esc)" aria-label="Back to the page" onClick={closeDrawer} className="border-transparent" />
            ) : (
              <HudButton size="sm" icon={ChevronUp} title="Bring up the chat" aria-label="Bring up the chat" onClick={openDrawer} className="border-transparent" />
            )}
            {small ? (
              <HudButton size="sm" icon={Minus} title="Minimize (Ctrl+K)" aria-label="Minimize" onClick={collapseChat} className="border-transparent" />
            ) : (
              <HudButton size="sm" icon={PictureInPicture2} title="Small window (Ctrl+K)" aria-label="Small window" onClick={openChat} className="border-transparent" />
            )}
          </div>
        </div>
        {/* Out of reach while resting: out of view, so out of the tab order too. */}
        <div className="min-h-0 flex-1" inert={resting}>
          <IntelligenceChat companion embedded initialConversationId={conversationId} className="h-full" />
        </div>
      </div>

      {/* The peek: the top sixth, where the page is still in view above the
          chat, and the way back to it. The page steps back a little — enough
          to say the chat has the focus, not enough to hide the page. */}
      <button
        type="button"
        onClick={closeDrawer}
        tabIndex={drawerOpen ? 0 : -1}
        title="Back to the page (Esc, or scroll up here)"
        aria-label="Back to the page"
        aria-hidden={!drawerOpen}
        className={cn(
          'fixed inset-x-0 top-0 z-50 h-[var(--drawer-peek)] bg-black/[0.035] dark:bg-black/25',
          !drawerOpen && 'pointer-events-none',
        )}
        // Fades with the strip (`--chat-pull` in globals.css).
        data-chat-strip="peek"
        style={{ '--chat-pull': drawerOpen ? 1 : 0 } as React.CSSProperties}
      />

      {/* The way in by pointer, on a desktop: a handle in the gap below the
          page, where the next card would come from. */}
      {resting && (
        <button
          type="button"
          onClick={openDrawer}
          title="Bring up the chat (or scroll down past the page)"
          aria-label="Bring up the chat"
          className="group/foot fixed bottom-0 left-1/2 z-30 hidden h-[var(--card-gap)] w-24 -translate-x-1/2 items-center justify-center md:flex"
        >
          <span className="h-[3px] w-8 rounded-full bg-hud-line-strong transition-all group-hover/foot:w-12 group-hover/foot:bg-hud-dim" />
        </button>
      )}

      {/* The launcher — a phone's way in. */}
      {resting && (
        <button
          className={cn(
            'fixed right-4 bottom-[calc(1rem+var(--app-rail,0px))] z-40 flex items-center gap-2 rounded-full border bg-background/95 px-3.5 py-2.5 md:hidden',
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
