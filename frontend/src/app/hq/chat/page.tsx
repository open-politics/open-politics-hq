'use client'

import { Suspense, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useChatStore } from '@/zustand_stores/storeChat'
import { Bot } from 'lucide-react'

export const maxDuration = 60

/**
 * The operator is now a GLOBAL companion (mounted in `app/hq/layout.tsx`), so it
 * lives on every route and isn't bound to this page. Visiting `/hq/chat` just
 * opens it — and hands off any `?prompt=` from the home "Ask" bar via the store,
 * so we never mount a second chat here (that would double the SSE stream).
 */
function ChatLanding() {
  const searchParams = useSearchParams()
  const openChat = useChatStore((s) => s.openChat)
  const setSeedPrompt = useChatStore((s) => s.setSeedPrompt)

  useEffect(() => {
    const prompt = searchParams.get('prompt')?.trim()
    if (prompt) setSeedPrompt(prompt)
    openChat()
  }, [searchParams, openChat, setSeedPrompt])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border bg-muted/40">
        <Bot className="h-7 w-7 text-primary" />
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">The HQ Operator is open</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          It rides along on every page now — bottom-right. Ask it to set up a monitoring
          operation, compare how outlets frame a topic, or run any workflow; it stays with
          you as it navigates HQ and opens what it builds beside you.
        </p>
      </div>
      <button
        className="rounded-md border bg-background px-3.5 py-2 text-sm font-medium shadow-sm hover:bg-muted"
        onClick={() => openChat()}
      >
        Open the Operator
      </button>
    </div>
  )
}

export default function Page() {
  return (
    <div className="p-2 sm:pr-4 pt-0">
      <Suspense fallback={null}>
        <ChatLanding />
      </Suspense>
    </div>
  )
}
