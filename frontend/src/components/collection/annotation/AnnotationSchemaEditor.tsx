"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { useInfospaceStore } from "@/zustand_stores/storeInfospace";
import { useAnnotationSystem } from "@/hooks/useAnnotationSystem";
import {
  AnnotationSchemaFormData,
  SchemaSection,
  AdvancedSchemeField,
  ADVANCED_SCHEME_TYPE_OPTIONS,
  TYPE_GROUP_LABELS,
  JsonSchemaType,
  TypeOption,
  EntityFieldConfig,
} from "@/lib/annotations/types";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Trash2, PlusCircle, AlertTriangle, FileJson, FileText, Image, Mic, Video,
  ChevronRight, ChevronDown, Type, Hash, ToggleLeft, List, Tags, ListOrdered,
  Braces, LayoutList, GitFork, ChevronsUpDown, Check, BarChart3, Table2, PieChart,
  Map, Clock, Network, CalendarClock, MapPin, CalendarRange, Users, Globe, AtSign,
  Link2, Unlink, Sparkles, X,
} from "lucide-react";
import GraphSchemaVisualEditor, { TagInput } from "./GraphSchemaVisualEditor";
import { HexColorPicker } from "react-colorful";
import { IconPickerDialog } from "@/components/collection/utilities/icons/IconPickerOverlay";
import { IconRenderer } from "@/components/collection/utilities/icons/icon-picker";
import { resolveEntityColor } from "@/lib/annotations/colors";
import { AnnotationSchemaRead, AnnotationSchemaUpdate } from "@/client";
import { adaptSchemaReadToSchemaFormData, adaptSchemaFormDataToSchemaCreate } from "@/lib/annotations/adapters";
import { useToast } from "@/components/ui/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { nanoid } from "nanoid";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Command, CommandList, CommandGroup, CommandItem, CommandEmpty } from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

// =============================================================================
// Helpers
// =============================================================================

