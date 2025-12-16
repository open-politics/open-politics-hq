/**
 * Type-Specific Asset Card Components
 * ====================================
 * 
 * These components provide specialized card renderings for different asset kinds.
 * They are used by the main AssetCard component which dispatches based on asset.kind.
 * 
 * To add a new type-specific card:
 * 1. Create a new component file (e.g., PdfAssetCard.tsx)
 * 2. Export it from this index
 * 3. Add the kind mapping in AssetCard.tsx
 */

export { DefaultAssetCard } from './DefaultAssetCard';
export { ArticleAssetCard } from './ArticleAssetCard';
export { WebAssetCard } from './WebAssetCard';
export { CsvAssetCard } from './CsvAssetCard';
export { CsvRowAssetCard } from './CsvRowAssetCard';
export { CardHeroFallback } from './CardHeroFallback';
