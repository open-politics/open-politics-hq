'use client'

/**
 * RunDock — a compact live view of an annotation run, shown in the dock beside
 * the chat (co-presence). Live progress via ObserveWatcher (the presence stream)
 * + a link to the full dashboard. Opened by the `open_form` directive that
 * `run.start` attaches, so a chat-started run appears next to the conversation.
 */
import { useRouter } from 'next/navigation'
import { ObserveWatcher } from './ObserveWatcher'
import { Button } from '@/components/ui/button'
import { X, ArrowLeft, ExternalLink } from 'lucide-react'

interface RunDockProps {
  runId: number
  onBack?: () => void
  onClose?: () => void
}

export function RunDock({ runId, onBack, onClose }: RunDockProps) {
  const router = useRouter()
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b p-2">
        {onBack && (
          <button onClick={onBack} aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <span className="text-sm font-medium">Run #{runId}</span>
        {onClose && (
          <button onClick={onClose} className="ml-auto" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="flex-1 space-y-3 overflow-auto p-3">
        <ObserveWatcher topic="annotation_run" resourceId={runId} label={`Run #${runId}`} />
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => router.push(`/hq/infospaces/annotation-runner?runId=${runId}`)}
        >
          <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open full dashboard
        </Button>
      </div>
    </div>
  )
}
