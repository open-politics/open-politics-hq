'use client'

/**
 * A broken card is a broken card, not a broken session.
 *
 * The inline confirm cards render model-authored JSON straight into React state,
 * so a shape nobody anticipated throws during render — and an uncaught throw
 * unmounts the whole tree. Here that tree is `HQLayout`, so one malformed tool
 * directive took out the entire page ("This page couldn't load"), conversation
 * and all. That is the wrong blast radius for a card in a message.
 */

import React from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  children: React.ReactNode
  /** What the failed card was for — shown to the user, logged with the error. */
  label: string
}

export class CardBoundary extends React.Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[chat] ${this.props.label} card failed to render`, error, info)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/[0.03] px-3 py-2 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive/70" />
        <div className="min-w-0">
          <div>This {this.props.label} card couldn&rsquo;t be displayed.</div>
          <div className="mt-0.5 break-words text-xs text-muted-foreground">{error.message}</div>
        </div>
      </div>
    )
  }
}
