'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import type { AssetKind } from '@/client';
import { ASSET_KIND_CONFIG } from '../../assetKindConfig';

/**
 * CardHeroFallback - Elegant text-based hero for cards without images
 * 
 * When no image is available, this component fills the image area with
 * stylized text content, creating visual interest while conveying information.
 * 
 * Features:
 * - Large, prominent title display
 * - Optional source/author line
 * - Text content preview (more space when no image)
 * - Gradient backgrounds based on asset kind (derived from assetKindConfig)
 * - Decorative first-letter treatment
 * - Responsive sizing
 */

interface CardHeroFallbackProps {
  /** Main title to display */
  title: string;
  /** Optional subtitle (source, author, domain) */
  subtitle?: string;
  /** Optional summary/description to show below title */
  summary?: string;
  /** Optional text content preview (should be pre-cleaned plain text) */
  textContent?: string;
  /** Asset kind for theming */
  kind?: AssetKind;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Orientation - affects layout */
  orientation?: 'vertical' | 'horizontal';
  /** Additional classes */
  className?: string;
}

/**
 * Map color names to gradient classes
 * These gradients are derived from the base colors in assetKindConfig
 * IMPORTANT: Dark mode gradients must be OPAQUE to ensure text visibility
 */
const colorToGradient: Record<string, string> = {
  // Blues - dark mode uses solid darker shades for contrast
  'blue': 'from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900',
  'sky': 'from-sky-50 to-sky-100 dark:from-sky-950 dark:to-sky-900',
  'cyan': 'from-cyan-50 to-cyan-100 dark:from-cyan-950 dark:to-cyan-900',
  'indigo': 'from-indigo-50 to-indigo-100 dark:from-indigo-950 dark:to-indigo-900',
  // Greens
  'green': 'from-green-50 to-green-100 dark:from-green-950 dark:to-green-900',
  'emerald': 'from-emerald-50 to-emerald-100 dark:from-emerald-950 dark:to-emerald-900',
  'teal': 'from-teal-50 to-teal-100 dark:from-teal-950 dark:to-teal-900',
  // Reds/Pinks
  'red': 'from-red-50 to-red-100 dark:from-red-950 dark:to-red-900',
  'rose': 'from-rose-50 to-rose-100 dark:from-rose-950 dark:to-rose-900',
  'fuchsia': 'from-fuchsia-50 to-fuchsia-100 dark:from-fuchsia-950 dark:to-fuchsia-900',
  // Warm
  'orange': 'from-orange-50 to-orange-100 dark:from-orange-950 dark:to-orange-900',
  'amber': 'from-amber-50 to-amber-100 dark:from-amber-950 dark:to-amber-900',
  // Purples
  'purple': 'from-purple-50 to-purple-100 dark:from-purple-950 dark:to-purple-900',
  'violet': 'from-violet-50 to-violet-100 dark:from-violet-950 dark:to-violet-900',
  // Neutrals
  'stone': 'from-stone-100 to-stone-200 dark:from-stone-900 dark:to-stone-800',
  'slate': 'from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800',
  'gray': 'from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800',
};

const colorToTextClass: Record<string, string> = {
  'blue': 'text-blue-800 dark:text-blue-100',
  'sky': 'text-sky-800 dark:text-sky-100',
  'cyan': 'text-cyan-800 dark:text-cyan-100',
  'indigo': 'text-indigo-800 dark:text-indigo-100',
  'green': 'text-green-800 dark:text-green-100',
  'emerald': 'text-emerald-800 dark:text-emerald-100',
  'teal': 'text-teal-800 dark:text-teal-100',
  'red': 'text-red-800 dark:text-red-100',
  'rose': 'text-rose-800 dark:text-rose-100',
  'fuchsia': 'text-fuchsia-800 dark:text-fuchsia-100',
  'orange': 'text-orange-800 dark:text-orange-100',
  'amber': 'text-amber-800 dark:text-amber-100',
  'purple': 'text-purple-800 dark:text-purple-100',
  'violet': 'text-violet-800 dark:text-violet-100',
  'stone': 'text-stone-700 dark:text-stone-100',
  'slate': 'text-slate-800 dark:text-slate-100',
  'gray': 'text-gray-800 dark:text-gray-100',
};

const defaultGradient = 'from-slate-100 to-slate-200 dark:from-slate-900 dark:to-slate-800';
const defaultTextColor = 'text-slate-700 dark:text-slate-100';

/**
 * Extract color name from a Tailwind color class
 * e.g., 'text-blue-600' → 'blue', 'bg-emerald-100' → 'emerald'
 */
function extractColorName(className: string): string | null {
  const match = className.match(/(?:text|bg|border)-([a-z]+)-\d+/);
  return match ? match[1] : null;
}

/**
 * Get gradient and text classes for an asset kind from centralized config
 */
function getKindStyles(kind?: AssetKind): { gradient: string; textColor: string } {
  if (!kind) {
    return { gradient: defaultGradient, textColor: defaultTextColor };
  }
  
  const config = ASSET_KIND_CONFIG[kind];
  if (!config) {
    return { gradient: defaultGradient, textColor: defaultTextColor };
  }
  
  // Extract color from the config's iconColor (e.g., 'text-blue-600' → 'blue')
  const colorName = extractColorName(config.iconColor);
  
  if (colorName && colorToGradient[colorName]) {
    return {
      gradient: colorToGradient[colorName],
      textColor: colorToTextClass[colorName] || defaultTextColor,
    };
  }
  
  return { gradient: defaultGradient, textColor: defaultTextColor };
}

