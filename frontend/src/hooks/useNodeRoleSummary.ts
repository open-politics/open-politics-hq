/**
 * useNodeRoleSummary — role-grouped dossier summary for one entity.
 *
 * Given an entity id (a node clicked on the graph), the active panel's
 * projection, and the run, this hook fetches the dossier through
 * ``/view`` and groups the resulting rows by role-tuple so the
 * NodeDetailHUD can render "AS ACTOR — Tipico ×23 mean 7.8" sections.
 *
 * Grouping is client-side: the dossier is small enough at single-node
 * scope (the entity's row count caps at the run's annotation count).
 * If a future investigation shows row counts crossing ~5k for one
 * node, swap this to a server-side ``buckets()`` projection — but
 * resist until measured.
 */
import { useMemo } from 'react';
import type { DossierConfig } from '@/client';
import { useAnnotationView } from './useAnnotationView';
import type { ViewDossierRow, PanelProjection } from '@/lib/annotations/types';

export interface RoleGroup {
  /** The role on the projection these rows fall under (e.g. "actor"). */
  role: string;
  /** Total number of dossier rows where this role's binding is set. */
  total: number;
  /** Per-(other-entity) breakdown — one entry per distinct
   *  ``(role_bindings[other_role], scalars)`` tuple, ranked by row count
   *  desc. ``other_role`` is the projection's other entity-typed role
   *  (typically ``subject`` when this group is ``actor``, or vice versa).
   *  When no second role binds, ``buckets`` collapses to one entry per
   *  this-role entity. */
  buckets: RoleBucket[];
}

export interface RoleBucket {
  /** Display label — the canonical name of the *other* role's entity. */
  label: string;
  /** Entity id of the bucket's anchor (the *other* role's value). */
  entity_id: number;
  /** Number of dossier rows in this bucket. */
  count: number;
  /** Mean of the projection's primary scalar over this bucket's rows. */
  primary_mean: number | null;
  /** Mean of the projection's confidence scalar (numeric after enum_weights). */
  confidence_mean: number | null;
  /** Categorical breakdown of any string-valued scalars (e.g. enforcement). */
  categorical: Record<string, Record<string, number>>;
  /** Source dossier rows in this bucket — sorted by primary × confidence DESC. */
  rows: ViewDossierRow[];
}

export interface UseNodeRoleSummaryParams {
  infospaceId: number;
  runId: number;
  /** The entity id whose role-grouped dossier we're computing. */
  entityId: number | null;
  /** The active panel's projection. Must declare entity-typed roles. */
  projection: PanelProjection | null | undefined;
  /** Roles to surface (e.g. ['actor','subject','mentioned']). When empty,
   *  every entity-typed role on the projection is surfaced. */
  surfaceRoles?: string[];
  /** The "other" role to bucket by per surface (e.g. when role='actor',
   *  bucket by 'subject'). Falls back to the first non-self role on the
   *  projection. */
  bucketRoleByRole?: Record<string, string>;
  /** Per-page cap on dossier rows. Default 500 — enough for "all rows
   *  behind one node" at run scale. */
  limit?: number;
  /** Whether to keep ``<unresolved>`` rows in the result. Default false. */
  allowUnresolved?: boolean;
  /** Disable until ready (e.g. user hasn't picked a node yet). */
  enabled?: boolean;
}

export interface UseNodeRoleSummaryResult {
  groups: RoleGroup[];
  unresolvedRows: number;
  isLoading: boolean;
  error: Error | null;
  totalRows: number;
}

function projectionHasEntityRoles(p: PanelProjection | null | undefined): boolean {
  if (!p?.roles) return false;
  return Object.values(p.roles).some(rb => !!rb.entity_type);
}

function entityRoles(p: PanelProjection): string[] {
  return Object.entries(p.roles ?? {})
    .filter(([_, rb]) => !!rb.entity_type)
    .map(([role]) => role);
}

