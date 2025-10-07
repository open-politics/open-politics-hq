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
      <div className="rounded-md border bg-background/50 overflow-hidden">
        {children}
      </div>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader className="pb-1 px-2 py-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-1.5 text-xs flex-1 min-w-0">
            <span className="shrink-0">{icon}</span>
            <span className="truncate">{title}</span>
            {badge && (
              <Badge variant="secondary" className="text-[10px] ml-1 shrink-0 px-1 py-0">
                {badge}
              </Badge>
            )}
          </CardTitle>
        </div>
        {summary && (
          <p className="text-[10px] text-muted-foreground mt-0.5">{summary}</p>
        )}
      </CardHeader>
      <CardContent className="pt-0 px-2 pb-2">
        {children}
      </CardContent>
    </Card>
  );
}

