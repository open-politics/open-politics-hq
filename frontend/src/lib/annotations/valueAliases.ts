/**
 * Run-wide value aliases → backend `MergeMap[]` conversion.
 *
 * Aliases are stored on the dashboard's `runWideSettings` as:
 *   valueAliasesByField: Record<fieldPath, Record<canonical, rawNames[]>>
 *
 * Each `/view` call converts this into the `MergeMap` list the backend
 * applies as SQL `CASE WHEN` expressions via `core/filters.merge_case`.
 * Panel-local merge_maps (the legacy field on PanelConfig) are unioned in,
 * with panel-local entries winning on field-path conflicts.
 */
import type { MergeMap, MergeMapEntry } from '@/client';

export function aliasesToMergeMaps(
  aliasesByField: Record<string, Record<string, string[]>>,
): MergeMap[] {
  const out: MergeMap[] = [];
  for (const [fieldPath, aliases] of Object.entries(aliasesByField ?? {})) {
    const entries: MergeMapEntry[] = Object.entries(aliases)
      .filter(([, names]) => names.length > 0)
      .map(([keep, names]) => ({ keep, names }));
    if (entries.length > 0) out.push({ field_path: fieldPath, entries });
  }
  return out;
}

/**
 * Union panel-local merge_maps with run-wide aliases. Panel-local wins on
 * field-path conflicts so the panel can override globally-defined aliases.
 */
export function effectiveMergeMaps(
  panelLocal: MergeMap[] | undefined,
  runWideAliases: Record<string, Record<string, string[]>> | undefined,
): MergeMap[] {
  const local = panelLocal ?? [];
  const global = aliasesToMergeMaps(runWideAliases ?? {});
  if (local.length === 0) return global;
  const taken = new Set(local.map(m => m.field_path));
  return [...local, ...global.filter(m => !taken.has(m.field_path))];
}
