"use client";

import React, { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HexColorPicker } from "react-colorful";
import {
  Network,
  X,
  Plus,
  Trash2,
  PlusCircle,
  Settings,
  Sparkles,
  Eye,
  EyeOff,
  ChevronRight,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { nanoid } from "nanoid";
import {
  AdvancedSchemeField,
  SchemaSection,
  JsonSchemaType,
  GraphFieldConfig,
  GraphConfig,
} from "@/lib/annotations/types";
import { DEFAULT_ENTITY_COLORS, getEntityColorSet, resolveEntityColor } from "@/lib/annotations/colors";

// =============================================================================
// CONSTANTS & COLOR SYSTEM
// =============================================================================

const ENTITY_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  PERSON:       { bg: "bg-blue-100 dark:bg-blue-900/40",       text: "text-blue-700 dark:text-blue-300",       border: "border-blue-300 dark:border-blue-700",       dot: "#3B82F6" },
  ORGANIZATION: { bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-300 dark:border-emerald-700", dot: "#10B981" },
  LOCATION:     { bg: "bg-amber-100 dark:bg-amber-900/40",     text: "text-amber-700 dark:text-amber-300",     border: "border-amber-300 dark:border-amber-700",     dot: "#F59E0B" },
  EVENT:        { bg: "bg-violet-100 dark:bg-violet-900/40",   text: "text-violet-700 dark:text-violet-300",   border: "border-violet-300 dark:border-violet-700",   dot: "#8B5CF6" },
  CONCEPT:      { bg: "bg-pink-100 dark:bg-pink-900/40",       text: "text-pink-700 dark:text-pink-300",       border: "border-pink-300 dark:border-pink-700",       dot: "#EC4899" },
  POLICY:       { bg: "bg-cyan-100 dark:bg-cyan-900/40",       text: "text-cyan-700 dark:text-cyan-300",       border: "border-cyan-300 dark:border-cyan-700",       dot: "#06B6D4" },
  DOCUMENT:     { bg: "bg-orange-100 dark:bg-orange-900/40",   text: "text-orange-700 dark:text-orange-300",   border: "border-orange-300 dark:border-orange-700",   dot: "#F97316" },
  COUNTRY:      { bg: "bg-teal-100 dark:bg-teal-900/40",       text: "text-teal-700 dark:text-teal-300",       border: "border-teal-300 dark:border-teal-700",       dot: "#14B8A6" },
  INSTITUTION:  { bg: "bg-indigo-100 dark:bg-indigo-900/40",   text: "text-indigo-700 dark:text-indigo-300",   border: "border-indigo-300 dark:border-indigo-700",   dot: "#6366F1" },
  LEGISLATION:  { bg: "bg-rose-100 dark:bg-rose-900/40",       text: "text-rose-700 dark:text-rose-300",       border: "border-rose-300 dark:border-rose-700",       dot: "#F43F5E" },
};

const DEFAULT_COLOR = { bg: "bg-gray-100 dark:bg-gray-800/40", text: "text-gray-700 dark:text-gray-300", border: "border-gray-300 dark:border-gray-600", dot: "#6B7280" };
const FALLBACK_DOTS = ["#8B5CF6", "#EC4899", "#06B6D4", "#F97316", "#14B8A6", "#6366F1", "#F43F5E", "#84CC16", "#EF4444", "#A855F7"];

// Use shared color system - getEntityColor returns the full color set
function getEntityColor(type: string) {
  return getEntityColorSet(type);
}

// Get dot color (hex) for graph preview
function getDotColor(type: string, index: number): string {
  return resolveEntityColor(type);
}

const ENTITY_TYPE_PRESETS = [
  "PERSON", "ORGANIZATION", "LOCATION", "EVENT",
  "CONCEPT", "POLICY", "COUNTRY", "INSTITUTION",
];

const PREDICATE_PRESETS = [
  "works_for", "located_in", "part_of", "related_to",
  "met_with", "belongs_to", "authored_by", "mentioned_in",
  "governs", "opposes", "supports", "funded_by",
];

// =============================================================================
// TAG INPUT COMPONENT
// =============================================================================

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  presets: string[];
  placeholder?: string;
  disabled?: boolean;
  uppercase?: boolean;
  colorMap?: (tag: string) => { bg: string; text: string; border: string };
  label: string;
  description?: string;
  // Color customization
  colorOverrides?: Record<string, string>; // hex colors per tag
  onColorChange?: (tag: string, color: string) => void; // called when user picks a color
  showColorPicker?: boolean; // whether to show color picker dots
}

