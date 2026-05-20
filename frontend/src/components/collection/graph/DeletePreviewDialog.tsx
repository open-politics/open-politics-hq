'use client';

/**
 * Shared delete preview/confirm dialog.
 *
 * Mirrors the backend's ``DeleteImpact`` preview/confirm pattern (see
 * ``core/tree.py`` Grove). Show cascade counts, list any hard blockers,
 * gate the confirm button on ``can_proceed``.
 *
 * Usage:
 *
 *   const { previewOrConfirm } = useDeleteCanon();
 *   const [impact, setImpact] = useState<DeleteImpact | null>(null);
 *
 *   <DeletePreviewDialog
 *     open={!!impact}
 *     impact={impact}
 *     resourceLabel="canon"
 *     resourceName={canon.name}
 *     onConfirm={async () => {
 *       const result = await previewOrConfirm(canon.id, true);
 *       if (result?.confirmed) onClose();
 *     }}
 *     onCancel={() => setImpact(null)}
 *   />
 */

import React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { DeleteImpact } from '@/client';

interface Props {
  open: boolean;
  impact: DeleteImpact | null;
  resourceLabel: string;        // e.g. "canon", "knowledge graph", "entity"
  resourceName?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const DeletePreviewDialog: React.FC<Props> = ({
  open, impact, resourceLabel, resourceName, onConfirm, onCancel,
}) => {
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {resourceLabel}{resourceName ? `: ${resourceName}` : ''}?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {impact?.blockers && impact.blockers.length > 0 && (
                <div>
                  <p className="font-medium text-destructive">Cannot proceed:</p>
                  <ul className="list-disc list-inside text-sm">
                    {impact.blockers.map((b, i) => <li key={i}>{b}</li>)}
                  </ul>
                </div>
              )}
              {impact && impact.can_proceed && (
                <div className="space-y-1 text-sm">
                  <p>This will cascade-destroy:</p>
                  <ul className="list-disc list-inside">
                    {!!impact.cascaded_entities && <li>{impact.cascaded_entities} entities</li>}
                    {!!impact.cascaded_edges && <li>{impact.cascaded_edges} graph edges</li>}
                    {!!impact.cascaded_curations && <li>{impact.cascaded_curations} curations</li>}
                    {!!impact.cascaded_relationships && <li>{impact.cascaded_relationships} materialized relationships</li>}
                  </ul>
                  <p className="text-muted-foreground">
                    Annotations, assets, and schemas always survive.
                  </p>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={!impact?.can_proceed}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
