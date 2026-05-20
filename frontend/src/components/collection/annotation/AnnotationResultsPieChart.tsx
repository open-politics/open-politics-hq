'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  TooltipProps
} from 'recharts';
import { AnnotationSchemaRead } from '@/client';
import type { AggregateViewConfig as AggregateConfig } from '@/client';
import { FormattedAnnotation, PanelConfig } from '@/lib/annotations/types';
import AssetLink from '../assets/Helper/AssetLink';
import { getTargetKeysForScheme } from '@/lib/annotations/utils';
import { useAnnotationView } from '@/hooks/useAnnotationView';
import { mergeFiltersAndScopes } from '@/lib/annotations/scopes';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Info } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { GroupedDataPoint } from './AnnotationResultsChart';
import { type RolePickerValue } from './panels/RolePicker';
import { RolePickerPopover } from './panels/RolePickerPopover';
import { PanelHeaderSlot } from './panels/PanelHeaderSlot';
import { PanelFormulaBinder } from './formulas/PanelFormulaBinder';
import { useResolvedProjection } from '@/hooks/useResolvedProjection';
import { EmptyStateCard } from './panels/EmptyStateCard';
import { ValueAliasManager } from './panels/ValueAliasManager';
import { EvidenceDrawer } from './panels/EvidenceDrawer';
import { PANEL_ROLE_SCHEMAS } from '@/lib/annotations/panelRoleSchema';
import { createScopeFromSelection } from '@/lib/annotations/scopes';
import type { Scope } from '@/lib/annotations/types';
import { useAnnotationRunStore } from '@/zustand_stores/useAnnotationRunStore';
import { effectiveMergeMaps } from '@/lib/annotations/valueAliases';
import { inferFieldShape } from '@/lib/annotations/fieldPaths';

const PIE_COLORS = [
  '#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8',
  '#82CA9D', '#A4DE6C', '#D0ED57', '#FFC658', '#FF6B6B',
  '#4BC0C0', '#9966FF', '#FF9F40', '#36A2EB', '#F7786B'
];

const SLICE_OPTIONS = [
  { value: 5, label: 'Top 5' },
  { value: 10, label: 'Top 10' },
  { value: 15, label: 'Top 15' },
  { value: Infinity, label: 'All' },
];


interface AnnotationResultsPieChartProps {
  infospaceId: number;
  runId: number;
  schemas: AnnotationSchemaRead[];
  panelConfig: PanelConfig;
  onUpdatePanel: (updates: Partial<PanelConfig>) => void;
  showControls?: boolean;
  onResultSelect?: (result: FormattedAnnotation) => void;
  onFieldInteraction?: (result: FormattedAnnotation, fieldKey: string) => void;
  onScopeGesture?: (fieldPath: string, value: any, gestureType: 'click' | 'select') => void;
}

interface PieDataPoint {
  name: string;
  value: number;
}

interface SelectedSliceDetails {
  name: string;
  value: number;
  percentage: number;
  /** Asset ids whose slice field equals this slice's value — used to list
   * clickable AssetLinks in the detail dialog. */
  documents: number[];
  schema: AnnotationSchemaRead;
  fieldKey: string;
  isOtherSlice: boolean;
  groupedCategories?: PieDataPoint[];
  pointForDialog: GroupedDataPoint;
}


