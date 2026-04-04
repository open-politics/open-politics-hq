'use client';

import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/* ─── Spring configs (matching AssetSelector originals) ─── */

const chevronSpring = { type: 'spring' as const, stiffness: 400, damping: 30 };
const childrenSpring = { type: 'spring' as const, stiffness: 400, damping: 35, mass: 0.6 };

/* ─── Props ─── */

export interface TreeRowProps {
  depth: number;
  canExpand: boolean;
  isExpanded: boolean;
  isLoading?: boolean;
  onToggle: () => void;

  /** Before icon — checkboxes, etc. */
  prefix?: React.ReactNode;
  /** Folder/asset/kind icon */
  icon: React.ReactNode;
  /** Name, metadata, editing UI */
  content: React.ReactNode;
  /** Right side, hover-revealed */
  actions?: React.ReactNode;

  className?: string;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  /** data-item-index for keyboard nav */
  'data-item-index'?: number;

  /** Expanded children — rendered inside AnimatePresence */
  children?: React.ReactNode;
  /** Extra class on the children container (e.g. border-l for assets) */
  childrenClassName?: string;
}

/* ─── Component ─── */

export function TreeRow({
  depth,
  canExpand,
  isExpanded,
  isLoading = false,
  onToggle,
  prefix,
  icon,
  content,
  actions,
  className,
  style,
  onClick,
  onDoubleClick,
  onContextMenu,
  draggable,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  'data-item-index': dataItemIndex,
  children,
  childrenClassName,
}: TreeRowProps) {
  return (
    <div>
      <div
        data-item-index={dataItemIndex}
        className={cn(
          'group flex items-center gap-2 rounded-md hover:bg-muted cursor-pointer transition-colors w-full overflow-hidden',
          className,
        )}
        style={{ paddingLeft: `${depth * 1.5}rem`, ...style }}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        draggable={draggable}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {/* Chevron / spinner */}
        <div className="ml-1 w-4 h-4 flex items-center justify-center shrink-0">
          {canExpand && (
            <Button
              variant="ghost"
              size="sm"
              className="h-4 w-4 p-0"
              onClick={(e) => { e.stopPropagation(); onToggle(); }}
            >
              {isLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <motion.div
                  animate={{ rotate: isExpanded ? 90 : 0 }}
                  transition={chevronSpring}
                >
                  <ChevronRight className="h-3 w-3" />
                </motion.div>
              )}
            </Button>
          )}
        </div>

        {/* Prefix slot (checkboxes, etc.) */}
        {prefix}

        {/* Icon slot */}
        <div className="w-4 h-4 flex items-center justify-center shrink-0">
          {icon}
        </div>

        {/* Content slot — fills remaining space */}
        <div className="flex-1 min-w-0 overflow-hidden">
          {content}
        </div>

        {/* Actions slot — hover-revealed */}
        {actions && (
          <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            {actions}
          </div>
        )}
      </div>

      {/* Animated children */}
      <AnimatePresence initial={false}>
        {isExpanded && children && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{
              height: 'auto',
              opacity: 1,
              transition: {
                height: childrenSpring,
                opacity: { duration: 0.1 },
              },
            }}
            exit={{
              height: 0,
              opacity: 0,
              transition: {
                height: childrenSpring,
                opacity: { duration: 0.1 },
              },
            }}
            className="overflow-hidden overflow-y-auto scrollbar-hide"
          >
            <div className={cn('ml-0 pl-0 space-y-0.5 pb-2 pt-1', childrenClassName)}>
              <div className="space-y-0.5">
                {children}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
