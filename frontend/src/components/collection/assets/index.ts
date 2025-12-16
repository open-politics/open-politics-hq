/**
 * Asset Components
 * =================
 * 
 * Unified exports for asset-related components and configurations.
 * 
 * ## Asset Kind Configuration (SINGLE SOURCE OF TRUTH)
 * 
 * All asset kind styling, icons, and metadata are defined in `assetKindConfig.ts`.
 * Import from here instead of defining local configs.
 * 
 * ```tsx
 * import { 
 *   getAssetKindConfig,    // Full config object
 *   getAssetIcon,          // Icon as React element
 *   getAssetIconComponent, // Icon component (not instantiated)
 *   getAssetBadgeClass,    // Badge CSS classes
 *   getAssetIconClass,     // Icon CSS classes
 *   formatAssetKind,       // Human-readable label
 *   
 *   // Lists & filters
 *   DISPLAYABLE_ASSET_KINDS,  // Non-internal kinds
 *   INTERNAL_ASSET_KINDS,     // Internal/fragment kinds
 *   CONTAINER_ASSET_KINDS,    // Kinds that can have children
 *   
 *   // Predicates
 *   isDisplayableKind,
 *   canHaveChildren,
 *   getKindsByGroup,
 * } from '@/components/collection/assets';
 * 
 * // Use appropriate style context:
 * getAssetBadgeClass('article', 'selector');  // Colorful (for tree/selector)
 * getAssetBadgeClass('article', 'card');      // Neutral (for feed cards)
 * getAssetBadgeClass('article', 'default');   // Standard colorful
 * ```
 * 
 * ## Pre-styled Components
 * 
 * ```tsx
 * import { 
 *   AssetKindBadge,  // Complete badge with icon + label
 *   AssetKindIcon,   // Just the icon
 * } from '@/components/collection/assets';
 * 
 * <AssetKindBadge kind="article" context="card" />
 * ```
 */

// Asset Kind Configuration - SINGLE SOURCE OF TRUTH
export {
  // Types
  type StyleContext,
  type AssetGroup,
  type AssetKindConfig,
  
  // Master config
  ASSET_KIND_CONFIG,
  
  // Getter functions
  getAssetKindConfig,
  getAssetIcon,
  getAssetIconComponent,
  getAssetBadgeClass,
  getAssetIconClass,
  formatAssetKind,
  
  // Asset kind lists
  DISPLAYABLE_ASSET_KINDS,
  INTERNAL_ASSET_KINDS,
  CONTAINER_ASSET_KINDS,
  
  // Predicates
  isDisplayableKind,
  canHaveChildren,
  getKindsByGroup,
} from './assetKindConfig';

// Pre-styled components
export { AssetKindBadge, AssetKindIcon } from './AssetKindBadge';

// Re-export legacy helpers from AssetSelector for backwards compatibility
// These now delegate to assetKindConfig
export { 
  getAssetIcon as getAssetIconLegacy, 
  formatAssetKind as formatAssetKindLegacy, 
  getAssetBadgeClass as getAssetBadgeClassLegacy,
} from './AssetSelector';

