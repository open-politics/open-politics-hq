'use client';

import React, { useState, useMemo, useCallback, useRef } from 'react';
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
import type { Panel, PieVizConfig } from '@/lib/annotations/types';
import AssetLink from '../assets/Helper/AssetLink';
import { useAnnotationView } from '@/hooks/useAnnotationView';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { GroupedDataPoint } from './AnnotationResultsChart';
import { PanelHeaderSlot } from './panels/PanelHeaderSlot';
import { EmptyStateCard } from './panels/EmptyStateCard';
import { EvidenceDrawer } from './panels/EvidenceDrawer';
import { createScopeFromSelection } from '@/lib/annotations/scopes';
import type { Scope } from '@/lib/annotations/types';

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
  panelConfig: Panel;
  onUpdatePanel: (updates: Partial<Panel>) => void;
  showControls?: boolean;
  /** Unused in new architecture — kept for PanelRenderer call-site compat. */
  onResultSelect?: (result: any) => void;
  /** Unused in new architecture — kept for PanelRenderer call-site compat. */
  onFieldInteraction?: (result: any, fieldKey: string) => void;
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
  onScopeGesture,
}) => {
  // --- Read visual roles from panel_config ---------------------------------
  const cfg = panelConfig.panel_config as PieVizConfig;
  const sliceBy = cfg.slice_by ?? null;
  const valueMeasure = cfg.value ?? null;
  const facetBy = cfg.facet ?? null;

  // Display knob: max_slices lives on panel_config. Sentinels:
  //   number   → cap to that many slices (5/10/15)
  //   null     → "All" (no cap; renders every slice)
  //   undefined → never set; default to 10 (sensible first run)
  const maxSlicesFromConfig: number | null =
    cfg.max_slices === undefined ? SLICE_OPTIONS[1].value : cfg.max_slices;

  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
  const [selectedSliceData, setSelectedSliceData] = useState<SelectedSliceDetails | null>(null);
  const [hoveredSliceName, setHoveredSliceName] = useState<string | null>(null);

  // Evidence drawer — click a slice to drill into the annotations that
  // contributed to it.
  const [evidenceScope, setEvidenceScope] = useState<Scope | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  // Stable ref for panelConfig values (used by handlers)
  const panelConfigRef = useRef(panelConfig);
  panelConfigRef.current = panelConfig;

  const handleMaxSlicesChange = useCallback((value: number) => {
    const pc = panelConfigRef.current;
    onUpdatePanel({
      panel_config: { ...(pc.panel_config as PieVizConfig), max_slices: value === Infinity ? null : value },
    } as any);
  }, [onUpdatePanel]);

  // --- Data fetching -------------------------------------------------------
  // Requires slice_by to be configured; value defaults to 'count' if absent.
  const isConfigured = !!sliceBy;

  const { data: viewData, isLoading: isViewLoading } = useAnnotationView({
    infospaceId,
    runId,
    panel: panelConfig,
    schemas,
    incoming_scopes: panelConfig.scopes_in,
    merge_maps: panelConfig.merge_maps,
    aggregate: {},
    enabled: !!runId && !!infospaceId && isConfigured,
  });

  // --- Map OutputRelation rows → pie chart data ----------------------------
  // OutputRelation row shape: { keys: { <dim>: <val> }, measures: { <name>: <val> } }
  // - slice label  = row.keys[sliceBy]
  // - slice value  = row.measures[valueMeasure ?? 'count'] (fall back to first measure)
  // - facet key    = row.keys[facetBy] when facet is set

  const { pieDataMap, groupedForOtherSliceMap } = useMemo((): {
    pieDataMap: Record<string, PieDataPoint[]>;
    groupedForOtherSliceMap: Record<string, PieDataPoint[] | undefined>;
  } => {
    const rows = viewData?.aggregate?.rows;
    if (!rows || rows.length === 0 || !sliceBy) {
      return { pieDataMap: {}, groupedForOtherSliceMap: {} };
    }

    // Determine which measure name to use for sizing
    const measureKey = valueMeasure
      ?? viewData?.aggregate?.measure_names?.[0]
      ?? 'count';

    // Build per-facet category lists. When no facet, everything goes into the
    // sentinel key 'aggregated'.
    const byFacet = new Map<string, PieDataPoint[]>();
    for (const row of rows) {
      const sliceLabel = String(row.keys[sliceBy] ?? 'N/A');
      const rawVal = row.measures[measureKey];
      const sliceValue = typeof rawVal === 'number' ? rawVal : Number(rawVal) || 0;
      const facetKey = facetBy ? String(row.keys[facetBy] ?? 'N/A') : 'aggregated';

      let bucket = byFacet.get(facetKey);
      if (!bucket) { bucket = []; byFacet.set(facetKey, bucket); }
      bucket.push({ name: sliceLabel, value: sliceValue });
    }

    const maxSlices = maxSlicesFromConfig ?? Infinity;

    const resultData: Record<string, PieDataPoint[]> = {};
    const resultOther: Record<string, PieDataPoint[] | undefined> = {};

    for (const [facetKey, categories] of byFacet.entries()) {
      const sorted = [...categories].sort((a, b) => b.value - a.value);

      if (maxSlices === Infinity || sorted.length <= maxSlices) {
        resultData[facetKey] = sorted;
        resultOther[facetKey] = undefined;
      } else {
        const topN = sorted.slice(0, maxSlices - 1);
        const others = sorted.slice(maxSlices - 1);
        const otherSum = others.reduce((acc, curr) => acc + curr.value, 0);
        resultData[facetKey] = [...topN, { name: 'Other', value: otherSum }];
        resultOther[facetKey] = others;
      }
    }

    return { pieDataMap: resultData, groupedForOtherSliceMap: resultOther };
  }, [viewData?.aggregate?.rows, viewData?.aggregate?.measure_names, sliceBy, valueMeasure, facetBy, maxSlicesFromConfig]);

  const facetKeys = useMemo(() => Object.keys(pieDataMap), [pieDataMap]);

  // --- Slice click handler -------------------------------------------------
  const handlePieSliceClick = useCallback((data: any, index: number, facetKey: string) => {
    const currentPieData = pieDataMap[facetKey];
    const currentGroupedForOther = groupedForOtherSliceMap[facetKey];

    if (!sliceBy || !currentPieData || !currentPieData[index]) return;

    const clickedSliceName = currentPieData[index].name;
    const isOtherSlice = clickedSliceName === 'Other';
    const totalValues = currentPieData.reduce((sum, item) => sum + item.value, 0);
    const percentage = totalValues > 0 ? (currentPieData[index].value / totalValues) * 100 : 0;

    const pointForDialog: GroupedDataPoint = {
      valueString: clickedSliceName,
      totalCount: currentPieData[index].value,
      sourceDocuments: new Map(),
      schemeName: '',
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
        isOtherSlice,
        groupedCategories: currentGroupedForOther,
        pointForDialog,
      });
      setIsDetailDialogOpen(true);
      return;
    }

    // Real slice → open the EvidenceDrawer with a scope equality on the
    // slice's field value.
    const scope = createScopeFromSelection(
      panelConfig.id,
      { type: 'click', fieldPath: sliceBy, data: clickedSliceName },
      panelConfig,
      'push',
    );
    // eslint-disable-next-line no-console
    console.log('[pie] opening evidence drawer', {
      sliceName: clickedSliceName,
      fieldPath: sliceBy,
      scopeId: scope.id,
    });
    setEvidenceScope(scope);
    setEvidenceOpen(true);

    if (onScopeGesture) {
      onScopeGesture(sliceBy, clickedSliceName, 'click');
    }
  }, [sliceBy, pieDataMap, groupedForOtherSliceMap, onScopeGesture, panelConfig]);

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

  // Determine whether we have any data to render across all facets
  const hasData = facetKeys.some((k) => (pieDataMap[k]?.length ?? 0) > 0);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header slot empty — display knobs render inline as a canvas
          overlay (top-right) so the panel header stays clean. The config
          popover handles roles + filter only. */}
      <PanelHeaderSlot>{null}</PanelHeaderSlot>

      {showControls && !isConfigured && (
        <div className="p-2">
          <EmptyStateCard reason={{ kind: 'role_unfilled', roleLabel: 'Slice by' }} />
        </div>
      )}

      <div className="relative flex-1 min-h-0 rounded-b-md bg-muted/20 backdrop-blur supports-[backdrop-filter]:bg-background/40 border border-border/50">
        {/* Inline display knob — Top-N slices selector. Floats over the
            canvas top-right. */}
        {showControls && isConfigured && (
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 bg-background/80 backdrop-blur-sm rounded border px-2 py-1">
            <Label htmlFor="pie-max-slices-select" className="text-[10px] text-muted-foreground whitespace-nowrap">Slices</Label>
            <Select
              value={(maxSlicesFromConfig ?? Infinity).toString()}
              onValueChange={(v) => handleMaxSlicesChange(v === 'Infinity' ? Infinity : parseInt(v))}
            >
              <SelectTrigger id="pie-max-slices-select" className="w-20 h-6 text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SLICE_OPTIONS.map(option => <SelectItem key={option.label} value={option.value.toString()}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {isViewLoading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground animate-pulse">Loading...</p>
          </div>
        ) : isConfigured && hasData ? (
          // Small multiples when facet is set — one pie per facet value.
          // Falls back to a single centered pie when no facet.
          //
          // Sizing strategy:
          //  - Single pie  → fills the panel ('h-full' on inner; ResponsiveContainer 100%)
          //  - Facetted    → tight grid; each cell holds title + pie. The
          //    legend is suppressed on small multiples — colors stay
          //    consistent across cells so the eye reads them via the
          //    cells' titles, not a duplicated per-pie legend.
          //
          // ``items-stretch`` (instead of content-start) lets cells span
          // the full row height so pies don't get cropped when the panel
          // is taller than the natural row size. ``auto-rows-[220px]``
          // fixes the row height so 4 small-multiples don't accidentally
          // form a 1×4 column when the panel is narrow.
          <div className={`h-full ${facetKeys.length > 1 ? 'grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] auto-rows-[220px] gap-2 overflow-auto p-2 items-stretch' : ''}`}>
            {facetKeys.map((facetKey) => {
              const pieData = pieDataMap[facetKey];
              if (!pieData || pieData.length === 0) return null;
              const isFacetted = facetKeys.length > 1;
              return (
                <div key={facetKey} className={isFacetted ? 'flex flex-col min-h-0 h-full overflow-hidden' : 'flex flex-col min-h-0 h-full'}>
                  {isFacetted && (
                    <p className="text-[11px] font-medium text-muted-foreground px-1 pt-1 pb-0.5 truncate flex-shrink-0" title={facetKey}>
                      {facetKey}
                    </p>
                  )}
                  <div className="flex-1 min-h-0">
                    <ResponsiveContainer width="100%" height="100%">
                    <PieChart margin={isFacetted ? { top: 0, right: 0, bottom: 0, left: 0 } : undefined}>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        outerRadius={isFacetted ? '80%' : 120}
                        fill="#8884d8"
                        dataKey="value"
                        nameKey="name"
                        onClick={(data, index) => {
                          // eslint-disable-next-line no-console
                          console.log('[pie] onClick fired', { data, index, facetKey });
                          handlePieSliceClick(data, index, facetKey);
                        }}
                        onMouseEnter={(data: any) => setHoveredSliceName(data.name)}
                        onMouseLeave={() => setHoveredSliceName(null)}
                        isAnimationActive={false}
                      >
                        {pieData.map((entry, index) => (
                          <Cell
                            key={`cell-${index}-${facetKey}`}
                            fill={PIE_COLORS[index % PIE_COLORS.length]}
                            // Belt-and-suspenders: recharts' ``<Pie onClick>`` misses
                            // clicks in some versions because the tooltip's invisible
                            // overlay captures them. Wiring the click on each Cell
                            // as well guarantees at least one handler runs.
                            onClick={() => {
                              // eslint-disable-next-line no-console
                              console.log('[pie] Cell onClick fired', { index, name: entry.name, facetKey });
                              handlePieSliceClick(entry, index, facetKey);
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
                      {/* Legend in single mode only — small-multiples
                          drop the legend so the pie fills the cell.
                          Colors stay consistent (palette index = slice
                          order) so the eye reads slices across cells. */}
                      {!isFacetted && <Legend content={renderCustomLegend} />}
                    </PieChart>
                  </ResponsiveContainer>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyStateCard
            className="h-full m-2"
            reason={
              !isConfigured
                ? { kind: 'role_unfilled', roleLabel: 'Slice by' }
                : {
                    kind: 'no_data',
                    filtersActive: (panelConfig.scopes_in?.length ?? 0) > 0,
                  }
            }
          />
        )}
      </div>

      <EvidenceDrawer
        open={evidenceOpen}
        onOpenChange={setEvidenceOpen}
        infospaceId={infospaceId}
        runId={runId}
        scope={evidenceScope}
        mergeMaps={panelConfig.merge_maps}
        schemas={schemas}
      />

      {selectedSliceData && (
        <Dialog open={isDetailDialogOpen} onOpenChange={setIsDetailDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Details for: {selectedSliceData.name}</DialogTitle>
              <DialogDescription>
                Count: {selectedSliceData.value} ({selectedSliceData.percentage.toFixed(1)}%)
                {selectedSliceData.isOtherSlice && selectedSliceData.groupedCategories && (
                  <span className="text-xs block mt-1"> (Aggregates {selectedSliceData.groupedCategories.length} smaller categories)</span>
                )}
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[60vh] p-1">
              <div className="space-y-3 pr-2">
                {selectedSliceData.isOtherSlice && selectedSliceData.groupedCategories && selectedSliceData.groupedCategories.length > 0 && (
                  <div className="mb-4 p-3 border rounded-md bg-muted/60">
                    <h4 className="font-medium text-sm mb-2">Categories in &ldquo;Other&rdquo;:</h4>
                    <ScrollArea className="max-h-40">
                      <ul className="list-disc pl-5 space-y-1 text-xs">
                        {selectedSliceData.groupedCategories.map(cat => (
                          <li key={cat.name}>{cat.name}: {cat.value}</li>
                        ))}
                      </ul>
                    </ScrollArea>
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