// Font sizes based on card size and title length
function getTitleClasses(size: 'sm' | 'md' | 'lg', titleLength: number, orientation: 'vertical' | 'horizontal'): string {
  // Adjust size based on title length for better readability
  const isLong = titleLength > 60;
  const isMedium = titleLength > 30;
  
  // Horizontal cards can afford slightly smaller titles to fit more content
  if (orientation === 'horizontal') {
    const sizeMap = {
      sm: isLong ? 'text-xs' : isMedium ? 'text-sm' : 'text-base',
      md: isLong ? 'text-sm' : isMedium ? 'text-base' : 'text-lg',
      lg: isLong ? 'text-base' : isMedium ? 'text-lg' : 'text-xl',
    };
    return sizeMap[size];
  }
  
  const sizeMap = {
    sm: isLong ? 'text-sm' : isMedium ? 'text-base' : 'text-lg',
    md: isLong ? 'text-base' : isMedium ? 'text-lg' : 'text-xl',
    lg: isLong ? 'text-lg' : isMedium ? 'text-xl' : 'text-2xl',
  };
  
  return sizeMap[size];
}

export function CardHeroFallback({
  title,
  subtitle,
  summary,
  textContent,
  kind,
  size = 'md',
  orientation = 'vertical',
  className,
}: CardHeroFallbackProps) {
  const { gradient, textColor } = getKindStyles(kind);
  
  // Get first letter for decorative treatment
  const firstLetter = title.trim().charAt(0).toUpperCase();
  const hasFirstLetter = /[A-Z]/.test(firstLetter);
  
  // Determine what content to show (textContent should already be cleaned and truncated)
  const hasTextContent = textContent && textContent.length > 0;
  const hasSummary = summary && summary.length > 0;
  const showContent = hasTextContent || hasSummary;
  
  // Clamp lines based on size - reduce title clamp when content is shown
  const titleClampClass = {
    sm: showContent ? 'line-clamp-2' : 'line-clamp-3',
    md: showContent ? 'line-clamp-2' : 'line-clamp-4',
    lg: showContent ? 'line-clamp-3' : 'line-clamp-5',
  };
  
  // Content clamp lines - more lines for horizontal orientation
  const contentClampClass = {
    sm: orientation === 'horizontal' ? 'line-clamp-3' : 'line-clamp-2',
    md: orientation === 'horizontal' ? 'line-clamp-4' : 'line-clamp-3',
    lg: orientation === 'horizontal' ? 'line-clamp-5' : 'line-clamp-4',
  };

  return (
    <div
      className={cn(
        // Use absolute positioning to fill parent container
        // Parent must have position:relative (which card containers do)
        'absolute inset-0',
        'overflow-hidden',
        // Apply the gradient background
        'bg-gradient-to-br',
        gradient,
        className
      )}
    >
      {/* Decorative large first letter (if title starts with a letter) */}
      {hasFirstLetter && orientation === 'vertical' && (
        <div 
          className={cn(
            'absolute -top-2 left-1 font-serif font-bold select-none pointer-events-none',
            'text-[8rem] leading-none opacity-[0.07]',
            textColor
          )}
          aria-hidden="true"
        >
          {firstLetter}
        </div>
      )}
      
      {/* Decorative first letter for horizontal - smaller and positioned differently */}
      {hasFirstLetter && orientation === 'horizontal' && (
        <div 
          className={cn(
            'absolute top-0 left-2 font-serif font-bold select-none pointer-events-none',
            'text-[5rem] leading-none opacity-[0.08]',
            textColor
          )}
          aria-hidden="true"
        >
          {firstLetter}
        </div>
      )}
      
      {/* Content */}
      <div className={cn(
        'absolute inset-0 flex flex-col',
        orientation === 'vertical' ? 'p-4 justify-end' : 'p-3 justify-center'
      )}>
        {/* Subtitle/source at top (only for vertical) */}
        {subtitle && orientation === 'vertical' && (
          <span className={cn(
            'text-xs font-medium opacity-60 mb-auto truncate',
            textColor
          )}>
            {subtitle}
          </span>
        )}
        
        {/* Title */}
        <h3
          className={cn(
            'font-semibold leading-tight',
            getTitleClasses(size, title.length, orientation),
            titleClampClass[size],
            textColor
          )}
        >
          {title}
        </h3>
        
        {/* Text content preview - prioritize over summary */}
        {hasTextContent && (
          <p
            className={cn(
              'leading-relaxed mt-2 opacity-70',
              orientation === 'horizontal' ? 'text-xs' : 'text-xs',
              contentClampClass[size],
              textColor
            )}
          >
            {textContent}
          </p>
        )}
        
        {/* Summary/description preview - show only if no text content */}
        {!hasTextContent && hasSummary && (
          <p
            className={cn(
              'leading-relaxed mt-2 opacity-70',
              orientation === 'horizontal' ? 'text-xs' : 'text-xs',
              contentClampClass[size],
              textColor
            )}
          >
            {summary}
          </p>
        )}
        
        {/* Subtitle at bottom for horizontal orientation */}
        {subtitle && orientation === 'horizontal' && (
          <span className={cn(
            'text-xs font-medium opacity-60 mt-2 truncate',
            textColor
          )}>
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
}
