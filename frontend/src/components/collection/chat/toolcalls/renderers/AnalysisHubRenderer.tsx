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
import { CheckCircle2, Eye, FilePlus, FilePen, Trash2, CircleSlash, PlusSquare, SlidersHorizontal, FlaskConical, Search } from 'lucide-react';
import { EMPTY_SCHEMA_MAP } from '@/lib/annotations/fieldPaths';

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
  // The hub tool result carries output_contract but not the resolved map.
  schema_map: EMPTY_SCHEMA_MAP,
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
  const [q, setQ] = React.useState('');
  if (runs.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">No annotation runs yet.</div>
    );
  }
  const term = q.trim().toLowerCase();
  const filtered = term
    ? runs.filter((r) => (r.name ?? '').toLowerCase().includes(term) || String(r.id).includes(term))
    : runs;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Runs</span>
        <Badge variant="secondary" className="h-5">{runs.length}</Badge>
      </div>
      {/* Search so a long list stays scannable instead of many rows. */}
      {runs.length > 6 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search runs by name or #id…"
            className="w-full rounded-md border bg-background py-1.5 pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      )}
      <div className="space-y-1">
        {filtered.map((r) => (
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
      {term && filtered.length === 0 && (
        <div className="text-xs text-muted-foreground">No runs match “{q}”.</div>
      )}
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
    <div className="flex items-center gap-2 rounded-md border bg-card px-3.5 py-2.5 text-sm">
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

// ── Dashboard edits (panel.add / panel.set / panel.remove) ──────────────────
// These act on the run OPEN in the Annotation Runner (the operator navigates there);
// the real dashboard renders on the page, so the chat only needs a small confirmation
// — not an inline dashboard, not a JSON dump.

type PanelVerb = 'added' | 'updated' | 'removed';

function dashboardEdit(result: any): { verb: PanelVerb; payload: any } | null {
  const d = result?.ui_directive;
  const list = Array.isArray(d) ? d : d ? [d] : [];
  const pd = list.find((x: any) => typeof x?.command === 'string' && x.command.startsWith('dashboard:'));
  if (!pd) return null;
  const verbByCommand: Record<string, PanelVerb> = {
    'dashboard:addPanel': 'added',
    'dashboard:setPanel': 'updated',
    'dashboard:removePanel': 'removed',
  };
  const verb = verbByCommand[pd.command];
  return verb ? { verb, payload: pd.payload ?? {} } : null;
}

function PanelConfirmation({ verb, payload }: { verb: PanelVerb; payload: any }) {
  const name = payload?.name ?? (payload?.index != null ? `panel #${payload.index}` : 'panel');
  const type = typeof payload?.type === 'string' ? payload.type : undefined;
  // A short hint of what was configured — kept subtle.
  const bits: string[] = [];
  if (payload?.axis && typeof payload.axis === 'object') {
    const roles = Object.entries(payload.axis)
      .filter(([, v]) => v != null && (Array.isArray(v) ? v.length > 0 : true))
      .map(([k]) => k);
    if (roles.length) bits.push(roles.join(' · '));
  }
  if (payload?.filter) bits.push('filtered');

  const Icon = verb === 'added' ? PlusSquare : verb === 'removed' ? Trash2 : SlidersHorizontal;
  const head = verb === 'added' ? `Added ${type ? `${type} ` : ''}panel` : verb === 'removed' ? 'Removed panel' : 'Updated panel';
  const tone = verb === 'removed' ? 'text-muted-foreground' : 'text-primary';

  return (
    <div className="flex items-center gap-2 rounded-md border bg-card px-3.5 py-2.5 text-sm">
      <Icon className={`h-4 w-4 shrink-0 ${tone}`} />
      <span className="flex-1 truncate">
        {head} <strong>{name}</strong>
        {verb !== 'removed' && bits.length > 0 && (
          <span className="text-xs text-muted-foreground"> · {bits.join(' · ')}</span>
        )}
      </span>
    </div>
  );
}

function dashboardBatch(result: any): any[] | null {
  const d = result?.ui_directive;
  const list = Array.isArray(d) ? d : d ? [d] : [];
  const pd = list.find((x: any) => x?.command === 'dashboard:addPanels');
  return pd ? (Array.isArray(pd.payload?.panels) ? pd.payload.panels : []) : null;
}

function BatchPanelConfirmation({ panels }: { panels: any[] }) {
  return (
    <div className="space-y-1.5 rounded-md border bg-card p-2.5 text-sm">
      <div className="mb-0.5 flex items-center gap-2">
        <PlusSquare className="h-4 w-4 shrink-0 text-primary" />
        <span>Added <strong>{panels.length}</strong> panel{panels.length === 1 ? '' : 's'}</span>
      </div>
      <div className="space-y-0.5">
        {panels.map((p, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{p?.type}</span>
            <span className="truncate">{p?.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Run start (navigates to the runner) — a small confirmation, not JSON ─────

function isRunStart(result: any): boolean {
  return !!result && typeof result === 'object'
    && typeof result.run_id === 'number'
    && result.model_name !== undefined
    && result.annotations === undefined;
}

function RunStartConfirmation({ result }: { result: any }) {
  const name = result.run_name ?? `Run #${result.run_id}`;
  return (
    <div className="flex items-center gap-2 rounded-md border bg-card px-3.5 py-2.5 text-sm">
      <FlaskConical className="h-4 w-4 shrink-0 text-primary" />
      <span className="flex-1 truncate">
        Started run <strong>{name}</strong>
        {result.live && <span className="text-xs text-muted-foreground"> · live</span>}
        <span className="text-xs text-muted-foreground"> · opened on the runner</span>
      </span>
      {result.run_id != null && <Badge variant="outline" className="text-xs">#{result.run_id}</Badge>}
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
    if (dashboardBatch(result)) return true;
    if (dashboardEdit(result)) return true;
    if (isRunStart(result)) return true;
    // Opt out of run.dashboard shape — GetRunDashboardRenderer handles that
    if (result.run_id !== undefined && result.annotations !== undefined) return false;
    if (Array.isArray(result.schemas) || Array.isArray(result.runs)) return true;
    return isSingleSchemaResult(result);
  },

  getSummary: (result: any) => {
    const batch = dashboardBatch(result);
    if (batch) return `added ${batch.length} panels`;
    const edit = dashboardEdit(result);
    if (edit) {
      const p = edit.payload;
      const name = p?.name ?? (p?.index != null ? `#${p.index}` : 'panel');
      return `${edit.verb} panel ${name}`;
    }
    if (isRunStart(result)) return `started run ${result.run_name ?? `#${result.run_id}`}`;
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
    const batch = dashboardBatch(result);
    if (batch) {
      return <BatchPanelConfirmation panels={batch} />;
    }
    const edit = dashboardEdit(result);
    if (edit) {
      return <PanelConfirmation verb={edit.verb} payload={edit.payload} />;
    }
    if (isRunStart(result)) {
      return <RunStartConfirmation result={result} />;
    }
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
