/**
 * ObserveRenderer — renders a live inline view for a tool result that carries an
 * observe payload ({kind:'observe', topic, resource_id}). The tool card shows the
 * resource (run / ingestion job) filling in real time via the presence stream.
 */
import React from 'react'
import { ToolResultRenderer } from '../core/ToolResultRegistry'
import { ToolResultRenderProps } from '../shared/types'
import { ObserveWatcher } from '../../observe/ObserveWatcher'

function isObserve(result: any): boolean {
  if (!result || typeof result !== 'object') return false
  const rid = result.resource_id ?? result.resourceId
  return result.kind === 'observe' || (!!result.topic && rid != null)
}

export const ObserveRenderer: ToolResultRenderer = {
  toolName: 'observe',
  canHandle: isObserve,
  render: ({ result }: ToolResultRenderProps) => {
    const topic = result?.topic
    const resourceId = result?.resource_id ?? result?.resourceId
    if (!topic || resourceId == null) return null
    return <ObserveWatcher topic={topic} resourceId={resourceId} label={result?.label} />
  },
  getSummary: (result: any) => `watching ${result?.topic} #${result?.resource_id ?? result?.resourceId}`,
}
