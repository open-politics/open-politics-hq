/**
 * Unified Asset Kind Configuration
 * =================================
 * 
 * Single source of truth for all asset type display properties.
 * Provides multiple styling contexts for different UI hierarchies:
 * 
 * - `selector`: Colorful badges for asset tree/selector (high contrast)
 * - `card`: Neutral styling for feed cards (bg-background/80, subtle)
 * - `default`: Standard colorful styling for general use
 * 
 * Usage:
 * ```tsx
 * import { 
 *   getAssetKindConfig, 
 *   getAssetIcon, 
 *   getAssetBadgeClass,
 *   formatAssetKind,
 *   AssetKindBadge 
 * } from '@/components/collection/assets/assetKindConfig';
 * 
 * // Get full config
 * const config = getAssetKindConfig('article');
 * 
 * // Get icon component
 * const icon = getAssetIcon('article', 'h-4 w-4');
 * 
 * // Get badge classes for context
 * const badgeClass = getAssetBadgeClass('article', 'card'); // neutral style
 * const badgeClass = getAssetBadgeClass('article', 'selector'); // colorful
 * 
 * // Format label
 * const label = formatAssetKind('csv_row'); // "Row"
 * ```
 */

import type { AssetKind } from '@/client';
import {
  FileText,
  FileSpreadsheet,
  Image as ImageIcon,
  Video,
  Music,
  Globe,
  Type,
  File,
  Mail,
  Newspaper,
  Rss,
  FileCode,
  Ellipsis,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import React from 'react';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

/**
 * Styling context for badges and icons
 * - selector: Colorful, high-contrast (for asset tree/selector)
 * - card: Neutral, subtle (for feed cards - bg-background/80)
 * - default: Standard colorful styling
 */
export type StyleContext = 'selector' | 'card' | 'default';

/**
 * Asset group categorization
 */
export type AssetGroup = 'file' | 'web' | 'text' | 'internal';

/**
 * Full configuration for an asset kind
 */
export interface AssetKindConfig {
  /** Lucide icon component */
  icon: LucideIcon;
  /** Human-readable label */
  label: string;
  /** Short description for tooltips or dialogs */
  description?: string;
  /** Icon color class (applied in selector context) */
  iconColor: string;
  /** Default colorful background */
  bgColor: string;
  /** Default colorful text */
  textColor: string;
  /** Default colorful border */
  borderColor: string;
  /** Whether this is an internal/fragment type (not shown in feeds) */
  isInternal: boolean;
  /** Whether this type can have children (is_container) */
  canHaveChildren: boolean;
  /** Group for categorization */
  group: AssetGroup;
}

/**
 * Styling classes for different contexts
 */
export interface StyleContextClasses {
  badge: string;
  icon: string;
}

// ============================================================================
// Configuration Registry
// ============================================================================

/**
 * Master configuration for all asset kinds
 * 
 * Color Philosophy (for dark theme with deep blue-slate background):
 * ─────────────────────────────────────────────────────────────────
 * • Article/Text:  stone (warm paper/newsprint feel)
 * • Documents:     rose (formal, PDF-like)
 * • Data/CSV:      emerald (spreadsheet green)
 * • Web:           sky (digital, internet blue)
 * • Media:         violet/fuchsia (creative, visual)
 * • Audio:         cyan (sound waves, calm)
 * • Email:         blue (traditional communication)
 * • RSS:           amber (feed/broadcast warmth)
 * • Generic:       slate (neutral fallback)
 */
export const ASSET_KIND_CONFIG: Record<AssetKind, AssetKindConfig> = {
  // === User-facing content types ===
  
  // TEXT & ARTICLES — warm stone tones (paper/newsprint feel)
  article: {
    icon: FileText,
    label: 'Article',
    description: 'News article or blog post',
    iconColor: 'text-sky-600 dark:text-sky-200',
    bgColor: 'bg-none',
    textColor: 'text-sky-600 dark:text-sky-200',
    borderColor: 'border-sky-200/50',
    isInternal: false,
    canHaveChildren: true,
    group: 'text',
  },
  text: {
    icon: Type,
    label: 'Text',
    description: 'Plain text content',
    iconColor: 'text-stone-400',
    bgColor: 'bg-none',
    textColor: 'text-stone-300',
    borderColor: 'border-stone-600/50',
    isInternal: false,
    canHaveChildren: false,
    group: 'text',
  },
  
  // DOCUMENTS — rose tones (formal document feel)
  pdf: {
    icon: FileText,
    label: 'PDF',
    description: 'PDF document',
    iconColor: 'text-rose-400',
    bgColor: 'bg-none',
    textColor: 'text-rose-300',
    borderColor: 'border-rose-700/50',
    isInternal: false,
    canHaveChildren: true,
    group: 'file',
  },
  
  // DATA — emerald tones (spreadsheet/data feel)
  csv: {
    icon: FileSpreadsheet,
    label: 'CSV',
    description: 'Spreadsheet data',
    iconColor: 'text-emerald-400',
    bgColor: 'bg-none',
    textColor: 'text-emerald-300',
    borderColor: 'border-emerald-700/50',
    isInternal: false,
    canHaveChildren: true,
    group: 'file',
  },
  
  // WEB — sky tones (internet/digital feel)
  web: {
    icon: Globe,
    label: 'Web',
    description: 'Web page content',
    iconColor: 'text-sky-400',
    bgColor: 'bg-none',
    textColor: 'text-sky-300',
    borderColor: 'border-sky-700/50',
    isInternal: false,
    canHaveChildren: true,
    group: 'web',
  },
  
  // VISUAL MEDIA — violet tones (creative/visual)
  image: {
    icon: ImageIcon,
    label: 'Image',
    description: 'Image file',
    iconColor: 'text-violet-400',
    bgColor: 'bg-none',
    textColor: 'text-violet-300',
    borderColor: 'border-violet-700/50',
    isInternal: false,
    canHaveChildren: false,
    group: 'file',
  },
  video: {
    icon: Video,
    label: 'Video',
    description: 'Video file',
    iconColor: 'text-fuchsia-400',
    bgColor: 'bg-none',
    textColor: 'text-fuchsia-300',
    borderColor: 'border-fuchsia-700/50',
    isInternal: false,
    canHaveChildren: true,
    group: 'file',
  },
  
  // AUDIO — cyan tones (sound waves, calm)
  audio: {
    icon: Music,
    label: 'Audio',
    description: 'Audio file',
    iconColor: 'text-cyan-400',
    bgColor: 'bg-none',
    textColor: 'text-cyan-300',
    borderColor: 'border-cyan-700/50',
    isInternal: false,
    canHaveChildren: true,
    group: 'file',
  },
  
  // EMAIL — blue tones (traditional communication)
  mbox: {
    icon: Mail,
    label: 'Email Box',
    description: 'Email archive',
    iconColor: 'text-blue-400',
    bgColor: 'bg-none',
    textColor: 'text-blue-300',
    borderColor: 'border-blue-700/50',
    isInternal: false,
    canHaveChildren: true,
    group: 'file',
  },
  email: {
    icon: Mail,
    label: 'Email',
    description: 'Email message',
    iconColor: 'text-blue-400',
    bgColor: 'bg-none',
    textColor: 'text-blue-300',
    borderColor: 'border-blue-700/50',
    isInternal: false,
    canHaveChildren: false,
    group: 'text',
  },
  
  // RSS — amber tones (feed/broadcast warmth)
  rss_feed: {
    icon: Rss,
    label: 'RSS Feed',
    description: 'RSS/Atom feed',
    iconColor: 'text-amber-400',
    bgColor: 'bg-none',
    textColor: 'text-amber-300',
    borderColor: 'border-amber-700/50',
    isInternal: false,
    canHaveChildren: true,
    group: 'web',
  },
  
  // GENERIC — slate tones (neutral fallback)
  file: {
    icon: File,
    label: 'File',
    description: 'Generic file',
    iconColor: 'text-slate-400',
    bgColor: 'bg-none',
    textColor: 'text-slate-300',
    borderColor: 'border-slate-600/50',
    isInternal: false,
    canHaveChildren: false,
    group: 'file',
  },

  // === Internal/fragment types (inherit parent colors, more muted) ===
  csv_row: {
    icon: Ellipsis,
    label: 'Row',
    description: 'Individual row from CSV',
    iconColor: 'text-emerald-500/70',
    bgColor: 'bg-none',
    textColor: 'text-emerald-400/80',
    borderColor: 'border-emerald-800/40',
    isInternal: true,
    canHaveChildren: false,
    group: 'internal',
  },
  text_chunk: {
    icon: Type,
    label: 'Text Chunk',
    description: 'Text fragment',
    iconColor: 'text-stone-500/70',
    bgColor: 'bg-none',
    textColor: 'text-stone-400/80',
    borderColor: 'border-stone-800/40',
    isInternal: true,
    canHaveChildren: false,
    group: 'internal',
  },
  pdf_page: {
    icon: FileText,
    label: 'PDF Page',
    description: 'Single PDF page',
    iconColor: 'text-rose-500/70',
    bgColor: 'bg-none',
    textColor: 'text-rose-400/80',
    borderColor: 'border-rose-800/40',
    isInternal: true,
    canHaveChildren: false,
    group: 'internal',
  },
  image_region: {
    icon: ImageIcon,
    label: 'Image Region',
    description: 'Cropped image region',
    iconColor: 'text-violet-500/70',
    bgColor: 'bg-none',
    textColor: 'text-violet-400/80',
    borderColor: 'border-violet-800/40',
    isInternal: true,
    canHaveChildren: false,
    group: 'internal',
  },
  video_scene: {
    icon: Video,
    label: 'Video Scene',
    description: 'Video segment',
    iconColor: 'text-fuchsia-500/70',
    bgColor: 'bg-fuchsia-950/30',
    textColor: 'text-fuchsia-400/80',
    borderColor: 'border-fuchsia-800/40',
    isInternal: true,
    canHaveChildren: false,
    group: 'internal',
  },
  audio_segment: {
    icon: Music,
    label: 'Audio Segment',
    description: 'Audio clip',
    iconColor: 'text-cyan-500/70',
    bgColor: 'bg-cyan-950/30',
    textColor: 'text-cyan-400/80',
    borderColor: 'border-cyan-800/40',
    isInternal: true,
    canHaveChildren: false,
    group: 'internal',
  },
};

// ============================================================================
// Style Context Helpers
// ============================================================================

/**
 * Get badge classes for a specific styling context
 */
function getStyleContextClasses(kind: AssetKind, context: StyleContext): StyleContextClasses {
  const config = ASSET_KIND_CONFIG[kind] || ASSET_KIND_CONFIG.file;
  
  switch (context) {
    case 'card':
      // Neutral styling for feed cards - minimal color, blend with card background
      return {
        badge: 'bg-background/80 text-foreground border-border/50',
        icon: 'text-muted-foreground',
      };
    
    case 'selector':
      // Colorful styling for asset tree/selector - high contrast
      return {
        badge: cn(
          config.bgColor,
          config.textColor,
          config.borderColor,
          'dark:bg-opacity-50'
        ),
        icon: config.iconColor,
      };
    
    case 'default':
    default:
      // Standard colorful styling
      return {
        badge: cn(config.bgColor, config.textColor, config.borderColor),
        icon: config.iconColor,
      };
  }
}

// ============================================================================
// Public API - Getter Functions
// ============================================================================

/**
 * Get full config for an asset kind
 */
export function getAssetKindConfig(kind: AssetKind): AssetKindConfig {
  return ASSET_KIND_CONFIG[kind] || ASSET_KIND_CONFIG.file;
}

/**
 * Get icon JSX element for an asset kind
 * 
 * @param kind - Asset kind
 * @param className - Optional additional classes
 * @param context - Styling context (default: 'selector' for colored icons)
 */
export function getAssetIcon(
  kind: AssetKind, 
  className?: string, 
  context: StyleContext = 'selector'
): React.ReactElement {
  const config = ASSET_KIND_CONFIG[kind] || ASSET_KIND_CONFIG.file;
  const IconComponent = config.icon;
  const styles = getStyleContextClasses(kind, context);
  
  return React.createElement(IconComponent, {
    className: cn('h-4 w-4', styles.icon, className),
  });
}

/**
 * Get icon component (not instantiated) for an asset kind
 */
export function getAssetIconComponent(kind: AssetKind): LucideIcon {
  const config = ASSET_KIND_CONFIG[kind] || ASSET_KIND_CONFIG.file;
  return config.icon;
}

/**
 * Get badge CSS classes for an asset kind
 * 
 * @param kind - Asset kind
 * @param context - Styling context
 *   - 'selector': Colorful badges (for asset tree)
 *   - 'card': Neutral badges (for feed cards)
 *   - 'default': Standard colorful
 */
export function getAssetBadgeClass(kind: AssetKind, context: StyleContext = 'default'): string {
  return getStyleContextClasses(kind, context).badge;
}

/**
 * Get icon CSS class for an asset kind
 */
export function getAssetIconClass(kind: AssetKind, context: StyleContext = 'default'): string {
  return getStyleContextClasses(kind, context).icon;
}

/**
 * Format asset kind as human-readable label
 */
export function formatAssetKind(kind: AssetKind): string {
  const config = ASSET_KIND_CONFIG[kind];
  if (config) return config.label;
  
  // Fallback formatting
  return kind
    .replace(/_/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// ============================================================================
// Public API - Filters & Lists
// ============================================================================

/**
 * Asset kinds that should be shown in feeds/listings
 * (excludes internal/fragment types)
 */
export const DISPLAYABLE_ASSET_KINDS: AssetKind[] = (
  Object.entries(ASSET_KIND_CONFIG) as [AssetKind, AssetKindConfig][]
)
  .filter(([_, config]) => !config.isInternal)
  .map(([kind]) => kind);

/**
 * Internal asset kinds (fragments, chunks, etc.)
 * Hidden from feeds, shown only in detail views
 */
export const INTERNAL_ASSET_KINDS: AssetKind[] = (
  Object.entries(ASSET_KIND_CONFIG) as [AssetKind, AssetKindConfig][]
)
  .filter(([_, config]) => config.isInternal)
  .map(([kind]) => kind);

/**
 * Asset kinds that can have children
 */
export const CONTAINER_ASSET_KINDS: AssetKind[] = (
  Object.entries(ASSET_KIND_CONFIG) as [AssetKind, AssetKindConfig][]
)
  .filter(([_, config]) => config.canHaveChildren)
  .map(([kind]) => kind);

/**
 * Check if an asset kind is displayable (not internal)
 */
export function isDisplayableKind(kind: AssetKind): boolean {
  return !ASSET_KIND_CONFIG[kind]?.isInternal;
}

/**
 * Check if an asset kind can have children
 */
export function canHaveChildren(kind: AssetKind): boolean {
  return ASSET_KIND_CONFIG[kind]?.canHaveChildren ?? false;
}

/**
 * Get asset kinds by group
 */
export function getKindsByGroup(group: AssetGroup): AssetKind[] {
  return (Object.entries(ASSET_KIND_CONFIG) as [AssetKind, AssetKindConfig][])
    .filter(([_, config]) => config.group === group)
    .map(([kind]) => kind);
}
