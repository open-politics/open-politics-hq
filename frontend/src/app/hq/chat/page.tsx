'use client'

import { IntelligenceChat } from '@/components/collection/chat/Chat'

export const maxDuration = 60

export default function Page() {
  return (
    <div className="p-2 sm:pr-4 pt-0">
      <IntelligenceChat />
    </div>
  )
}