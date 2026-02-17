import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, X, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { FragmentData } from './types';
import { getDisplayFragmentKey, generateFragmentPreview } from './utils';
import { FragmentValueRenderer } from './FragmentValueRenderer';
import { searchInAnnotationValue } from '@/lib/annotations/search';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

interface FragmentAccordionItemProps {
  fragmentKey: string;
  fragmentData: FragmentData;
  onDelete?: (key: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Single accordion item for a fragment
 */
function FragmentAccordionItem({ 
  fragmentKey, 
  fragmentData,
  onDelete,
  open: controlledOpen,
  onOpenChange
}: FragmentAccordionItemProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setIsOpen = onOpenChange || setInternalOpen;
  
  const displayKey = getDisplayFragmentKey(fragmentKey);
  
  // Get the actual value (handle FragmentData wrapper)
  const value = fragmentData?.value !== undefined ? fragmentData.value : fragmentData;
  const preview = generateFragmentPreview(value, 60);

  return (
    <div className="border-b border-border/30 last:border-b-0 relative group">
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="border-0 outline-0">
        <div className="flex items-center gap-1">
          <CollapsibleTrigger asChild>
            <button
              className={cn(
                "flex-1 flex items-center gap-2 px-2 py-2.5 text-left",
                "hover:bg-muted/50 transition-colors",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm",
                "border-0 outline-0"
              )}
            >
              <div className="flex items-center gap-1.5 shrink-0">
                {isOpen ? (
                  <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </div>
              
              <div className="flex-1 min-w-0 flex items-baseline gap-2">
                <span className="font-medium text-sm text-foreground shrink-0">
                  {displayKey}
                </span>
                
                <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">
                  {preview}
                </span>
              </div>
            </button>
          </CollapsibleTrigger>
          
          {onDelete && (
            <button
              type="button"
              className={cn(
                "h-5 w-5 p-0 shrink-0 text-muted-foreground hover:text-destructive",
                "flex items-center justify-center rounded-sm transition-colors",
                "hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
              )}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(fragmentKey);
              }}
              aria-label={`Delete ${displayKey}`}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        
        <CollapsibleContent className="px-2 pb-3">
          <div className="pl-6 pt-2 border-l-2 border-border/30 ml-2">
            <FragmentValueRenderer value={value} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

interface FragmentAccordionProps {
  fragments: Record<string, FragmentData | any>;
  onDelete?: (key: string) => void;
  className?: string;
  defaultExpanded?: boolean;
}

/**
 * Accordion list of fragments with collapsible items
 * Each fragment can be expanded to see full structured content
 */
export function FragmentAccordion({ 
  fragments, 
  onDelete,
  className,
  defaultExpanded = false
}: FragmentAccordionProps) {
  const entries = Object.entries(fragments);
  const [searchQuery, setSearchQuery] = useState('');
  const [allExpanded, setAllExpanded] = useState(defaultExpanded);
  const [itemStates, setItemStates] = useState<Record<string, boolean>>(() => {
    const states: Record<string, boolean> = {};
    entries.forEach(([key]) => {
      states[key] = defaultExpanded;
    });
    return states;
  });

  // Filter fragments based on search query (searches recursively through nested values)
  const filteredEntries = useMemo(() => {
    const entries = Object.entries(fragments);
    if (!searchQuery.trim()) return entries;
    
    const query = searchQuery.toLowerCase();
    return entries.filter(([key, data]) => {
      const displayKey = getDisplayFragmentKey(key);
      const value = data?.value !== undefined ? data.value : data;
      
      // Check key name first
      if (displayKey.toLowerCase().includes(query)) {
        return true;
      }
      
      // Use recursive search for nested values
      return searchInAnnotationValue(value, searchQuery);
    });
  }, [fragments, searchQuery]);

  const toggleAll = () => {
    const newState = !allExpanded;
    setAllExpanded(newState);
    const newItemStates: Record<string, boolean> = {};
    filteredEntries.forEach(([key]) => {
      newItemStates[key] = newState;
    });
    setItemStates(newItemStates);
  };

  const handleItemToggle = (key: string, isOpen: boolean) => {
    const newStates = { ...itemStates, [key]: isOpen };
    setItemStates(newStates);
    // Update allExpanded based on current states
    const allOpen = Object.values(newStates).every(v => v === true);
    const allClosed = Object.values(newStates).every(v => v === false);
    if (allOpen) setAllExpanded(true);
    else if (allClosed) setAllExpanded(false);
  };
  
  if (entries.length === 0) {
    return (
      <div className={cn("text-xs text-muted-foreground py-4 text-center", className)}>
        No fragments available
      </div>
    );
  }

  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-center gap-2 mb-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search fragments..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>
        <button
          onClick={toggleAll}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
        >
          {allExpanded ? 'Collapse All' : 'Expand All'}
        </button>
      </div>
      {filteredEntries.length === 0 ? (
        <div className="text-xs text-muted-foreground py-4 text-center border border-border/30 rounded-md">
          No fragments match your search
        </div>
      ) : (
            <div className="max-h-[300px] overflow-y-auto scrollbar-hide">
              {filteredEntries.map(([key, fragmentData]) => {
                // Handle both FragmentData objects and plain values
                const data: FragmentData = fragmentData?.value !== undefined 
                  ? fragmentData 
                  : { value: fragmentData };
                
                return (
                  <FragmentAccordionItem
                    key={key}
                    fragmentKey={key}
                    fragmentData={data}
                    onDelete={onDelete}
                    open={itemStates[key] ?? defaultExpanded}
                    onOpenChange={(open) => handleItemToggle(key, open)}
                  />
                );
              })}
            </div>
      )}
    </div>
  );
}
