import type { SourceRead } from '@/client';
import type { SourceKind } from '@/lib/annotations/types';

/**
 * Init payload that opens the source form (in the dock) to edit an existing
 * source — landing on the config step with its kind locked. Shared by every
 * "manage / edit this source" affordance (the sources rail, a bundle's feeding
 * sources) so they stay in lockstep instead of drifting field-by-field.
 */
export function sourceFormInit(source: SourceRead) {
  return {
    sourceId: source.id,
    kind: source.kind as SourceKind,
    name: source.name,
    config: source.details ?? {},
    streamEnabled: source.is_active,
    pollInterval: source.poll_interval_seconds,
    bundleId: source.output_bundle_id ?? undefined,
    lockKind: true,
    startStep: 'config' as const,
    layout: 'stepped' as const,
  };
}
