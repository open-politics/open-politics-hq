"use client";

/**
 * RolePickerPopover — compact trigger for RolePicker.
 *
 * The picker itself is vertical and takes a full row of header space.
 * Most panels already have a dense toolbar (chart type toggle, interval,
 * field visibility…); stacking the full picker on top wastes real estate
 * when the user has already configured the required roles. This wrapper
 * renders a single button that opens the picker in a popover.
 *
 * The trigger summarizes current selections — schema name + role→paths
 * chips — so users can see the configuration at a glance without opening.
 * Missing-required hints still surface inline so the panel isn't silently
 * broken.
 */
import React, { useMemo, useState } from 'react';
import { Axis3d, AlertCircle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { RolePicker, type RolePickerProps } from './RolePicker';
import type { PanelProjection } from '@/lib/annotations/types';

export interface RolePickerPopoverProps extends RolePickerProps {
  /** Extra classes for the trigger button. */
  triggerClassName?: string;
  /** @deprecated — preview embed retired with the projection phase. Kept
   *  so legacy panel call sites typecheck while they migrate. */
  infospaceId?: number;
  /** @deprecated — see above. */
  runId?: number;
  /** @deprecated — see above. */
  previewProjection?: PanelProjection | null;
  /** @deprecated — see above. */
  projectionRoles?: string[];
}

export function RolePickerPopover({
  triggerClassName,
  infospaceId: _iid,
  runId: _rid,
  previewProjection: _prev,
  projectionRoles: _pr,
  ...rolePickerProps
}: RolePickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const { schema, availableSchemas, value } = rolePickerProps;

  const selectedSchema = useMemo(
    () => availableSchemas.find((s) => s.id === value.schemaId) ?? null,
    [availableSchemas, value.schemaId],
  );

  const missingRequired = useMemo(
    () =>
      schema.roles.filter(
        (r) => r.required && (value.fieldsByRole[r.key]?.length ?? 0) === 0,
      ),
    [schema.roles, value.fieldsByRole],
  );

  const summaryChips = useMemo(() => {
    return schema.roles
      .map((r) => ({ role: r, fields: value.fieldsByRole[r.key] ?? [] }))
      .filter(({ fields }) => fields.length > 0);
  }, [schema.roles, value.fieldsByRole]);

  // Compact icon-only trigger — the panel header is dense and the full
  // summary chip strip was swallowing the panel name on narrower layouts.
  // Tooltip (via ``title``) carries the schema + role summary for hover.
  const tooltipText = (() => {
    const parts: string[] = [];
    parts.push(selectedSchema?.name ?? 'Configure');
    if (missingRequired.length > 0) {
      parts.push(`Needs: ${missingRequired.map((r) => r.label).join(', ')}`);
    } else if (summaryChips.length > 0) {
      parts.push(
        summaryChips
          .map(({ role, fields }) => `${role.label}: ${fields.join(', ')}`)
          .join(' • '),
      );
    }
    return parts.join(' — ');
  })();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'h-6 w-6 p-0 relative flex-shrink-0',
            missingRequired.length > 0 && 'text-amber-700 dark:text-amber-400',
            triggerClassName,
          )}
          title={tooltipText}
          aria-label={tooltipText}
        >
          <Axis3d className="h-3 w-3" />
          {missingRequired.length > 0 && (
            <AlertCircle className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 text-amber-600 dark:text-amber-400" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[640px] max-w-[95vw] p-0"
        align="start"
        side="bottom"
      >
        <div className="p-3 space-y-2">
          {/* Inner picker skips its own collapse toggle — the popover *is*
              the collapse surface. */}
          <RolePicker {...rolePickerProps} alwaysOpen />
        </div>
      </PopoverContent>
    </Popover>
  );
}