const AnnotationResultsPieChart: React.FC<AnnotationResultsPieChartProps> = ({
  infospaceId,
  runId,
  schemas,
  panelConfig,
  onUpdatePanel,
  showControls = true,
  onResultSelect,
  onFieldInteraction,
  onScopeGesture,
}) => {
  // --- Derive UI state directly from panelConfig (no local state sync) ---
  const selectedSchemaId = (panelConfig.settings?.selectedSchemaId ?? null) as number | null;
  const selectedFieldKey = panelConfig.aggregation?.group_by || panelConfig.settings?.selectedFieldKey || null;
  const selectedMaxSlices = panelConfig.settings?.selectedMaxSlices ?? SLICE_OPTIONS[1].value;

  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
  const [selectedSliceData, setSelectedSliceData] = useState<SelectedSliceDetails | null>(null);
  const [hoveredSliceName, setHoveredSliceName] = useState<string | null>(null);

  // Evidence drawer — double-click a slice to drill into the annotations that
  // contributed to it. Double-click detection is manual since recharts' Pie
  // doesn't expose onDoubleClick directly; we track the last click per slice.
  const [evidenceScope, setEvidenceScope] = useState<Scope | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  // Stable ref for panelConfig values (used by handlers)
  const panelConfigRef = useRef(panelConfig);
  panelConfigRef.current = panelConfig;

  // User interaction handlers — write directly to panelConfig
  const handleSchemaChange = useCallback((newSchemaId: number | null) => {
    const pc = panelConfigRef.current;
    onUpdatePanel({
      settings: {
        ...(pc.settings || {}),
        selectedSchemaId: newSchemaId ?? undefined,
        selectedFieldKey: undefined, // reset field when schema changes
      },
      aggregation: { ...(pc.aggregation || {}), group_by: undefined },
    });
  }, [onUpdatePanel]);

  const handleFieldChange = useCallback((newFieldKey: string | null) => {
    const pc = panelConfigRef.current;
    onUpdatePanel({
      settings: {
        ...(pc.settings || {}),
        selectedFieldKey: newFieldKey ?? undefined,
      },
      aggregation: {
        ...(pc.aggregation || {}),
        group_by: newFieldKey || undefined,
        function: 'count',
      },
    });
  }, [onUpdatePanel]);

  const handleMaxSlicesChange = useCallback((value: number) => {
    const pc = panelConfigRef.current;
    onUpdatePanel({
      settings: { ...(pc.settings || {}), selectedMaxSlices: value },
    });
  }, [onUpdatePanel]);

  // --- RolePicker wiring --------------------------------------------------
  // `slice` → aggregation.group_by; `value` → aggregation.value_field (+ sum);
  // `group_by` (small multiples) → settings.groupingFieldKey. The schema picker
  // reuses settings.selectedSchemaId so the legacy select below stays in sync.
  const rolePickerValue = useMemo<RolePickerValue>(() => {
    const mappings = panelConfig.projection?.field_mappings ?? {};
    const fieldsByRole: Record<string, string[]> = {};
    for (const [key, val] of Object.entries(mappings)) {
      if (Array.isArray(val)) fieldsByRole[key] = val.map(String);
      else if (typeof val === 'string' && val.length > 0) fieldsByRole[key] = [val];
    }
    // Back-compat: aggregation.group_by was the source of truth before roles.
    if (!fieldsByRole['slice'] && typeof panelConfig.aggregation?.group_by === 'string') {
      fieldsByRole['slice'] = [panelConfig.aggregation.group_by];
    }
    return {
      schemaId: selectedSchemaId ?? null,
      fieldsByRole,
      explosionByRole: {},
      aggregation: panelConfig.aggregation ?? {},
    };
  }, [panelConfig.projection, panelConfig.aggregation, selectedSchemaId]);

  const handleRolePickerChange = useCallback((next: RolePickerValue) => {
    const field_mappings: Record<string, string | string[]> = {};
    for (const [role, paths] of Object.entries(next.fieldsByRole)) {
      if (paths.length === 0) continue;
      field_mappings[role] = paths.length > 1 ? paths : paths[0];
    }
    const sliceField = next.fieldsByRole['slice']?.[0];
    const valueField = next.fieldsByRole['value']?.[0];
    const pc = panelConfigRef.current;
    onUpdatePanel({
      projection: {
        field_mappings,
        explosion: Object.values(next.explosionByRole).find((e) => !!e) ?? null,
      },
      aggregation: {
        ...(pc.aggregation ?? {}),
        ...(next.aggregation ?? {}),
        group_by: sliceField ?? pc.aggregation?.group_by ?? undefined,
        value_field: valueField ?? pc.aggregation?.value_field ?? undefined,
        function: next.aggregation?.function ?? pc.aggregation?.function ?? 'count',
      },
      settings: {
        ...(pc.settings ?? {}),
        selectedSchemaId: next.schemaId ?? undefined,
        selectedFieldKey: sliceField,
      },
    });
  }, [onUpdatePanel]);

  // --- Server-side data fetching ---
  const mergedFilters = useMemo(
    () => mergeFiltersAndScopes(panelConfig.local_filters, panelConfig.incoming_scopes),
    [panelConfig.local_filters, panelConfig.incoming_scopes],
  );

  const aggregateConfig = useMemo((): AggregateConfig | undefined => {
    const agg = panelConfig.aggregation;
    if (!agg.group_by) return undefined;
    // Auto-append ``[*]`` for array-shaped slice fields so the backend
    // explodes array elements into individual slices (each topic, each tag)
    // rather than grouping whole stringified arrays into one slice per row.
    let sliceBy = agg.group_by;
    if (!sliceBy.includes('[*]') && selectedSchemaId != null) {
      const owningSchema = schemas.find((s) => s.id === selectedSchemaId) ?? null;
      const shape = inferFieldShape(owningSchema, sliceBy);
      if (shape === 'array_string' || shape === 'array_string_enum' ||
          shape === 'array_number' || shape === 'array_object') {
        sliceBy = `${sliceBy}[*]`;
      }
    }
    return {
      group_by: sliceBy,
      function: agg.function || 'count',
      // Don't pass top_n — fetch all buckets, slice client-side for "Other" support
    };
  }, [panelConfig.aggregation, selectedSchemaId, schemas]);

  // Value-alias wiring — the pie's alias target is the `slice` field.
  const [aliasManagerOpen, setAliasManagerOpen] = useState(false);
  const getGlobalVariableSplitting = useAnnotationRunStore(s => s.getGlobalVariableSplitting);
  const setGlobalVariableSplitting = useAnnotationRunStore(s => s.setGlobalVariableSplitting);
  const gvs = getGlobalVariableSplitting();
  const runWideAliasesByField = gvs?.valueAliasesByField ?? {};
  const aliasTargetField = (panelConfig.projection?.field_mappings?.['slice'] as string | undefined) ?? selectedFieldKey ?? null;
  const aliasesForField = aliasTargetField ? runWideAliasesByField[aliasTargetField] ?? {} : {};

  const effectiveMergeMapsForView = useMemo(
    () => effectiveMergeMaps(panelConfig.merge_maps, runWideAliasesByField),
    [panelConfig.merge_maps, runWideAliasesByField],
  );

  const { data: viewData, isLoading: isViewLoading } = useAnnotationView({
    infospaceId,
    runId,
    aggregate: aggregateConfig,
    filters: mergedFilters,
    merge_maps: effectiveMergeMapsForView,
    schema_ids: selectedSchemaId ? [selectedSchemaId] : undefined,
    enabled: !!runId && !!infospaceId && !!aggregateConfig,
  });

  // Parallel rows fetch — so clicking a slice can list the actual
  // annotations that contributed (same UX as the chart's ChartDialogDetails
  // and the graph's "Appears in documents" chips).
  const { data: rowsViewData } = useAnnotationView({
    infospaceId,
    runId,
    rows: { limit: 500 },
    filters: mergedFilters,
    merge_maps: effectiveMergeMapsForView,
    schema_ids: selectedSchemaId ? [selectedSchemaId] : undefined,
    enabled: !!runId && !!infospaceId,
  });

  // Build a map: slice value → asset ids whose slice field equals that value.
  // Walks the slice path with ``[*]`` awareness so array-typed fields (auto-
  // exploded at the backend) match element-by-element.
  const sliceAssetsByValue = useMemo(() => {
    const map = new Map<string, Set<number>>();
    const items = rowsViewData?.rows?.items;
    if (!items || !selectedFieldKey) return map;
    const normalized = selectedFieldKey.replace(/\[\*\]/g, '');
    const parts = normalized.split('.');
    const unwrapped = parts[0] === 'document' ? parts.slice(1) : null;

    const collect = (node: any, path: string[]): string[] => {
      let cursor: any = node;
      for (let i = 0; i < path.length; i++) {
        const seg = path[i];
        if (cursor == null) return [];
        if (Array.isArray(cursor)) {
          // Traverse each element along the remaining path.
          const out: string[] = [];
          for (const el of cursor) {
            for (const v of collect(el, path.slice(i))) out.push(v);
          }
          return out;
        }
        if (typeof cursor !== 'object' || !(seg in cursor)) return [];
        cursor = (cursor as any)[seg];
      }
      if (cursor == null) return [];
      if (Array.isArray(cursor)) {
        return cursor.filter((v) => v != null).map((v) => String(v));
      }
      return [String(cursor)];
    };

    for (const row of items) {
      const primary = collect(row.value, parts);
      const fallback = primary.length === 0 && unwrapped ? collect(row.value, unwrapped) : [];
      for (const v of (primary.length ? primary : fallback)) {
        let s = map.get(v);
        if (!s) { s = new Set<number>(); map.set(v, s); }
        s.add(row.asset_id);
      }
    }
    return map;
  }, [rowsViewData?.rows?.items, selectedFieldKey]);

  const schemaOptions = useMemo(() => {
    return schemas.map(schema => ({
      value: schema.id.toString(),
      label: schema.name,
    }));
  }, [schemas]);

  const fieldOptions = useMemo(() => {
    if (!selectedSchemaId) return [];
    const targetKeys = getTargetKeysForScheme(selectedSchemaId, schemas);
    return targetKeys.map(tk => ({
      value: tk.key,
      label: `${tk.name} (${tk.type})`,
    }));
  }, [selectedSchemaId, schemas]);

  // --- Map server aggregate buckets → pie chart data ---
  const { pieDataMap, groupedForOtherSliceMap } = useMemo((): {
    pieDataMap: Record<string | number, PieDataPoint[]>;
    groupedForOtherSliceMap: Record<string | number, PieDataPoint[] | undefined>;
  } => {
    if (!viewData?.aggregate?.buckets || viewData.aggregate.buckets.length === 0) {
      return { pieDataMap: {}, groupedForOtherSliceMap: {} };
    }

    const allCategories = viewData.aggregate.buckets
      .map(b => ({ name: b.key || 'N/A', value: b.count }))
      .sort((a, b) => b.value - a.value);

    const maxSlices = selectedMaxSlices ?? SLICE_OPTIONS[1].value;
    if (maxSlices === Infinity || allCategories.length <= maxSlices) {
      return {
        pieDataMap: { aggregated: allCategories },
        groupedForOtherSliceMap: { aggregated: undefined },
      };
    }

    const topN = allCategories.slice(0, maxSlices - 1);
    const others = allCategories.slice(maxSlices - 1);
    const otherSum = others.reduce((acc, curr) => acc + curr.value, 0);
    return {
      pieDataMap: { aggregated: [...topN, { name: 'Other', value: otherSum }] },
      groupedForOtherSliceMap: { aggregated: others },
    };
  }, [viewData?.aggregate?.buckets, selectedMaxSlices]);

  // Placeholder — only used for variable splitting which is no longer needed
  const getPieChartDisplayName = (targetKey: string | number): string => {
    if (targetKey === 'aggregated') return 'All Data';
    return String(targetKey);
  };

  const handlePieSliceClick = useCallback((data: any, index: number, targetKey: string | number) => {
    const currentPieData = pieDataMap[targetKey];
    const currentGroupedForOther = groupedForOtherSliceMap[targetKey];

    if (!selectedSchemaId || !selectedFieldKey || !currentPieData || !currentPieData[index]) return;

    const clickedSliceName = currentPieData[index].name;
    const schema = schemas.find(s => s.id === selectedSchemaId);
    if (!schema) return;

    const isOtherSlice = clickedSliceName === 'Other';
    const totalValues = currentPieData.reduce((sum, item) => sum + item.value, 0);
    const percentage = totalValues > 0 ? (currentPieData[index].value / totalValues) * 100 : 0;

    // Assets whose slice field equals this slice value — populates
    // ``sourceDocuments`` so the detail dialog can list them with
    // AssetLink + AnnotationResultDisplay (same shape chart uses).
    const sliceAssetIds = Array.from(sliceAssetsByValue.get(clickedSliceName) ?? []);
    const sourceDocuments = new Map<number | string, number[]>();
    if (sliceAssetIds.length > 0) sourceDocuments.set('all', sliceAssetIds);

    const pointForDialog: GroupedDataPoint = {
      valueString: clickedSliceName,
      totalCount: currentPieData[index].value,
      sourceDocuments,
      schemeName: schema.name,
      valueKey: clickedSliceName,
    };

    // Make sure a previous "Other"-slice click doesn't leave the legacy
    // dialog hanging open behind the drawer.
    setIsDetailDialogOpen(false);
    setSelectedSliceData(null);

    if (isOtherSlice) {
      // "Other" aggregates many values — a single equality scope can't
      // describe it. Fall back to the legacy dialog so the user at least
      // sees the grouped category list.
      setSelectedSliceData({
        name: clickedSliceName,
        value: currentPieData[index].value,
        percentage,
        documents: sliceAssetIds,
        schema,
        fieldKey: selectedFieldKey,
        isOtherSlice,
        groupedCategories: currentGroupedForOther,
        pointForDialog,
      });
      setIsDetailDialogOpen(true);
      return;
    }

    // Real slice → open the EvidenceDrawer with a scope equality on the
    // slice's field value. Drawer groups by asset, renders AnnotationResultDisplay
    // cards, and each asset header opens the AssetDetailOverlay.
    const scope = createScopeFromSelection(
      panelConfig.id,
      { type: 'click', fieldPath: selectedFieldKey, data: clickedSliceName },
      panelConfig,
      'push',
    );
    // eslint-disable-next-line no-console
    console.log('[pie] opening evidence drawer', {
      sliceName: clickedSliceName,
      fieldPath: selectedFieldKey,
      scopeId: scope.id,
    });
    setEvidenceScope(scope);
    setEvidenceOpen(true);

    if (onScopeGesture) {
      onScopeGesture(selectedFieldKey, clickedSliceName, 'click');
    }
  }, [selectedSchemaId, selectedFieldKey, schemas, pieDataMap, groupedForOtherSliceMap, onScopeGesture, panelConfig, sliceAssetsByValue]);

  const CustomTooltipContent = ({ active, payload }: TooltipProps<number, string>) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload as PieDataPoint;
      const percentage = (payload[0] as any).percent;
      return (
        <div className="bg-background/95 dark:bg-popover p-3 border border-border rounded-lg shadow-xl text-sm text-popover-foreground">
          <p className="font-semibold text-base mb-1">{`${data.name}`}</p>
          <p><span className="font-medium">Count:</span> {data.value}</p>
          {percentage !== undefined && (
            <p><span className="font-medium">Percentage:</span> {(percentage * 100).toFixed(1)}%</p>
          )}
        </div>
      );
    }
    return null;
  };
  
  // OPTIMIZED: Memoize the legend component to prevent excessive re-renders
  const renderCustomLegend = useCallback((props: any) => {
    const { payload } = props;
    const maxLegendLabelLength = 25;

    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-3 gap-y-1.5 mt-3 text-xs text-muted-foreground max-w-full overflow-y-auto max-h-24 pb-2 px-2">
        {payload.map((entry: any, index: number) => {
          const { value, color } = entry;
          const truncatedValue = value.length > maxLegendLabelLength 
            ? `${value.substring(0, maxLegendLabelLength)}…` 
            : value;
          const isHovered = hoveredSliceName === value;
          const opacity = hoveredSliceName && !isHovered ? 0.5 : 1;

          return (
            <TooltipProvider key={`item-${index}`} delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div 
                    className="flex items-center cursor-default overflow-hidden transition-opacity duration-200" 
                    style={{ opacity: opacity }}
                    onMouseEnter={() => setHoveredSliceName(value)}
                    onMouseLeave={() => setHoveredSliceName(null)}
                  >
                    <span style={{ backgroundColor: '#000000', width: '10px', height: '10px', borderRadius: '50%', marginRight: '5px', flexShrink: 0 }} /> 
                    <span className="truncate">{truncatedValue}</span>
                  </div>
                </TooltipTrigger>
                {value.length > maxLegendLabelLength && (
                  <TooltipContent side="top" className="max-w-xs z-[70]">
                    <p>{value}</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          );
        })}
      </div>
    );
  }, [hoveredSliceName]); // Only re-render when hover state changes

  if (schemas.length === 0) {
    return <div className="p-4 text-center text-muted-foreground">No annotation schemas available to build a chart.</div>;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PanelHeaderSlot>
          <PanelFormulaBinder
            formulaId={(panelConfig as any).formula_id ?? (panelConfig as any).observation_id ?? null}
            onBind={(id) => onUpdatePanel({ formula_id: id, observation_id: undefined } as any)}
          />
          <RolePickerPopover
          schema={PANEL_ROLE_SCHEMAS.pie}
          availableSchemas={schemas}
          value={rolePickerValue}
          onChange={handleRolePickerChange}
          onOpenValueAliases={aliasTargetField ? () => setAliasManagerOpen(true) : undefined}
        />
      </PanelHeaderSlot>
      {showControls && (!selectedSchemaId || !selectedFieldKey) && (
        <div className="p-2">
          <EmptyStateCard
            reason={
              !selectedSchemaId
                ? { kind: 'no_schema' }
                : { kind: 'role_unfilled', roleLabel: 'Slice by' }
            }
          />
        </div>
      )}

      <div className="relative flex-1 min-h-0 rounded-b-md bg-muted/20 backdrop-blur supports-[backdrop-filter]:bg-background/40 border border-border/50">
        {showControls && (
          <div className="absolute left-2 top-2 z-20 rounded-md border border-border/70 bg-background/90 px-2 py-1 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/75">
            <div className="flex items-center gap-2">
              <Label htmlFor="pie-max-slices-select" className="text-xs font-medium whitespace-nowrap">Show slices</Label>
              <Select
                value={selectedMaxSlices?.toString() ?? SLICE_OPTIONS[1].value.toString()}
                onValueChange={(v) => handleMaxSlicesChange(v === 'Infinity' ? Infinity : parseInt(v))}
                disabled={!selectedSchemaId || !selectedFieldKey}
              >
                <SelectTrigger id="pie-max-slices-select" className="w-24 h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SLICE_OPTIONS.map(option => <SelectItem key={option.label} value={option.value.toString()}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        {isViewLoading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground animate-pulse">Loading...</p>
          </div>
        ) : selectedSchemaId && selectedFieldKey && pieDataMap['aggregated'] && pieDataMap['aggregated'].length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieDataMap['aggregated']}
                cx="50%"
                cy="50%"
                labelLine={false}
                outerRadius={120}
                fill="#8884d8"
                dataKey="value"
                nameKey="name"
                onClick={(data, index) => {
                  // eslint-disable-next-line no-console
                  console.log('[pie] onClick fired', { data, index });
                  handlePieSliceClick(data, index, 'aggregated');
                }}
                onMouseEnter={(data: any) => setHoveredSliceName(data.name)}
                onMouseLeave={() => setHoveredSliceName(null)}
                isAnimationActive={false}
              >
                {pieDataMap['aggregated'].map((entry, index) => (
                  <Cell
                    key={`cell-${index}-aggregated`}
                    fill={PIE_COLORS[index % PIE_COLORS.length]}
                    // Belt-and-suspenders: recharts' ``<Pie onClick>`` misses
                    // clicks in some versions because the tooltip's invisible
                    // overlay captures them. Wiring the click on each Cell
                    // as well guarantees at least one handler runs.
                    onClick={() => {
                      // eslint-disable-next-line no-console
                      console.log('[pie] Cell onClick fired', { index, name: entry.name });
                      handlePieSliceClick(entry, index, 'aggregated');
                    }}
                    style={{
                      transition: 'opacity 0.2s ease-in-out',
                      opacity: hoveredSliceName && hoveredSliceName !== entry.name ? 0.5 : 1,
                      cursor: 'pointer',
                    }}
                  />
                ))}
              </Pie>
              <RechartsTooltip content={<CustomTooltipContent />} />
              <Legend content={renderCustomLegend} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <EmptyStateCard
            className="h-full m-2"
            reason={
              !selectedSchemaId
                ? { kind: 'no_schema' }
                : !selectedFieldKey
                ? { kind: 'role_unfilled', roleLabel: 'Slice by' }
                : {
                    kind: 'no_data',
                    filtersActive:
                      (panelConfig.local_filters?.conditions?.length ?? 0) > 0 ||
                      (panelConfig.incoming_scopes?.length ?? 0) > 0,
                  }
            }
          />
        )}
      </div>

      {aliasTargetField && (
        <ValueAliasManager
          open={aliasManagerOpen}
          onOpenChange={setAliasManagerOpen}
          infospaceId={infospaceId}
          runId={runId}
          fieldPath={aliasTargetField}
          aliases={aliasesForField}
          schemaIds={selectedSchemaId ? [selectedSchemaId] : undefined}
          filters={mergedFilters}
          onSave={(next) => {
            const current = getGlobalVariableSplitting() ?? { enabled: true };
            setGlobalVariableSplitting({
              ...current,
              enabled: true,
              valueAliasesByField: {
                ...(current.valueAliasesByField ?? {}),
                [aliasTargetField]: next,
              },
            });
          }}
        />
      )}

      <EvidenceDrawer
        open={evidenceOpen}
        onOpenChange={setEvidenceOpen}
        infospaceId={infospaceId}
        runId={runId}
        scope={evidenceScope}
        baseFilters={panelConfig.local_filters}
        mergeMaps={effectiveMergeMapsForView}
        schemas={schemas}
      />

      {selectedSliceData && (
        <Dialog open={isDetailDialogOpen} onOpenChange={setIsDetailDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Details for: {selectedSliceData.name}</DialogTitle>
              <DialogDescription>
                Schema: {selectedSliceData.schema.name} | Field: {selectedSliceData.fieldKey} <br />
                Count: {selectedSliceData.value} ({selectedSliceData.percentage.toFixed(1)}%)
                {selectedSliceData.isOtherSlice && selectedSliceData.groupedCategories && (
                  <span className="text-xs block mt-1"> (Aggregates {selectedSliceData.groupedCategories.length} smaller categories)</span>
                )}
                {!selectedSliceData.isOtherSlice && selectedSliceData.documents.length > 0 && (
                  <span className="text-xs block mt-1">
                    {selectedSliceData.documents.length} asset{selectedSliceData.documents.length === 1 ? '' : 's'} —
                    click one to open the full content + results view.
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[60vh] p-1">
              <div className="space-y-3 pr-2">
                {selectedSliceData.isOtherSlice && selectedSliceData.groupedCategories && selectedSliceData.groupedCategories.length > 0 && (
                  <div className="mb-4 p-3 border rounded-md bg-muted/60">
                    <h4 className="font-medium text-sm mb-2">Categories in "Other":</h4>
                    <ScrollArea className="max-h-40">
                      <ul className="list-disc pl-5 space-y-1 text-xs">
                        {selectedSliceData.groupedCategories.map(cat => (
                          <li key={cat.name}>{cat.name}: {cat.value}</li>
                        ))}
                      </ul>
                    </ScrollArea>
                  </div>
                )}
                {!selectedSliceData.isOtherSlice && selectedSliceData.documents.length > 0 && (
                  <div className="space-y-1.5">
                    {selectedSliceData.documents.map((assetId) => (
                      <div
                        key={assetId}
                        className="border rounded px-3 py-2 hover:bg-muted/40 hover:border-primary/50 transition-colors"
                      >
                        <AssetLink
                          assetId={assetId}
                          className="text-sm font-medium hover:underline"
                        >
                          Asset #{assetId}
                        </AssetLink>
                      </div>
                    ))}
                  </div>
                )}
                {!selectedSliceData.isOtherSlice && selectedSliceData.documents.length === 0 && (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    No annotations matched this slice value in the fetched row set.
                  </div>
                )}
              </div>
            </ScrollArea>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDetailDialogOpen(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default AnnotationResultsPieChart;