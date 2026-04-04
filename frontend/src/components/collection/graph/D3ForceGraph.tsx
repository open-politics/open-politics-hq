'use client';

import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { Button } from '@/components/ui/button';
import { ZoomIn, ZoomOut, Maximize2, RotateCcw } from 'lucide-react';
import { resolveEntityColor, resolvePredicateColor, type ColorOverrides } from '@/lib/annotations/colors';
import { getEntityIconPaths } from './entityTypeIcons';

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
  zoomOnNodeClick: boolean;
  clickZoomScale: number;
  zoomTransitionMs: number;

  // Layout / forces
  chargeStrength: number;
  linkDistance: number;
  warmupTicks: number;

  // Display
  showNodeLabels: boolean;
  showEdgeLabels: boolean;
  labelFontSize: number;
  showEdgeArrows: boolean;
  showNodeIcons: boolean;

  // Clustering
  clusterByType: boolean;
  clusterStrength: number;

  // Edge display
  edgeColorMode: 'uniform' | 'predicate';
  edgeWidthField: 'auto' | 'none' | string;  // 'auto', 'none', or any numeric field name

  // Fit
  autoFitOnLoad: boolean;
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
  showEdgeArrows: true,
  showNodeIcons: true,
  clusterByType: false,
  clusterStrength: 0.3,
  edgeColorMode: 'uniform',
  edgeWidthField: 'auto',
  autoFitOnLoad: true,
};

interface D3ForceGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width?: number;
  height?: number;
  highlightedNodeId?: string | null;
  connectedNodeIds?: string[];
  mergeSelectedNodeIds?: string[];
  onNodeClick?: (node: GraphNode) => void;
  onNodeShiftClick?: (node: GraphNode) => void;
  onEdgeClick?: (edge: GraphEdge) => void;
  autoResize?: boolean;
  config?: Partial<GraphViewConfig>;
  colorOverrides?: ColorOverrides;
  // Filtering
  hiddenEntityTypes?: Set<string>;
  hiddenPredicates?: Set<string>;
  onToggleEntityType?: (type: string) => void;
  // Icons
  typeIcons?: Record<string, string>;
  // Per-predicate arrow direction
  predicateArrows?: Record<string, 'forward' | 'backward' | 'both' | 'none'>;
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
    if (edge.weight !== undefined) availableFields.add('weight');
    if (edge.confidence !== undefined) availableFields.add('confidence');
    if (edge.date !== undefined) availableFields.add('date');
    if (edge.context !== undefined) availableFields.add('context');
  });
  return Array.from(availableFields);
}

function getEntityTypeColor(type: string, overrides?: ColorOverrides): string {
  return resolveEntityColor(type, overrides);
}

function buildDegreeMap(edges: GraphEdge[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of edges) {
    map.set(e.sourceId, (map.get(e.sourceId) ?? 0) + 1);
    map.set(e.targetId, (map.get(e.targetId) ?? 0) + 1);
  }
  return map;
}

function buildEdgeWidthFn(edges: GraphEdge[], field: GraphViewConfig['edgeWidthField']): (edge: GraphEdge) => number {
  if (field === 'none') return () => 2;

  const getFieldValue = (e: GraphEdge, f: string): number => {
    // Check direct properties first, then properties bag
    const direct = (e as any)[f];
    if (direct != null && typeof direct === 'number') return direct;
    const fromProps = e.properties?.[f];
    if (fromProps != null && typeof fromProps === 'number') return fromProps;
    return 1;
  };

  // Auto-detect: try weight, then frequency
  if (field === 'auto') {
    const availableFields = detectFields(edges);
    if (availableFields.includes('weight')) return buildEdgeWidthFn(edges, 'weight');
    if (edges.some(e => e.frequency !== undefined)) return buildEdgeWidthFn(edges, 'frequency');
    return () => 2;
  }

  const values = edges.map(e => getFieldValue(e, field));
  if (values.length === 0) return () => 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return () => 2;
  const scale = d3.scaleLinear().domain([min, max]).range([1, 8]);
  return (edge: GraphEdge) => scale(getFieldValue(edge, field));
}

