/**
 * Pie small-multiples facet logic — shared by the renderer
 * (AnnotationResultsPieChart) and the config popover (PanelConfigPopover)
 * so the two surfaces agree on ordering and visibility semantics.
 *
 * A "facet" here is a distinct value of the pie's ``facet`` field; each one
 * becomes its own pie in the small-multiples grid.
 */

/**
 * Apply explicit facet ordering: listed facets first (in ``order``'s order),
 * then any remaining facets in their natural order. Stale entries in
 * ``order`` (values no longer present) are ignored, and new facets not yet
 * in ``order`` fall to the end — so a saved order survives data changes.
 */
export function orderFacets(keys: string[], order?: string[] | null): string[] {
  if (!order || order.length === 0) return keys;
  const present = new Set(keys);
  const listed = order.filter((k) => present.has(k));
  const listedSet = new Set(listed);
  const rest = keys.filter((k) => !listedSet.has(k));
  return [...listed, ...rest];
}

/**
 * The effective visible facet set. ``null``/empty → all keys. If every
 * stored value has gone stale (none match ``keys``) we also fall back to all
 * — never blank the panel. Preserves the order of ``keys`` (caller passes
 * already-ordered keys).
 */
export function effectiveVisibleFacets(keys: string[], visible?: string[] | null): string[] {
  if (!visible || visible.length === 0) return keys;
  const visibleSet = new Set(visible);
  const filtered = keys.filter((k) => visibleSet.has(k));
  return filtered.length > 0 ? filtered : keys;
}
