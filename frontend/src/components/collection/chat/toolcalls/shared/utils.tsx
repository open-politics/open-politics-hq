/**
 * Shared Utilities for Tool Result Rendering
 * 
 * Common utility functions used across tool renderers for formatting,
 * icons, and content transformation.
 */

import React from 'react';
import {
  Search,
  FileText,
  BarChart3,
  Database,
  Bot,
  Globe,
  FolderOpen,
  Package,
  Rss,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ListTodo,
  StickyNote,
} from 'lucide-react';

/**
 * Format tool name for display (snake_case -> Title Case)
 * 
 * @example
 * formatToolName('search_web') // => 'Search Web'
 * formatToolName('semantic_search') // => 'Semantic Search'
 */
export function formatToolName(toolName: string): string {
  // Special cases for better formatting
  const specialNames: Record<string, string> = {
    'semantic_search': 'Semantic Search',
    'search_web': 'Web Search',
    'search_assets': 'Asset Search',
  };
  
  if (specialNames[toolName]) {
    return specialNames[toolName];
  }
  
  return toolName
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Get appropriate icon for a tool
 */
export function getToolIcon(toolName: string, className: string = 'h-4 w-4'): React.ReactNode {
  const iconProps = { className };
  
  switch (toolName) {
    case 'navigate':
      return <FolderOpen {...iconProps} />;
    case 'organize':
      return <Package {...iconProps} />;
    case 'semantic_search':
    case 'search_assets':
      return <Search {...iconProps} />;
    case 'search_web':
    case 'search_and_ingest':
    case 'search_news_with_clarification':
      return <Globe {...iconProps} />;
    case 'analyze_assets':
    case 'get_asset_details':
      return <FileText {...iconProps} />;
    case 'discover_rss_feeds':
    case 'ingest_rss_feeds':
      return <Rss {...iconProps} />;
    case 'list_schemas':
    case 'list_bundles':
    case 'explore_bundles':
      return <Database {...iconProps} />;
    case 'tasks':
    case 'add_task':
    case 'start_task':
    case 'finish_task':
    case 'cancel_task':
      return <ListTodo {...iconProps} />;
    case 'working_memory':
      return <StickyNote {...iconProps} />;
    default:
      return <Bot {...iconProps} />;
  }
}

/**
 * Get status icon for tool execution states
 */
export function getStatusIcon(
  status: 'pending' | 'running' | 'completed' | 'failed' | 'success' | 'error',
  className: string = 'h-4 w-4'
): React.ReactNode {
  const iconProps = { className };
  
  switch (status) {
    case 'pending':
      return <Clock {...iconProps} />;
    case 'running':
      return <Loader2 className={`${className} animate-spin`} />;
    case 'completed':
    case 'success':
      return <CheckCircle2 className={`${className} text-green-600`} />;
    case 'failed':
    case 'error':
      return <XCircle className={`${className} text-red-600`} />;
  }
}

/**
 * Get status color classes for tool execution states
 */
export function getStatusColorClass(status: 'pending' | 'running' | 'completed' | 'failed'): string {
  switch (status) {
    case 'pending':
      return 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700';
    case 'running':
      return 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800';
    case 'completed':
      return 'bg-green-50 dark:bg-emerald-900/10 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800';
    case 'failed':
      return 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800';
  }
}

/**
 * Resolve relative URLs in markdown content against a base URL
 * 
 * Converts relative image and link URLs to absolute URLs using the base URL's origin.
 * 
 * @example
 * resolveMarkdownUrls('![alt](/image.png)', 'https://example.com/page')
 * // => '![alt](https://example.com/image.png)'
 */
export function resolveMarkdownUrls(markdown: string, baseUrl: string): string {
  if (!markdown || !baseUrl) return markdown;
  
  try {
    const url = new URL(baseUrl);
    const origin = url.origin;
    
    // Replace relative image URLs: ![alt](/path) or ![alt](path)
    markdown = markdown.replace(
      /!\[([^\]]*)\]\(([^)]+)\)/g,
      (match, alt, imgUrl) => {
        if (imgUrl.startsWith('http://') || imgUrl.startsWith('https://')) {
          return match; // Already absolute
        }
        const absoluteUrl = imgUrl.startsWith('/') 
          ? `${origin}${imgUrl}`
          : `${origin}/${imgUrl}`;
        return `![${alt}](${absoluteUrl})`;
      }
    );
    
    // Replace relative link URLs: [text](/path) or [text](path)
    markdown = markdown.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (match, text, linkUrl) => {
        // Skip if already absolute, or if it's an anchor, email, etc.
        if (linkUrl.startsWith('http://') || 
            linkUrl.startsWith('https://') || 
            linkUrl.startsWith('#') ||
            linkUrl.startsWith('mailto:')) {
          return match;
        }
        const absoluteUrl = linkUrl.startsWith('/') 
          ? `${origin}${linkUrl}`
          : `${origin}/${linkUrl}`;
        return `[${text}](${absoluteUrl})`;
      }
    );
    
    return markdown;
  } catch (e) {
    console.warn('Failed to resolve relative URLs:', e);
    return markdown;
  }
}

/**
 * Truncate text to a maximum length with ellipsis
 */
export function truncateText(text: string, maxLength: number = 200): string {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * Check if a result is a structured response that can be rendered specially
 */
export function isStructuredResult(result: any): boolean {
  if (!result || typeof result !== 'object') return false;
  
  // Check if it's an array (e.g., list_bundles, list_schemas)
  if (Array.isArray(result)) {
    return true;
  }
  
  // Check for common structured response fields
  const structuredFields = [
    'assets', 'total_found', 'search_method', 'query', 
    'message', 'status', 'bundle_data', 'bundles_explored',
    'results', 'items'
  ];
  
  return structuredFields.some(field => field in result);
}

/**
 * Decode HTML entities in text
 */
export function decodeHtmlEntities(text: string): string {
  if (typeof document === 'undefined') return text;
  const textArea = document.createElement('textarea');
  textArea.innerHTML = text;
  return textArea.value;
}

/**
 * Format a number as a percentage
 */
export function formatPercentage(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

/**
 * Format a count with singular/plural
 * 
 * @example
 * formatCount(1, 'item') // => '1 item'
 * formatCount(5, 'item') // => '5 items'
 */
export function formatCount(count: number, singular: string, plural?: string): string {
  const pluralForm = plural || `${singular}s`;
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

