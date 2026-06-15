'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { IntelligenceChat } from '@/components/collection/chat/Chat'

export const maxDuration = 60

function ChatInner() {
  const searchParams = useSearchParams()
  const initialPrompt = searchParams.get('prompt') ?? undefined
  return <IntelligenceChat initialPrompt={initialPrompt} />
}

export default function Page() {
  return (
    <div className="p-2 sm:pr-4 pt-0">
      <Suspense fallback={null}>
        <ChatInner />
      </Suspense>
    </div>
  )
}
