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
      <div className="bg-background/50 overflow-hidden">
        {children}
      </div>
    );
  }

  return (
    <Card className="w-full rounded-none border-none">
      <CardContent className="p-0">
        {children}
      </CardContent>
    </Card>
  );
}

