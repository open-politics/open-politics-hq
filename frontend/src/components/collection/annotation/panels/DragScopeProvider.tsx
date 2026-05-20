"use client";

/**
 * DragScopeProvider — @dnd-kit wrapper that powers drag-to-push scope
 * handoff between panels.
 *
 * The provider owns two pieces of state:
 *   1. The pending scope gesture (which panel emitted it, what field+value).
 *   2. The active drag + over-target panel (managed by @dnd-kit).
 *
 * Panels call `setPendingScope({ sourcePanelId, fieldPath, value, gestureType })`
 * when a user selection fires. The provider renders a floating draggable chip
 * that the user drops onto another panel. Each panel wraps its outer
 * container with `DroppablePanelZone`. The provider resolves the drop by
 * invoking `onResolve(targetPanelId, pending)`.
 *
 * The legacy ScopeTargetPicker popover still works in parallel — this is an
 * additive UX, not a replacement (phase 5 keeps both surfaces during the
 * transition so users can click or drag).
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  DndContext,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import type { GestureType } from '@/lib/annotations/scopes';

export interface PendingScopeGesture {
  sourcePanelId: string;
  fieldPath: string;
  value: unknown;
  gestureType: GestureType;
  /** Optional label for the chip (fallback = derived). */
  label?: string;
  /** Optional parent-group value so the resolver can attach group_context. */
  groupValue?: unknown;
}

interface DragScopeContextValue {
  pending: PendingScopeGesture | null;
  setPending: (g: PendingScopeGesture | null) => void;
  /** True while the user is actively dragging the chip. */
  active: boolean;
  /** Panel id the drag is currently over (for hover styling). */
  overPanelId: string | null;
}

const DragScopeContext = createContext<DragScopeContextValue>({
  pending: null,
  setPending: () => {},
  active: false,
  overPanelId: null,
});

export type OnResolveScope = (targetPanelId: string, pending: PendingScopeGesture) => void;

export interface DragScopeProviderProps {
  children: React.ReactNode;
  /** Called when the chip is dropped onto a target panel. */
  onResolve: OnResolveScope;
}

export function DragScopeProvider({ children, onResolve }: DragScopeProviderProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const [pending, setPending] = useState<PendingScopeGesture | null>(null);
  const [active, setActive] = useState(false);
  const [overPanelId, setOverPanelId] = useState<string | null>(null);

  const handleDragStart = useCallback(() => setActive(true), []);
  const handleDragOver = useCallback((e: { over: { data: { current?: { panelId?: string } } } | null }) => {
    const over = e.over?.data.current as { panelId?: string } | undefined;
    setOverPanelId(over?.panelId ?? null);
  }, []);
  const handleDragEnd = useCallback((e: DragEndEvent) => {
    const overData = e.over?.data.current as { panelId?: string } | undefined;
    const target = overData?.panelId;
    if (pending && target && target !== pending.sourcePanelId) {
      onResolve(target, pending);
    }
    setActive(false);
    setOverPanelId(null);
    setPending(null);
  }, [pending, onResolve]);
  const handleDragCancel = useCallback(() => {
    setActive(false);
    setOverPanelId(null);
  }, []);

  const ctx = useMemo<DragScopeContextValue>(
    () => ({ pending, setPending, active, overPanelId }),
    [pending, active, overPanelId],
  );

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <DragScopeContext.Provider value={ctx}>
        {children}
        <DragOverlay dropAnimation={null}>
          {active && pending ? (
            <div className="rounded border bg-primary text-primary-foreground shadow px-2 py-1 text-xs font-medium">
              Push scope: {pending.label ?? describePending(pending)}
            </div>
          ) : null}
        </DragOverlay>
      </DragScopeContext.Provider>
    </DndContext>
  );
}

function describePending(g: PendingScopeGesture): string {
  const field = g.fieldPath.split('.').pop() ?? g.fieldPath;
  if (g.gestureType === 'brush' && Array.isArray(g.value)) {
    return `${field}: ${String(g.value[0])} – ${String(g.value[1])}`;
  }
  if (Array.isArray(g.value)) return `${field} in [${g.value.length}]`;
  return `${field} = ${String(g.value)}`;
}

export function useDragScope() {
  return useContext(DragScopeContext);
}

// --- Panel-level droppable wrapper -------------------------------------

export interface DroppablePanelZoneProps {
  panelId: string;
  children: React.ReactNode;
  className?: string;
  /**
   * Style passed through to the wrapper. IMPORTANT: CSS custom properties
   * used by ancestor selectors (e.g. `.dashboard-panel { grid-column:
   * calc(var(--grid-x) + 1) }`) must be set on THIS element — custom
   * properties inherit downward, so putting them on a child leaves the
   * ancestor selector resolving `initial`.
   */
  style?: React.CSSProperties;
}

export function DroppablePanelZone({ panelId, children, className, style }: DroppablePanelZoneProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `panel-dropzone-${panelId}`,
    data: { panelId },
  });
  const { pending } = useDragScope();
  // Visually suppress the drop outline when this zone is the source panel
  // (self-drops are no-ops anyway, but the hover ring would be misleading).
  const isSource = pending?.sourcePanelId === panelId;
  return (
    <div
      ref={setNodeRef}
      data-panel-dropzone={panelId}
      style={style}
      className={cn(
        'relative transition-all',
        isOver && !isSource && 'ring-2 ring-primary/60 ring-offset-1 rounded',
        className,
      )}
    >
      {children}
    </div>
  );
}

// --- Floating draggable chip --------------------------------------

/**
 * Rendered inside `PanelRenderer` when `pending.sourcePanelId === panel.id`.
 * The user grabs this and drops onto another panel; the provider resolves
 * the drop via `onResolve`.
 */
export function DraggableScopeChip() {
  const { pending } = useDragScope();
  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({
    id: `scope-chip-${pending?.sourcePanelId ?? 'none'}`,
    data: { sourcePanelId: pending?.sourcePanelId },
  });
  if (!pending) return null;
  const style: React.CSSProperties | undefined = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  return (
    <button
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      type="button"
      className={cn(
        'h-6 px-2 text-[10px] rounded border bg-primary/10 text-primary border-primary/40 cursor-grab',
        'whitespace-nowrap animate-pulse',
        isDragging && 'opacity-40 cursor-grabbing',
      )}
      aria-label="Drag to push scope onto another panel"
    >
      ⇲ Drop on a panel: {pending.label ?? describePending(pending)}
    </button>
  );
}
