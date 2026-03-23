'use client';

import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ZoomIn, ZoomOut, Maximize2, RotateCcw } from 'lucide-react';
import { resolveEntityColor, type ColorOverrides } from '@/lib/annotations/colors';

// Generic graph node interface (works for both run-scoped and curated graphs)
export interface GraphNode {
  id: string;
  label: string;
  type: string;
  frequency?: number;
  sourceAssetCount?: number;
  sourceAssetIds?: number[];
  aliases?: string[];
  properties?: Record<string, any>;
}

// Generic graph edge interface (works for both run-scoped and curated graphs)
export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  predicate: string;
  frequency?: number;
  weight?: number;
  confidence?: number;
  sourceAssetCount?: number;
  date?: string;
  context?: string;
  properties?: Record<string, any>;
}

export interface GraphViewConfig {
  // Interaction
  zoomOnNodeClick: boolean;       // default: true
  clickZoomScale: number;         // default: 1.5, range [1.0, 3.0]
  zoomTransitionMs: number;       // default: 300, range [0, 1000]
  
  // Layout / forces
  chargeStrength: number;         // default: -300, range [-1000, 0]
  linkDistance: number;            // default: 150, range [50, 400]
  warmupTicks: number;            // default: 100, range [0, 300]
  
  // Display
  showNodeLabels: boolean;        // default: true
  showEdgeLabels: boolean;        // default: true
  labelFontSize: number;          // default: 12, range [8, 20]
  
  // Fit
  autoFitOnLoad: boolean;         // default: true
}

export const defaultGraphViewConfig: GraphViewConfig = {
  zoomOnNodeClick: true,
  clickZoomScale: 1.5,
  zoomTransitionMs: 300,
  chargeStrength: -300,
  linkDistance: 150,
  warmupTicks: 100,
  showNodeLabels: true,
  showEdgeLabels: true,
  labelFontSize: 12,
  autoFitOnLoad: true,
};

interface D3ForceGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width?: number;
  height?: number;
  highlightedNodeId?: string | null;
  connectedNodeIds?: string[];
  mergeSelectedNodeIds?: string[]; // Nodes selected for merge (shift+click)
  onNodeClick?: (node: GraphNode) => void;
  onNodeShiftClick?: (node: GraphNode) => void; // Shift+click for merge selection
  onEdgeClick?: (edge: GraphEdge) => void;
  autoResize?: boolean; // If true, uses ResizeObserver to fill container
  config?: Partial<GraphViewConfig>; // Optional config override
  colorOverrides?: ColorOverrides; // Schema/infospace color overrides
}

function detectFields(edges: GraphEdge[]): string[] {
  if (edges.length === 0) return [];
  
  const availableFields = new Set<string>();
  edges.forEach(edge => {
    if (edge.properties) {
      Object.keys(edge.properties).forEach(key => {
        if (['weight', 'confidence', 'date', 'context'].includes(key)) {
          availableFields.add(key);
        }
      });
    }
    // Also check direct properties
    if (edge.weight !== undefined) availableFields.add('weight');
    if (edge.confidence !== undefined) availableFields.add('confidence');
    if (edge.date !== undefined) availableFields.add('date');
    if (edge.context !== undefined) availableFields.add('context');
  });
  
  return Array.from(availableFields);
}

// Get entity type color - now uses shared color system
// This function is kept for backward compatibility but delegates to resolveEntityColor
function getEntityTypeColor(type: string, overrides?: ColorOverrides): string {
  return resolveEntityColor(type, overrides);
}

// Build a degree lookup map from edges (pure function)
function buildDegreeMap(edges: GraphEdge[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of edges) {
    map.set(e.sourceId, (map.get(e.sourceId) ?? 0) + 1);
    map.set(e.targetId, (map.get(e.targetId) ?? 0) + 1);
  }
  return map;
}

