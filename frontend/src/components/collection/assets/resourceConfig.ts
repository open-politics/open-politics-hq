/**
 * Resource Display Config
 * =======================
 *
 * How each resource type (bundle, asset, run, schema, graph, entity) looks
 * across the UI — icon, label, color. This is the *type* level config.
 *
 * For asset *kind* styling (pdf, csv, web, etc.) see assetKindConfig.ts.
 *
 * ```tsx
 * import { getResourceConfig, getResourceIcon, RESOURCE_GROUP_ORDER, DERIVATION_LABELS }
 *   from '@/components/collection/assets/resourceConfig';
 *
 * const { icon: Icon, iconClass, groupLabel } = getResourceConfig('run');
 * <Icon className={`h-4 w-4 ${iconClass}`} />   // → colored Play icon
 * groupLabel                                      // → "Annotation Runs"
 *
 * getResourceIcon('schema')                       // → <Microscope /> rendered element
 * ```
 */

import React from 'react';
import {
  FileText,
  FolderOpen,
  Package,
  Play,
  Microscope,
  Network,
  Tag,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/* ─── Shape ─── */

export interface ResourceTypeConfig {
  icon: LucideIcon;
  /** Singular: "Bundle", "Annotation Run" */
  label: string;
  /** Plural section header: "Assets", "Annotation Runs" */
  groupLabel: string;
  /** Tailwind color class for the icon */
  iconClass: string;
}

/* ─── Registry ─── */

const CONFIG: Record<string, ResourceTypeConfig> = {
  bundle: {
    icon: FolderOpen,
    label: 'Bundle',
    groupLabel: 'Assets',
    iconClass: 'text-blue-400',
  },
  asset: {
    icon: FileText,
    label: 'Asset',
    groupLabel: 'Assets',
    iconClass: 'text-muted-foreground',
  },
  run: {
    icon: Play,
    label: 'Analysis Result',
    groupLabel: 'Analysis Results',
    iconClass: 'text-muted-foreground',
  },
  schema: {
    icon: Microscope,
    label: 'Schema',
    groupLabel: 'Schemas',
    iconClass: 'text-muted-foreground',
  },
  graph: {
    icon: Network,
    label: 'Graph',
    groupLabel: 'Graphs',
    iconClass: 'text-muted-foreground',
  },
  entity: {
    icon: Tag,
    label: 'Entity',
    groupLabel: 'Entities',
    iconClass: 'text-muted-foreground',
  },
  package: {
    icon: Package,
    label: 'Package',
    groupLabel: 'Packages',
    iconClass: 'text-muted-foreground',
  },
};

const FALLBACK: ResourceTypeConfig = {
  icon: FileText,
  label: 'Item',
  groupLabel: 'Items',
  iconClass: 'text-muted-foreground',
};

/* ─── Accessors ─── */

export function getResourceConfig(type: string): ResourceTypeConfig {
  return CONFIG[type] ?? FALLBACK;
}

/**
 * Rendered icon element for a resource type.
 * For assets with a known kind, prefer `getAssetIcon(kind)` from assetKindConfig.ts.
 */
export function getResourceIcon(
  type: string,
  className: string = 'h-4 w-4',
): React.ReactElement {
  const { icon, iconClass } = getResourceConfig(type);
  return React.createElement(icon, { className: `${className} ${iconClass}` });
}

export function getResourceGroupLabel(type: string): string {
  return getResourceConfig(type).groupLabel;
}

/* ─── Ordering ─── */

/** Canonical display order. 'files' = merged bundle+asset group key. */
export const RESOURCE_GROUP_ORDER = ['files', 'graph', 'run', 'schema', 'entity'] as const;

/* ─── Derivation labels ─── */

/** Human-readable provenance labels for derived package items */
export const DERIVATION_LABELS: Record<string, string> = {
  bundle_subtree: 'sub-bundle',
  run_schema: 'schema from run',
  graph_run: 'run from graph',
};
