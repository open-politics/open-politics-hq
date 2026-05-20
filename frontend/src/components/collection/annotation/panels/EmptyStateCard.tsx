"use client";

/**
 * EmptyStateCard — teacher copy for panels that can't render yet.
 *
 * Philosophy: every empty state tells the user *why* and what to do next,
 * with an actionable button wherever possible. Generic "no data" is a bug.
 *
 * Callers pass one of several `reason` kinds; the card renders appropriate
 * copy plus optional action buttons the panel wires to its picker UI.
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Info, AlertTriangle, Target } from 'lucide-react';

export type EmptyStateReason =
  | { kind: 'no_schema' }
  | { kind: 'role_unfilled'; roleLabel: string }
  | { kind: 'shape_mismatch'; roleLabel: string; accepts: string[]; present: string[] }
  | { kind: 'no_data'; filtersActive: boolean }
  | { kind: 'field_empty'; fieldPath: string; rowCount: number }
  | { kind: 'custom'; message: string };

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'outline' | 'ghost';
}

export interface EmptyStateCardProps {
  reason: EmptyStateReason;
  actions?: EmptyStateAction[];
  className?: string;
}

function copyFor(reason: EmptyStateReason): { title: string; body: string; icon: React.ReactNode } {
  switch (reason.kind) {
    case 'no_schema':
      return {
        title: 'Pick a schema',
        body: 'This panel reads values from an annotation schema. Start by choosing which one.',
        icon: <Target className="h-4 w-4 text-primary" />,
      };
    case 'role_unfilled':
      return {
        title: `Pick a field for ${reason.roleLabel}`,
        body: `This panel needs a field mapped to the ${reason.roleLabel.toLowerCase()} role to render.`,
        icon: <Target className="h-4 w-4 text-primary" />,
      };
    case 'shape_mismatch':
      return {
        title: `No compatible field for ${reason.roleLabel}`,
        body: `This role accepts ${reason.accepts.join(', ')} fields. The schema only has ${reason.present.join(', ')}. Try a different schema or role.`,
        icon: <AlertTriangle className="h-4 w-4 text-amber-600" />,
      };
    case 'no_data':
      return {
        title: 'No items match current filters',
        body: reason.filtersActive
          ? 'Widen your filters or remove an incoming scope to see results.'
          : 'The annotation run hasn\'t produced matching items yet.',
        icon: <Info className="h-4 w-4 text-muted-foreground" />,
      };
    case 'field_empty':
      return {
        title: 'Field is empty across rows',
        body: `Field \`${reason.fieldPath}\` is null/missing in all ${reason.rowCount} items. Try another field.`,
        icon: <AlertTriangle className="h-4 w-4 text-amber-600" />,
      };
    case 'custom':
      return {
        title: 'Not yet configured',
        body: reason.message,
        icon: <Info className="h-4 w-4 text-muted-foreground" />,
      };
  }
}

export function EmptyStateCard({ reason, actions, className }: EmptyStateCardProps) {
  const { title, body, icon } = copyFor(reason);
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 p-6 text-center',
        'bg-muted/20 rounded border border-dashed',
        className,
      )}
      role="status"
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-medium">{title}</span>
      </div>
      <p className="text-xs text-muted-foreground max-w-md">{body}</p>
      {actions && actions.length > 0 && (
        <div className="flex gap-1.5 pt-1">
          {actions.map((a, i) => (
            <Button
              key={i}
              size="sm"
              variant={a.variant ?? 'outline'}
              className="h-7 text-xs"
              onClick={a.onClick}
            >
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
