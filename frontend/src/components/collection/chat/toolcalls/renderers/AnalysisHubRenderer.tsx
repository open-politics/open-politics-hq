/**
 * Analysis Hub Renderer
 *
 * Handles analysis_hub tool results. Two response shapes:
 * - Lists (schema.list, run.list): inline cards so the user can browse.
 * - Single-schema ops (get/create/update/delete): compact confirmation only.
 *   The full output_contract goes to the model via text content — the UI
 *   doesn't re-render it; schema.list is where the user views full schemas.
 *
 * analysis_hub(operation='run.dashboard') is handled by GetRunDashboardRenderer
 * via the registry's canHandle fallback.
 */

import React from 'react';
import { ToolResultRenderer } from '../core/ToolResultRegistry';
import { ToolResultRenderProps } from '../shared/types';
import { Badge } from '@/components/ui/badge';
import { SchemePreview } from '@/components/collection/annotation/schemaCreation/SchemePreview';
import type { AnnotationSchemaRead } from '@/client';
import { CheckCircle2, Eye, FilePlus, FilePen, Trash2, CircleSlash } from 'lucide-react';

interface AnalysisHubSchema {
  id: number;
  name: string;
  description?: string | null;
  version?: string;
  field_count?: number;
  output_contract?: Record<string, unknown> | null;
  created_at?: string | null;
}

interface AnalysisHubRun {
  id: number;
  name: string;
  status?: string;
  schema_names?: string[];
  asset_count?: number;
  annotation_count?: number;
  created_at?: string | null;
}

const toAnnotationSchemaRead = (s: AnalysisHubSchema): AnnotationSchemaRead => ({
  id: s.id,
  name: s.name,
  description: s.description ?? '',
  version: s.version ?? '1.0',
  output_contract: (s.output_contract ?? {}) as AnnotationSchemaRead['output_contract'],
  instructions: '',
  uuid: '',
  infospace_id: 0,
  user_id: 0,
  created_at: s.created_at ?? '',
  updated_at: s.created_at ?? '',
  is_active: true,
  field_specific_justification_configs: null,
});

function SchemasList({ schemas }: { schemas: AnalysisHubSchema[] }) {
  if (schemas.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">No schemas in this infospace.</div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Schemas</span>
        <Badge variant="secondary" className="h-5">{schemas.length}</Badge>
      </div>
      <div className="space-y-3">
        {schemas.map((s) => (
          <div key={s.id} className="rounded-md border bg-card p-3">
            <SchemePreview scheme={toAnnotationSchemaRead(s)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function RunsList({ runs }: { runs: AnalysisHubRun[] }) {
  if (runs.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">No annotation runs yet.</div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Runs</span>
        <Badge variant="secondary" className="h-5">{runs.length}</Badge>
      </div>
      <div className="space-y-1">
        {runs.map((r) => (
          <div key={r.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <span className="font-medium flex-1 truncate">{r.name}</span>
            {r.status && <Badge variant="outline" className="text-xs">{r.status}</Badge>}
            {typeof r.annotation_count === 'number' && (
              <span className="text-xs text-muted-foreground">{r.annotation_count} annotations</span>
            )}
            <span className="text-xs text-muted-foreground">#{r.id}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

type SingleSchemaStatus = 'created' | 'updated' | 'deactivated' | 'deleted' | undefined;

interface SingleSchemaResult {
  id?: number;
  schema_id?: number;
  name?: string;
  version?: string;
  field_count?: number;
  is_active?: boolean;
  output_contract?: unknown;
  status?: SingleSchemaStatus;
  updated_fields?: string[];
  annotation_count?: number;
  annotations_deleted?: number;
}

function SchemaConfirmation({ result }: { result: SingleSchemaResult }) {
  const status = result.status;
  const id = result.id ?? result.schema_id;

  if (status === 'deleted' || status === 'deactivated') {
    const Icon = status === 'deleted' ? Trash2 : CircleSlash;
    const verb = status === 'deleted' ? 'Deleted' : 'Deactivated';
    const tone = status === 'deleted'
      ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800 text-red-900 dark:text-red-100'
      : 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-100';
    const countNote = status === 'deleted'
      ? (result.annotations_deleted ? ` · ${result.annotations_deleted} annotations removed` : '')
      : (result.annotation_count ? ` · ${result.annotation_count} annotations preserved` : '');
    const label = result.name ? `${result.name}${result.version ? ` v${result.version}` : ''}` : `#${id}`;
    return (
      <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${tone}`}>
        <Icon className="h-4 w-4 shrink-0" />
        <span className="flex-1">
          {verb} schema <strong>{label}</strong>
          <span className="text-xs opacity-80">{countNote}</span>
        </span>
        {id != null && <Badge variant="outline" className="text-xs">#{id}</Badge>}
      </div>
    );
  }

  const Icon = status === 'created' ? FilePlus : status === 'updated' ? FilePen : Eye;
  const verb = status === 'created' ? 'Created' : status === 'updated' ? 'Updated' : 'Fetched';
  const name = result.name ?? `Schema #${id}`;

  return (
    <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm">
      <Icon className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
      <span className="flex-1 truncate">
        {verb} schema <strong>{name}</strong>
        {result.version ? <span className="text-muted-foreground"> v{result.version}</span> : null}
        {status === 'updated' && result.updated_fields?.length ? (
          <span className="text-xs text-muted-foreground"> · changed: {result.updated_fields.join(', ')}</span>
        ) : null}
      </span>
      {typeof result.field_count === 'number' && (
        <span className="text-xs text-muted-foreground">{result.field_count} fields</span>
      )}
      {id != null && <Badge variant="outline" className="text-xs">#{id}</Badge>}
    </div>
  );
}

function isSingleSchemaResult(result: any): result is SingleSchemaResult {
  if (!result || typeof result !== 'object') return false;
  // Delete/deactivate responses (no output_contract, but carry a schema_id + status)
  if ((result.status === 'deleted' || result.status === 'deactivated') && typeof result.schema_id === 'number') {
    return true;
  }
  // Get/create/update responses — single schema shape
  return typeof result.id === 'number' && typeof result.name === 'string' && 'output_contract' in result;
}

export const AnalysisHubRenderer: ToolResultRenderer = {
  toolName: 'analysis_hub',

  canHandle: (result: any) => {
    if (!result || typeof result !== 'object') return false;
    // Opt out of run.dashboard shape — GetRunDashboardRenderer handles that
    if (result.run_id !== undefined && result.annotations !== undefined) return false;
    if (Array.isArray(result.schemas) || Array.isArray(result.runs)) return true;
    return isSingleSchemaResult(result);
  },

  getSummary: (result: any) => {
    if (Array.isArray(result?.schemas)) return `${result.schemas.length} schemas`;
    if (Array.isArray(result?.runs)) return `${result.runs.length} runs`;
    if (isSingleSchemaResult(result)) {
      const status = result.status ?? 'fetched';
      const name = result.name ?? `#${result.id ?? result.schema_id}`;
      return `${status}: ${name}`;
    }
    return 'Analysis hub';
  },

  render: ({ result }: ToolResultRenderProps) => {
    if (Array.isArray(result?.schemas)) {
      return <SchemasList schemas={result.schemas as AnalysisHubSchema[]} />;
    }
    if (Array.isArray(result?.runs)) {
      return <RunsList runs={result.runs as AnalysisHubRun[]} />;
    }
    if (isSingleSchemaResult(result)) {
      return <SchemaConfirmation result={result} />;
    }
    return null;
  },
};
