'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import type { CardGridProps } from './types';
import type { AssetRead } from '@/client';

/**
 * CardGrid - Responsive grid layout for asset cards
 * 
 * Layout modes:
 * - 'grid': Uniform grid, all cards same size
 * - 'bento': Magazine-style timeline - varied sizes creating visual rhythm
 * - 'list': Horizontal cards stacked vertically
 */

const columnClasses = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 md:grid-cols-2',
  3: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
  auto: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4',
};

const gapClasses = {
  sm: 'gap-2 sm:gap-3',
  md: 'gap-3 sm:gap-2.5 lg:gap-2.5',
  lg: 'gap-4 sm:gap-2.5 lg:gap-2.5',
};

/**
 * Check if an asset has an image
 */
function assetHasImage(asset?: AssetRead): boolean {
  if (!asset) return false;
  const metadata = asset.source_metadata as Record<string, any> | null;
  if (!metadata) return false;
  
  const hasOgImage = metadata.og_image && !metadata.og_image.toLowerCase().includes('.gif');
  const hasFeaturedImage = metadata.featured_image_url && !metadata.featured_image_url.toLowerCase().includes('.gif');
  
  return !!(hasOgImage || hasFeaturedImage);
}

/**
 * Check if asset is a CSV row type (compact-friendly)
 */
function isCsvRowType(asset?: AssetRead): boolean {
  return asset?.kind === 'csv_row';
}

/**
 * Check if asset is text-heavy (articles, web)
 */
function isTextHeavy(asset?: AssetRead): boolean {
  if (!asset) return false;
  return ['article', 'web', 'document', 'pdf'].includes(asset.kind);
}

function getAssetFromChild(child: React.ReactNode): AssetRead | undefined {
  if (React.isValidElement(child) && child.props) {
    return (child.props as any).asset;
  }
  return undefined;
}

/**
 * Bento section types for varied visual rhythm
 */
type BentoSectionType = 
  | 'hero-wide'        // Full-width hero card
  | 'hero-left'        // Hero left + 2-3 compact right
  | 'hero-right'       // 2-3 compact left + hero right
  | 'double-hero'      // Two heroes side by side
  | 'triple-compact'   // Three compact cards in a row
  | 'wide-horizontal'  // Full-width horizontal card
  | 'pair-horizontal'  // Two horizontal cards side by side
  | 'csv-stack'        // 3-4 CSV row cards stacked (compact)
  | 'mixed-row';       // Mixed: 1 vertical + 2 horizontal stacked

interface BentoItem {
  child: React.ReactNode;
  asset?: AssetRead;
  hasImage: boolean;
  isCsvRow: boolean;
  index: number;
}

interface BentoSection {
  type: BentoSectionType;
  items: { item: BentoItem; role: 'hero' | 'compact' | 'horizontal' | 'wide' }[];
}

