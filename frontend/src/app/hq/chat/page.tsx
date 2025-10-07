'use client'

import { IntelligenceChat } from '@/components/collection/chat/Chat'

export const maxDuration = 60

export default function Page() {
  return (
    <div className="h-full p-2 sm:pr-4 flex flex-col w-full min-h-[calc(100vh-3em)]">
      <IntelligenceChat />
    </div>
  )
}