'use client';

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { highlightTextInValue } from '@/lib/annotations/search';
import type { Density } from './types';
import { getDensitySpec } from './types';

interface TruncatedTextProps {
  text: string;
  density: Density;
  searchTerm?: string;
  /** Force search-matched text to render unclipped so the match is visible. */
  preserveMatches?: boolean;
  className?: string;
  /** Click → bubble up to row click (overlay opens). When unset, show-more toggles inline. */
  onOpenDetail?: () => void;
}

const TruncatedText: React.FC<TruncatedTextProps> = ({
  text,
  density,
  searchTerm,
  preserveMatches = true,
  className,
  onOpenDetail,
}) => {
  const [expanded, setExpanded] = useState(false);
  const spec = getDensitySpec(density);
  const limit = spec.stringClip;

  if (!text) return <span className="text-muted-foreground italic text-xs">empty</span>;

  // If a search term hits and preserveMatches is on, don't clip — let the user see the hit.
  const matchVisible =
    preserveMatches &&
    searchTerm &&
    searchTerm.length > 0 &&
    text.toLowerCase().includes(searchTerm.toLowerCase());

  const needsClip = !expanded && !matchVisible && text.length > limit;
  const displayText = needsClip ? `${text.slice(0, limit).trimEnd()}…` : text;

  return (
    <span className={cn('text-xs leading-snug break-words min-w-0', className)}>
      {searchTerm ? highlightTextInValue(displayText, searchTerm) : displayText}
      {needsClip && (
        <Button
          variant="link"
          size="sm"
          className="h-auto px-1 py-0 align-baseline text-[10px]"
          onClick={(e) => {
            e.stopPropagation();
            if (onOpenDetail && density !== 'expanded') {
              // In compact/comfortable, prefer routing to the focus surface.
              onOpenDetail();
            } else {
              setExpanded(true);
            }
          }}
        >
          more
        </Button>
      )}
      {expanded && text.length > limit && (
        <Button
          variant="link"
          size="sm"
          className="h-auto px-1 py-0 align-baseline text-[10px]"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(false);
          }}
        >
          less
        </Button>
      )}
    </span>
  );
};

export default TruncatedText;
