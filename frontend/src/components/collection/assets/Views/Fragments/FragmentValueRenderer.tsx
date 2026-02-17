import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface FragmentValueRendererProps {
  value: any;
  className?: string;
}

/**
 * Generic value renderer for fragment data
 * Uses type detection to render arrays, objects, and primitives appropriately
 * Adapted from AnnotationResultDisplay.tsx rendering logic
 */
export function FragmentValueRenderer({ value, className }: FragmentValueRendererProps) {
  if (value === null || value === undefined) {
    return <span className={cn("text-muted-foreground italic text-xs", className)}>N/A</span>;
  }

  // Handle arrays
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className={cn("text-muted-foreground italic text-xs", className)}>empty</span>;
    }

    // Check if this is an array of objects - render as structured cards
    // Note: No ScrollArea here - parent FragmentAccordion provides scrolling
    if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
      return (
        <div className={cn("w-full space-y-3", className)}>
          <div className="text-[10px] text-muted-foreground mb-1">
            {value.length} item{value.length > 1 ? 's' : ''}
          </div>
          {value.map((item: any, i: number) => (
            <div key={i} className="border-2 border-border/60 rounded-md p-3 space-y-1 bg-muted/25 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className="text-[10px] border-border/60">
                  Item {i + 1}
                </Badge>
              </div>
              <div className="text-xs space-y-0 divide-y divide-border/40">
                {Object.entries(item)
                  .filter(([_, val]) => val !== null && val !== undefined)
                  .map(([key, val]: [string, any]) => {
                    // Handle arrays within objects
                    if (Array.isArray(val)) {
                      if (val.length === 0) return null;
                      return (
                        <div key={key} className="py-2.5 first:pt-0">
                          <span className="font-medium text-muted-foreground">{key}:</span>{' '}
                          <div className="flex flex-wrap gap-1 mt-1">
                            {val.map((v: any, idx: number) => (
                              <Badge key={idx} variant="outline" className="text-[10px]">
                                {String(v)}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    
                    // Handle nested objects
                    if (typeof val === 'object' && val !== null) {
                      return (
                        <div key={key} className="py-2.5 first:pt-0 bg-muted/20 -mx-3 px-3">
                          <div className="text-[10px] text-muted-foreground mb-2 font-medium">{key}:</div>
                          <div className="text-xs whitespace-pre-wrap break-words bg-background/50 p-2 rounded border border-border/30">
                            {JSON.stringify(val, null, 2)}
                          </div>
                        </div>
                      );
                    }
                    
                    // Handle long strings
                    if (typeof val === 'string' && val.length > 100) {
                      return (
                        <div key={key} className="py-2.5 first:pt-0 bg-muted/20 -mx-3 px-3">
                          <div className="text-[10px] text-muted-foreground mb-2 font-medium">{key}:</div>
                          <div className="text-xs whitespace-pre-wrap break-words bg-background/50 p-2 rounded border border-border/30">
                            {val}
                          </div>
                        </div>
                      );
                    }
                    
                    // Handle simple values
                    return (
                      <div key={key} className="py-2.5 first:pt-0">
                        <span className="font-medium text-muted-foreground">{key}:</span>{' '}
                        <span className="text-foreground">{String(val)}</span>
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      );
    }
    
    // Simple array of primitives - render as badges
    return (
      <div className={cn("flex flex-wrap gap-1 items-center max-w-full min-w-0", className)}>
        {value.map((item, i) => {
          const itemText = typeof item === 'object' ? JSON.stringify(item) : String(item);
          return (
            <Badge 
              key={i} 
              variant="outline" 
              className={cn(
                "text-[10px] px-1.5 py-0 font-normal border-border/40 max-w-full",
                itemText.length > 50 ? "break-all" : "whitespace-nowrap"
              )}
              title={itemText.length > 50 ? itemText : undefined}
            >
              <span className={cn(
                "truncate block",
                itemText.length > 50 && "max-w-[200px]"
              )}>
                {itemText}
              </span>
            </Badge>
          );
        })}
      </div>
    );
  }

  // Handle objects
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value);
    
    // Check if this is a small metadata object (structured display)
    const isMetadataObject = keys.length <= 10 && !Array.isArray(value);
    
    if (isMetadataObject) {
      return (
        <div className={cn("w-full space-y-1", className)}>
          {Object.entries(value).map(([key, val]) => (
            <div key={key} className="flex gap-2 text-xs">
              <span className="font-medium text-muted-foreground">{key}:</span>
              <span className="flex-1 break-words">
                {Array.isArray(val) 
                  ? `[${(val as any[]).map(v => String(v)).join(', ')}]`
                  : typeof val === 'object' && val !== null
                  ? JSON.stringify(val)
                  : String(val)}
              </span>
            </div>
          ))}
        </div>
      );
    }
    
    // Fallback to JSON for complex objects
    const jsonString = JSON.stringify(value, null, 2);
    return (
      <div className={cn("max-w-full min-w-0", className)}>
        <pre className={cn(
          "text-[10px] bg-muted/30 p-1.5 rounded border border-border/30 max-w-full min-w-0",
          "max-h-32 overflow-auto whitespace-pre-wrap break-words"
        )}>
          {jsonString}
        </pre>
      </div>
    );
  }

  // Handle primitives
  const stringValue = String(value);
  
  return (
    <div className={cn("text-xs leading-tight max-w-full min-w-0 ml-1", className)}>
      <span className="break-words">{stringValue}</span>
    </div>
  );
}