function isValidFieldName(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

function getTypeValue(field: AdvancedSchemeField): string {
  if (field.type === "graph") return "graph";
  if (field.type === "entity") return "entity";
  if (field.type === "array" && field.items) {
    if (field.items.type === "entity") return "array_entity";
    if (field.items.type === "string" && field.items.enum !== undefined) return "array_string_enum";
    if (field.items.type === "object") return "array_object";
    return `array_${field.items.type}`;
  }
  return field.type || "string";
}

function computeTypeChangeUpdate(field: AdvancedSchemeField, value: string): Partial<AdvancedSchemeField> {
  const update: Partial<AdvancedSchemeField> = {};

  if (value === "graph") {
    update.type = "graph";
    update.graphConfig = {
      entityTypes: { typeEnum: [], typeConstrained: false },
      relationshipSchema: { predicateEnum: [], predicateConstrained: false, optionalFields: [] },
    };
    delete update.items;
    delete update.properties;
    if (field.type === "entity") update.entityConfig = undefined;
  } else if (value === "entity") {
    update.type = "entity";
    update.entityConfig = field.entityConfig || { entity_type: "", typeConstrained: true };
    delete update.items;
    delete update.properties;
    if (field.type === "graph") update.graphConfig = undefined;
  } else if (value.startsWith("array_")) {
    update.type = "array";
    const itemType = value.split("_")[1] as JsonSchemaType;
    update.items = { type: itemType };
    if (itemType === "object") {
      update.items.properties = field.items?.properties || [];
    } else if (itemType === "entity") {
      update.items.entityConfig = field.items?.entityConfig
        ?? field.entityConfig
        ?? { entity_type: "", typeConstrained: true };
    } else if (value === "array_string_enum") {
      update.items.enum = [];
      update.items.includeOther = true;
    } else if (value === "array_string" && field.items?.enum !== undefined) {
      const existingItems = field.items || { type: "string" };
      update.items = { type: existingItems.type };
      if (existingItems.properties) update.items.properties = existingItems.properties;
    }
    if (field.type === "graph") update.graphConfig = undefined;
    if (field.type === "entity") update.entityConfig = undefined;
  } else {
    update.type = value as JsonSchemaType;
    delete update.items;
    if (field.type === "graph") update.graphConfig = undefined;
    if (field.type === "entity") update.entityConfig = undefined;
  }

  if (update.type === "object") {
    update.properties = field.properties || [];
  } else if (update.type !== "graph") {
    delete update.properties;
  }

  return update;
}

function getCompactTypeLabel(field: AdvancedSchemeField): string {
  if (field.type === "graph") return "graph";
  if (field.type === "entity") return "entity";
  if (field.type === "array" && field.items) {
    if (field.items.type === "entity") return "entity[]";
    if (field.items.type === "string" && field.items.enum !== undefined) return "labels";
    if (field.items.type === "object") return "obj[]";
    return `${field.items.type}[]`;
  }
  if (field.type === "object") return "obj";
  if (field.type === "boolean") return "bool";
  return field.type;
}

function getTypeChipClass(field: AdvancedSchemeField): string {
  if (field.type === "graph") return "bg-purple-100/70 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300";
  if (field.type === "entity" || (field.type === "array" && field.items?.type === "entity"))
    return "bg-cyan-100/70 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300";
  return "bg-muted text-muted-foreground";
}

// =============================================================================
// Tree walking — selection at any depth
// =============================================================================

function getChildren(field: AdvancedSchemeField): AdvancedSchemeField[] | null {
  if (field.type === "object") return field.properties ?? null;
  if (field.type === "array" && field.items?.type === "object") return field.items.properties ?? null;
  return null;
}

function setChildren(field: AdvancedSchemeField, children: AdvancedSchemeField[]): AdvancedSchemeField {
  if (field.type === "object") return { ...field, properties: children };
  if (field.type === "array" && field.items?.type === "object") {
    return { ...field, items: { ...field.items, properties: children } };
  }
  return field;
}

function fieldCanHostChildren(field: AdvancedSchemeField): boolean {
  return field.type === "object" || (field.type === "array" && field.items?.type === "object");
}

type Resolution =
  | { kind: "none"; sectionId: null; section: null; fieldPath: string[]; field: null; ancestors: AdvancedSchemeField[] }
  | { kind: "section"; sectionId: string; section: SchemaSection; fieldPath: string[]; field: null; ancestors: AdvancedSchemeField[] }
  | { kind: "field"; sectionId: string; section: SchemaSection; fieldPath: string[]; field: AdvancedSchemeField; ancestors: AdvancedSchemeField[] };

function findFieldPath(
  fields: AdvancedSchemeField[],
  targetId: string,
  ancestors: AdvancedSchemeField[] = [],
): { path: string[]; ancestors: AdvancedSchemeField[]; field: AdvancedSchemeField } | null {
  for (const f of fields) {
    if (f.id === targetId) {
      return { path: [...ancestors.map(a => a.id), f.id], ancestors: [...ancestors], field: f };
    }
    const children = getChildren(f);
    if (children) {
      const r = findFieldPath(children, targetId, [...ancestors, f]);
      if (r) return r;
    }
  }
  return null;
}

function resolveSelection(structure: SchemaSection[], nodeId: string | null): Resolution {
  if (!nodeId) return { kind: "none", sectionId: null, section: null, fieldPath: [], field: null, ancestors: [] };
  for (const sec of structure) {
    if (sec.id === nodeId) {
      return { kind: "section", sectionId: sec.id, section: sec, fieldPath: [], field: null, ancestors: [] };
    }
    const r = findFieldPath(sec.fields, nodeId);
    if (r) return { kind: "field", sectionId: sec.id, section: sec, fieldPath: r.path, field: r.field, ancestors: r.ancestors };
  }
  return { kind: "none", sectionId: null, section: null, fieldPath: [], field: null, ancestors: [] };
}

function applyAtPath(
  fields: AdvancedSchemeField[],
  path: string[],
  update: Partial<AdvancedSchemeField>,
): AdvancedSchemeField[] {
  if (path.length === 0) return fields;
  const [head, ...tail] = path;
  return fields.map(f => {
    if (f.id !== head) return f;
    if (tail.length === 0) return { ...f, ...update };
    const children = getChildren(f);
    if (!children) return f;
    return setChildren(f, applyAtPath(children, tail, update));
  });
}

function updateFieldAtPath(
  structure: SchemaSection[],
  sectionId: string,
  path: string[],
  update: Partial<AdvancedSchemeField>,
): SchemaSection[] {
  return structure.map(s => (s.id !== sectionId ? s : { ...s, fields: applyAtPath(s.fields, path, update) }));
}

function addInPath(
  fields: AdvancedSchemeField[],
  parentPath: string[],
  newField: AdvancedSchemeField,
): AdvancedSchemeField[] {
  if (parentPath.length === 0) return [...fields, newField];
  const [head, ...tail] = parentPath;
  return fields.map(f => {
    if (f.id !== head) return f;
    if (tail.length === 0) {
      const children = getChildren(f) ?? [];
      return setChildren(f, [...children, newField]);
    }
    const children = getChildren(f);
    if (!children) return f;
    return setChildren(f, addInPath(children, tail, newField));
  });
}

function addPropertyAtPath(
  structure: SchemaSection[],
  sectionId: string,
  parentPath: string[],
  newField: AdvancedSchemeField,
): SchemaSection[] {
  return structure.map(s => (s.id !== sectionId ? s : { ...s, fields: addInPath(s.fields, parentPath, newField) }));
}

function removeInPath(
  fields: AdvancedSchemeField[],
  parentPath: string[],
  targetId: string,
): AdvancedSchemeField[] {
  if (parentPath.length === 0) return fields.filter(f => f.id !== targetId);
  const [head, ...tail] = parentPath;
  return fields.map(f => {
    if (f.id !== head) return f;
    if (tail.length === 0) {
      const children = getChildren(f);
      if (!children) return f;
      return setChildren(f, children.filter(c => c.id !== targetId));
    }
    const children = getChildren(f);
    if (!children) return f;
    return setChildren(f, removeInPath(children, tail, targetId));
  });
}

function removeFieldAtPath(structure: SchemaSection[], sectionId: string, path: string[]): SchemaSection[] {
  if (path.length === 0) return structure;
  const targetId = path[path.length - 1];
  const parentPath = path.slice(0, -1);
  return structure.map(s => (s.id !== sectionId ? s : { ...s, fields: removeInPath(s.fields, parentPath, targetId) }));
}

// =============================================================================
// Data Type Picker — same Popover+Command UI, restyled trigger
// =============================================================================

const TYPE_ICONS: Record<string, React.ElementType> = {
  Type, Hash, ToggleLeft, List, Tags, ListOrdered, Braces, LayoutList, GitFork, AtSign,
};

const UNLOCK_ICONS: Record<string, { icon: React.ElementType; label: string }> = {
  table:    { icon: Table2,    label: "Table" },
  chart:    { icon: BarChart3, label: "Chart" },
  pie:      { icon: PieChart,  label: "Pie" },
  map:      { icon: Map,       label: "Map" },
  timeline: { icon: Clock,     label: "Timeline" },
  graph:    { icon: Network,   label: "Graph" },
};

const DataTypePicker: React.FC<{
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  align?: "start" | "end";
}> = ({ value, onValueChange, disabled, size = "md", align = "start" }) => {
  const [open, setOpen] = useState(false);
  const selected = ADVANCED_SCHEME_TYPE_OPTIONS.find(o => o.value === value);

  const groups = useMemo(() => {
    const order: TypeOption["group"][] = ["primitives", "collections", "structured", "relational"];
    return order.map(g => ({
      group: g,
      label: TYPE_GROUP_LABELS[g],
      options: ADVANCED_SCHEME_TYPE_OPTIONS.filter(o => o.group === g),
    }));
  }, []);

  const triggerClass = size === "sm" ? "h-7 text-xs px-2.5" : "h-9 text-sm px-3";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("justify-between font-normal", triggerClass)}
        >
          {selected ? (
            <span className="flex items-center gap-2 min-w-0">
              {TYPE_ICONS[selected.icon] && React.createElement(TYPE_ICONS[selected.icon], { className: "h-3.5 w-3.5 shrink-0 text-muted-foreground" })}
              <span className="truncate">{selected.label}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">Type…</span>
          )}
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align={align} onWheel={(e) => e.stopPropagation()}>
        <Command>
          <CommandList
            className="max-h-[420px]"
            onWheel={(e) => {
              const el = e.currentTarget;
              if ((e.deltaY > 0 && el.scrollTop < el.scrollHeight - el.clientHeight) || (e.deltaY < 0 && el.scrollTop > 0)) {
                e.stopPropagation();
              }
            }}
          >
            <CommandEmpty>No matching type.</CommandEmpty>
            {groups.map(({ group, label, options }) => (
              <CommandGroup key={group} heading={label}>
                {options.map(opt => {
                  const IconComp = TYPE_ICONS[opt.icon];
                  const isSelected = opt.value === value;
                  return (
                    <CommandItem
                      key={opt.value}
                      value={opt.value}
                      keywords={[opt.label, opt.description]}
                      onSelect={() => { onValueChange(opt.value); setOpen(false); }}
                      className="flex items-start gap-2.5 py-2 px-2"
                    >
                      <div className={cn(
                        "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border",
                        isSelected ? "bg-primary/10 border-primary/30 text-primary" : "bg-muted/50 text-muted-foreground"
                      )}>
                        {IconComp && <IconComp className="h-3.5 w-3.5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={cn("text-sm font-medium", isSelected && "text-primary")}>{opt.label}</span>
                          {isSelected && <Check className="h-3 w-3 text-primary" />}
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{opt.description}</p>
                        {opt.unlocks && opt.unlocks.length > 0 && (
                          <div className="flex items-center gap-1 mt-1.5">
                            {opt.unlocks.map(u => {
                              const info = UNLOCK_ICONS[u];
                              if (!info) return null;
                              return (
                                <span key={u} className="inline-flex items-center gap-0.5 text-[9px] bg-muted/80 text-muted-foreground px-1.5 py-0.5 rounded-full">
                                  <info.icon className="h-2.5 w-2.5" />
                                  {info.label}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

// =============================================================================
// Field templates / suggestions — kept
// =============================================================================

const LOCATION_DESCRIPTION =
  "Geographic location. As specific as the source allows, from specific to general: " +
  "street, neighborhood, city, state/province, country, supranational region. " +
  "Always include enough levels to be unambiguous. Use full names, not abbreviations.";

interface FieldSuggestion {
  key: string;
  label: string;
  icon: React.ElementType;
  color: string;
  field: Omit<AdvancedSchemeField, "id">;
}

const FIELD_SUGGESTIONS: FieldSuggestion[] = [
  {
    key: "timestamp", label: "Timestamp", icon: CalendarClock, color: "text-amber-600",
    field: { name: "timestamp", type: "string", required: false, description: "ISO 8601 datetime of when this event or observation occurred. E.g. 2024-03-15T14:30:00Z" },
  },
  {
    key: "location", label: "Location", icon: MapPin, color: "text-emerald-600",
    field: { name: "location", type: "string", required: false, description: LOCATION_DESCRIPTION },
  },
];

const NESTED_FIELD_SUGGESTIONS: FieldSuggestion[] = [
  {
    key: "timestamp", label: "Timestamp", icon: CalendarClock, color: "text-amber-600",
    field: { name: "timestamp", type: "string", required: false, description: "ISO 8601 datetime." },
  },
  {
    key: "end_timestamp", label: "End time", icon: Clock, color: "text-amber-500",
    field: { name: "end_timestamp", type: "string", required: false, description: "ISO 8601 end datetime for ranges/durations." },
  },
  {
    key: "location", label: "Location", icon: MapPin, color: "text-emerald-600",
    field: { name: "location", type: "string", required: false, description: LOCATION_DESCRIPTION },
  },
];

interface FieldTemplate {
  key: string;
  label: string;
  icon: React.ElementType;
  color: string;
  description: string;
  fields?: Omit<AdvancedSchemeField, "id">[];
  factory?: () => AdvancedSchemeField;
}

const FIELD_TEMPLATES: FieldTemplate[] = [
  {
    key: "events", label: "Events", icon: CalendarRange, color: "text-orange-500",
    description: "A list of events the document describes — one row per event with when, where, who, and what happened",
    fields: [
      { name: "description", type: "string", required: true, description: "What happened — one or two sentences." },
      { name: "timestamp", type: "string", required: true, description: "ISO 8601 datetime of when the event occurred. E.g. 2024-03-15T14:30:00Z" },
      { name: "end_timestamp", type: "string", required: false, description: "ISO 8601 end datetime, if the event spans a period." },
      { name: "location", type: "string", required: false, description: LOCATION_DESCRIPTION },
      { name: "participants", type: "array", required: false, description: "Names of people or organizations involved.", items: { type: "string" } },
    ],
  },
  {
    key: "entities", label: "Entities (canon-resolved)", icon: Users, color: "text-blue-500",
    description: "A list of canonical entities — each item resolves to the canon at curation, so the same name in different fields links automatically.",
    factory: () => ({
      id: nanoid(),
      name: "entities",
      type: "array",
      required: false,
      description: "Entities named in this document — people, organizations, places, or whatever vocabulary you anchor below.",
      items: {
        type: "entity",
        entityConfig: { entity_type: "", typeConstrained: true },
      },
    }),
  },
  {
    key: "graph", label: "Knowledge graph", icon: GitFork, color: "text-purple-500",
    description: "Triplet extraction — subject → predicate → object. Use to capture relationships (worked_for, located_in, met_with).",
    factory: () => ({
      id: nanoid(),
      name: "relationships",
      type: "graph",
      required: false,
      description: "Triplets describing relationships between the entities and concepts in this document.",
      graphConfig: {
        entityTypes: { typeEnum: [], typeConstrained: false },
        relationshipSchema: { predicateEnum: [], predicateConstrained: false, optionalFields: [] },
      },
    }),
  },
  {
    key: "locations", label: "Locations (free text)", icon: Globe, color: "text-emerald-500",
    description: "A list of geographic locations the document mentions. Plain strings — for canon-resolved places, use Entities with entity_type = \"Location\".",
    fields: [],
  },
];

function createFieldFromSuggestion(s: FieldSuggestion): AdvancedSchemeField {
  return { ...s.field, id: nanoid() };
}

function createFieldFromTemplate(t: FieldTemplate): AdvancedSchemeField {
  if (t.factory) return t.factory();
  if (!t.fields || t.fields.length === 0) {
    return { id: nanoid(), name: t.key, type: "array", required: false, description: t.description, items: { type: "string" } };
  }
  return {
    id: nanoid(),
    name: t.key,
    type: "array",
    required: false,
    description: t.description,
    items: {
      type: "object",
      properties: t.fields.map(f => ({ ...f, id: nanoid() })),
    },
  };
}

// =============================================================================
// Justification helpers
// =============================================================================

const RIGOR_TEMPLATE = (level: "minimal" | "standard" | "thorough" | "exhaustive"): string => {
  const counts = { minimal: "1-2", standard: "3-5", thorough: "5-8", exhaustive: "8+" };
  return `Explain your reasoning for this value and provide ${counts[level]} direct quotations from the text that support your answer. Each quotation should be a complete sentence or meaningful phrase.`;
};

function isCustomPromptDefault(customPrompt: string | undefined, rigorLevel: string | undefined): boolean {
  if (!customPrompt || !rigorLevel) return true;
  return customPrompt.trim() === RIGOR_TEMPLATE(rigorLevel as any).trim();
}

// =============================================================================
// Section meta (icons, labels)
// =============================================================================

const SECTION_META: Record<string, { icon: React.ElementType; color: string; title: string; sub: string }> = {
  document: { icon: FileText, color: "text-blue-600", title: "Document", sub: "Fields extracted once from the document body" },
  per_image: { icon: Image, color: "text-green-600", title: "Per image", sub: "Fields extracted once per image asset" },
  per_audio: { icon: Mic, color: "text-purple-600", title: "Per audio", sub: "Fields extracted once per audio asset" },
  per_video: { icon: Video, color: "text-orange-600", title: "Per video", sub: "Fields extracted once per video asset" },
};

// =============================================================================
// Top bar — schema name, description, instructions popover, save/cancel
// =============================================================================


const TopBar: React.FC<{
  formData: AnnotationSchemaFormData;
  onFormChange: (d: AnnotationSchemaFormData) => void;
  formErrors: Record<string, string | string[]>;
  isReady: boolean;
  isLoading: boolean;
  mode: "create" | "edit" | "watch";
  disabled: boolean;
  onCancel: () => void;
}> = ({ formData, onFormChange, formErrors, isReady, isLoading, mode, disabled, onCancel }) => {
  const titleByMode = { create: "New schema", edit: "Edit schema", watch: "View schema" }[mode];
  const [showInstructions, setShowInstructions] = useState(false);

  return (
    <div className="border-b flex flex-col">
      <div className="h-14 flex items-center gap-3 px-5 shrink-0">
        <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          <FileJson className="h-4 w-4 text-primary" />
        </div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold w-[80px] shrink-0">
          {titleByMode}
        </div>
        <div className="flex-1 min-w-0 flex items-center gap-3">
          <Input
            value={formData.name}
            onChange={(e) => onFormChange({ ...formData, name: e.target.value })}
            placeholder="Schema name"
            disabled={disabled}
            className={cn(
              "h-9 text-base font-medium border-0 focus-visible:ring-0 shadow-none px-2",
              "bg-transparent hover:bg-muted/30 focus-visible:bg-muted/40 transition-colors",
              formErrors.name && "ring-1 ring-destructive",
            )}
          />
          <div className="hidden md:block h-5 w-px bg-border/60" />
          <Input
            value={formData.description || ""}
            onChange={(e) => onFormChange({ ...formData, description: e.target.value })}
            placeholder="Description"
            disabled={disabled}
            className="hidden md:block h-9 text-sm border-0 focus-visible:ring-0 shadow-none px-2 bg-transparent hover:bg-muted/30 focus-visible:bg-muted/40 transition-colors"
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowInstructions(s => !s)}
          className="h-8 text-xs gap-1.5 shrink-0"
        >
          <Sparkles className="h-3.5 w-3.5" />
          AI instructions
          <ChevronDown className={cn("h-3 w-3 transition-transform", showInstructions && "rotate-180")} />
        </Button>
        <div className="h-5 w-px bg-border/60 shrink-0" />
        <div className="flex items-center gap-1.5 shrink-0">
          <div className={cn("h-1.5 w-1.5 rounded-full", isReady ? "bg-green-500" : "bg-amber-500")} />
          <span className="text-[11px] text-muted-foreground hidden lg:inline">
            {isReady ? "Ready" : "Fill required fields"}
          </span>
        </div>
        <Button
          type="button" variant="ghost" size="sm"
          onClick={onCancel} disabled={isLoading}
          className="h-8 text-xs"
        >
          Cancel
        </Button>
        {mode !== "watch" && (
          <Button type="submit" size="sm" className="h-8 text-xs px-4" disabled={isLoading || !isReady}>
            {isLoading ? "Saving…" : mode === "create" ? "Create" : "Update"}
          </Button>
        )}
      </div>
      {showInstructions && (
        <div className="px-5 py-3 border-t bg-muted/20">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Schema-level AI instructions
          </Label>
          <p className="text-[11px] text-muted-foreground mt-0.5 mb-2">
            Optional preamble the LLM reads before annotating any field. Useful for global tone, time conventions, language preferences.
          </p>
          <Textarea
            value={formData.instructions || ""}
            onChange={(e) => onFormChange({ ...formData, instructions: e.target.value })}
            placeholder="e.g. All dates ISO 8601 in UTC. Names are German official. If unsure, leave the field empty."
            rows={3}
            disabled={disabled}
            className="text-sm resize-y"
          />
        </div>
      )}
      {formErrors.name && (
        <div className="px-5 pb-2 text-[11px] text-destructive">{formErrors.name as string}</div>
      )}
    </div>
  );
};

// =============================================================================
// Nav tree (left rail)
// =============================================================================

const NavFieldRow: React.FC<{
  field: AdvancedSchemeField;
  sectionId: string;
  path: string[];
  depth: number;
  selectedNodeId: string | null;
  onSelect: (id: string) => void;
  onRemove: (sectionId: string, path: string[]) => void;
  navExpanded: Set<string>;
  onToggleExpanded: (id: string) => void;
  disabled: boolean;
}> = ({ field, sectionId, path, depth, selectedNodeId, onSelect, onRemove, navExpanded, onToggleExpanded, disabled }) => {
  const children = getChildren(field);
  const hasChildren = children !== null && children.length > 0;
  const expanded = navExpanded.has(field.id);
  const selected = selectedNodeId === field.id;

  return (
    <>
      <div
        className={cn(
          "group flex items-center gap-1.5 pr-1 rounded-md cursor-pointer transition-colors",
          selected ? "bg-primary/10 text-foreground" : "hover:bg-muted/40 text-foreground/90",
        )}
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={() => onSelect(field.id)}
      >
        <button
          type="button"
          className={cn(
            "h-5 w-5 flex items-center justify-center shrink-0 text-muted-foreground/60 hover:text-foreground",
            !hasChildren && "invisible",
          )}
          onClick={(e) => { e.stopPropagation(); onToggleExpanded(field.id); }}
          tabIndex={hasChildren ? 0 : -1}
        >
          {hasChildren && (expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)}
        </button>
        {field.ref && <Link2 className="h-3 w-3 text-cyan-600 shrink-0" />}
        <span className={cn("text-xs font-mono truncate flex-1 py-1", !isValidFieldName(field.name) && field.name && "text-amber-600")}>
          {field.name || <span className="italic text-muted-foreground">unnamed</span>}
        </span>
        <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full font-mono shrink-0", getTypeChipClass(field))}>
          {getCompactTypeLabel(field)}
        </span>
        {field.required && (
          <span className="h-1 w-1 rounded-full bg-red-500 shrink-0" title="Required" />
        )}
        {!disabled && (
          <button
            type="button"
            className="h-5 w-5 opacity-0 group-hover:opacity-100 flex items-center justify-center text-muted-foreground hover:text-destructive transition-opacity shrink-0"
            onClick={(e) => { e.stopPropagation(); onRemove(sectionId, path); }}
            title="Remove field"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
      {hasChildren && expanded && children!.map(child => (
        <NavFieldRow
          key={child.id}
          field={child}
          sectionId={sectionId}
          path={[...path, child.id]}
          depth={depth + 1}
          selectedNodeId={selectedNodeId}
          onSelect={onSelect}
          onRemove={onRemove}
          navExpanded={navExpanded}
          onToggleExpanded={onToggleExpanded}
          disabled={disabled}
        />
      ))}
    </>
  );
};

const NavTree: React.FC<{
  structure: SchemaSection[];
  selectedNodeId: string | null;
  onSelect: (id: string) => void;
  navExpanded: Set<string>;
  onToggleExpanded: (id: string) => void;
  onAddTopLevel: (sectionId: string, field?: AdvancedSchemeField) => void;
  onRemoveSection: (sectionId: string) => void;
  onRemoveField: (sectionId: string, path: string[]) => void;
  onAddSection: (name: SchemaSection["name"]) => void;
  disabled: boolean;
  mode: "create" | "edit" | "watch";
  formErrors: Record<string, string | string[]>;
}> = ({ structure, selectedNodeId, onSelect, navExpanded, onToggleExpanded, onAddTopLevel, onRemoveSection, onRemoveField, onAddSection, disabled, mode, formErrors }) => {
  const mediaOptions = [
    { value: "per_image" as const, icon: Image, label: "Images", color: "text-green-600" },
    { value: "per_audio" as const, icon: Mic, label: "Audio", color: "text-purple-600" },
    { value: "per_video" as const, icon: Video, label: "Video", color: "text-orange-600" },
  ];

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="h-10 flex items-center px-4 border-b shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Outline</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
        {structure.map(section => {
          const meta = SECTION_META[section.name] || { icon: FileText, color: "text-muted-foreground", title: section.name, sub: "" };
          const SectIcon = meta.icon;
          const isSectionSelected = selectedNodeId === section.id;
          return (
            <div key={section.id} className="mb-3">
              <div
                className={cn(
                  "group flex items-center gap-2 px-2 h-7 rounded-md cursor-pointer",
                  isSectionSelected ? "bg-primary/10" : "hover:bg-muted/40",
                )}
                onClick={() => onSelect(section.id)}
              >
                <SectIcon className={cn("h-3.5 w-3.5 shrink-0", meta.color)} />
                <span className="text-[10px] uppercase tracking-wider font-semibold flex-1 truncate">
                  {meta.title}
                </span>
                <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{section.fields.length}</span>
                {section.name !== "document" && mode !== "watch" && (
                  <button
                    type="button"
                    className="h-5 w-5 opacity-0 group-hover:opacity-100 flex items-center justify-center text-muted-foreground hover:text-destructive transition-opacity shrink-0"
                    onClick={(e) => { e.stopPropagation(); onRemoveSection(section.id); }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
              <div className="space-y-px mt-0.5">
                {section.fields.map(f => (
                  <NavFieldRow
                    key={f.id}
                    field={f}
                    sectionId={section.id}
                    path={[f.id]}
                    depth={0}
                    selectedNodeId={selectedNodeId}
                    onSelect={onSelect}
                    onRemove={onRemoveField}
                    navExpanded={navExpanded}
                    onToggleExpanded={onToggleExpanded}
                    disabled={disabled}
                  />
                ))}
              </div>
              {mode !== "watch" && (
                <div className="mt-1 px-1 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onAddTopLevel(section.id)}
                    className="flex-1 flex items-center gap-1.5 h-6 px-2 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                  >
                    <PlusCircle className="h-3 w-3" />
                    Add field
                  </button>
                  <TemplatePopover
                    existingFieldNames={section.fields.map(f => f.name)}
                    onAdd={(field) => onAddTopLevel(section.id, field)}
                  />
                  {FIELD_SUGGESTIONS.map(s => {
                    const exists = section.fields.some(f => f.name === s.field.name);
                    return (
                      <button
                        key={s.key}
                        type="button"
                        disabled={exists}
                        onClick={() => onAddTopLevel(section.id, createFieldFromSuggestion(s))}
                        className={cn(
                          "h-6 w-6 flex items-center justify-center rounded-md transition-colors",
                          exists ? "opacity-30" : "hover:bg-muted/60",
                        )}
                        title={exists ? `${s.label} already exists` : `Add ${s.label.toLowerCase()}`}
                      >
                        <s.icon className={cn("h-3 w-3", s.color)} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {formErrors.structure && (
          <div className="flex items-center gap-1.5 text-destructive px-2 py-1.5">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <p className="text-[11px]">{formErrors.structure as string}</p>
          </div>
        )}
      </div>

      {mode !== "watch" && (
        <div className="border-t px-3 py-2.5 shrink-0 space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Add section
          </div>
          <div className="flex flex-wrap gap-1">
            {mediaOptions.map(opt => {
              const exists = structure.some(s => s.name === opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={exists || disabled}
                  onClick={() => onAddSection(opt.value)}
                  className={cn(
                    "flex items-center gap-1 h-6 px-2 rounded-md text-[10px] transition-colors",
                    exists ? "opacity-30" : "hover:bg-muted/60 text-foreground/80",
                  )}
                >
                  <opt.icon className={cn("h-3 w-3", opt.color)} />
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// =============================================================================
// Templates popover
// =============================================================================

const TemplatePopover: React.FC<{
  existingFieldNames: string[];
  onAdd: (field: AdvancedSchemeField) => void;
}> = ({ existingFieldNames, onAdd }) => {
  const [open, setOpen] = useState(false);
  const existing = new Set(existingFieldNames);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="h-6 px-2 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-md transition-colors"
          title="Insert a field template"
        >
          <Sparkles className="h-3 w-3" />
          Templates
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-1.5" align="start" side="bottom" onWheel={(e) => e.stopPropagation()}>
        <div className="space-y-0.5">
          {FIELD_TEMPLATES.map(t => {
            const exists = existing.has(t.key);
            return (
              <button
                key={t.key}
                type="button"
                disabled={exists}
                className={cn(
                  "w-full flex items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                  exists ? "opacity-40 cursor-not-allowed" : "hover:bg-accent cursor-pointer",
                )}
                onClick={() => { onAdd(createFieldFromTemplate(t)); setOpen(false); }}
              >
                <t.icon className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", t.color)} />
                <div className="min-w-0">
                  <div className="text-xs font-medium">{t.label}</div>
                  <div className="text-[10px] text-muted-foreground leading-snug">{t.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
};

// =============================================================================
// Section group label — used inside canvas
// =============================================================================

const SectionLabel: React.FC<{ children: React.ReactNode; className?: string; right?: React.ReactNode }> = ({ children, className, right }) => (
  <div className={cn("flex items-center justify-between gap-3 py-1", className)}>
    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{children}</span>
    {right}
  </div>
);

// =============================================================================
// Canvas (center pane) — the field's identity + content
// =============================================================================

const FieldCanvas: React.FC<{
  resolution: Resolution;
  structure: SchemaSection[];
  onUpdateField: (update: Partial<AdvancedSchemeField>) => void;
  onSelectNode: (id: string | null) => void;
  onAddNested: (field?: AdvancedSchemeField) => void;
  onRemoveField: () => void;
  disabled: boolean;
}> = ({ resolution, structure, onUpdateField, onSelectNode, onAddNested, onRemoveField, disabled }) => {
  if (resolution.kind === "none") return <EmptyCanvas />;
  if (resolution.kind === "section") return <SectionCanvas section={resolution.section} />;

  const { field, section, fieldPath, ancestors } = resolution;
  const SectIcon = SECTION_META[section.name]?.icon || FileText;
  const sectMeta = SECTION_META[section.name];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto px-8 py-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-4">
          <button
            type="button"
            onClick={() => onSelectNode(section.id)}
            className="flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <SectIcon className={cn("h-3 w-3", sectMeta?.color)} />
            <span>{sectMeta?.title || section.name}</span>
          </button>
          {ancestors.map(a => (
            <React.Fragment key={a.id}>
              <ChevronRight className="h-3 w-3 opacity-50" />
              <button
                type="button"
                onClick={() => onSelectNode(a.id)}
                className="hover:text-foreground transition-colors font-mono"
              >
                {a.name}
              </button>
            </React.Fragment>
          ))}
          <ChevronRight className="h-3 w-3 opacity-50" />
          <span className="font-mono text-foreground/80">{field.name}</span>
        </div>

        {/* Identity row: name + type */}
        <div className="flex items-start gap-3 mb-4">
          <Input
            value={field.name}
            onChange={(e) => onUpdateField({ name: e.target.value })}
            placeholder="field_name"
            disabled={disabled}
            className={cn(
              "flex-1 h-11 text-xl font-mono border-0 focus-visible:ring-0 shadow-none px-2 -mx-2",
              "bg-transparent hover:bg-muted/30 focus-visible:bg-muted/40 transition-colors",
              !isValidFieldName(field.name) && field.name && "text-amber-600",
            )}
          />
          <div className="shrink-0">
            <DataTypePicker
              value={getTypeValue(field)}
              onValueChange={(value) => onUpdateField(computeTypeChangeUpdate(field, value))}
              disabled={disabled || !!field.ref}
              align="end"
            />
          </div>
        </div>

        {/* Validation hint */}
        {field.name && !isValidFieldName(field.name) && (
          <div className="text-[11px] text-amber-600 mb-3 -mt-2 px-0.5">
            Use only letters, numbers, and underscores (start with a letter).
          </div>
        )}

        {/* Description (the prompt) */}
        <div className="space-y-1.5 mb-6">
          <SectionLabel>Description (LLM prompt)</SectionLabel>
          <Textarea
            value={field.description || ""}
            onChange={(e) => onUpdateField({ description: e.target.value })}
            placeholder={field.ref
              ? "Override the inherited description, or leave blank to keep the target's."
              : "What should the model extract here? Be specific. Mention edge cases. This text is the LLM's only prompt for this field."}
            rows={4}
            disabled={disabled}
            className="text-sm resize-y min-h-[88px] leading-relaxed"
          />
        </div>

        {/* Type-specific surface */}
        <FieldTypeSurface
          field={field}
          section={section}
          fieldPath={fieldPath}
          structure={structure}
          onUpdateField={onUpdateField}
          onSelectNode={onSelectNode}
          onAddNested={onAddNested}
          disabled={disabled}
        />
      </div>
    </div>
  );
};

const EmptyCanvas: React.FC = () => (
  <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center px-6">
    <FileJson className="h-10 w-10 text-muted-foreground/30 mb-4" />
    <p className="text-sm text-muted-foreground">Select a section or field on the left to configure it.</p>
  </div>
);

const SectionCanvas: React.FC<{ section: SchemaSection }> = ({ section }) => {
  const meta = SECTION_META[section.name] || { icon: FileText, color: "text-muted-foreground", title: section.name, sub: "" };
  const Icon = meta.icon;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-[860px] mx-auto px-8 py-6">
        <div className="flex items-center gap-3 mb-2">
          <Icon className={cn("h-6 w-6", meta.color)} />
          <h2 className="text-2xl font-semibold tracking-tight">{meta.title}</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">{meta.sub}</p>
        <div className="space-y-1 text-sm">
          <div className="flex items-center justify-between py-2 border-b">
            <span className="text-muted-foreground">Fields</span>
            <span className="font-medium tabular-nums">{section.fields.length}</span>
          </div>
          <div className="flex items-center justify-between py-2 border-b">
            <span className="text-muted-foreground">Required</span>
            <span className="font-medium tabular-nums">{section.fields.filter(f => f.required).length}</span>
          </div>
        </div>
        {section.fields.length === 0 && (
          <p className="mt-6 text-sm text-muted-foreground italic">
            No fields yet. Add one from the outline on the left.
          </p>
        )}
      </div>
    </div>
  );
};

// =============================================================================
// Type-specific canvas surfaces
// =============================================================================

const FieldTypeSurface: React.FC<{
  field: AdvancedSchemeField;
  section: SchemaSection;
  fieldPath: string[];
  structure: SchemaSection[];
  onUpdateField: (update: Partial<AdvancedSchemeField>) => void;
  onSelectNode: (id: string | null) => void;
  onAddNested: (field?: AdvancedSchemeField) => void;
  disabled: boolean;
}> = ({ field, section, fieldPath, structure, onUpdateField, onSelectNode, onAddNested, disabled }) => {
  // Ref'd fields inherit type-specific config from target — show explanation only
  if (field.ref) {
    return (
      <div className="rounded-md border border-cyan-200/70 dark:border-cyan-900/50 bg-cyan-50/30 dark:bg-cyan-950/15 px-4 py-3 text-[12px]">
        <div className="flex items-center gap-1.5 text-cyan-700 dark:text-cyan-300 font-medium mb-1">
          <Link2 className="h-3.5 w-3.5" /> Inherited from <code className="font-mono">{field.ref.target}</code>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          Type, allowed values, and entity vocabulary come from the target field. Description above is the only override.
          Break the reference in the right rail to make this field independent.
        </p>
      </div>
    );
  }

  // graph
  if (field.type === "graph" && field.graphConfig) {
    return (
      <div className="-mx-2">
        <GraphSchemaVisualEditor
          field={field}
          section={section}
          disabled={disabled}
          onFieldUpdate={onUpdateField}
        />
      </div>
    );
  }

  // entity (scalar) and array_entity
  if (field.type === "entity") {
    return (
      <EntityVocabularyBlock
        ec={field.entityConfig}
        onChange={(next) => onUpdateField({ entityConfig: next })}
        disabled={disabled}
      />
    );
  }
  if (field.type === "array" && field.items?.type === "entity") {
    return (
      <EntityVocabularyBlock
        ec={field.items.entityConfig}
        onChange={(next) => onUpdateField({ items: { ...field.items!, entityConfig: next } })}
        disabled={disabled}
      />
    );
  }

  // array_string_enum
  if (field.type === "array" && field.items?.type === "string" && field.items.enum !== undefined) {
    return (
      <EnumLabelsBlock
        items={field.items}
        onChange={(items) => onUpdateField({ items })}
        disabled={disabled}
      />
    );
  }

  // string with enum
  if (field.type === "string" && Array.isArray(field.enum)) {
    return (
      <StringEnumBlock
        values={field.enum}
        onChange={(enumVals) => onUpdateField({ enum: enumVals })}
        disabled={disabled}
      />
    );
  }

  // number / integer
  if (field.type === "number" || field.type === "integer") {
    return (
      <NumberBoundsBlock
        minimum={field.minimum} maximum={field.maximum}
        onChange={(b) => onUpdateField(b)}
        disabled={disabled}
      />
    );
  }

  // object / array_object — children outline
  if (fieldCanHostChildren(field)) {
    const children = getChildren(field) ?? [];
    return (
      <NestedChildrenList
        parent={field}
        children={children}
        onSelect={onSelectNode}
        onAdd={onAddNested}
        onUpdate={(childId, update) => {
          const next = applyAtPath(children, [childId], update);
          if (field.type === "object") onUpdateField({ properties: next });
          else if (field.type === "array" && field.items?.type === "object") onUpdateField({ items: { ...field.items, properties: next } });
        }}
        onRemove={(childId) => {
          const next = children.filter(c => c.id !== childId);
          if (field.type === "object") onUpdateField({ properties: next });
          else if (field.type === "array" && field.items?.type === "object") onUpdateField({ items: { ...field.items, properties: next } });
        }}
        disabled={disabled}
      />
    );
  }

  // Plain string — option to convert to enum
  if (field.type === "string") {
    return (
      <div className="rounded-md border border-dashed border-border/70 px-4 py-4 text-[11px] text-muted-foreground">
        Free-form text. Want to restrict to a closed list?{" "}
        <button
          type="button"
          onClick={() => onUpdateField({ enum: [""] })}
          disabled={disabled}
          className="text-primary hover:underline disabled:opacity-50"
        >
          Add allowed values
        </button>
        .
      </div>
    );
  }

  // boolean / array_string / array_number — nothing extra
  return null;
};

// =============================================================================
// Entity vocabulary block (replaces the cyan box)
// =============================================================================

const EntityVocabularyBlock: React.FC<{
  ec?: EntityFieldConfig;
  onChange: (next: EntityFieldConfig) => void;
  disabled: boolean;
}> = ({ ec, onChange, disabled }) => {
  const cfg: EntityFieldConfig = ec ?? { entity_type: "", typeConstrained: true };
  const update = (partial: Partial<EntityFieldConfig>) => onChange({ ...cfg, ...partial });

  const allTypes: string[] = cfg.entity_type ? [cfg.entity_type, ...(cfg.alternate_types || [])] : (cfg.alternate_types || []);
  const onTypesChange = (next: string[]) => {
    if (next.length === 0) update({ entity_type: "", alternate_types: undefined });
    else update({ entity_type: next[0], alternate_types: next.length > 1 ? next.slice(1) : undefined });
  };

  return (
    <div className="space-y-5">
      <div>
        <SectionLabel right={<AtSign className="h-3 w-3 text-cyan-600" />}>Entity vocabulary</SectionLabel>
        <p className="text-[11px] text-muted-foreground -mt-1 mb-3">
          The kinds of entities this field carries. First tag = primary type (used as the canon resolution key). Add more if the model can pick from several.
        </p>
        <TagInput
          tags={allTypes}
          onChange={onTypesChange}
          presets={["PERSON", "ORGANIZATION", "LOCATION", "EVENT", "CONCEPT"]}
          placeholder="Type a type and press Enter (e.g. Konzern, Person, Behörde)"
          disabled={disabled}
          label=""
        />
      </div>

      <div>
        <SectionLabel>Allowed names <span className="lowercase text-muted-foreground/70 normal-case font-normal tracking-normal text-[11px]">— optional</span></SectionLabel>
        <p className="text-[11px] text-muted-foreground -mt-1 mb-3">
          Closed list anchors the model to known names. Leave empty for open extraction; canon resolution still merges duplicates after curation.
        </p>
        <TagInput
          tags={cfg.enum || []}
          onChange={(names) => update({ enum: names.length > 0 ? names : undefined })}
          presets={[]}
          placeholder="Type an allowed name and press Enter"
          disabled={disabled}
          label=""
        />
      </div>

      <div className="flex items-center justify-between gap-4 py-2 border-t">
        <div className="min-w-0">
          <Label className="text-xs font-medium">Strict type</Label>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            On: the model must pick a declared type. Off: it may emit something else (useful as an audit signal for discovering new entity kinds).
          </p>
        </div>
        <Switch
          checked={cfg.typeConstrained !== false}
          onCheckedChange={(checked) => update({ typeConstrained: checked })}
          disabled={disabled}
        />
      </div>

      <div className="flex items-center gap-5 pt-2 border-t">
        <div className="flex items-center gap-2">
          <Label className="text-[11px] font-medium text-muted-foreground">Color</Label>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="h-5 w-5 rounded-full border border-border shadow-sm hover:scale-110 transition-transform"
                style={{ backgroundColor: cfg.color || resolveEntityColor(cfg.entity_type || "DEFAULT") }}
                title="Pick color"
                disabled={disabled}
              />
            </PopoverTrigger>
            <PopoverContent className="w-auto p-3">
              <div className="space-y-2">
                <Label className="text-xs font-medium">Color for {cfg.entity_type || "entity"}</Label>
                <HexColorPicker
                  color={cfg.color || resolveEntityColor(cfg.entity_type || "DEFAULT")}
                  onChange={(c) => update({ color: c })}
                />
                <div className="flex items-center gap-2">
                  <Input
                    value={cfg.color || ""}
                    onChange={(e) => { if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) update({ color: e.target.value }); }}
                    className="h-7 text-xs font-mono"
                    placeholder="#000000"
                  />
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => update({ color: undefined })}>
                    Reset
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-[11px] font-medium text-muted-foreground">Icon</Label>
          {cfg.icon ? <IconRenderer icon={cfg.icon} className="h-4 w-4" /> : <div className="h-4 w-4 rounded bg-muted" />}
          <IconPickerDialog onIconSelect={(iconKey) => update({ icon: iconKey })} defaultIcon={cfg.icon} />
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// Enum / number / nested children blocks
// =============================================================================

const StringEnumBlock: React.FC<{
  values: string[];
  onChange: (values: string[]) => void;
  disabled: boolean;
}> = ({ values, onChange, disabled }) => (
  <div>
    <SectionLabel>Allowed values</SectionLabel>
    <p className="text-[11px] text-muted-foreground -mt-1 mb-3">
      The model is restricted to one of these values. Empty list = remove the constraint.
    </p>
    <TagInput
      tags={values}
      onChange={(next) => onChange(next)}
      presets={[]}
      placeholder="Type a value and press Enter"
      disabled={disabled}
      label=""
    />
    {values.length === 0 && (
      <button
        type="button"
        onClick={() => onChange([])}
        disabled={disabled}
        className="mt-2 text-[11px] text-muted-foreground hover:text-foreground"
      >
        Remove constraint (back to free text)
      </button>
    )}
  </div>
);

const EnumLabelsBlock: React.FC<{
  items: NonNullable<AdvancedSchemeField["items"]>;
  onChange: (items: NonNullable<AdvancedSchemeField["items"]>) => void;
  disabled: boolean;
}> = ({ items, onChange, disabled }) => {
  const enumVals = items.enum || [];
  return (
    <div className="space-y-5">
      <div>
        <SectionLabel>Allowed labels</SectionLabel>
        <p className="text-[11px] text-muted-foreground -mt-1 mb-3">
          The model picks zero or more labels from this list per item.
        </p>
        <TagInput
          tags={enumVals}
          onChange={(next) => onChange({ ...items, enum: next })}
          presets={[]}
          placeholder="Type a label and press Enter"
          disabled={disabled}
          label=""
        />
      </div>
      <div className="flex items-center justify-between gap-4 py-2 border-t">
        <div>
          <Label className="text-xs font-medium">Include &ldquo;Other&rdquo; fallback</Label>
          <p className="text-[11px] text-muted-foreground mt-0.5">Lets the model record an unmatched label rather than dropping it.</p>
        </div>
        <Switch
          checked={items.includeOther ?? false}
          onCheckedChange={(checked) => onChange({ ...items, includeOther: checked })}
          disabled={disabled}
        />
      </div>
      {enumVals.length === 0 && (
        <div className="flex items-start gap-1.5 text-[11px] text-amber-600">
          <AlertTriangle className="h-3 w-3 mt-0.5" />
          Add at least one label, otherwise the model has no valid choices.
        </div>
      )}
    </div>
  );
};

const NumberBoundsBlock: React.FC<{
  minimum?: number;
  maximum?: number;
  onChange: (b: { minimum?: number; maximum?: number }) => void;
  disabled: boolean;
}> = ({ minimum, maximum, onChange, disabled }) => (
  <div>
    <SectionLabel>Value range</SectionLabel>
    <p className="text-[11px] text-muted-foreground -mt-1 mb-3">Optional bounds. Leave empty for unconstrained.</p>
    <div className="grid grid-cols-2 gap-3 max-w-md">
      <div className="space-y-1.5">
        <Label className="text-[11px] font-medium text-muted-foreground">Minimum</Label>
        <Input
          type="number"
          value={minimum ?? ""}
          onChange={(e) => {
            const v = e.target.value === "" ? undefined : parseFloat(e.target.value);
            onChange({ minimum: isNaN(v as number) ? undefined : v, maximum });
          }}
          placeholder="—"
          disabled={disabled}
          className="h-8 text-sm"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-[11px] font-medium text-muted-foreground">Maximum</Label>
        <Input
          type="number"
          value={maximum ?? ""}
          onChange={(e) => {
            const v = e.target.value === "" ? undefined : parseFloat(e.target.value);
            onChange({ minimum, maximum: isNaN(v as number) ? undefined : v });
          }}
          placeholder="—"
          disabled={disabled}
          className="h-8 text-sm"
        />
      </div>
    </div>
  </div>
);

// Children outline rendered inside the canvas — clicking a row selects that
// nested field (the canvas re-renders for it). No nested cards.
const NestedChildrenList: React.FC<{
  parent: AdvancedSchemeField;
  children: AdvancedSchemeField[];
  onSelect: (id: string) => void;
  onAdd: (field?: AdvancedSchemeField) => void;
  onUpdate: (childId: string, update: Partial<AdvancedSchemeField>) => void;
  onRemove: (childId: string) => void;
  disabled: boolean;
}> = ({ parent, children, onSelect, onAdd, onUpdate, onRemove, disabled }) => {
  const isArrayObj = parent.type === "array" && parent.items?.type === "object";
  return (
    <div>
      <SectionLabel right={<span className="text-[10px] text-muted-foreground tabular-nums">{children.length} {children.length === 1 ? "property" : "properties"}</span>}>
        {isArrayObj ? `Each "${parent.name}" item has` : "Properties"}
      </SectionLabel>
      <p className="text-[11px] text-muted-foreground -mt-1 mb-3">
        {isArrayObj
          ? "Click a property to configure it on its own. The model emits one row per item, each filled with these properties."
          : "Click a property to configure it on its own."}
      </p>
      {children.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/70 px-4 py-6 text-[12px] text-muted-foreground text-center">
          No properties yet.
        </div>
      ) : (
        <div className="rounded-md border divide-y">
          {children.map(child => (
            <NestedChildRow
              key={child.id}
              child={child}
              onSelect={() => onSelect(child.id)}
              onUpdate={(u) => onUpdate(child.id, u)}
              onRemove={() => onRemove(child.id)}
              disabled={disabled}
            />
          ))}
        </div>
      )}
      {!disabled && (
        <div className="mt-2 flex items-center gap-1">
          <button
            type="button"
            onClick={() => onAdd()}
            className="flex items-center gap-1.5 h-7 px-3 rounded-md text-[12px] text-foreground/80 hover:bg-muted/50 transition-colors"
          >
            <PlusCircle className="h-3.5 w-3.5" />
            Add property
          </button>
          {NESTED_FIELD_SUGGESTIONS.map(s => {
            const exists = children.some(c => c.name === s.field.name);
            const needsTimestamp = s.key === "end_timestamp" && !children.some(c => c.name === "timestamp");
            const isDisabled = exists || needsTimestamp;
            return (
              <button
                key={s.key}
                type="button"
                disabled={isDisabled}
                onClick={() => onAdd({ ...s.field, id: nanoid() })}
                className={cn(
                  "flex items-center gap-1 h-7 px-2 rounded-md text-[11px] transition-colors",
                  isDisabled ? "opacity-30" : "hover:bg-muted/50 text-foreground/80",
                )}
                title={exists ? `${s.label} already exists` : needsTimestamp ? "Add a timestamp first" : `Add ${s.label.toLowerCase()}`}
              >
                <s.icon className={cn("h-3 w-3", s.color)} />
                {s.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

const NestedChildRow: React.FC<{
  child: AdvancedSchemeField;
  onSelect: () => void;
  onUpdate: (update: Partial<AdvancedSchemeField>) => void;
  onRemove: () => void;
  disabled: boolean;
}> = ({ child, onSelect, onUpdate, onRemove, disabled }) => {
  const sub = child.description?.trim() || (child.ref ? `→ ${child.ref.target}` : "");
  return (
    <div
      className="group flex items-center gap-3 px-3 py-2 hover:bg-muted/30 cursor-pointer transition-colors"
      onClick={onSelect}
    >
      <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-mono shrink-0", getTypeChipClass(child))}>
        {child.ref && <Link2 className="inline h-2.5 w-2.5 mr-0.5" />}
        {getCompactTypeLabel(child)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={cn("text-sm font-mono truncate", !isValidFieldName(child.name) && child.name && "text-amber-600")}>
            {child.name || <span className="italic text-muted-foreground">unnamed</span>}
          </span>
          {child.required && <span className="h-1 w-1 rounded-full bg-red-500" title="Required" />}
          {child.justification?.enabled && <span className="h-1 w-1 rounded-full bg-green-500" title="Justification on" />}
        </div>
        {sub && <p className="text-[11px] text-muted-foreground truncate mt-0.5">{sub}</p>}
      </div>
      <Checkbox
        checked={child.required ?? false}
        onCheckedChange={(checked) => onUpdate({ required: !!checked })}
        onClick={(e) => e.stopPropagation()}
        disabled={disabled}
        className="h-3.5 w-3.5 shrink-0"
        title="Required"
      />
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
      {!disabled && (
        <button
          type="button"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 flex items-center justify-center text-muted-foreground hover:text-destructive transition-opacity shrink-0"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
};

// =============================================================================
// Aux panel (right rail) — required, ref, justification
// =============================================================================

const AuxPanel: React.FC<{
  resolution: Resolution;
  onUpdateField: (update: Partial<AdvancedSchemeField>) => void;
  onRemoveField: () => void;
  disabled: boolean;
}> = ({ resolution, onUpdateField, onRemoveField, disabled }) => {
  if (resolution.kind !== "field") {
    return (
      <div className="h-full flex flex-col">
        <div className="h-10 flex items-center px-4 border-b">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Settings</span>
        </div>
        <div className="flex-1 flex items-center justify-center text-center px-6 text-[12px] text-muted-foreground">
          {resolution.kind === "section"
            ? "Select a field to configure its settings."
            : "No selection."}
        </div>
      </div>
    );
  }
  const { field, section } = resolution;
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="h-10 flex items-center px-4 border-b shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex-1">Settings</span>
        {!disabled && (
          <button
            type="button"
            onClick={onRemoveField}
            className="h-6 px-2 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-destructive rounded-md transition-colors"
          >
            <Trash2 className="h-3 w-3" />
            Remove
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-5 py-4 space-y-6">
          {/* Required */}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <Label className="text-xs font-semibold">Required</Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                The model must produce a value. Use sparingly — overly required schemas hallucinate more.
              </p>
            </div>
            <Switch
              checked={field.required ?? false}
              onCheckedChange={(checked) => onUpdateField({ required: !!checked })}
              disabled={disabled}
            />
          </div>

          <div className="border-t" />

          {/* Inheritance */}
          <RefRow field={field} section={section} disabled={disabled} onFieldUpdate={onUpdateField} />

          <div className="border-t" />

          {/* Justification */}
          <JustificationPanel field={field} disabled={disabled} onUpdateField={onUpdateField} />
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// RefRow — restyled, no colored bg
// =============================================================================

const RefRow: React.FC<{
  field: AdvancedSchemeField;
  section: SchemaSection;
  disabled: boolean;
  onFieldUpdate: (update: Partial<AdvancedSchemeField>) => void;
}> = ({ field, section, disabled, onFieldUpdate }) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const candidates = (section.fields || [])
    .filter(f => f.id !== field.id && f.name)
    .sort((a, b) => {
      const score = (f: AdvancedSchemeField) =>
        f.type === "entity" || (f.type === "array" && f.items?.type === "entity")
          ? 0
          : f.type === "graph" ? 2 : 1;
      return score(a) - score(b);
    });

  if (field.ref) {
    return (
      <div>
        <SectionLabel>Inheritance</SectionLabel>
        <div className="flex items-center gap-2 mt-1">
          <Link2 className="h-3.5 w-3.5 text-cyan-700 dark:text-cyan-400 shrink-0" />
          <span className="text-xs flex-1 truncate">
            <span className="text-muted-foreground">references </span>
            <code className="text-[11px] bg-muted px-1 py-0.5 rounded font-mono">{field.ref.target}</code>
          </span>
          {!disabled && (
            <button
              type="button"
              onClick={() => onFieldUpdate({ ref: undefined })}
              className="h-6 px-2 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/50 transition-colors"
              title="Break reference — restore independent type configuration"
            >
              <Unlink className="h-3 w-3" />
              Break
            </button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5">
          Type, allowed values, and entity vocabulary inherited from the target. Description is the only override.
        </p>
      </div>
    );
  }

  return (
    <div>
      <SectionLabel>Inheritance</SectionLabel>
      <p className="text-[11px] text-muted-foreground -mt-1 mb-2">
        Reuse another top-level field's vocabulary instead of redefining it. Keeps the canon clean.
      </p>
      {disabled || candidates.length === 0 ? (
        <div className="text-[11px] text-muted-foreground italic">
          {disabled ? "—" : "No top-level fields to reference yet."}
        </div>
      ) : (
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button" variant="outline" size="sm"
              className="h-7 text-[11px] gap-1 border-dashed text-muted-foreground hover:text-foreground"
            >
              <Link2 className="h-3 w-3" />
              Use vocabulary from another field
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-1" align="start" onWheel={(e) => e.stopPropagation()}>
            <div
              className="space-y-0.5 max-h-80 overflow-y-auto"
              onWheel={(e) => {
                const el = e.currentTarget;
                if ((e.deltaY > 0 && el.scrollTop < el.scrollHeight - el.clientHeight) || (e.deltaY < 0 && el.scrollTop > 0)) {
                  e.stopPropagation();
                }
              }}
            >
              {candidates.map(cand => (
                <button
                  key={cand.id}
                  type="button"
                  className="w-full flex items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent transition-colors"
                  onClick={() => { onFieldUpdate({ ref: { target: cand.name } }); setPickerOpen(false); }}
                >
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-mono shrink-0 mt-0.5", getTypeChipClass(cand))}>
                    {getCompactTypeLabel(cand)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium font-mono">{cand.name}</div>
                    {cand.description && (
                      <div className="text-[10px] text-muted-foreground line-clamp-2">{cand.description}</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
};

// =============================================================================
// Justification panel
// =============================================================================

const JustificationPanel: React.FC<{
  field: AdvancedSchemeField;
  disabled: boolean;
  onUpdateField: (update: Partial<AdvancedSchemeField>) => void;
}> = ({ field, disabled, onUpdateField }) => {
  const j = field.justification;
  const enabled = !!j?.enabled;
  const rigor = (j?.rigor_level || "standard") as "minimal" | "standard" | "thorough" | "exhaustive";

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <SectionLabel className="py-0">Justification</SectionLabel>
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => {
            if (checked) {
              const level = j?.rigor_level || "standard";
              onUpdateField({
                justification: {
                  enabled: true,
                  rigor_level: level as any,
                  custom_prompt: j?.custom_prompt || RIGOR_TEMPLATE(level as any),
                } as any,
              });
            } else {
              onUpdateField({ justification: { ...(j as any), enabled: false } as any });
            }
          }}
          disabled={disabled}
        />
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        Have the model explain itself with quotations. For array&lt;object&gt; fields the explanation lands inside each row; for scalars it lands as a sibling field.
      </p>

      {enabled && (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-[11px] font-medium text-muted-foreground">Evidence rigor</Label>
            <Select
              value={rigor}
              onValueChange={(value) => {
                const level = value as "minimal" | "standard" | "thorough" | "exhaustive";
                const wasDefault = isCustomPromptDefault(j?.custom_prompt, j?.rigor_level);
                onUpdateField({
                  justification: {
                    enabled: true,
                    rigor_level: level,
                    custom_prompt: wasDefault ? RIGOR_TEMPLATE(level) : j?.custom_prompt,
                  } as any,
                });
              }}
              disabled={disabled}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minimal" className="text-xs">Minimal · 1-2 snippets</SelectItem>
                <SelectItem value="standard" className="text-xs">Standard · 3-5 snippets</SelectItem>
                <SelectItem value="thorough" className="text-xs">Thorough · 5-8 snippets</SelectItem>
                <SelectItem value="exhaustive" className="text-xs">Exhaustive · 8+ snippets</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-medium text-muted-foreground">Custom prompt</Label>
            <Textarea
              value={j?.custom_prompt || ""}
              onChange={(e) => onUpdateField({ justification: { ...(j as any), enabled: true, custom_prompt: e.target.value } as any })}
              placeholder="What should the model explain?"
              rows={4}
              disabled={disabled}
              className="text-[12px] resize-y"
            />
          </div>
        </div>
      )}
    </div>
  );
};

// =============================================================================
// Main editor
// =============================================================================

interface AnnotationSchemaEditorProps {
  show: boolean;
  onClose: () => void;
  schemeId?: number;
  mode: "create" | "edit" | "watch";
  defaultValues?: AnnotationSchemaRead | null;
}

const defaultSchemeFormData: AnnotationSchemaFormData = {
  name: "",
  description: "",
  instructions: "",
  structure: [{ id: nanoid(), name: "document", fields: [] }],
};

const AnnotationSchemaEditor: React.FC<AnnotationSchemaEditorProps> = ({
  show, onClose, schemeId, mode, defaultValues = null,
}) => {
  const { activeInfospace } = useInfospaceStore();
  const { createSchema, updateScheme, isLoadingSchemas, error: apiError, loadSchemas } = useAnnotationSystem();
  const { toast } = useToast();

  const [formData, setFormData] = useState<AnnotationSchemaFormData>(defaultSchemeFormData);
  const [formErrors, setFormErrors] = useState<Record<string, string | string[]>>({});
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [navExpanded, setNavExpanded] = useState<Set<string>>(new Set());

  const isDisabled = isLoadingSchemas || mode === "watch";
  const resolution = useMemo(() => resolveSelection(formData.structure, selectedNodeId), [formData.structure, selectedNodeId]);

  // ---- mutators ----

  const updateSelectedField = (update: Partial<AdvancedSchemeField>) => {
    if (resolution.kind !== "field") return;
    setFormData(prev => ({
      ...prev,
      structure: updateFieldAtPath(prev.structure, resolution.sectionId, resolution.fieldPath, update),
    }));
  };

  const handleAddSection = (sectionName: SchemaSection["name"]) => {
    if (formData.structure.some(s => s.name === sectionName)) {
      toast({ title: "Section exists", description: `A section for '${sectionName}' already exists.` });
      return;
    }
    const newSection: SchemaSection = { id: nanoid(), name: sectionName, fields: [] };
    setFormData(prev => ({ ...prev, structure: [...prev.structure, newSection] }));
    setSelectedNodeId(newSection.id);
  };

  const handleRemoveSection = (sectionId: string) => {
    setFormData(prev => ({ ...prev, structure: prev.structure.filter(s => s.id !== sectionId) }));
    setSelectedNodeId(null);
  };

  const handleAddTopLevelField = (sectionId: string, field?: AdvancedSchemeField) => {
    const newField: AdvancedSchemeField = field ?? { id: nanoid(), name: `new_field_${nanoid(4)}`, type: "string", required: false };
    setFormData(prev => ({
      ...prev,
      structure: addPropertyAtPath(prev.structure, sectionId, [], newField),
    }));
    setSelectedNodeId(newField.id);
  };

  const handleAddNestedField = (field?: AdvancedSchemeField) => {
    if (resolution.kind !== "field") return;
    const newField: AdvancedSchemeField = field ?? { id: nanoid(), name: `property_${nanoid(4)}`, type: "string", required: false };
    setFormData(prev => ({
      ...prev,
      structure: addPropertyAtPath(prev.structure, resolution.sectionId, resolution.fieldPath, newField),
    }));
    setSelectedNodeId(newField.id);
    setNavExpanded(prev => {
      const next = new Set(prev);
      resolution.fieldPath.forEach(id => next.add(id));
      return next;
    });
  };

  const handleRemoveSelectedField = () => {
    if (resolution.kind !== "field") return;
    setFormData(prev => ({
      ...prev,
      structure: removeFieldAtPath(prev.structure, resolution.sectionId, resolution.fieldPath),
    }));
    setSelectedNodeId(resolution.fieldPath.length > 1 ? resolution.fieldPath[resolution.fieldPath.length - 2] : null);
  };

  const removeFieldByPath = (sectionId: string, path: string[]) => {
    setFormData(prev => ({
      ...prev,
      structure: removeFieldAtPath(prev.structure, sectionId, path),
    }));
    if (selectedNodeId && path.includes(selectedNodeId)) {
      setSelectedNodeId(path.length > 1 ? path[path.length - 2] : null);
    }
  };

  const toggleNavExpanded = (id: string) => {
    setNavExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ---- init ----

  useEffect(() => {
    if (mode === "create") {
      const initialField: AdvancedSchemeField = { id: nanoid(), name: "summary", type: "string", description: "A summary of the document.", required: true };
      const initialStructure = { id: nanoid(), name: "document" as const, fields: [initialField] };
      setFormData({ name: "", description: "", instructions: "", structure: [initialStructure] });
      setSelectedNodeId(initialField.id);
    } else if (mode === "edit" || mode === "watch") {
      if (defaultValues) {
        try {
          const adapted = adaptSchemaReadToSchemaFormData(defaultValues);
          setFormData(adapted);
          if (adapted.structure[0]?.fields[0]) {
            setSelectedNodeId(adapted.structure[0].fields[0].id);
          }
        } catch {
          toast({ title: "Error", description: "Failed to load schema data for editing.", variant: "destructive" });
          setFormData(defaultSchemeFormData);
        }
      } else {
        setFormData(defaultSchemeFormData);
      }
    }
  }, [defaultValues, mode, toast]);

  // ---- validation & save ----

  const validateForm = (): boolean => {
    const errors: Record<string, string | string[]> = {};
    let isValid = true;
    if (!formData.name.trim()) { errors.name = "Schema name cannot be empty"; isValid = false; }
    if (formData.structure.length === 0) {
      errors.structure = "At least one section is required"; isValid = false;
    } else if (formData.structure.every(s => s.fields.length === 0)) {
      errors.structure = "At least one field in one section is required"; isValid = false;
    } else {
      for (const section of formData.structure) {
        for (const f of section.fields) {
          if (!f.name.trim()) { errors.structure = "All fields must have a name"; isValid = false; break; }
        }
        if (!isValid) break;
      }
    }
    setFormErrors(errors);
    return isValid;
  };

  const collectMissingDescriptions = (
    fields: AdvancedSchemeField[],
    parentPath = "",
  ): string[] => {
    const missing: string[] = [];
    for (const f of fields) {
      const path = parentPath ? `${parentPath}.${f.name}` : f.name;
      if (f.ref) continue;
      const isSelfExplanatory =
        f.type === "boolean"
        || (f.type === "string" && Array.isArray(f.enum) && f.enum.length > 0)
        || (f.type === "array" && f.items?.type === "string" && Array.isArray(f.items.enum) && f.items.enum.length > 0);
      if (!isSelfExplanatory && !(f.description && f.description.trim())) {
        missing.push(path);
      }
      if (f.properties) missing.push(...collectMissingDescriptions(f.properties, path));
      if (f.items?.properties) missing.push(...collectMissingDescriptions(f.items.properties, `${path}[*]`));
    }
    return missing;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validateForm() || !activeInfospace?.id || mode === "watch") return;
    setFormErrors({});

    const missing = formData.structure.flatMap(s => collectMissingDescriptions(s.fields));
    if (missing.length > 0) {
      const head = missing.slice(0, 8).join(", ");
      const more = missing.length - 8;
      toast({
        title: "Heads up — some fields have no description",
        description: `LLMs use descriptions as prompts. Empty: ${head}${more > 0 ? ` (+${more} more)` : ""}`,
      });
    }

    try {
      let response: AnnotationSchemaRead | null = null;
      if (mode === "create") {
        response = await createSchema(formData);
        toast({ title: "Schema Created", description: `Schema "${response?.name}" created successfully.` });
      } else if (mode === "edit" && schemeId) {
        const updateData: AnnotationSchemaUpdate = adaptSchemaFormDataToSchemaCreate(formData);
        response = await updateScheme(schemeId, updateData);
        toast({ title: "Schema Updated", description: `Schema "${response?.name}" updated successfully.` });
      }
      await loadSchemas({ force: true });
      onClose();
    } catch (error: any) {
      const errorMsg = error.message || apiError || "An unexpected error occurred while saving.";
      setFormErrors({ submit: errorMsg });
      toast({ title: "Save Failed", description: errorMsg, variant: "destructive" });
    }
  };

  const isReady = !!formData.name && formData.structure.some(s => s.fields.length > 0);

  return (
    <Dialog open={show} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[98vw] w-[98vw] h-[96vh] max-h-none p-0 gap-0 rounded-xl overflow-hidden flex flex-col [&>button]:hidden">
        <DialogTitle className="sr-only">
          {mode === "create" ? "Create Schema" : mode === "edit" ? "Edit Schema" : "Schema"}
        </DialogTitle>

        <form onSubmit={handleSubmit} className="flex flex-col h-full min-h-0">
          <TopBar
            formData={formData}
            onFormChange={setFormData}
            formErrors={formErrors}
            isReady={isReady}
            isLoading={isLoadingSchemas}
            mode={mode}
            disabled={isDisabled}
            onCancel={onClose}
          />

          {formErrors.submit && (
            <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{formErrors.submit as string}</AlertDescription>
            </Alert>
          )}

          <div className="flex-1 min-h-0 flex">
            <aside className="w-[256px] shrink-0 border-r min-h-0">
              <NavTree
                structure={formData.structure}
                selectedNodeId={selectedNodeId}
                onSelect={setSelectedNodeId}
                navExpanded={navExpanded}
                onToggleExpanded={toggleNavExpanded}
                onAddTopLevel={handleAddTopLevelField}
                onRemoveSection={handleRemoveSection}
                onRemoveField={removeFieldByPath}
                onAddSection={handleAddSection}
                disabled={isDisabled}
                mode={mode}
                formErrors={formErrors}
              />
            </aside>
            <main className="flex-1 min-w-0 flex flex-col min-h-0">
              <FieldCanvas
                resolution={resolution}
                structure={formData.structure}
                onUpdateField={updateSelectedField}
                onSelectNode={setSelectedNodeId}
                onAddNested={handleAddNestedField}
                onRemoveField={handleRemoveSelectedField}
                disabled={isDisabled}
              />
            </main>
            <aside className="w-[360px] shrink-0 border-l min-h-0">
              <AuxPanel
                resolution={resolution}
                onUpdateField={updateSelectedField}
                onRemoveField={handleRemoveSelectedField}
                disabled={isDisabled}
              />
            </aside>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AnnotationSchemaEditor;