export function CardGrid({
  children,
  columns = 'auto',
  gap = 'md',
  layout = 'grid',
  className,
}: CardGridProps) {
  // List layout
  if (layout === 'list') {
    return (
      <div className={cn('flex flex-col w-full', gapClasses[gap], 'px-2 sm:px-0', className)}>
        {children}
      </div>
    );
  }
  
  // Standard grid layout
  if (layout === 'grid') {
    return (
      <div className={cn('grid w-full', columnClasses[columns], gapClasses[gap], 'px-2 sm:px-0', className)}>
        {children}
      </div>
    );
  }
  
  // BENTO LAYOUT - Magazine-style timeline
  // Strategy: Create visual variety with different section patterns
  // Recent/important items get prominence, text-only items stack compactly
  
  const childArray = React.Children.toArray(children);
  
  const items: BentoItem[] = childArray.map((child, index) => {
    const asset = getAssetFromChild(child);
    return {
      child,
      asset,
      hasImage: assetHasImage(asset),
      isCsvRow: isCsvRowType(asset),
      index,
    };
  });
  
  // Categorize items
  const imageItems: BentoItem[] = [];
  const textItems: BentoItem[] = [];
  const csvItems: BentoItem[] = [];
  
  items.forEach(item => {
    if (item.isCsvRow) {
      csvItems.push(item);
    } else if (item.hasImage) {
      imageItems.push(item);
    } else {
      textItems.push(item);
    }
  });
  
  // Build bento sections with varied patterns
  const sections: BentoSection[] = [];
  let imgIdx = 0;
  let textIdx = 0;
  let csvIdx = 0;
  let patternIdx = 0;
  
  // Pattern cycle for variety - prioritizes showing recent items prominently
  const patterns: BentoSectionType[] = [
    'hero-wide',       // Start with a big splash
    'hero-left',       // Hero + compact stack
    'pair-horizontal', // Two horizontal cards
    'hero-right',      // Flip for variety
    'triple-compact',  // Three compact cards
    'double-hero',     // Two heroes
    'wide-horizontal', // Full-width horizontal
    'csv-stack',       // CSV rows if available
    'mixed-row',       // Mix it up
  ];
  
  while (imgIdx < imageItems.length || textIdx < textItems.length || csvIdx < csvItems.length) {
    const remainingImages = imageItems.length - imgIdx;
    const remainingText = textItems.length - textIdx;
    const remainingCsv = csvItems.length - csvIdx;
    const pattern = patterns[patternIdx % patterns.length];
    
    // Try to fulfill the pattern, fall back to simpler patterns if not enough items
    let section: BentoSection | null = null;
    
    // CSV stack - when we have CSV rows
    if (pattern === 'csv-stack' && remainingCsv >= 2) {
      const count = Math.min(4, remainingCsv);
      section = {
        type: 'csv-stack',
        items: Array.from({ length: count }, () => ({
          item: csvItems[csvIdx++],
          role: 'horizontal' as const,
        })),
      };
    }
    // Hero wide - full-width featured card (first item or important)
    else if (pattern === 'hero-wide' && remainingImages >= 1) {
      section = {
        type: 'hero-wide',
        items: [{ item: imageItems[imgIdx++], role: 'wide' }],
      };
    }
    // Hero left with compact stack
    else if (pattern === 'hero-left' && remainingImages >= 1 && remainingText >= 2) {
      const compactCount = Math.min(3, remainingText);
      section = {
        type: 'hero-left',
        items: [
          { item: imageItems[imgIdx++], role: 'hero' },
          ...Array.from({ length: compactCount }, () => ({
            item: textItems[textIdx++],
            role: 'compact' as const,
          })),
        ],
      };
    }
    // Hero right (flipped layout)
    else if (pattern === 'hero-right' && remainingImages >= 1 && remainingText >= 2) {
      const compactCount = Math.min(3, remainingText);
      section = {
        type: 'hero-right',
        items: [
          ...Array.from({ length: compactCount }, () => ({
            item: textItems[textIdx++],
            role: 'compact' as const,
          })),
          { item: imageItems[imgIdx++], role: 'hero' },
        ],
      };
    }
    // Double hero
    else if (pattern === 'double-hero' && remainingImages >= 2) {
      section = {
        type: 'double-hero',
        items: [
          { item: imageItems[imgIdx++], role: 'hero' },
          { item: imageItems[imgIdx++], role: 'hero' },
        ],
      };
    }
    // Pair horizontal
    else if (pattern === 'pair-horizontal' && remainingText >= 2) {
      section = {
        type: 'pair-horizontal',
        items: [
          { item: textItems[textIdx++], role: 'horizontal' },
          { item: textItems[textIdx++], role: 'horizontal' },
        ],
      };
    }
    // Triple compact
    else if (pattern === 'triple-compact' && remainingText >= 3) {
      section = {
        type: 'triple-compact',
        items: Array.from({ length: 3 }, () => ({
          item: textItems[textIdx++],
          role: 'compact' as const,
        })),
      };
    }
    // Wide horizontal
    else if (pattern === 'wide-horizontal' && remainingText >= 1) {
      section = {
        type: 'wide-horizontal',
        items: [{ item: textItems[textIdx++], role: 'wide' }],
      };
    }
    // Mixed row
    else if (pattern === 'mixed-row' && remainingImages >= 1 && remainingText >= 1) {
      section = {
        type: 'mixed-row',
        items: [
          { item: imageItems[imgIdx++], role: 'hero' },
          { item: textItems[textIdx++], role: 'horizontal' },
        ],
      };
    }
    
    // Fallback patterns when we can't fulfill the preferred pattern
    if (!section) {
      // Remaining CSV rows
      if (remainingCsv >= 2) {
        const count = Math.min(4, remainingCsv);
        section = {
          type: 'csv-stack',
          items: Array.from({ length: count }, () => ({
            item: csvItems[csvIdx++],
            role: 'horizontal' as const,
          })),
        };
      }
      // Single CSV row
      else if (remainingCsv >= 1) {
        section = {
          type: 'wide-horizontal',
          items: [{ item: csvItems[csvIdx++], role: 'wide' }],
        };
      }
      // Hero with whatever text we have
      else if (remainingImages >= 1 && remainingText >= 1) {
        section = {
          type: 'hero-left',
          items: [
            { item: imageItems[imgIdx++], role: 'hero' },
            { item: textItems[textIdx++], role: 'compact' },
          ],
        };
      }
      // Just images
      else if (remainingImages >= 2) {
        section = {
          type: 'double-hero',
          items: [
            { item: imageItems[imgIdx++], role: 'hero' },
            { item: imageItems[imgIdx++], role: 'hero' },
          ],
        };
      }
      // Single image
      else if (remainingImages >= 1) {
        section = {
          type: 'hero-wide',
          items: [{ item: imageItems[imgIdx++], role: 'wide' }],
        };
      }
      // Just text - pair horizontal
      else if (remainingText >= 2) {
        section = {
          type: 'pair-horizontal',
          items: [
            { item: textItems[textIdx++], role: 'horizontal' },
            { item: textItems[textIdx++], role: 'horizontal' },
          ],
        };
      }
      // Single text
      else if (remainingText >= 1) {
        section = {
          type: 'wide-horizontal',
          items: [{ item: textItems[textIdx++], role: 'wide' }],
        };
      }
    }
    
    if (section) {
      sections.push(section);
      patternIdx++;
    } else {
      break;
    }
  }
  
  // Render sections
  return (
    <div className={cn('flex flex-col w-full', gapClasses[gap], 'px-2 sm:px-0', className)}>
      {sections.map((section, sectionIdx) => {
        // Helper to clone with props
        const cloneWithProps = (
          item: BentoItem, 
          props: { orientation?: 'vertical' | 'horizontal'; size?: 'sm' | 'md' | 'lg'; isFeatured?: boolean }
        ) => {
          return React.isValidElement(item.child)
            ? React.cloneElement(item.child as React.ReactElement<any>, props)
            : item.child;
        };
        
        // Hero Wide - full width featured card
        if (section.type === 'hero-wide') {
          const item = section.items[0];
          return (
            <div key={`section-${sectionIdx}`} className="min-h-[280px] [&>*]:h-full">
              {cloneWithProps(item.item, { isFeatured: true, size: 'lg' })}
            </div>
          );
        }
        
        // Hero Left - hero on left, compact stack on right
        if (section.type === 'hero-left') {
          const hero = section.items[0];
          const compacts = section.items.slice(1);
          
          return (
            <div key={`section-${sectionIdx}`} className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {/* Hero card - full height */}
              <div className="min-h-[280px] [&>*]:h-full">
                {cloneWithProps(hero.item, { isFeatured: true, size: 'lg' })}
              </div>
              
              {/* Stack of compact horizontal cards */}
              <div className="flex flex-col gap-2.5">
                {compacts.map((compact, i) => (
                  <div key={compact.item.index} className="flex-1 min-h-[80px]">
                    {cloneWithProps(compact.item, { orientation: 'horizontal', size: 'sm' })}
                  </div>
                ))}
              </div>
            </div>
          );
        }
        
        // Hero Right - compact stack on left, hero on right
        if (section.type === 'hero-right') {
          const hero = section.items[section.items.length - 1];
          const compacts = section.items.slice(0, -1);
          
          return (
            <div key={`section-${sectionIdx}`} className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {/* Stack of compact horizontal cards */}
              <div className="flex flex-col gap-2.5 order-2 md:order-1">
                {compacts.map((compact, i) => (
                  <div key={compact.item.index} className="flex-1 min-h-[80px]">
                    {cloneWithProps(compact.item, { orientation: 'horizontal', size: 'sm' })}
                  </div>
                ))}
              </div>
              
              {/* Hero card - full height */}
              <div className="min-h-[280px] [&>*]:h-full order-1 md:order-2">
                {cloneWithProps(hero.item, { isFeatured: true, size: 'lg' })}
              </div>
            </div>
          );
        }
        
        // Double Hero - two heroes side by side
        if (section.type === 'double-hero') {
          return (
            <div key={`section-${sectionIdx}`} className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {section.items.map((item) => (
                <div key={item.item.index} className="min-h-[260px] [&>*]:h-full">
                  {cloneWithProps(item.item, { size: 'md' })}
                </div>
              ))}
            </div>
          );
        }
        
        // Triple Compact - three compact vertical cards
        if (section.type === 'triple-compact') {
          return (
            <div key={`section-${sectionIdx}`} className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {section.items.map((item) => (
                <div key={item.item.index} className="min-h-[200px] [&>*]:h-full">
                  {cloneWithProps(item.item, { size: 'sm' })}
                </div>
              ))}
            </div>
          );
        }
        
        // Pair Horizontal - two horizontal cards side by side
        if (section.type === 'pair-horizontal') {
          return (
            <div key={`section-${sectionIdx}`} className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {section.items.map((item) => (
                <div key={item.item.index} className="min-h-[150px]">
                  {cloneWithProps(item.item, { orientation: 'horizontal', size: 'md' })}
                </div>
              ))}
            </div>
          );
        }
        
        // Wide Horizontal - full width horizontal card
        if (section.type === 'wide-horizontal') {
          const item = section.items[0];
          return (
            <div key={`section-${sectionIdx}`} className="min-h-[150px]">
              {cloneWithProps(item.item, { orientation: 'horizontal', size: 'lg' })}
            </div>
          );
        }
        
        // CSV Stack - compact horizontal CSV row cards stacked
        if (section.type === 'csv-stack') {
          return (
            <div key={`section-${sectionIdx}`} className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {section.items.map((item) => (
                <div key={item.item.index} className="min-h-[90px]">
                  {cloneWithProps(item.item, { orientation: 'horizontal', size: 'sm' })}
                </div>
              ))}
            </div>
          );
        }
        
        // Mixed Row - one vertical hero + stacked horizontal
        if (section.type === 'mixed-row') {
          const hero = section.items[0];
          const horizontals = section.items.slice(1);
          
          return (
            <div key={`section-${sectionIdx}`} className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              <div className="min-h-[240px] [&>*]:h-full">
                {cloneWithProps(hero.item, { size: 'md' })}
              </div>
              <div className="flex flex-col gap-2.5">
                {horizontals.map((item) => (
                  <div key={item.item.index} className="flex-1 min-h-[100px]">
                    {cloneWithProps(item.item, { orientation: 'horizontal', size: 'md' })}
                  </div>
                ))}
              </div>
            </div>
          );
        }
        
        return null;
      })}
    </div>
  );
}

/**
 * CardGridSkeleton - Loading skeleton
 */
interface CardGridSkeletonProps {
  count?: number;
  columns?: CardGridProps['columns'];
  gap?: CardGridProps['gap'];
  layout?: CardGridProps['layout'];
}

export function CardGridSkeleton({
  count = 6,
  columns = 'auto',
  gap = 'md',
  layout = 'grid',
}: CardGridSkeletonProps) {
  const { AssetCardSkeleton } = require('./AssetCardBase');
  const orientation = layout === 'list' ? 'horizontal' : 'vertical';
  
  return (
    <CardGrid columns={columns} gap={gap} layout={layout}>
      {Array.from({ length: count }).map((_, i) => (
        <AssetCardSkeleton key={i} orientation={orientation} />
      ))}
    </CardGrid>
  );
}