// Compute node radius based on degree
function nodeRadius(degree: number, isHighlighted: boolean = false): number {
  const base = isHighlighted ? 20 : 12;
  return Math.max(base, Math.min(30, base + degree * 1.5));
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
  hiddenEntityTypes,
  hiddenPredicates,
  onToggleEntityType,
  typeIcons,
  predicateArrows,
}: D3ForceGraphProps) {
  const config: GraphViewConfig = useMemo(() => ({
    ...defaultGraphViewConfig,
    ...configOverride,
  }), [configOverride]);

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: propWidth, height: propHeight });

  // D3 selection refs
  const simulationRef = useRef<d3.Simulation<any, any> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const gRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const nodeGroupSelRef = useRef<d3.Selection<SVGGElement, any, SVGGElement, unknown> | null>(null);
  const linkSelRef = useRef<d3.Selection<SVGLineElement, any, SVGGElement, unknown> | null>(null);
  const linkLabelSelRef = useRef<d3.Selection<SVGTextElement, any, SVGGElement, unknown> | null>(null);

  const hasBuiltRef = useRef(false);

  // Refs for volatile callbacks
  const onNodeClickRef = useRef(onNodeClick);
  const onNodeShiftClickRef = useRef(onNodeShiftClick);
  const onEdgeClickRef = useRef(onEdgeClick);
  useEffect(() => { onNodeClickRef.current = onNodeClick; }, [onNodeClick]);
  useEffect(() => { onNodeShiftClickRef.current = onNodeShiftClick; }, [onNodeShiftClick]);
  useEffect(() => { onEdgeClickRef.current = onEdgeClick; }, [onEdgeClick]);

  // Refs for volatile visual params
  const highlightedNodeIdRef = useRef(highlightedNodeId);
  const connectedNodeIdsRef = useRef(connectedNodeIds);
  const mergeSelectedNodeIdsRef = useRef(mergeSelectedNodeIds);
  useEffect(() => { highlightedNodeIdRef.current = highlightedNodeId; }, [highlightedNodeId]);
  useEffect(() => { connectedNodeIdsRef.current = connectedNodeIds; }, [connectedNodeIds]);
  useEffect(() => { mergeSelectedNodeIdsRef.current = mergeSelectedNodeIds; }, [mergeSelectedNodeIds]);

  // Build legend from unique entity types
  const entityTypeLegend = useMemo(() => {
    const typeMap = new Map<string, number>();
    nodes.forEach(n => {
      if (n.type) {
        const t = n.type.toUpperCase();
        typeMap.set(t, (typeMap.get(t) ?? 0) + 1);
      }
    });
    return Array.from(typeMap.entries()).sort((a, b) => b[1] - a[1]).map(([type, count]) => ({
      type,
      color: getEntityTypeColor(type, colorOverrides),
      count,
    }));
  }, [nodes, colorOverrides]);

  // Auto-resize with debounce
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
              if (prev.width === w && prev.height === h) return prev;
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

  // Stable data derivations
  const degreeMap = useMemo(() => buildDegreeMap(edges), [edges]);
  const edgeWidthFn = useMemo(() => buildEdgeWidthFn(edges, config.edgeWidthField), [edges, config.edgeWidthField]);

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
  // EFFECT A: Build simulation + SVG elements
  // ==========================================================================
  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;
    hasBuiltRef.current = false;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        if (gRef.current) {
          gRef.current.attr('transform', event.transform.toString());
        }
      });
    zoomRef.current = zoom;
    svg.call(zoom);

    // Defs for arrow markers
    const defs = svg.append('defs');

    // Default arrow marker
    defs.append('marker')
      .attr('id', 'arrow-default')
      .attr('viewBox', '0 0 10 6')
      .attr('refX', 10)
      .attr('refY', 3)
      .attr('markerWidth', 8)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M 0 0 L 10 3 L 0 6 z')
      .style('fill', 'var(--graph-edge-stroke)');

    // Per-predicate colored markers (when edge coloring is active)
    if (config.edgeColorMode === 'predicate') {
      const uniquePredicates = new Set(edges.map(e => e.predicate));
      uniquePredicates.forEach(pred => {
        const color = resolvePredicateColor(pred, colorOverrides);
        const markerId = `arrow-${pred.replace(/[^a-zA-Z0-9]/g, '_')}`;
        defs.append('marker')
          .attr('id', markerId)
          .attr('viewBox', '0 0 10 6')
          .attr('refX', 10)
          .attr('refY', 3)
          .attr('markerWidth', 8)
          .attr('markerHeight', 6)
          .attr('orient', 'auto')
          .append('path')
          .attr('d', 'M 0 0 L 10 3 L 0 6 z')
          .attr('fill', color);
      });
    }

    const g = svg.append('g').attr('class', 'zoom-container');
    gRef.current = g;

    // Prepare simulation data
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

    // Build simulation
    const sim = d3.forceSimulation(simNodes as any)
      .force('link', d3.forceLink(simLinks).id((d: any) => d.index).distance(config.linkDistance))
      .force('charge', d3.forceManyBody().strength(config.chargeStrength))
      .force('center', d3.forceCenter(0, 0))
      .force('collision', d3.forceCollide().radius(
        nodes.length > 50 ? Math.min(60, 40 + nodes.length * 0.1) : 40
      ))
      .alphaDecay(0.03)
      .velocityDecay(0.4)
      .stop();

    // Cluster by type: assign radial targets per entity type
    if (config.clusterByType) {
      const types = Array.from(new Set(nodes.map(n => n.type.toUpperCase()))).sort();
      const typeAngle = new Map<string, number>();
      types.forEach((t, i) => typeAngle.set(t, (2 * Math.PI * i) / types.length));
      const radius = config.linkDistance * 2;
      const strength = config.clusterStrength;

      sim.force('clusterX', d3.forceX<any>((d: any) => {
        const angle = typeAngle.get(d.type?.toUpperCase()) ?? 0;
        return Math.cos(angle) * radius;
      }).strength(strength));
      sim.force('clusterY', d3.forceY<any>((d: any) => {
        const angle = typeAngle.get(d.type?.toUpperCase()) ?? 0;
        return Math.sin(angle) * radius;
      }).strength(strength));
    }

    sim.alpha(1);
    const ticks = Math.max(config.warmupTicks, 300);
    for (let i = 0; i < ticks; i++) sim.tick();

    simulationRef.current = sim;

    // Helper: get edge color
    const edgeColor = (d: any): string => {
      if (config.edgeColorMode === 'predicate') {
        return resolvePredicateColor(d.predicate, colorOverrides);
      }
      return ''; // will be set via CSS var
    };

    // Helper: get arrow direction for a predicate
    const getArrowDir = (predicate: string): 'forward' | 'backward' | 'both' | 'none' => {
      if (!config.showEdgeArrows) return 'none';
      return predicateArrows?.[predicate] || 'forward';
    };

    // Helper: get arrow marker for an edge (end marker)
    const edgeMarkerEnd = (d: any): string => {
      const dir = getArrowDir(d.predicate);
      if (dir === 'none' || dir === 'backward') return '';
      if (config.edgeColorMode === 'predicate') {
        return `url(#arrow-${d.predicate.replace(/[^a-zA-Z0-9]/g, '_')})`;
      }
      return 'url(#arrow-default)';
    };

    // Helper: get arrow marker for start (backward/both)
    const edgeMarkerStart = (d: any): string => {
      const dir = getArrowDir(d.predicate);
      if (dir !== 'backward' && dir !== 'both') return '';
      if (config.edgeColorMode === 'predicate') {
        return `url(#arrow-${d.predicate.replace(/[^a-zA-Z0-9]/g, '_')})`;
      }
      return 'url(#arrow-default)';
    };

    // Helper: shorten line endpoint by node radius for arrow positioning
    const shortenLine = (sx: number, sy: number, tx: number, ty: number, radiusOffset: number) => {
      const dx = tx - sx, dy = ty - sy;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) return { x: tx, y: ty };
      return { x: tx - (dx / len) * radiusOffset, y: ty - (dy / len) * radiusOffset };
    };

    // --- Build SVG elements at converged positions ---

    // Helper: build edge tooltip text
    const edgeTooltip = (d: any): string => {
      const e = d.edge as GraphEdge;
      const parts = [e.predicate];
      if (e.weight != null) parts.push(`weight: ${e.weight}`);
      if (e.confidence != null) parts.push(`confidence: ${e.confidence}`);
      if (e.frequency != null && e.frequency > 1) parts.push(`frequency: ${e.frequency}`);
      if (e.context) parts.push(e.context.length > 80 ? e.context.slice(0, 80) + '...' : e.context);
      if (e.properties) {
        for (const [k, v] of Object.entries(e.properties)) {
          if (!['weight', 'confidence', 'context', 'date'].includes(k)) continue;
          if (parts.some(p => p.startsWith(k))) continue;
          parts.push(`${k}: ${v}`);
        }
      }
      return parts.join('\n');
    };

    // Edges
    const link = g.append('g').attr('class', 'edges').selectAll('line').data(simLinks).enter().append('line')
      .attr('stroke-opacity', 1)
      .attr('stroke-width', (d: any) => edgeWidthFn(d.edge))
      .attr('cursor', 'pointer')
      .each(function(d: any) {
        const el = d3.select(this);
        if (config.edgeColorMode === 'predicate') {
          el.attr('stroke', edgeColor(d));
        } else {
          el.style('stroke', 'var(--graph-edge-stroke)');
        }
        const endMarker = edgeMarkerEnd(d);
        const startMarker = edgeMarkerStart(d);
        if (endMarker) el.attr('marker-end', endMarker);
        if (startMarker) el.attr('marker-start', startMarker);
      })
      .on('click', (event: any, d: any) => {
        event.stopPropagation();
        onEdgeClickRef.current?.(d.edge);
      });
    // Add tooltips to edges
    link.append('title').text((d: any) => edgeTooltip(d));
    linkSelRef.current = link;

    // Edge labels
    const linkLabels = g.append('g').attr('class', 'edge-labels').selectAll('text').data(simLinks).enter().append('text')
      .attr('font-size', `${config.labelFontSize - 2}px`)
      .attr('text-anchor', 'middle')
      .style('fill', 'var(--graph-edge-label)')
      .style('stroke', 'var(--graph-label-halo)')
      .attr('stroke-width', 1.5)
      .attr('stroke-linejoin', 'round')
      .style('paint-order', 'stroke')
      .text((d: any) => d.predicate)
      .style('pointer-events', 'none')
      .style('opacity', config.showEdgeLabels ? 1 : 0);
    linkLabelSelRef.current = linkLabels;

    // Node groups: <g> containing circle + icon + label
    const nodeGroup = g.append('g').attr('class', 'nodes').selectAll('g').data(simNodes).enter().append('g')
      .attr('transform', (d: any) => `translate(${d.x ?? 0},${d.y ?? 0})`)
      .attr('cursor', 'pointer')
      .call(
        d3.drag<SVGGElement, any>()
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
    // Add tooltips to nodes
    nodeGroup.append('title').text((d: any) => {
      const parts = [d.label, `Type: ${d.type}`];
      if (d.frequency && d.frequency > 1) parts.push(`Frequency: ${d.frequency}`);
      if (d.sourceAssetCount) parts.push(`Sources: ${d.sourceAssetCount}`);
      const deg = degreeMap.get(d.id) ?? 0;
      if (deg > 0) parts.push(`Connections: ${deg}`);
      return parts.join('\n');
    });
    nodeGroupSelRef.current = nodeGroup;

    // Node circles
    nodeGroup.append('circle')
      .attr('r', (d: any) => nodeRadius(degreeMap.get(d.id) ?? 0))
      .attr('fill', (d: any) => getEntityTypeColor(d.type, colorOverrides))
      .style('stroke', 'var(--graph-node-stroke)')
      .attr('stroke-width', 2);

    // Node icons (rendered as stroke-based paths inside the circle)
    if (config.showNodeIcons) {
      nodeGroup.each(function(d: any) {
        const paths = getEntityIconPaths(d.type, typeIcons);
        if (!paths) return;
        const r = nodeRadius(degreeMap.get(d.id) ?? 0);
        const iconSize = Math.max(10, r * 0.9);
        const iconScale = iconSize / 24; // icons are 24x24 viewBox
        const gIcon = d3.select(this).append('g')
          .attr('class', 'node-icon')
          .attr('transform', `translate(${-iconSize / 2},${-iconSize / 2}) scale(${iconScale})`);
        paths.forEach(pathD => {
          gIcon.append('path')
            .attr('d', pathD)
            .attr('fill', 'none')
            .attr('stroke', 'rgba(255,255,255,0.9)')
            .attr('stroke-width', 2)
            .attr('stroke-linecap', 'round')
            .attr('stroke-linejoin', 'round');
        });
      });
    }

    // Node labels
    nodeGroup.append('text')
      .attr('class', 'node-label')
      .attr('font-size', `${config.labelFontSize}px`)
      .attr('font-weight', 'bold')
      .attr('text-anchor', 'middle')
      .attr('dy', (d: any) => nodeRadius(degreeMap.get(d.id) ?? 0) + config.labelFontSize + 2)
      .style('fill', 'var(--graph-node-label)')
      .style('stroke', 'var(--graph-label-halo)')
      .attr('stroke-width', 1.5)
      .attr('stroke-linejoin', 'round')
      .style('paint-order', 'stroke')
      .text((d: any) => d.label)
      .style('pointer-events', 'none')
      .style('opacity', config.showNodeLabels ? 1 : 0);

    // Position edges (with arrow shortening based on direction)
    const positionEdges = () => {
      link.each(function(d: any) {
        const sx = d.source.x ?? 0, sy = d.source.y ?? 0;
        const tx = d.target.x ?? 0, ty = d.target.y ?? 0;
        const el = d3.select(this);
        const dir = getArrowDir(d.predicate);

        // Shorten target end for forward/both arrows
        if (dir === 'forward' || dir === 'both') {
          const targetDeg = degreeMap.get(d.edge.targetId) ?? 0;
          const r = nodeRadius(targetDeg) + 4;
          const shortened = shortenLine(sx, sy, tx, ty, r);
          el.attr('x2', shortened.x).attr('y2', shortened.y);
        } else {
          el.attr('x2', tx).attr('y2', ty);
        }

        // Shorten source end for backward/both arrows
        if (dir === 'backward' || dir === 'both') {
          const sourceDeg = degreeMap.get(d.edge.sourceId) ?? 0;
          const r = nodeRadius(sourceDeg) + 4;
          const shortened = shortenLine(tx, ty, sx, sy, r);
          el.attr('x1', shortened.x).attr('y1', shortened.y);
        } else {
          el.attr('x1', sx).attr('y1', sy);
        }
      });
    };

    // Tick handler
    const updatePos = () => {
      positionEdges();
      linkLabels
        .attr('x', (d: any) => ((d.source.x ?? 0) + (d.target.x ?? 0)) / 2)
        .attr('y', (d: any) => ((d.source.y ?? 0) + (d.target.y ?? 0)) / 2);
      nodeGroup
        .attr('transform', (d: any) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    };
    sim.on('tick', updatePos);

    // Initial position
    positionEdges();
    linkLabels
      .attr('x', (d: any) => ((d.source.x ?? 0) + (d.target.x ?? 0)) / 2)
      .attr('y', (d: any) => ((d.source.y ?? 0) + (d.target.y ?? 0)) / 2);

    hasBuiltRef.current = true;

    // Fit to viewport
    const w = widthRef.current;
    const h = heightRef.current;
    if (w > 0 && h > 0) {
      svg.attr('viewBox', `0 0 ${w} ${h}`);
      if (config.autoFitOnLoad) {
        svg.call(zoom.transform as any, computeFitTransform(simNodes));
      }
    }

    return () => { sim.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, config.linkDistance, config.chargeStrength, config.warmupTicks,
      config.showNodeLabels, config.showEdgeLabels, config.labelFontSize,
      config.autoFitOnLoad, config.showEdgeArrows, config.showNodeIcons,
      config.clusterByType, config.clusterStrength,
      config.edgeColorMode, config.edgeWidthField,
      edgeWidthFn, degreeMap, computeFitTransform]);

  // ==========================================================================
  // EFFECT B: Viewport reframe
  // ==========================================================================
  useEffect(() => {
    if (!svgRef.current || !hasBuiltRef.current) return;
    if (width <= 0 || height <= 0) return;
    d3.select(svgRef.current).attr('viewBox', `0 0 ${width} ${height}`);
  }, [width, height]);

  // ==========================================================================
  // EFFECT C: Highlight visual updates
  // ==========================================================================
  useEffect(() => {
    if (!nodeGroupSelRef.current) return;
    const hId = highlightedNodeId;
    const cIds = connectedNodeIds;
    const mIds = mergeSelectedNodeIds;

    nodeGroupSelRef.current.each(function(d: any) {
      const group = d3.select(this);
      const circle = group.select('circle');
      const label = group.select('.node-label');
      const deg = degreeMap.get(d.id) ?? 0;

      // Radius
      const r = nodeRadius(deg, hId === d.id);
      circle.attr('r', r);

      // Fill
      const c = getEntityTypeColor(d.type, colorOverrides);
      let fill = c;
      if (mIds.includes(d.id)) fill = d3.color(c)?.brighter(0.3)?.toString() || c;
      else if (hId === d.id) fill = d3.color(c)?.brighter(0.5)?.toString() || c;
      else if (cIds.includes(d.id)) fill = d3.color(c)?.brighter(0.2)?.toString() || c;
      else if (hId && !cIds.includes(d.id)) fill = d3.color(c)?.darker(0.5)?.toString() || c;
      circle.attr('fill', fill);

      // Stroke
      if (mIds.includes(d.id)) circle.style('stroke', '#f59e0b');
      else if (hId === d.id) circle.style('stroke', '#2563eb');
      else if (cIds.includes(d.id)) circle.style('stroke', '#10b981');
      else circle.style('stroke', 'var(--graph-node-stroke)');

      circle.attr('stroke-width', mIds.includes(d.id) ? 4 : (hId === d.id) ? 3 : 2);

      // Opacity
      const dimmed = hId && hId !== d.id && !cIds.includes(d.id) && !mIds.includes(d.id);
      group.attr('opacity', dimmed ? 0.4 : 1);

      // Label color
      if (mIds.includes(d.id)) label.style('fill', '#f59e0b');
      else if (dimmed) label.style('fill', 'var(--graph-edge-label)');
      else label.style('fill', 'var(--graph-node-label)');

      // Update label position for changed radius
      label.attr('dy', r + config.labelFontSize + 2);
    });

    if (linkSelRef.current) {
      linkSelRef.current
        .attr('stroke-opacity', (d: any) => {
          if (!hId) return 1;
          const edge = d.edge as GraphEdge;
          return (edge.sourceId === hId || edge.targetId === hId) ? 1 : 0.2;
        });
    }
    if (linkLabelSelRef.current) {
      linkLabelSelRef.current
        .style('opacity', (d: any) => {
          if (!config.showEdgeLabels) return 0;
          if (!hId) return 1;
          const edge = d.edge as GraphEdge;
          return (edge.sourceId === hId || edge.targetId === hId) ? 1 : 0.15;
        });
    }
  }, [highlightedNodeId, connectedNodeIds, mergeSelectedNodeIds, degreeMap, config.labelFontSize, config.showEdgeLabels]);

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

  // ==========================================================================
  // EFFECT E: Visibility filtering (hide/show nodes and edges by type/predicate)
  // ==========================================================================
  useEffect(() => {
    if (!nodeGroupSelRef.current || !linkSelRef.current || !linkLabelSelRef.current) return;

    const hiddenTypes = hiddenEntityTypes ?? new Set<string>();
    const hiddenPreds = hiddenPredicates ?? new Set<string>();

    // Hide/show nodes
    nodeGroupSelRef.current
      .style('display', (d: any) => hiddenTypes.has(d.type?.toUpperCase()) ? 'none' : null);

    // Hide/show edges (hidden if predicate is hidden OR source/target node type is hidden)
    linkSelRef.current
      .style('display', (d: any) => {
        const edge = d.edge as GraphEdge;
        if (hiddenPreds.has(edge.predicate)) return 'none';
        const srcNode = nodes.find(n => n.id === edge.sourceId);
        const tgtNode = nodes.find(n => n.id === edge.targetId);
        if (srcNode && hiddenTypes.has(srcNode.type?.toUpperCase())) return 'none';
        if (tgtNode && hiddenTypes.has(tgtNode.type?.toUpperCase())) return 'none';
        return null;
      });

    linkLabelSelRef.current
      .style('display', (d: any) => {
        const edge = d.edge as GraphEdge;
        if (hiddenPreds.has(edge.predicate)) return 'none';
        const srcNode = nodes.find(n => n.id === edge.sourceId);
        const tgtNode = nodes.find(n => n.id === edge.targetId);
        if (srcNode && hiddenTypes.has(srcNode.type?.toUpperCase())) return 'none';
        if (tgtNode && hiddenTypes.has(tgtNode.type?.toUpperCase())) return 'none';
        return null;
      });
  }, [hiddenEntityTypes, hiddenPredicates, nodes]);

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

  const availableFieldsList = useMemo(() => detectFields(edges), [edges]);
  const hiddenTypes = hiddenEntityTypes ?? new Set<string>();

  return (
    <div ref={containerRef} className="w-full h-full">
      <div className="relative h-full">
        <svg
          ref={svgRef}
          className="w-full h-full rounded border border-[var(--graph-svg-border)]"
        />
        {/* Zoom Controls */}
        <div className="absolute bottom-2 left-2 bg-background/95 p-1 rounded shadow-md flex flex-row gap-1 z-20">
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
        {/* Legend — clickable to toggle entity type visibility */}
        {entityTypeLegend.length > 0 && (
          <div className="absolute top-2 right-2 bg-background/90 p-2 rounded shadow-md text-xs max-h-64 overflow-y-auto z-20">
            <div className="font-semibold mb-1">Entity Types</div>
            <div className="space-y-0.5">
              {entityTypeLegend.map(({ type, color, count }) => {
                const isHidden = hiddenTypes.has(type);
                return (
                  <div
                    key={type}
                    className={`flex items-center gap-2 px-1 py-0.5 rounded cursor-pointer transition-opacity hover:bg-accent/50 ${isHidden ? 'opacity-40' : ''}`}
                    onClick={() => onToggleEntityType?.(type)}
                    title={isHidden ? `Show ${type}` : `Hide ${type}`}
                  >
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: isHidden ? 'var(--graph-edge-stroke)' : color }}
                    />
                    <span className={isHidden ? 'line-through' : ''}>{type}</span>
                    <span className="text-muted-foreground ml-auto">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {availableFieldsList.length > 0 && (
          <div className="absolute bottom-2 right-2 bg-background/90 p-2 rounded shadow-md text-xs text-muted-foreground z-20">
            Fields: {availableFieldsList.join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}
