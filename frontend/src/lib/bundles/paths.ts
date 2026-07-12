import type { BundleRead } from '@/client';

/**
 * Human breadcrumb of a bundle's ancestors, root-first, excluding the bundle
 * itself ("Finance / 2024"). Walks the flat bundle list by `parent_bundle_id` —
 * the same backbone the tree reveal uses. Display only; empty for a root folder.
 */
export function bundlePathLabel(targetId: number, byId: Map<number, BundleRead>): string {
  const names: string[] = [];
  const seen = new Set<number>();
  let parentId = byId.get(targetId)?.parent_bundle_id ?? null;
  while (parentId != null && !seen.has(parentId)) {
    seen.add(parentId);
    const b = byId.get(parentId);
    if (b?.name) names.push(b.name);
    parentId = b?.parent_bundle_id ?? null;
  }
  return names.reverse().join(' / ');
}
