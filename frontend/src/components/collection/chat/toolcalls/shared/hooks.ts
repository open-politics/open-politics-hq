/**
 * Custom Hooks for Tool Result Components
 * 
 * Reusable React hooks for common patterns in tool result rendering.
 */

import { useState, useCallback, useMemo } from 'react';

/**
 * Hook for managing multi-item selection state
 * 
 * Provides selection state and helpers for select/deselect operations.
 * 
 * @example
 * const { selected, toggle, toggleAll, clear, isAllSelected } = useSelection();
 * 
 * // Toggle individual item
 * <Checkbox checked={selected.has(index)} onChange={() => toggle(index)} />
 * 
 * // Toggle all items
 * <Button onClick={() => toggleAll(items.length)}>Select All</Button>
 */
export function useSelection() {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  
  const toggle = useCallback((index: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);
  
  const toggleAll = useCallback((totalCount: number) => {
    setSelected(prev => {
      if (prev.size === totalCount && totalCount > 0) {
        return new Set(); // Deselect all
      } else {
        return new Set(Array.from({ length: totalCount }, (_, i) => i)); // Select all
      }
    });
  }, []);
  
  const clear = useCallback(() => {
    setSelected(new Set());
  }, []);
  
  const isAllSelected = useCallback((totalCount: number) => {
    return selected.size === totalCount && totalCount > 0;
  }, [selected.size]);
  
  const getSelected = useCallback(<T,>(items: T[]): T[] => {
    return Array.from(selected)
      .map(idx => items[idx])
      .filter(Boolean);
  }, [selected]);
  
  return {
    selected,
    toggle,
    toggleAll,
    clear,
    isAllSelected,
    getSelected,
    setSelected,
  };
}

/**
 * Hook for managing expanded/collapsed state of tree items
 * 
 * @example
 * const { expanded, toggle, isExpanded, expandAll, collapseAll } = useExpansion();
 */
export function useExpansion(initialExpanded: Set<string> = new Set()) {
  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded);
  
  const toggle = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);
  
  const isExpanded = useCallback((id: string) => {
    return expanded.has(id);
  }, [expanded]);
  
  const expandAll = useCallback((ids: string[]) => {
    setExpanded(new Set(ids));
  }, []);
  
  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);
  
  return {
    expanded,
    toggle,
    isExpanded,
    expandAll,
    collapseAll,
    setExpanded,
  };
}

/**
 * Hook for managing search/filter state with debouncing
 * 
 * @param initialValue - Initial search term
 * @param debounceMs - Debounce delay in milliseconds
 */
export function useSearch(initialValue: string = '', debounceMs: number = 0) {
  const [searchTerm, setSearchTerm] = useState(initialValue);
  const [debouncedTerm, setDebouncedTerm] = useState(initialValue);
  
  // Simple debounce implementation
  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
    
    if (debounceMs > 0) {
      const timer = setTimeout(() => {
        setDebouncedTerm(value);
      }, debounceMs);
      return () => clearTimeout(timer);
    } else {
      setDebouncedTerm(value);
    }
  }, [debounceMs]);
  
  return {
    searchTerm,
    debouncedTerm: debounceMs > 0 ? debouncedTerm : searchTerm,
    setSearchTerm: handleSearchChange,
    clearSearch: () => handleSearchChange(''),
  };
}

/**
 * Hook for filtering items based on search term
 * 
 * @param items - Array of items to filter
 * @param searchTerm - Search term to filter by
 * @param searchFields - Function to extract searchable text from an item
 */
export function useFilteredItems<T>(
  items: T[],
  searchTerm: string,
  searchFields: (item: T) => string[]
) {
  return useMemo(() => {
    if (!searchTerm.trim()) return items;
    
    const search = searchTerm.toLowerCase();
    return items.filter(item => {
      const fields = searchFields(item);
      return fields.some(field => 
        field && field.toLowerCase().includes(search)
      );
    });
  }, [items, searchTerm, searchFields]);
}