// Build an edge-width function from edge data (pure function)
function buildEdgeWidthFn(edges: GraphEdge[], availableFields: string[]): (edge: GraphEdge) => number {
  if (availableFields.includes('weight')) {
    const weights = edges.map(e => e.weight ?? e.properties?.weight ?? 1) as number[];
    if (weights.length === 0) return () => 2;
    const minW = Math.min(...weights);
    const maxW = Math.max(...weights);
    const scale = d3.scaleLinear().domain([minW, maxW]).range([1, 8]);
    return (edge: GraphEdge) => scale(edge.weight ?? edge.properties?.weight ?? 1);
  }
  if (edges.some(e => e.frequency !== undefined)) {
    const freqs = edges.map(e => e.frequency ?? 1).filter(f => f > 0);
    if (freqs.length > 0) {
      const minF = Math.min(...freqs);
      const maxF = Math.max(...freqs);
      const scale = d3.scaleLinear().domain([minF, maxF]).range([1, 5]);
      return (edge: GraphEdge) => scale(edge.frequency ?? 1);
    }
  }
  return () => 2;
}

export function D3ForceGraph({
  nodes,
  edges,
  width: propWidth = 800,
  height: propHeight = 600,
  highlightedNodeId = null,
  connectedNodeIds = [],
  mergeSelectedNodeIds = [],
  onNodeClick,
  onNodeShiftClick,
  onEdgeClick,
  autoResize = false,
  config: configOverride = {},
  colorOverrides,
}: D3ForceGraphProps) {
  // Merge config with defaults
  const config: GraphViewConfig = useMemo(() => ({
    ...defaultGraphViewConfig,
    ...configOverride,
  }), [configOverride]);

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: propWidth, height: propHeight });

  // D3 selection refs (survive across effects)
  const simulationRef = useRef<d3.Simulation<any, any> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const gRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const nodeSelRef = useRef<d3.Selection<SVGCircleElement, any, SVGGElement, unknown> | null>(null);
  const nodeLabelSelRef = useRef<d3.Selection<SVGTextElement, any, SVGGElement, unknown> | null>(null);
  const linkSelRef = useRef<d3.Selection<SVGLineElement, any, SVGGElement, unknown> | null>(null);
  const linkLabelSelRef = useRef<d3.Selection<SVGTextElement, any, SVGGElement, unknown> | null>(null);

  // Track whether we've done the initial build (to distinguish resize from first paint)
  const hasBuiltRef = useRef(false);

  // Refs for volatile callbacks (never in any dep array)
  const onNodeClickRef = useRef(onNodeClick);
  const onNodeShiftClickRef = useRef(onNodeShiftClick);
  const onEdgeClickRef = useRef(onEdgeClick);
  useEffect(() => { onNodeClickRef.current = onNodeClick; }, [onNodeClick]);
  useEffect(() => { onNodeShiftClickRef.current = onNodeShiftClick; }, [onNodeShiftClick]);
  useEffect(() => { onEdgeClickRef.current = onEdgeClick; }, [onEdgeClick]);

  // Refs for volatile visual params (used by Effect 2, never rebuild simulation)
  const highlightedNodeIdRef = useRef(highlightedNodeId);
  const connectedNodeIdsRef = useRef(connectedNodeIds);
  const mergeSelectedNodeIdsRef = useRef(mergeSelectedNodeIds);
  useEffect(() => { highlightedNodeIdRef.current = highlightedNodeId; }, [highlightedNodeId]);
  useEffect(() => { connectedNodeIdsRef.current = connectedNodeIds; }, [connectedNodeIds]);
  useEffect(() => { mergeSelectedNodeIdsRef.current = mergeSelectedNodeIds; }, [mergeSelectedNodeIds]);

  // Build legend from unique entity types in nodes
  const entityTypeLegend = useMemo(() => {
    const typeSet = new Set<string>();
    nodes.forEach(n => {
      if (n.type) typeSet.add(n.type.toUpperCase());
    });
    return Array.from(typeSet).sort().map(type => ({
      type,
      color: getEntityTypeColor(type, colorOverrides),
    }));
  }, [nodes, colorOverrides]);

  // --- Auto-resize with debounce ---
  useEffect(() => {
    if (!autoResize || !containerRef.current) return;
    let timeout: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver((entries) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        for (const entry of entries) {
          const { width: w, height: h } = entry.contentRect;
          if (w > 0 && h > 0) {
            setDimensions(prev => {
              if (prev.width === w && prev.height === h) return prev; // avoid no-op
              return { width: w, height: h };
            });
          }
        }
      }, 100);
    });
    ro.observe(containerRef.current);
    return () => { clearTimeout(timeout); ro.disconnect(); };
  }, [autoResize]);

  const width = autoResize ? dimensions.width : propWidth;
  const height = autoResize ? dimensions.height : propHeight;

  // --- Stable data derivations (only change when edges change) ---
  const availableFields = useMemo(() => detectFields(edges), [edges]);
  const degreeMap = useMemo(() => buildDegreeMap(edges), [edges]);
  const edgeWidthFn = useMemo(() => buildEdgeWidthFn(edges, availableFields), [edges, availableFields]);

  // --- Compute fit transform (reads current width/height from refs, not a dep) ---
  const widthRef = useRef(width);
  const heightRef = useRef(height);
  useEffect(() => { widthRef.current = width; }, [width]);
  useEffect(() => { heightRef.current = height; }, [height]);

  const computeFitTransform = useCallback((simNodes: any[], padding: number = 50) => {
    const w = widthRef.current;
    const h = heightRef.current;
    if (simNodes.length === 0 || w <= 0 || h <= 0) return d3.zoomIdentity;
    const xs = simNodes.map((n: any) => n.x ?? 0).filter((x: number) => !isNaN(x));
    const ys = simNodes.map((n: any) => n.y ?? 0).filter((y: number) => !isNaN(y));
    if (xs.length === 0 || ys.length === 0) return d3.zoomIdentity;
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const gw = maxX - minX, gh = maxY - minY;
    if (gw === 0 && gh === 0) {
      // Single node: center it
      return d3.zoomIdentity.translate(w / 2 - minX, h / 2 - minY);
    }
    const scale = Math.min(
      gw > 0 ? (w - padding * 2) / gw : 1,
      gh > 0 ? (h - padding * 2) / gh : 1,
      1.5
    );
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    return d3.zoomIdentity.translate(w / 2 - scale * cx, h / 2 - scale * cy).scale(scale);
  }, []);

  // ==========================================================================
  // EFFECT A: Build simulation + SVG elements (ONLY when data or force config changes)
  // Does NOT depend on width/height. Simulation works in abstract coordinate space.
  // ==========================================================================
  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;
    hasBuiltRef.current = false;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // We set viewBox in Effect B; here just ensure SVG is clean
    // Create zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        if (gRef.current) {
          gRef.current.attr('transform', event.transform.toString());
        }
      });
    zoomRef.current = zoom;
    svg.call(zoom);

    const g = svg.append('g').attr('class', 'zoom-container');
    gRef.current = g;

    // Prepare simulation data — positions centered around origin (0,0)
    const simNodes = nodes.map((n, i) => ({
      ...n,
      index: i,
      x: (Math.random() - 0.5) * 300,
      y: (Math.random() - 0.5) * 300,
    }));

    const simLinks = edges.map(e => {
      const si = nodes.findIndex(n => n.id === e.sourceId);
      const ti = nodes.findIndex(n => n.id === e.targetId);
      return { source: si >= 0 ? si : 0, target: ti >= 0 ? ti : 0, predicate: e.predicate, edge: e };
    }).filter(l => l.source !== l.target);

    // Build simulation, run to convergence synchronously, then stop
    const sim = d3.forceSimulation(simNodes as any)
      .force('link', d3.forceLink(simLinks).id((d: any) => d.index).distance(config.linkDistance))
      .force('charge', d3.forceManyBody().strength(config.chargeStrength))
      .force('center', d3.forceCenter(0, 0))
      .force('collision', d3.forceCollide().radius(40))
      .alphaDecay(0.03)
      .velocityDecay(0.4)
      .stop();

    sim.alpha(1);
    const ticks = Math.max(config.warmupTicks, 300);
    for (let i = 0; i < ticks; i++) sim.tick();

    simulationRef.current = sim;

    // --- Build SVG at converged positions ---
    const link = g.append('g').selectAll('line').data(simLinks).enter().append('line')
      .attr('stroke', '#999')
      .attr('stroke-opacity', 1)
      .attr('stroke-width', (d: any) => edgeWidthFn(d.edge))
      .attr('x1', (d: any) => d.source.x ?? 0)
      .attr('y1', (d: any) => d.source.y ?? 0)
      .attr('x2', (d: any) => d.target.x ?? 0)
      .attr('y2', (d: any) => d.target.y ?? 0)
      .attr('cursor', 'pointer')
      .on('click', (event: any, d: any) => {
        event.stopPropagation();
        onEdgeClickRef.current?.(d.edge);
      });
    linkSelRef.current = link;

    const linkLabels = g.append('g').selectAll('text').data(simLinks).enter().append('text')
      .attr('font-size', `${config.labelFontSize - 2}px`)
      .attr('fill', '#666')
      .text((d: any) => d.predicate)
      .attr('x', (d: any) => ((d.source.x ?? 0) + (d.target.x ?? 0)) / 2)
      .attr('y', (d: any) => ((d.source.y ?? 0) + (d.target.y ?? 0)) / 2)
      .style('pointer-events', 'none')
      .style('opacity', config.showEdgeLabels ? 1 : 0);
    linkLabelSelRef.current = linkLabels;

    const node = g.append('g').selectAll('circle').data(simNodes).enter().append('circle')
      .attr('r', (d: any) => Math.max(12, Math.min(30, 12 + (degreeMap.get(d.id) ?? 0) * 1.5)))
      .attr('fill', (d: any) => getEntityTypeColor(d.type, colorOverrides))
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .attr('cx', (d: any) => d.x ?? 0)
      .attr('cy', (d: any) => d.y ?? 0)
      .attr('cursor', 'pointer')
      .call(
        d3.drag<SVGCircleElement, any>()
          .on('start', (event: any, d: any) => {
            if (!event.active && simulationRef.current) {
              simulationRef.current.alphaTarget(0.3).restart();
            }
            d.fx = d.x; d.fy = d.y;
          })
          .on('drag', (event: any, d: any) => { d.fx = event.x; d.fy = event.y; })
          .on('end', (event: any, d: any) => {
            if (!event.active && simulationRef.current) {
              simulationRef.current.alphaTarget(0);
            }
            d.fx = null; d.fy = null;
          })
      )
      .on('click', (event: any, d: any) => {
        event.stopPropagation();
        if (event.shiftKey && onNodeShiftClickRef.current) {
          onNodeShiftClickRef.current(d);
        } else {
          onNodeClickRef.current?.(d);
        }
      });
    nodeSelRef.current = node;

    const nodeLabels = g.append('g').selectAll('text').data(simNodes).enter().append('text')
      .attr('font-size', `${config.labelFontSize}px`)
      .attr('font-weight', 'bold')
      .attr('fill', '#333')
      .text((d: any) => d.label)
      .attr('x', (d: any) => d.x ?? 0)
      .attr('y', (d: any) => (d.y ?? 0) + 5)
      .style('pointer-events', 'none')
      .style('opacity', config.showNodeLabels ? 1 : 0);
    nodeLabelSelRef.current = nodeLabels;

    // Tick handler for drag only
    const updatePos = () => {
      linkSelRef.current
        ?.attr('x1', (d: any) => d.source.x ?? 0)
        .attr('y1', (d: any) => d.source.y ?? 0)
        .attr('x2', (d: any) => d.target.x ?? 0)
        .attr('y2', (d: any) => d.target.y ?? 0);
      linkLabelSelRef.current
        ?.attr('x', (d: any) => ((d.source.x ?? 0) + (d.target.x ?? 0)) / 2)
        .attr('y', (d: any) => ((d.source.y ?? 0) + (d.target.y ?? 0)) / 2);
      nodeSelRef.current
        ?.attr('cx', (d: any) => d.x ?? 0)
        .attr('cy', (d: any) => d.y ?? 0);
      nodeLabelSelRef.current
        ?.attr('x', (d: any) => d.x ?? 0)
        .attr('y', (d: any) => (d.y ?? 0) + 5);
    };
    sim.on('tick', updatePos);

    hasBuiltRef.current = true;

    // Immediately fit to current viewport
    const w = widthRef.current;
    const h = heightRef.current;
    if (w > 0 && h > 0) {
      svg.attr('viewBox', `0 0 ${w} ${h}`);
      if (config.autoFitOnLoad) {
        svg.call(zoom.transform as any, computeFitTransform(simNodes));
      }
    }

    return () => { sim.stop(); };
    // Only rebuild when actual graph data or force params change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, config.linkDistance, config.chargeStrength, config.warmupTicks,
      config.showNodeLabels, config.showEdgeLabels, config.labelFontSize,
      config.autoFitOnLoad, edgeWidthFn, degreeMap, computeFitTransform]);

  // ==========================================================================
  // EFFECT B: Viewport reframe (runs when width/height change, NOT rebuilding sim)
  // Only updates the SVG viewBox so D3 zoom knows the coordinate space.
  // Does NOT reset the zoom transform — user's pan/zoom is preserved.
  // User can click "Fit to Content" to re-center after a resize.
  // ==========================================================================
  useEffect(() => {
    if (!svgRef.current || !hasBuiltRef.current) return;
    if (width <= 0 || height <= 0) return;

    d3.select(svgRef.current).attr('viewBox', `0 0 ${width} ${height}`);
  }, [width, height]);

  // ==========================================================================
  // EFFECT C: Highlight visual updates (no simulation rebuild)
  // ==========================================================================
  useEffect(() => {
    if (!nodeSelRef.current || !nodeLabelSelRef.current) return;
    const hId = highlightedNodeId;
    const cIds = connectedNodeIds;
    const mIds = mergeSelectedNodeIds;

    nodeSelRef.current
      .attr('r', (d: any) => {
        const deg = degreeMap.get(d.id) ?? 0;
        const base = hId === d.id ? 20 : 12;
        return Math.max(base, Math.min(30, base + deg * 1.5));
      })
      .attr('fill', (d: any) => {
        const c = getEntityTypeColor(d.type, colorOverrides);
        if (mIds.includes(d.id)) return d3.color(c)?.brighter(0.3)?.toString() || c;
        if (hId === d.id) return d3.color(c)?.brighter(0.5)?.toString() || c;
        if (cIds.includes(d.id)) return d3.color(c)?.brighter(0.2)?.toString() || c;
        if (hId && !cIds.includes(d.id)) return d3.color(c)?.darker(0.5)?.toString() || c;
        return c;
      })
      .attr('stroke', (d: any) => {
        if (mIds.includes(d.id)) return '#f59e0b'; // amber for merge selection
        if (hId === d.id) return '#2563eb';
        if (cIds.includes(d.id)) return '#10b981';
        return '#fff';
      })
      .attr('stroke-width', (d: any) => mIds.includes(d.id) ? 4 : (hId === d.id) ? 3 : 2)
      .attr('opacity', (d: any) => (hId && hId !== d.id && !cIds.includes(d.id) && !mIds.includes(d.id)) ? 0.4 : 1);

    nodeLabelSelRef.current
      .attr('fill', (d: any) => {
        if (mIds.includes(d.id)) return '#92400e'; // amber-800
        if (hId && hId !== d.id && !cIds.includes(d.id)) return '#999';
        return '#333';
      });

    if (linkSelRef.current) {
      linkSelRef.current
        .attr('stroke-opacity', (d: any) => {
          if (!hId) return 1;
          const edge = d.edge as GraphEdge;
          return (edge.sourceId === hId || edge.targetId === hId) ? 1 : 0.2;
        });
    }
  }, [highlightedNodeId, connectedNodeIds, mergeSelectedNodeIds, degreeMap]);

  // ==========================================================================
  // EFFECT D: Zoom to highlighted node
  // ==========================================================================
  useEffect(() => {
    if (!config.zoomOnNodeClick || !highlightedNodeId) return;
    if (!simulationRef.current || !zoomRef.current || !svgRef.current) return;
    const nd = simulationRef.current.nodes().find((d: any) => d.id === highlightedNodeId);
    if (!nd || nd.x === undefined || nd.y === undefined) return;
    const w = widthRef.current, h = heightRef.current;
    const s = config.clickZoomScale;
    const svg = d3.select(svgRef.current);
    svg.transition()
      .duration(config.zoomTransitionMs)
      .call(zoomRef.current.transform as any,
        d3.zoomIdentity.translate(w / 2 - s * nd.x, h / 2 - s * nd.y).scale(s));
  }, [highlightedNodeId, config.zoomOnNodeClick, config.clickZoomScale, config.zoomTransitionMs]);

  // --- Zoom button handlers ---
  const handleZoomIn = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    const svg = d3.select(svgRef.current);
    const t = d3.zoomTransform(svg.node()!);
    svg.transition().duration(200).call(zoomRef.current.transform as any, t.scale(1.3));
  }, []);

  const handleZoomOut = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    const svg = d3.select(svgRef.current);
    const t = d3.zoomTransform(svg.node()!);
    svg.transition().duration(200).call(zoomRef.current.transform as any, t.scale(1 / 1.3));
  }, []);

  const handleFitToContent = useCallback(() => {
    if (!simulationRef.current || !svgRef.current || !zoomRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.transition().duration(400)
      .call(zoomRef.current.transform as any, computeFitTransform(simulationRef.current.nodes()));
  }, [computeFitTransform]);

  const handleResetView = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current).transition().duration(300)
      .call(zoomRef.current.transform as any, d3.zoomIdentity);
  }, []);

  // --- Detect fields for display ---
  const availableFieldsList = useMemo(() => detectFields(edges), [edges]);

  return (
    <div ref={containerRef} className="w-full h-full">
      <Card className="h-full">
        <CardContent className="p-0 relative h-full">
          <svg
            ref={svgRef}
            style={{ border: '1px solid #e0e0e0', borderRadius: '4px', width: '100%', height: '100%' }}
          />
          {/* Zoom Controls */}
          <div className="absolute bottom-2 left-2 bg-white/95 p-1 rounded shadow-md flex flex-row gap-1 z-20">
            <Button variant="ghost" size="sm" onClick={handleZoomIn} className="h-8 w-8 p-0" title="Zoom In">
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={handleZoomOut} className="h-8 w-8 p-0" title="Zoom Out">
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={handleFitToContent} className="h-8 w-8 p-0" title="Fit to Content">
              <Maximize2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={handleResetView} className="h-8 w-8 p-0" title="Reset View">
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
          {/* Legend */}
          {entityTypeLegend.length > 0 && (
            <div className="absolute top-2 right-2 bg-white/90 dark:bg-gray-900/90 p-2 rounded shadow-md text-xs">
              <div className="font-semibold mb-1">Entity Types</div>
              <div className="space-y-1">
                {entityTypeLegend.map(({ type, color }) => (
                  <div key={type} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }}></div>
                    <span>{type}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {availableFieldsList.length > 0 && (
            <div className="absolute bottom-2 right-2 bg-white/90 p-2 rounded shadow-md text-xs text-muted-foreground">
              Detected fields: {availableFieldsList.join(', ')}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
