/**
 * Asset metadata helpers for facets + file_info (post source_metadata migration).
 * Use getAssetMeta() for a merged view when migrating from source_metadata.
 */

export interface AssetMetaSource {
  facets?: Record<string, unknown> | null;
  file_info?: Record<string, unknown> | null;
}

/**
 * Returns a merged view of asset metadata from facets and file_info.
 * Use for backward-compat reads when migrating from source_metadata.
 * Prefer direct asset.facets?.X / asset.file_info?.Y where the source is known.
 */
export function getAssetMeta(asset: AssetMetaSource): Record<string, unknown> {
  const f = asset.facets ?? {};
  const fi = asset.file_info ?? {};
  return {
    ...fi,
    ...f,
    // Explicit overrides for known dual-sourced keys
    summary: (f.summary ?? fi.summary) as string | undefined,
  };
}
