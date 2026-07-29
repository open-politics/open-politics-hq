'use client'

import { Suspense, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useChatStore } from '@/zustand_stores/storeChat'
import { IntelligenceChat } from '@/components/collection/chat/Chat'

export const maxDuration = 60

/**
 * The full-page operator. It renders the chat pointed at the store's `conversationId`,
 * so it shows the SAME thread as the floating companion (backend-persisted; either
 * surface re-hydrates from the id). The companion stands down on this route, so there's
 * only ever one chat mount.
 */
function ChatSurface() {
  const searchParams = useSearchParams()
  const conversationId = useChatStore((s) => s.conversationId)
  const setSeedPrompt = useChatStore((s) => s.setSeedPrompt)

  useEffect(() => {
    const prompt = searchParams.get('prompt')?.trim()
    if (prompt) setSeedPrompt(prompt)
  }, [searchParams, setSeedPrompt])

  return <IntelligenceChat companion initialConversationId={conversationId} />
}

export default function Page() {
  // Mark the operator open at the PAGE level (outside the Suspense boundary that wraps
  // useSearchParams) so it fires reliably — landing here means the operator is open, so
  // leaving lands on the floating window, not the collapsed launcher.
  const openChat = useChatStore((s) => s.openChat)
  useEffect(() => { openChat() }, [openChat])

  return (
    <div className="h-full p-2 pt-0 sm:pr-4">
      <Suspense fallback={null}>
        <ChatSurface />
      </Suspense>
    </div>
  )
}