const TagInput: React.FC<TagInputProps> = ({
  tags,
  onChange,
  presets,
  placeholder = "Type and press Enter...",
  disabled = false,
  uppercase = false,
  colorMap,
  label,
  description,
  colorOverrides,
  onColorChange,
  showColorPicker = false,
}) => {
  const [inputValue, setInputValue] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addTag = useCallback(
    (tag: string) => {
      const normalized = uppercase ? tag.toUpperCase().trim() : tag.trim();
      if (normalized && !tags.includes(normalized)) {
        onChange([...tags, normalized]);
      }
      setInputValue("");
    },
    [tags, onChange, uppercase]
  );

  const removeTag = useCallback(
    (tag: string) => {
      onChange(tags.filter((t) => t !== tag));
    },
    [tags, onChange]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (inputValue.trim()) {
        addTag(inputValue);
      }
    } else if (e.key === "Backspace" && !inputValue && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  };

  const availablePresets = presets.filter(
    (p) => !tags.includes(uppercase ? p.toUpperCase() : p)
  );

  const getColor = (tag: string) =>
    colorMap?.(tag) ?? { bg: "bg-secondary", text: "text-secondary-foreground", border: "border-transparent" };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">{label}</Label>
        {tags.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">{tags.length} defined</span>
        )}
      </div>
      {description && <p className="text-xs text-muted-foreground -mt-1">{description}</p>}

      {/* Tag container */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-1.5 p-2 rounded-lg border-2 transition-all duration-200 min-h-[42px] cursor-text",
          isFocused
            ? "border-primary/50 ring-2 ring-primary/20 bg-background"
            : "border-border bg-muted/20 hover:border-primary/30",
          disabled && "opacity-60 cursor-not-allowed"
        )}
        onClick={() => !disabled && inputRef.current?.focus()}
      >
        <AnimatePresence mode="popLayout">
          {tags.map((tag) => {
            const color = getColor(tag);
            const currentColor = colorOverrides?.[tag] || resolveEntityColor(tag);
            return (
              <motion.div
                key={tag}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                layout
                transition={{ duration: 0.15 }}
                className="inline-flex items-center gap-1"
              >
                {showColorPicker && !disabled && onColorChange && (
                  <Popover open={colorPickerOpen === tag} onOpenChange={(open) => setColorPickerOpen(open ? tag : null)}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setColorPickerOpen(tag);
                        }}
                        className="h-5 w-5 rounded-full border-2 border-white dark:border-gray-800 shadow-sm hover:scale-110 transition-transform"
                        style={{ backgroundColor: currentColor }}
                        title="Change color"
                      />
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-3" onClick={(e) => e.stopPropagation()}>
                      <div className="space-y-2">
                        <Label className="text-xs font-medium">Color for {tag}</Label>
                        <HexColorPicker
                          color={currentColor}
                          onChange={(newColor) => {
                            onColorChange(tag, newColor);
                          }}
                        />
                        <div className="flex items-center gap-2">
                          <Input
                            value={currentColor}
                            onChange={(e) => {
                              if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
                                onColorChange(tag, e.target.value);
                              }
                            }}
                            className="h-7 text-xs font-mono"
                            placeholder="#000000"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => {
                              // Reset to default
                              onColorChange(tag, resolveEntityColor(tag));
                            }}
                          >
                            Reset
                          </Button>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
                <span
                  className={cn(
                    "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                    color.bg,
                    color.text,
                    color.border
                  )}
                >
                  {uppercase ? tag : tag}
                  {!disabled && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeTag(tag);
                      }}
                      className="ml-0.5 rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {!disabled && (
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(uppercase ? e.target.value.toUpperCase() : e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={tags.length === 0 ? placeholder : "Add more..."}
            className="flex-1 min-w-[120px] bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
            disabled={disabled}
          />
        )}
      </div>

      {/* Preset suggestions */}
      {!disabled && availablePresets.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <span className="text-xs text-muted-foreground self-center mr-1">Quick add:</span>
          {availablePresets.slice(0, 8).map((preset) => {
            const color = getColor(uppercase ? preset.toUpperCase() : preset);
            return (
              <button
                key={preset}
                type="button"
                onClick={() => addTag(preset)}
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border border-dashed transition-all",
                  "hover:border-solid hover:shadow-sm active:scale-95",
                  color.border,
                  "text-muted-foreground hover:" + color.text
                )}
              >
                <Plus className="h-2.5 w-2.5" />
                {preset}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

// =============================================================================
// LIVE GRAPH PREVIEW (SVG)
// =============================================================================

interface LiveGraphPreviewProps {
  entityTypes: string[];
  predicates: string[];
  className?: string;
  entityTypeColors?: Record<string, string>;
  predicateColors?: Record<string, string>;
}

const LiveGraphPreview: React.FC<LiveGraphPreviewProps> = ({
  entityTypes,
  predicates,
  className,
  entityTypeColors,
  predicateColors,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const WIDTH = 320;
  const HEIGHT = 260;
  const CENTER_X = WIDTH / 2;
  const CENTER_Y = HEIGHT / 2;
  const RADIUS = Math.min(WIDTH, HEIGHT) * 0.32;
  const NODE_RADIUS = 24;

  // Position nodes in a circle
  const nodes = useMemo(() => {
    if (entityTypes.length === 0) return [];
    return entityTypes.map((type, i) => {
      const angle = (2 * Math.PI * i) / entityTypes.length - Math.PI / 2;
      return {
        id: type,
        x: CENTER_X + RADIUS * Math.cos(angle),
        y: CENTER_Y + RADIUS * Math.sin(angle),
        color: entityTypeColors?.[type] || getDotColor(type, i),
        label: type.length > 8 ? type.slice(0, 7) + "..." : type,
        fullLabel: type,
      };
    });
  }, [entityTypes, CENTER_X, CENTER_Y, RADIUS]);

  // Generate sample edges between nodes
  const edges = useMemo(() => {
    if (nodes.length < 2 || predicates.length === 0) return [];
    const result: { source: typeof nodes[0]; target: typeof nodes[0]; label: string }[] = [];
    const maxEdges = Math.min(predicates.length, Math.floor(nodes.length * 1.5));

    for (let i = 0; i < maxEdges; i++) {
      const srcIdx = i % nodes.length;
      const tgtIdx = (i + 1 + Math.floor(i / nodes.length)) % nodes.length;
      if (srcIdx !== tgtIdx) {
        result.push({
          source: nodes[srcIdx],
          target: nodes[tgtIdx],
          label: predicates[i % predicates.length],
        });
      }
    }
    return result;
  }, [nodes, predicates]);

  // Curved path between two points
  const edgePath = (
    sx: number,
    sy: number,
    tx: number,
    ty: number,
    curveOffset: number = 0
  ) => {
    const mx = (sx + tx) / 2;
    const my = (sy + ty) / 2;
    const dx = tx - sx;
    const dy = ty - sy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const offset = 20 + curveOffset * 15;
    const cx = mx + nx * offset;
    const cy = my + ny * offset;
    return { path: `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`, cx, cy };
  };

  if (entityTypes.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center rounded-xl border-2 border-dashed bg-muted/10",
          className
        )}
        style={{ width: WIDTH, height: HEIGHT }}
      >
        <Network className="h-8 w-8 text-muted-foreground/30 mb-2" />
        <p className="text-xs text-muted-foreground/50 text-center px-4">
          Add entity types to see a live preview
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn("rounded-xl border bg-gradient-to-br from-background to-muted/30 overflow-hidden relative", className)}
    >
      {/* Subtle grid background */}
      <svg
        ref={svgRef}
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto"
      >
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="currentColor" strokeWidth="0.3" className="text-border/30" />
          </pattern>
          {/* Arrow marker */}
          <marker id="arrow" viewBox="0 0 10 6" refX="8" refY="3" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 3 L 0 6 z" fill="currentColor" className="text-muted-foreground/40" />
          </marker>
          {/* Glow filter for nodes */}
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect width={WIDTH} height={HEIGHT} fill="url(#grid)" />

        {/* Edges */}
        <AnimatePresence>
          {edges.map((edge, i) => {
            const { path, cx, cy } = edgePath(edge.source.x, edge.source.y, edge.target.x, edge.target.y, i * 0.3);
            const truncLabel = edge.label.length > 12 ? edge.label.slice(0, 11) + ".." : edge.label;
            return (
              <g key={`edge-${edge.source.id}-${edge.target.id}-${i}`}>
                <motion.path
                  d={path}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                  className="text-muted-foreground/30"
                  markerEnd="url(#arrow)"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                />
                <motion.g
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3, delay: 0.3 + i * 0.1 }}
                >
                  <rect
                    x={cx - truncLabel.length * 3 - 4}
                    y={cy - 8}
                    width={truncLabel.length * 6 + 8}
                    height={16}
                    rx={4}
                    fill="currentColor"
                    className="text-background"
                  />
                  <rect
                    x={cx - truncLabel.length * 3 - 4}
                    y={cy - 8}
                    width={truncLabel.length * 6 + 8}
                    height={16}
                    rx={4}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="0.5"
                    className="text-border"
                  />
                  <text
                    x={cx}
                    y={cy + 3.5}
                    textAnchor="middle"
                    fontSize="9"
                    fill="currentColor"
                    className="text-muted-foreground font-mono"
                  >
                    {truncLabel}
                  </text>
                </motion.g>
              </g>
            );
          })}
        </AnimatePresence>

        {/* Nodes */}
        <AnimatePresence>
          {nodes.map((node, i) => (
            <motion.g
              key={node.id}
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 20, delay: i * 0.05 }}
              style={{ originX: `${node.x}px`, originY: `${node.y}px` }}
            >
              {/* Outer glow */}
              <circle cx={node.x} cy={node.y} r={NODE_RADIUS + 4} fill={node.color} opacity={0.15} />
              {/* Main circle */}
              <circle
                cx={node.x}
                cy={node.y}
                r={NODE_RADIUS}
                fill={node.color}
                opacity={0.85}
                stroke="white"
                strokeWidth="2"
                filter="url(#glow)"
              />
              {/* Label */}
              <text
                x={node.x}
                y={node.y + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="8"
                fontWeight="600"
                fill="white"
                className="pointer-events-none select-none"
                style={{ textShadow: "0 1px 2px rgba(0,0,0,0.3)" }}
              >
                {node.label}
              </text>
            </motion.g>
          ))}
        </AnimatePresence>
      </svg>

      {/* Overlay label */}
      <div className="absolute bottom-2 right-2 text-[10px] text-muted-foreground/40 font-mono">
        schema preview
      </div>
    </div>
  );
};

