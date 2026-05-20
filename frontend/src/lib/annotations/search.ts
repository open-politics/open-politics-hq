/**
 * Search utilities for annotation values with nested array support.
 *
 * This module provides functions for searching within annotation values,
 * including recursive traversal of nested arrays and objects.
 *
 * Backend Migration Path:
 * When migrating to backend search, these functions will be replaced
 * with API calls to GET /api/v1/infospaces/{id}/runs/{run_id}/search
 */

import React from 'react';

/**
 * Wrap occurrences of `term` in `text` with a <mark> for inline highlighting.
 * Returns a ReactNode (string when no matches, fragment when matches present).
 */
export function highlightTextInValue(text: string, term: string | null | undefined): React.ReactNode {
  if (!term || !text) return text;
  const searchLower = term.toLowerCase();
  const textLower = text.toLowerCase();

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let index = textLower.indexOf(searchLower, lastIndex);

  while (index !== -1) {
    if (index > lastIndex) parts.push(text.slice(lastIndex, index));
    parts.push(
      React.createElement(
        'mark',
        { key: index, className: 'bg-yellow-300 dark:bg-yellow-600 px-0.5 rounded' },
        text.slice(index, index + term.length),
      ),
    );
    lastIndex = index + term.length;
    index = textLower.indexOf(searchLower, lastIndex);
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length > 0 ? React.createElement(React.Fragment, null, ...parts) : text;
}

/**
 * Recursively search for a term within an annotation value.
 * Searches through strings, numbers, arrays, and nested objects.
 * 
 * @param value - The value to search within (can be any type)
 * @param searchTerm - The search term (will be lowercased for comparison)
 * @returns true if the search term is found anywhere in the value structure
 */
export function searchInAnnotationValue(value: any, searchTerm: string): boolean {
  if (value === null || value === undefined) return false;
  
  const searchLower = searchTerm.toLowerCase();
  
  // Search in strings
  if (typeof value === 'string') {
    return value.toLowerCase().includes(searchLower);
  }
  
  // Search in numbers and booleans (convert to string)
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).toLowerCase().includes(searchLower);
  }
  
  // Search in arrays (recursively check each item)
  if (Array.isArray(value)) {
    return value.some(item => searchInAnnotationValue(item, searchLower));
  }
  
  // Search in objects (recursively check each property value)
  if (typeof value === 'object') {
    return Object.values(value).some(v => searchInAnnotationValue(v, searchLower));
  }
  
  return false;
}

/**
 * Search annotations with support for nested arrays.
 * This is a frontend implementation that can be replaced with backend API calls.
 * 
 * @param annotations - Array of annotations to search
 * @param query - Search query string
 * @param options - Search options
 * @returns Array of matching annotations
 */
export function searchAnnotations(
  annotations: any[],
  query: string,
  options: { searchNestedArrays?: boolean } = {}
): any[] {
  if (!query || !query.trim()) {
    return annotations;
  }
  
  const searchTerm = query.trim();
  
  return annotations.filter(annotation => {
    // Search in annotation value
    if (annotation.value) {
      if (searchInAnnotationValue(annotation.value, searchTerm)) {
        return true;
      }
    }
    
    // Search in other annotation properties if needed
    // (e.g., asset title, source name - these are typically handled at table level)
    
    return false;
  });
}
