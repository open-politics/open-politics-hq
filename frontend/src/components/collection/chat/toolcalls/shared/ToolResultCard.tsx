/**
 * Tool Result Card
 * 
 * Consistent wrapper for tool results with optional header, summary, and collapse functionality
 */

import { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface ToolResultCardProps {
  title: string;
  summary?: string;
  icon?: ReactNode;
  badge?: string;
  children: ReactNode;
  compact?: boolean;
  defaultExpanded?: boolean;
}

export function ToolResultCard({
  title,
  summary,
  icon,
  badge,
  children,
  compact = false,
  defaultExpanded = true
}: ToolResultCardProps) {
  // No longer managing state here - just always render (parent controls visibility)
  
  if (compact) {
    return (
      <div className="bg-background/50 overflow-hidden min-w-0">
        {children}
      </div>
    );
  }

  // min-w-0 + overflow-hidden so renderers' break-words actually has a width
  // to wrap inside — without these, long URLs / titles push the card past
  // the chat bubble edge instead of wrapping.
  return (
    <Card className="w-full min-w-0 overflow-hidden rounded-none border-none">
      <CardContent className="p-0 min-w-0">
        {children}
      </CardContent>
    </Card>
  );
}

