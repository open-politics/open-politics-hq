import { IntelligenceChat } from '@/components/collection/infospaces/chat/IntelligenceChat'

export const maxDuration = 60

export default function Page() {
  return (
    <div className="container mx-auto py-6">
      <div className="max-w-4xl mx-auto">
        <IntelligenceChat className="h-[calc(100vh-8rem)]" />
      </div>
    </div>
  )
}