export function useNodeRoleSummary(
  params: UseNodeRoleSummaryParams,
): UseNodeRoleSummaryResult {
  const {
    infospaceId,
    runId,
    entityId,
    projection,
    surfaceRoles,
    bucketRoleByRole,
    limit = 500,
    allowUnresolved = false,
    enabled = true,
  } = params;

  // Build the dossier config from the panel's projection. The dossier is
  // not narrowed by entity at the SQL level (we'd need a "filter by
  // role-bound canon id" condition that doesn't exist yet) — instead we
  // pull all rows from the run and filter client-side. This is fine at
  // single-run scale; the dossier engine caps at ``limit`` rows anyway.
  const dossierConfig: DossierConfig | undefined = useMemo(() => {
    if (!projection || !projectionHasEntityRoles(projection)) return undefined;
    return {
      projection: {
        field_mappings: projection.field_mappings ?? {},
        explosion: projection.explosion ?? null,
        roles: projection.roles ?? {},
        scalars: projection.scalars ?? {},
        snippet: projection.snippet ?? null,
        edges: projection.edges ?? [],
        joint_roles: projection.joint_roles ?? [],
      } as DossierConfig['projection'],
      limit,
      allow_unresolved: allowUnresolved,
    };
  }, [projection, limit, allowUnresolved]);

  const { data, isLoading, error } = useAnnotationView({
    infospaceId,
    runId,
    dossier: dossierConfig,
    enabled: enabled && !!entityId && !!dossierConfig,
  });

  const result: UseNodeRoleSummaryResult = useMemo(() => {
    const empty: UseNodeRoleSummaryResult = {
      groups: [],
      unresolvedRows: 0,
      isLoading,
      error,
      totalRows: 0,
    };
    if (!projection || !data?.dossier || entityId == null) return empty;

    const allRoles = surfaceRoles && surfaceRoles.length > 0
      ? surfaceRoles
      : entityRoles(projection);

    // For each role surface: filter dossier rows where role_bindings[role] === entityId,
    // then bucket by (bucket_role)'s entity_id.
    const groups: RoleGroup[] = [];
    for (const role of allRoles) {
      const bucketRole =
        bucketRoleByRole?.[role]
        ?? entityRoles(projection).find(r => r !== role)
        ?? role;

      const matchingRows = data.dossier.items.filter(
        r => r.role_bindings?.[role] === entityId,
      );
      if (matchingRows.length === 0) continue;

      // Group by bucket_role's entity id.
      const bucketMap = new Map<number, RoleBucket>();
      for (const row of matchingRows) {
        const otherId = row.role_bindings?.[bucketRole];
        if (otherId == null) continue;
        const otherName = row.role_names?.[bucketRole] ?? '<unknown>';
        let bucket = bucketMap.get(otherId);
        if (!bucket) {
          bucket = {
            label: otherName,
            entity_id: otherId,
            count: 0,
            primary_mean: null,
            confidence_mean: null,
            categorical: {},
            rows: [],
          };
          bucketMap.set(otherId, bucket);
        }
        bucket.count += 1;
        bucket.rows.push(row);

        for (const [scalarName, raw] of Object.entries(row.scalars ?? {})) {
          if (raw == null) continue;
          if (typeof raw === 'number') {
            // Aggregate numeric scalars as running mean. ``primary`` is
            // canonical; everything else is just available for downstream
            // rendering (we don't know which scalar names matter without
            // the projection schema, so the consumer reads them directly
            // off ``rows``).
            if (scalarName === 'primary') {
              bucket.primary_mean = bucket.primary_mean == null
                ? raw
                : (bucket.primary_mean * (bucket.count - 1) + raw) / bucket.count;
            }
            if (scalarName === 'confidence') {
              bucket.confidence_mean = bucket.confidence_mean == null
                ? raw
                : (bucket.confidence_mean * (bucket.count - 1) + raw) / bucket.count;
            }
          } else if (typeof raw === 'string') {
            const cat = bucket.categorical[scalarName] ??= {};
            cat[raw] = (cat[raw] ?? 0) + 1;
          }
        }
      }

      const buckets = Array.from(bucketMap.values()).sort((a, b) => {
        // Rank by primary × confidence weight × count, descending.
        const sa = (a.primary_mean ?? 0) * (a.confidence_mean ?? 1) * a.count;
        const sb = (b.primary_mean ?? 0) * (b.confidence_mean ?? 1) * b.count;
        return sb - sa;
      });

      // Sort each bucket's row list by primary × confidence DESC for
      // dossier preview display.
      for (const b of buckets) {
        b.rows.sort((x, y) => {
          const sx = (Number(x.scalars?.primary) || 0) * (Number(x.scalars?.confidence) || 1);
          const sy = (Number(y.scalars?.primary) || 0) * (Number(y.scalars?.confidence) || 1);
          return sy - sx;
        });
      }

      groups.push({
        role,
        total: matchingRows.length,
        buckets,
      });
    }

    return {
      groups,
      unresolvedRows: data.dossier.unresolved_rows ?? 0,
      isLoading,
      error,
      totalRows: data.dossier.items.length,
    };
  }, [data, projection, entityId, surfaceRoles, bucketRoleByRole, isLoading, error]);

  return result;
}