// =============================================================================
// MAIN: GRAPH SCHEMA VISUAL EDITOR
// =============================================================================

interface GraphSchemaVisualEditorProps {
  field: AdvancedSchemeField;
  section: SchemaSection;
  disabled: boolean;
  onFieldUpdate: (update: Partial<AdvancedSchemeField>) => void;
}

const GraphSchemaVisualEditor: React.FC<GraphSchemaVisualEditorProps> = ({
  field,
  section,
  disabled,
  onFieldUpdate,
}) => {
  const graphConfig = field.graphConfig!;
  const [showPreview, setShowPreview] = useState(true);

  // --- Updaters ---

  const updateGraphConfig = (update: Partial<GraphFieldConfig>) => {
    onFieldUpdate({
      graphConfig: {
        ...graphConfig,
        ...update,
      },
    });
  };

  const updateDeduplicationConfig = (update: Partial<GraphConfig["deduplication"]>) => {
    updateGraphConfig({
      graphConfig: {
        ...graphConfig.graphConfig,
        deduplication: {
          ...graphConfig.graphConfig.deduplication,
          ...update,
        },
      },
    });
  };

  // Entity types
  const entityTypes = graphConfig.entityTypes.typeEnum ?? [];
  const setEntityTypes = (types: string[]) => {
    updateGraphConfig({
      entityTypes: {
        ...graphConfig.entityTypes,
        typeEnum: types,
        typeConstrained: types.length > 0 ? (graphConfig.entityTypes.typeConstrained ?? true) : false,
        // Preserve colors when updating types
        typeColors: graphConfig.entityTypes.typeColors,
      },
    });
  };

  // Entity type colors
  const handleEntityTypeColorChange = (type: string, color: string) => {
    updateGraphConfig({
      entityTypes: {
        ...graphConfig.entityTypes,
        typeColors: {
          ...(graphConfig.entityTypes.typeColors || {}),
          [type]: color,
        },
      },
    });
  };

  // Predicates
  const predicates = graphConfig.relationshipSchema.predicateEnum ?? [];
  const setPredicates = (preds: string[]) => {
    updateGraphConfig({
      relationshipSchema: {
        ...graphConfig.relationshipSchema,
        predicateEnum: preds,
        predicateConstrained: preds.length > 0 ? (graphConfig.relationshipSchema.predicateConstrained ?? true) : false,
        // Preserve colors when updating predicates
        predicateColors: graphConfig.relationshipSchema.predicateColors,
      },
    });
  };

  // Predicate colors
  const handlePredicateColorChange = (predicate: string, color: string) => {
    updateGraphConfig({
      relationshipSchema: {
        ...graphConfig.relationshipSchema,
        predicateColors: {
          ...(graphConfig.relationshipSchema.predicateColors || {}),
          [predicate]: color,
        },
      },
    });
  };

  // Optional fields
  const addOptionalField = () => {
    const newField: AdvancedSchemeField = {
      id: nanoid(),
      name: `field_${nanoid(4)}`,
      type: "string",
      required: false,
      description: "",
    };
    updateGraphConfig({
      relationshipSchema: {
        ...graphConfig.relationshipSchema,
        optionalFields: [...graphConfig.relationshipSchema.optionalFields, newField],
      },
    });
  };

  const updateOptionalField = (fieldId: string, update: Partial<AdvancedSchemeField>) => {
    updateGraphConfig({
      relationshipSchema: {
        ...graphConfig.relationshipSchema,
        optionalFields: graphConfig.relationshipSchema.optionalFields.map((f) =>
          f.id === fieldId ? { ...f, ...update } : f
        ),
      },
    });
  };

  const removeOptionalField = (fieldId: string) => {
    updateGraphConfig({
      relationshipSchema: {
        ...graphConfig.relationshipSchema,
        optionalFields: graphConfig.relationshipSchema.optionalFields.filter((f) => f.id !== fieldId),
      },
    });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Network className="h-4.5 w-4.5 text-white" />
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-green-500 border-2 border-background" />
          </div>
          <div>
            <h4 className="text-sm font-bold tracking-tight">Knowledge Graph Schema</h4>
            <p className="text-xs text-muted-foreground">
              Define entities and relationships for extraction
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={() => setShowPreview((v) => !v)}
        >
          {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {showPreview ? "Hide" : "Show"} Preview
        </Button>
      </div>

      {/* Triplet info banner */}
      <div className="flex items-center gap-3 p-3 rounded-lg bg-gradient-to-r from-purple-500/5 to-indigo-500/5 border border-purple-200/40 dark:border-purple-800/40">
        <Zap className="h-4 w-4 text-purple-500 shrink-0" />
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Triplet extraction:</span>{" "}
          Each result produces{" "}
          <code className="bg-background px-1 py-0.5 rounded text-[10px] font-mono">
            subject &rarr; predicate &rarr; object
          </code>{" "}
          with typed entities
        </div>
      </div>

      {/* Main content: side-by-side on larger screens */}
      <div className={cn("grid gap-4", showPreview ? "grid-cols-1 xl:grid-cols-[1fr_320px]" : "grid-cols-1")}>
        {/* Left: Configuration */}
        <div className="space-y-5">
          {/* Entity Types */}
          <div className="p-4 rounded-xl border-2 border-blue-200/50 dark:border-blue-800/30 bg-gradient-to-br from-blue-50/30 to-transparent dark:from-blue-950/10">
            <TagInput
              tags={entityTypes}
              onChange={setEntityTypes}
              presets={ENTITY_TYPE_PRESETS}
              placeholder="Type an entity type and press Enter..."
              disabled={disabled}
              uppercase
              colorMap={(tag) => getEntityColor(tag)}
              label="Entity Types"
              description="Define what kinds of entities the AI should extract (e.g., people, organizations, locations)"
              showColorPicker={!disabled}
              colorOverrides={graphConfig.entityTypes.typeColors}
              onColorChange={handleEntityTypeColorChange}
            />

            {/* Constrain toggle */}
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-blue-200/30 dark:border-blue-800/20">
              <div>
                <Label className="text-xs font-medium">Strict mode</Label>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Only allow these types (no free-form discovery)
                </p>
              </div>
              <Switch
                checked={graphConfig.entityTypes.typeConstrained ?? false}
                onCheckedChange={(checked) =>
                  updateGraphConfig({
                    entityTypes: {
                      ...graphConfig.entityTypes,
                      typeConstrained: checked,
                    },
                  })
                }
                disabled={disabled || entityTypes.length === 0}
              />
            </div>

            {/* Optional type guidance */}
            {entityTypes.length > 0 && (
              <div className="mt-3">
                <Textarea
                  value={graphConfig.entityTypes.typeDescription || ""}
                  onChange={(e) =>
                    updateGraphConfig({
                      entityTypes: {
                        ...graphConfig.entityTypes,
                        typeDescription: e.target.value,
                      },
                    })
                  }
                  placeholder="Optional: Guide the AI on how to categorize entities (e.g., 'PERSON for individuals, ORGANIZATION for companies...')"
                  rows={2}
                  disabled={disabled}
                  className="text-xs resize-none bg-background/50"
                />
              </div>
            )}
          </div>

          {/* Predicates / Relationships */}
          <div className="p-4 rounded-xl border-2 border-green-200/50 dark:border-green-800/30 bg-gradient-to-br from-green-50/30 to-transparent dark:from-green-950/10">
            <TagInput
              tags={predicates}
              onChange={setPredicates}
              presets={PREDICATE_PRESETS}
              placeholder="Type a relationship and press Enter..."
              disabled={disabled}
              colorMap={() => ({
                bg: "bg-green-100 dark:bg-green-900/40",
                text: "text-green-700 dark:text-green-300",
                border: "border-green-300 dark:border-green-700",
              })}
              label="Relationship Predicates"
              description="Define how entities connect to each other (e.g., works_for, located_in, met_with)"
            />

            {/* Constrain toggle */}
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-green-200/30 dark:border-green-800/20">
              <div>
                <Label className="text-xs font-medium">Strict mode</Label>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Only allow these predicates
                </p>
              </div>
              <Switch
                checked={graphConfig.relationshipSchema.predicateConstrained ?? false}
                onCheckedChange={(checked) =>
                  updateGraphConfig({
                    relationshipSchema: {
                      ...graphConfig.relationshipSchema,
                      predicateConstrained: checked,
                    },
                  })
                }
                disabled={disabled || predicates.length === 0}
              />
            </div>

            {/* Optional predicate guidance */}
            {predicates.length > 0 && (
              <div className="mt-3">
                <Textarea
                  value={graphConfig.relationshipSchema.predicateDescription || ""}
                  onChange={(e) =>
                    updateGraphConfig({
                      relationshipSchema: {
                        ...graphConfig.relationshipSchema,
                        predicateDescription: e.target.value,
                      },
                    })
                  }
                  placeholder="Optional: Guide the AI on when to use each predicate (e.g., 'works_for for employment, located_in for geography...')"
                  rows={2}
                  disabled={disabled}
                  className="text-xs resize-none bg-background/50"
                />
              </div>
            )}
          </div>
        </div>

        {/* Right: Live Preview */}
        {showPreview && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col gap-3"
          >
            <LiveGraphPreview 
              entityTypes={entityTypes} 
              predicates={predicates}
              entityTypeColors={graphConfig.entityTypes.typeColors}
              predicateColors={graphConfig.relationshipSchema.predicateColors}
            />

            {/* Legend */}
            {entityTypes.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-1">
                {entityTypes.map((type, i) => (
                  <div key={type} className="flex items-center gap-1">
                    <div
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: getDotColor(type, i) }}
                    />
                    <span className="text-[10px] text-muted-foreground font-medium">{type}</span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </div>

      {/* Additional Settings - Compact Accordion */}
      <Accordion type="multiple" className="space-y-2">
        {/* Optional Triplet Fields */}
        <AccordionItem value="optional-fields" className="border rounded-xl px-4 bg-card/50">
          <AccordionTrigger className="text-sm font-semibold py-3 hover:no-underline">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-purple-500" />
              <span>Additional Triplet Fields</span>
              {graphConfig.relationshipSchema.optionalFields.length > 0 && (
                <Badge variant="secondary" className="text-[10px] h-5 ml-1">
                  {graphConfig.relationshipSchema.optionalFields.length}
                </Badge>
              )}
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Add extra fields to each triplet beyond the core subject/predicate/object.
              </p>

              {graphConfig.relationshipSchema.optionalFields.length > 0 && (
                <div className="space-y-2">
                  {graphConfig.relationshipSchema.optionalFields.map((optField) => (
                    <div key={optField.id} className="bg-muted/40 p-3 rounded-lg space-y-2 border">
                      <div className="flex items-center gap-2">
                        <Input
                          value={optField.name}
                          onChange={(e) => updateOptionalField(optField.id, { name: e.target.value })}
                          placeholder="field_name"
                          disabled={disabled}
                          className="h-8 text-xs flex-1 font-mono"
                        />
                        <Select
                          value={optField.type}
                          onValueChange={(value) =>
                            updateOptionalField(optField.id, { type: value as JsonSchemaType })
                          }
                          disabled={disabled}
                        >
                          <SelectTrigger className="h-8 w-[100px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="string" className="text-xs">String</SelectItem>
                            <SelectItem value="number" className="text-xs">Number</SelectItem>
                            <SelectItem value="integer" className="text-xs">Integer</SelectItem>
                            <SelectItem value="boolean" className="text-xs">Boolean</SelectItem>
                          </SelectContent>
                        </Select>
                        {!disabled && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                            onClick={() => removeOptionalField(optField.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                      <Textarea
                        value={optField.description || ""}
                        onChange={(e) => updateOptionalField(optField.id, { description: e.target.value })}
                        placeholder="Field description (e.g., 'Direct quote from source supporting this relationship')"
                        disabled={disabled}
                        className="h-12 text-xs resize-none"
                        rows={2}
                      />
                    </div>
                  ))}
                </div>
              )}

              {!disabled && (
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground bg-muted/30 p-2.5 rounded-lg border border-dashed">
                    <div className="font-medium mb-1">Common optional fields:</div>
                    <div className="space-y-0.5">
                      <div>
                        <code className="bg-background px-1 rounded text-[10px]">context</code>{" "}
                        <span className="text-muted-foreground/70">(string)</span> - Supporting text quote
                      </div>
                      <div>
                        <code className="bg-background px-1 rounded text-[10px]">confidence</code>{" "}
                        <span className="text-muted-foreground/70">(number)</span> - Extraction confidence 0-1
                      </div>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full h-8 text-xs border-dashed"
                    onClick={addOptionalField}
                  >
                    <PlusCircle className="h-3 w-3 mr-1.5" />
                    Add Optional Field
                  </Button>
                </div>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Deduplication */}
        <AccordionItem value="deduplication" className="border rounded-xl px-4 bg-card/50">
          <AccordionTrigger className="text-sm font-semibold py-3 hover:no-underline">
            <div className="flex items-center gap-2">
              <Settings className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Entity Deduplication</span>
              {graphConfig.graphConfig.deduplication.enabled && (
                <div className="h-2 w-2 rounded-full bg-green-500" />
              )}
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Entities are extracted from triplets and deduplicated during aggregation.
              </p>

              <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border">
                <div>
                  <Label htmlFor="dedup-enabled" className="text-sm font-medium cursor-pointer">
                    Enable Deduplication
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Merge duplicate entities across triplets
                  </p>
                </div>
                <Switch
                  id="dedup-enabled"
                  checked={graphConfig.graphConfig.deduplication.enabled}
                  onCheckedChange={(checked) => updateDeduplicationConfig({ enabled: checked })}
                  disabled={disabled}
                />
              </div>

              {graphConfig.graphConfig.deduplication.enabled && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-3"
                >
                  <div className="space-y-2">
                    <Label htmlFor="dedup-strategy" className="text-sm font-medium">
                      Strategy
                    </Label>
                    <Select
                      value={graphConfig.graphConfig.deduplication.strategy}
                      onValueChange={(value: "exact" | "normalized" | "fuzzy") =>
                        updateDeduplicationConfig({ strategy: value })
                      }
                      disabled={disabled}
                    >
                      <SelectTrigger id="dedup-strategy" className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="exact">Exact Match</SelectItem>
                        <SelectItem value="normalized">Normalized (case-insensitive)</SelectItem>
                        <SelectItem value="fuzzy">Fuzzy Match (future)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {graphConfig.graphConfig.deduplication.strategy === "normalized" && (
                    <div className="flex items-center justify-between p-3 bg-muted/20 rounded-lg border">
                      <Label htmlFor="dedup-case" className="text-sm font-medium cursor-pointer">
                        Case Sensitive
                      </Label>
                      <Switch
                        id="dedup-case"
                        checked={graphConfig.graphConfig.deduplication.caseSensitive}
                        onCheckedChange={(checked) =>
                          updateDeduplicationConfig({ caseSensitive: checked })
                        }
                        disabled={disabled}
                      />
                    </div>
                  )}
                </motion.div>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
};

export default GraphSchemaVisualEditor;
