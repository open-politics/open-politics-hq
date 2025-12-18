"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  useReactFlow,
  Panel,
  BackgroundVariant,
  Position,
  Handle,
  NodeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { useFlowStore } from "@/zustand_stores/storeFlows";
import { useBundleStore } from "@/zustand_stores/storeBundles";
import { useSourceStore } from "@/zustand_stores/storeSources";
import { useInfospaceStore } from "@/zustand_stores/storeInfospace";
import { useAnnotationSystem } from "@/hooks/useAnnotationSystem";
import { FlowRead, FlowCreate, FlowUpdate } from "@/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Plus,
  Play,
  Pause,
  Trash2,
  Zap,
  Activity,
  FolderOpen,
  RadioTower,
  Filter,
  Microscope,
  Tag,
  GitBranch,
  Radio,
  CheckCircle2,
  Loader2,
  RefreshCw,
  RotateCcw,
  Maximize2,
  X,
  Save,
  Settings,
  ChevronRight,
} from "lucide-react";

// ============ CUSTOM NODES ============

const stepConfig: Record<string, { icon: typeof Activity; color: string; bg: string; border: string }> = {
  FILTER: { icon: Filter, color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-950/30', border: 'border-orange-300 dark:border-orange-700' },
  ANNOTATE: { icon: Microscope, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-950/30', border: 'border-purple-300 dark:border-purple-700' },
  CURATE: { icon: Tag, color: 'text-teal-600', bg: 'bg-teal-50 dark:bg-teal-950/30', border: 'border-teal-300 dark:border-teal-700' },
  ROUTE: { icon: GitBranch, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-blue-300 dark:border-blue-700' },
  EMBED: { icon: Zap, color: 'text-yellow-600', bg: 'bg-yellow-50 dark:bg-yellow-950/30', border: 'border-yellow-300 dark:border-yellow-700' },
  ANALYZE: { icon: Activity, color: 'text-pink-600', bg: 'bg-pink-50 dark:bg-pink-950/30', border: 'border-pink-300 dark:border-pink-700' },
};

function SourceNode({ data, selected }: NodeProps) {
  return (
    <div className={cn(
      "min-w-[160px] rounded-lg border-2 shadow-md transition-all",
      "border-blue-400 bg-blue-50 dark:bg-blue-950/30",
      selected && "ring-2 ring-primary ring-offset-2"
    )}>
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-blue-500" />
      <div className="px-3 py-2">
        <div className="flex items-center gap-2 mb-1">
          <RadioTower className="h-4 w-4 text-blue-600" />
          <span className="text-xs font-medium text-blue-600">SOURCE</span>
          {selected && <Settings className="h-3 w-3 ml-auto text-muted-foreground" />}
        </div>
        <p className="font-medium text-sm truncate">{data.name}</p>
        <div className="flex items-center gap-2 mt-1">
          <Badge variant="outline" className="text-[10px] px-1">{data.kind}</Badge>
          {data.is_active && data.status === 'active' && (
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          )}
        </div>
      </div>
    </div>
  );
}

function BundleNode({ data, selected }: NodeProps) {
  const isInput = data.role === 'input';
  const isOutput = data.role === 'output';
  
  return (
    <div className={cn(
      "min-w-[140px] rounded-lg border-2 shadow-md transition-all",
      isInput ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30" :
      isOutput ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30" :
      "border-gray-300 bg-gray-50 dark:bg-gray-900",
      selected && "ring-2 ring-primary ring-offset-2"
    )}>
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-amber-500" />
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-amber-500" />
      <div className="px-3 py-2">
        <div className="flex items-center gap-2 mb-1">
          <FolderOpen className={cn("h-4 w-4", isOutput ? "text-emerald-600" : "text-amber-600")} />
          <span className={cn("text-xs font-medium", isOutput ? "text-emerald-600" : "text-amber-600")}>
            {isInput ? 'INPUT' : isOutput ? 'OUTPUT' : 'BUNDLE'}
          </span>
          {selected && <Settings className="h-3 w-3 ml-auto text-muted-foreground" />}
        </div>
        <p className="font-medium text-sm truncate">{data.name}</p>
        <p className="text-xs text-muted-foreground">{data.asset_count ?? 0} assets</p>
      </div>
    </div>
  );
}

function StepNode({ data, selected }: NodeProps) {
  const config = stepConfig[data.type] || stepConfig.ANALYZE;
  const Icon = config.icon;
  
  return (
    <div className={cn(
      "min-w-[130px] rounded-lg border-2 shadow-md transition-all cursor-pointer",
      config.bg, config.border,
      selected && "ring-2 ring-primary ring-offset-2"
    )}>
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-violet-500" />
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-violet-500" />
      <div className="px-3 py-2">
        <div className="flex items-center gap-2">
          <Icon className={cn("h-4 w-4", config.color)} />
          <span className="font-medium text-sm">{data.type}</span>
          {selected && <Settings className="h-3 w-3 ml-auto text-muted-foreground" />}
        </div>
        {data.type === 'ANNOTATE' && data.schema_ids?.length > 0 && (
          <p className="text-xs text-muted-foreground mt-1">{data.schema_ids.length} schema(s)</p>
        )}
        {data.type === 'ROUTE' && (
          <p className="text-xs text-muted-foreground mt-1">
            {data.branches?.length > 0 
              ? `${data.branches.length} branch(es)`
              : data.bundle_name 
                ? `→ ${data.bundle_name}`
                : 'No destination'
            }
          </p>
        )}
        {data.type === 'FILTER' && (
          <p className="text-xs text-muted-foreground mt-1">
            {data.expression?.rules?.length || 0} rule(s)
          </p>
        )}
        {data.type === 'CURATE' && (
          <p className="text-xs text-muted-foreground mt-1">
            {data.fields?.length > 0 ? `${data.fields.length} field(s)` : 'All fields'}
          </p>
        )}
      </div>
    </div>
  );
}

const nodeTypes = { source: SourceNode, bundle: BundleNode, step: StepNode };

// Filter operators available
const FILTER_OPERATORS = [
  { value: 'exists', label: 'Exists', needsValue: false },
  { value: 'not_exists', label: 'Not Exists', needsValue: false },
  { value: '==', label: 'Equals (==)', needsValue: true },
  { value: '!=', label: 'Not Equals (!=)', needsValue: true },
  { value: 'contains', label: 'Contains', needsValue: true },
  { value: 'not_contains', label: 'Not Contains', needsValue: true },
  { value: '>', label: 'Greater Than (>)', needsValue: true },
  { value: '<', label: 'Less Than (<)', needsValue: true },
  { value: '>=', label: 'Greater or Equal (>=)', needsValue: true },
  { value: '<=', label: 'Less or Equal (<=)', needsValue: true },
];

// Base document fields (always available)
const DOCUMENT_FIELDS = [
  { value: 'text_content', label: 'Text Content', category: 'document', type: 'string' },
  { value: 'title', label: 'Title', category: 'document', type: 'string' },
  { value: 'kind', label: 'Asset Kind', category: 'document', type: 'string' },
  { value: 'url', label: 'URL', category: 'document', type: 'string' },
  { value: 'source_identifier', label: 'Source', category: 'document', type: 'string' },
  { value: 'created_at', label: 'Created At', category: 'document', type: 'date' },
];

// Helper to extract fields from schema output_contract with types
function extractSchemaFieldsWithTypes(schema: any): { field: string; type: string; description?: string }[] {
  if (!schema?.output_contract?.properties) return [];
  return Object.entries(schema.output_contract.properties).map(([key, val]: [string, any]) => ({
    field: key,
    type: val.type || 'string',
    description: val.description,
  }));
}

// Build available fields based on step position in flow
function getAvailableFieldsAtStep(
  stepIndex: number,
  steps: any[],
  schemas: any[]
): { value: string; label: string; category: string; type: string }[] {
  const fields = [...DOCUMENT_FIELDS];
  
  // Look at preceding steps to determine what's available
  for (let i = 0; i < stepIndex; i++) {
    const step = steps[i];
    
    if (step.type === 'ANNOTATE' && step.schema_ids?.length) {
      // Add annotation fields from this step's schemas
      step.schema_ids.forEach((schemaId: number) => {
        const schema = schemas.find(s => s.id === schemaId);
        if (schema) {
          extractSchemaFieldsWithTypes(schema).forEach(({ field, type, description }) => {
            fields.push({
              value: `annotations.${schema.name}.${field}`,
              label: `${field}${description ? ` (${description.slice(0, 30)}...)` : ''}`,
              category: `annotation: ${schema.name}`,
              type,
            });
          });
        }
      });
    }
    
    if (step.type === 'CURATE' && step.fields?.length) {
      // Add curated fragment fields
      step.fields.forEach((field: string) => {
        fields.push({
          value: `fragments.${field}`,
          label: field,
          category: 'curated fragment',
          type: 'any',
        });
      });
    }
  }
  
  return fields;
}

// ============ NODE EDITOR PANEL ============

interface NodeEditorProps {
  node: Node | null;
  flow: FlowRead | null;
  bundles: any[];
  schemas: any[];
  onClose: () => void;
  onSave: (updates: Partial<FlowUpdate>) => Promise<void>;
}

function NodeEditor({ node, flow, bundles, schemas, onClose, onSave }: NodeEditorProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [localSteps, setLocalSteps] = useState<any[]>([]);
  const [inputBundleId, setInputBundleId] = useState<string>('');
  
  // Filter rule state
  const [filterField, setFilterField] = useState('text_content');
  const [filterOp, setFilterOp] = useState('exists');
  const [filterValue, setFilterValue] = useState('');
  
  // Route condition state
  const [routeField, setRouteField] = useState('');
  const [routeOp, setRouteOp] = useState('==');
  const [routeValue, setRouteValue] = useState('');
  const [routeBundle, setRouteBundle] = useState('');

  // Initialize local state when node/flow changes
  useEffect(() => {
    if (flow) {
      setLocalSteps([...(flow.steps as any[] || [])]);
      setInputBundleId(flow.input_bundle_id?.toString() || '');
    }
  }, [flow]);

  if (!node || !flow) return null;

  const nodeType = node.type;
  const nodeData = node.data;
  const stepIndex = node.id.startsWith('step-') ? parseInt(node.id.split('-')[1]) : -1;
  const currentStep = stepIndex >= 0 ? localSteps[stepIndex] : null;

  // Get all schema IDs from ANNOTATE steps BEFORE current step for CURATE field selection
  const getSchemaIdsBeforeStep = (beforeIndex: number) => {
    const ids = new Set<number>();
    for (let i = 0; i < beforeIndex; i++) {
      const step = localSteps[i];
      if (step?.type === 'ANNOTATE' && step.schema_ids) {
        step.schema_ids.forEach((id: number) => ids.add(id));
      }
    }
    return ids;
  };

  // Get available fields from selected schemas before this step
  const availableCurateFields = useMemo(() => {
    if (stepIndex < 0) return [];
    const schemaIds = getSchemaIdsBeforeStep(stepIndex);
    const fields: { schemaName: string; schemaId: number; field: string; type: string }[] = [];
    schemas.forEach(schema => {
      if (schemaIds.has(schema.id)) {
        extractSchemaFieldsWithTypes(schema).forEach(({ field, type }) => {
          fields.push({ schemaName: schema.name, schemaId: schema.id, field, type });
        });
      }
    });
    return fields;
  }, [schemas, localSteps, stepIndex]);

  // Get context-aware fields for FILTER/ROUTE at this step position
  const availableFilterFields = useMemo(() => {
    if (stepIndex < 0) return DOCUMENT_FIELDS;
    return getAvailableFieldsAtStep(stepIndex, localSteps, schemas);
  }, [stepIndex, localSteps, schemas]);

  // Group fields by category for display
  const groupedFilterFields = useMemo(() => {
    const groups: Record<string, typeof availableFilterFields> = {};
    availableFilterFields.forEach(f => {
      if (!groups[f.category]) groups[f.category] = [];
      groups[f.category].push(f);
    });
    return groups;
  }, [availableFilterFields]);

  const updateStep = (index: number, updates: any) => {
    const newSteps = [...localSteps];
    newSteps[index] = { ...newSteps[index], ...updates };
    setLocalSteps(newSteps);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updates: Partial<FlowUpdate> = {};
      
      if (nodeType === 'bundle' && nodeData.role === 'input') {
        updates.input_bundle_id = parseInt(inputBundleId);
      } else if (nodeType === 'step') {
        updates.steps = localSteps;
      }
      
      await onSave(updates);
      toast.success('Flow updated');
    } catch (e) {
      toast.error('Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const removeStep = async (index: number) => {
    const newSteps = localSteps.filter((_, i) => i !== index);
    setLocalSteps(newSteps);
    await onSave({ steps: newSteps });
    onClose();
  };

  // Add a filter rule
  const addFilterRule = () => {
    const opConfig = FILTER_OPERATORS.find(o => o.value === filterOp);
    const newRule: any = { field: filterField, operator: filterOp };
    if (opConfig?.needsValue && filterValue) {
      // Try to parse as number if it looks like one
      const numVal = parseFloat(filterValue);
      newRule.value = !isNaN(numVal) && filterValue.trim() === String(numVal) ? numVal : filterValue;
    }
    
    const currentExpr = currentStep?.expression || { operator: 'and', rules: [], sub_expressions: [] };
    const updatedExpr = {
      ...currentExpr,
      rules: [...(currentExpr.rules || []), newRule],
    };
    updateStep(stepIndex, { expression: updatedExpr });
    setFilterValue('');
  };

  // Remove a filter rule
  const removeFilterRule = (ruleIndex: number) => {
    const currentExpr = currentStep?.expression || { operator: 'and', rules: [], sub_expressions: [] };
    const newRules = [...(currentExpr.rules || [])];
    newRules.splice(ruleIndex, 1);
    updateStep(stepIndex, { expression: { ...currentExpr, rules: newRules } });
  };
  
  // Add a route branch
  const addRouteBranch = () => {
    if (!routeBundle) return;
    const opConfig = FILTER_OPERATORS.find(o => o.value === routeOp);
    const condition: any = routeField ? { field: routeField, operator: routeOp } : null;
    if (condition && opConfig?.needsValue && routeValue) {
      const numVal = parseFloat(routeValue);
      condition.value = !isNaN(numVal) && routeValue.trim() === String(numVal) ? numVal : routeValue;
    }
    
    const branches = [...(currentStep.branches || [])];
    branches.push({ 
      bundle_id: parseInt(routeBundle), 
      condition: condition ? { operator: 'and', rules: [condition] } : null,
      label: condition ? `${routeField} ${routeOp} ${routeValue || ''}`.trim() : 'Default'
    });
    updateStep(stepIndex, { branches });
    setRouteField('');
    setRouteValue('');
    setRouteBundle('');
  };
  
  // Remove a route branch
  const removeRouteBranch = (branchIndex: number) => {
    const branches = [...(currentStep.branches || [])];
    branches.splice(branchIndex, 1);
    updateStep(stepIndex, { branches });
  };

  return (
    <div className="w-80 border-l bg-background flex flex-col h-full">
      <div className="p-3 border-b flex items-center justify-between">
        <h3 className="font-semibold text-sm">Edit Node</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 p-4">
        {/* Input Bundle Editor */}
        {nodeType === 'bundle' && nodeData.role === 'input' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-amber-600">
              <FolderOpen className="h-5 w-5" />
              <span className="font-medium">Input Bundle</span>
            </div>
            <div className="space-y-2">
              <Label>Watch Bundle</Label>
              <Select value={inputBundleId} onValueChange={setInputBundleId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select bundle..." />
                </SelectTrigger>
                <SelectContent>
                  {bundles.map(b => (
                    <SelectItem key={b.id} value={b.id.toString()}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* ANNOTATE Step Editor */}
        {nodeType === 'step' && currentStep?.type === 'ANNOTATE' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-purple-600">
              <Microscope className="h-5 w-5" />
              <span className="font-medium">Annotate Step</span>
            </div>
            <div className="space-y-2">
              <Label>Schemas to Apply</Label>
              <div className="border rounded-md max-h-[200px] overflow-y-auto p-2 space-y-1">
                {schemas.filter(s => s.is_active !== false).map(schema => (
                  <label key={schema.id} className="flex items-center gap-2 p-2 rounded hover:bg-muted cursor-pointer">
                    <Checkbox
                      checked={currentStep.schema_ids?.includes(schema.id)}
                      onCheckedChange={(checked) => {
                        const ids = new Set(currentStep.schema_ids || []);
                        if (checked) ids.add(schema.id);
                        else ids.delete(schema.id);
                        updateStep(stepIndex, { schema_ids: Array.from(ids) });
                      }}
                    />
                    <Microscope className="h-4 w-4 text-purple-500" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm">{schema.name}</span>
                      {schema.output_contract?.properties && (
                        <p className="text-[10px] text-muted-foreground truncate">
                          Fields: {Object.keys(schema.output_contract.properties).join(', ')}
                        </p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* FILTER Step Editor */}
        {nodeType === 'step' && currentStep?.type === 'FILTER' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-orange-600">
              <Filter className="h-5 w-5" />
              <span className="font-medium">Filter Step</span>
            </div>
            
            {/* Position context */}
            <div className="p-2 bg-muted/50 rounded text-xs text-muted-foreground">
              {stepIndex === 0 ? (
                <span>📄 Filtering on document fields only (before annotation)</span>
              ) : (
                <span>🔬 Filtering on document + annotation fields</span>
              )}
            </div>
            
            {/* Logical operator */}
            <div className="flex items-center gap-2">
              <Label className="text-xs">Match:</Label>
              <Select 
                value={currentStep.expression?.operator || 'and'} 
                onValueChange={(v) => {
                  const expr = currentStep.expression || { operator: 'and', rules: [] };
                  updateStep(stepIndex, { expression: { ...expr, operator: v } });
                }}
              >
                <SelectTrigger className="h-7 w-24 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="and">ALL rules</SelectItem>
                  <SelectItem value="or">ANY rule</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {/* Current Rules */}
            <div className="space-y-2">
              <Label className="text-xs">Rules ({currentStep.expression?.rules?.length || 0})</Label>
              <div className="space-y-1 max-h-[150px] overflow-y-auto">
                {(currentStep.expression?.rules || []).map((rule: any, i: number) => (
                  <div key={i} className="flex items-center gap-1 p-2 bg-muted rounded text-xs group">
                    <span className="font-mono text-[10px] truncate max-w-[100px]" title={rule.field}>{rule.field}</span>
                    <Badge variant="outline" className="text-[10px] shrink-0">{rule.operator}</Badge>
                    {rule.value !== undefined && (
                      <span className="truncate max-w-[60px]" title={String(rule.value)}>
                        {typeof rule.value === 'string' ? `"${rule.value}"` : rule.value}
                      </span>
                    )}
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-5 w-5 ml-auto opacity-0 group-hover:opacity-100"
                      onClick={() => removeFilterRule(i)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                {(currentStep.expression?.rules?.length || 0) === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-2">No rules - all assets pass through</p>
                )}
              </div>
            </div>

            {/* Add Rule */}
            <div className="space-y-2 border rounded-md p-3 bg-muted/30">
              <Label className="text-xs font-medium">Add Filter Rule</Label>
              
              {/* Field selector with categories */}
              <Select value={filterField} onValueChange={setFilterField}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select field..." />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {Object.entries(groupedFilterFields).map(([category, fields]) => (
                    <div key={category}>
                      <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide bg-muted/50">
                        {category}
                      </div>
                      {fields.map(f => (
                        <SelectItem key={f.value} value={f.value} className="text-xs">
                          <div className="flex items-center gap-2">
                            <span>{f.label}</span>
                            <span className="text-[10px] text-muted-foreground">({f.type})</span>
                          </div>
                        </SelectItem>
                      ))}
                    </div>
                  ))}
                </SelectContent>
              </Select>
              
              <Select value={filterOp} onValueChange={setFilterOp}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FILTER_OPERATORS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              {FILTER_OPERATORS.find(o => o.value === filterOp)?.needsValue && (
                <Input 
                  className="h-8 text-xs"
                  placeholder="Value (string or number)..."
                  value={filterValue}
                  onChange={(e) => setFilterValue(e.target.value)}
                />
              )}
              
              <Button size="sm" className="w-full h-7 text-xs" onClick={addFilterRule}>
                <Plus className="h-3 w-3 mr-1" />
                Add Rule
              </Button>
            </div>
          </div>
        )}

        {/* CURATE Step Editor */}
        {nodeType === 'step' && currentStep?.type === 'CURATE' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-teal-600">
              <Tag className="h-5 w-5" />
              <span className="font-medium">Curate Step</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Promotes annotation values to searchable fragments. Select which fields from preceding annotation schemas to extract.
            </p>
            
            {availableCurateFields.length > 0 ? (
              <div className="space-y-3">
                {/* Group by schema */}
                {schemas.filter(s => getSchemaIdsBeforeStep(stepIndex).has(s.id)).map(schema => {
                  const schemaFields = availableCurateFields.filter(f => f.schemaId === schema.id);
                  if (schemaFields.length === 0) return null;
                  
                  return (
                    <div key={schema.id} className="border rounded-md overflow-hidden">
                      <div className="bg-muted/50 px-3 py-2 flex items-center gap-2">
                        <Microscope className="h-3 w-3 text-purple-500" />
                        <span className="text-xs font-medium">{schema.name}</span>
                      </div>
                      <div className="p-2 space-y-1">
                        {schemaFields.map(({ field, type }) => (
                          <label 
                            key={`${schema.id}-${field}`} 
                            className="flex items-center gap-2 p-2 rounded hover:bg-muted cursor-pointer"
                          >
                            <Checkbox
                              checked={(currentStep.fields || []).includes(field)}
                              onCheckedChange={(checked) => {
                                const fields = new Set(currentStep.fields || []);
                                if (checked) fields.add(field);
                                else fields.delete(field);
                                updateStep(stepIndex, { fields: Array.from(fields) });
                              }}
                            />
                            <div className="flex-1 min-w-0 flex items-center gap-2">
                              <span className="text-sm font-mono">{field}</span>
                              <Badge variant="secondary" className="text-[9px]">{type}</Badge>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
                
                <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                  <span>
                    {(currentStep.fields || []).length === 0 
                      ? 'All fields will be curated'
                      : `${(currentStep.fields || []).length} field(s) selected`
                    }
                  </span>
                  {(currentStep.fields || []).length > 0 && (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-6 text-xs"
                      onClick={() => updateStep(stepIndex, { fields: [] })}
                    >
                      Clear all
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-4 border border-dashed rounded-md text-center space-y-2">
                <p className="text-sm text-muted-foreground">
                  No annotation schemas available yet.
                </p>
                <p className="text-xs text-muted-foreground">
                  Add an ANNOTATE step before this CURATE step to select fields.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ROUTE Step Editor */}
        {nodeType === 'step' && currentStep?.type === 'ROUTE' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-blue-600">
              <GitBranch className="h-5 w-5" />
              <span className="font-medium">Route Step</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Route assets to bundles. Add conditions for branching or use a single unconditional route.
            </p>
            
            {/* Existing branches */}
            <div className="space-y-2">
              <Label className="text-xs">Routes ({(currentStep.branches || []).length || (currentStep.bundle_id ? 1 : 0)})</Label>
              
              {/* Legacy single bundle_id */}
              {currentStep.bundle_id && !(currentStep.branches?.length) && (
                <div className="p-2 bg-muted rounded text-xs flex items-center gap-2">
                  <FolderOpen className="h-4 w-4 text-amber-600" />
                  <span className="flex-1">{bundles.find(b => b.id === currentStep.bundle_id)?.name || 'Unknown'}</span>
                  <Badge variant="outline" className="text-[10px]">Default</Badge>
                </div>
              )}
              
              {/* Branches */}
              {(currentStep.branches || []).map((branch: any, i: number) => (
                <div key={i} className="p-2 bg-muted rounded text-xs group">
                  <div className="flex items-center gap-2">
                    <FolderOpen className="h-4 w-4 text-amber-600 shrink-0" />
                    <span className="flex-1 truncate">{bundles.find(b => b.id === branch.bundle_id)?.name || 'Unknown'}</span>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-5 w-5 opacity-0 group-hover:opacity-100"
                      onClick={() => removeRouteBranch(i)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                  {branch.condition?.rules?.length > 0 ? (
                    <div className="mt-1 pl-6 text-[10px] text-muted-foreground">
                      When: {branch.condition.rules.map((r: any) => 
                        `${r.field} ${r.operator} ${r.value ?? ''}`
                      ).join(' & ')}
                    </div>
                  ) : (
                    <div className="mt-1 pl-6 text-[10px] text-muted-foreground">
                      Default (no condition)
                    </div>
                  )}
                </div>
              ))}
              
              {!currentStep.bundle_id && !(currentStep.branches?.length) && (
                <p className="text-xs text-muted-foreground text-center py-2">No routes defined</p>
              )}
            </div>

            {/* Add branch */}
            <div className="space-y-2 border rounded-md p-3 bg-muted/30">
              <Label className="text-xs font-medium">Add Route Branch</Label>
              
              {/* Destination bundle */}
              <Select value={routeBundle} onValueChange={setRouteBundle}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select destination bundle..." />
                </SelectTrigger>
                <SelectContent>
                  {bundles.filter(b => b.id !== flow.input_bundle_id).map(b => (
                    <SelectItem key={b.id} value={b.id.toString()}>
                      <div className="flex items-center gap-2">
                        <FolderOpen className="h-3 w-3" />
                        {b.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              {/* Optional condition */}
              <div className="pt-2 border-t mt-2">
                <Label className="text-[10px] text-muted-foreground">Optional: Route only when...</Label>
              </div>
              
              <Select value={routeField} onValueChange={setRouteField}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="(No condition - default route)" />
                </SelectTrigger>
                <SelectContent className="max-h-[200px]">
                  <SelectItem value="_none" className="text-xs text-muted-foreground">
                    No condition (default route)
                  </SelectItem>
                  {Object.entries(groupedFilterFields).map(([category, fields]) => (
                    <div key={category}>
                      <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase bg-muted/50">
                        {category}
                      </div>
                      {fields.map(f => (
                        <SelectItem key={f.value} value={f.value} className="text-xs">
                          {f.label}
                        </SelectItem>
                      ))}
                    </div>
                  ))}
                </SelectContent>
              </Select>
              
              {routeField && routeField !== '_none' && (
                <>
                  <Select value={routeOp} onValueChange={setRouteOp}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FILTER_OPERATORS.map(o => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  
                  {FILTER_OPERATORS.find(o => o.value === routeOp)?.needsValue && (
                    <Input 
                      className="h-8 text-xs"
                      placeholder="Value..."
                      value={routeValue}
                      onChange={(e) => setRouteValue(e.target.value)}
                    />
                  )}
                </>
              )}
              
              <Button 
                size="sm" 
                className="w-full h-7 text-xs" 
                onClick={() => {
                  if (routeField === '_none') setRouteField('');
                  addRouteBranch();
                }}
                disabled={!routeBundle}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add Route
              </Button>
            </div>
          </div>
        )}

        {/* Source (read-only info) */}
        {nodeType === 'source' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-blue-600">
              <RadioTower className="h-5 w-5" />
              <span className="font-medium">Source</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Name</span>
                <span>{nodeData.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Type</span>
                <Badge variant="outline">{nodeData.kind}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <Badge variant={nodeData.is_active ? 'default' : 'secondary'}>
                  {nodeData.status || 'idle'}
                </Badge>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Edit source settings in the Sources page.
            </p>
          </div>
        )}

        {/* Output Bundle (read-only) */}
        {nodeType === 'bundle' && nodeData.role === 'output' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-emerald-600">
              <FolderOpen className="h-5 w-5" />
              <span className="font-medium">Output Bundle</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Configure the ROUTE step to change the output bundle.
            </p>
          </div>
        )}

        {/* Delete Step */}
        {nodeType === 'step' && (
          <>
            <Separator className="my-4" />
            <Button 
              variant="outline" 
              className="w-full text-destructive hover:text-destructive"
              onClick={() => removeStep(stepIndex)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Remove Step
            </Button>
          </>
        )}
      </ScrollArea>

      {/* Save Button */}
      {(nodeType === 'step' || (nodeType === 'bundle' && nodeData.role === 'input')) && (
        <div className="p-3 border-t">
          <Button className="w-full" onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Save Changes
          </Button>
        </div>
      )}
    </div>
  );
}

// ============ MAIN COMPONENT ============

function FlowsPageInner() {
  const { activeInfospace } = useInfospaceStore();
  const { flows, isLoading, fetchFlows, createFlow, updateFlow, activateFlow, pauseFlow, triggerExecution, deleteFlow, resetCursor } = useFlowStore();
  const { bundles, fetchBundles } = useBundleStore();
  const { sources, fetchSources } = useSourceStore();
  const { schemas, loadSchemas } = useAnnotationSystem();
  const { fitView } = useReactFlow();

  const [selectedFlowId, setSelectedFlowId] = useState<number | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  
  // Create form state
  const [newFlowName, setNewFlowName] = useState('');
  const [newFlowInputBundle, setNewFlowInputBundle] = useState<string>('');
  const [newFlowOutputBundle, setNewFlowOutputBundle] = useState<string>('');
  const [newFlowSchemas, setNewFlowSchemas] = useState<Set<number>>(new Set());
  const [isCreating, setIsCreating] = useState(false);

  // Load data
  useEffect(() => {
    if (activeInfospace?.id) {
      fetchFlows();
      fetchBundles(activeInfospace.id);
      fetchSources();
      loadSchemas();
    }
  }, [activeInfospace?.id, fetchFlows, fetchBundles, fetchSources, loadSchemas]);

  // Auto-select first flow
  useEffect(() => {
    if (flows.length > 0 && !selectedFlowId) {
      setSelectedFlowId(flows[0].id);
    }
  }, [flows, selectedFlowId]);

  const selectedFlow = flows.find(f => f.id === selectedFlowId) || null;

  // Build nodes/edges for selected flow
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    if (!selectedFlow) return { nodes: [], edges: [] };

    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const steps = (selectedFlow.steps as any[]) || [];
    const STEP_WIDTH = 180;
    let xPos = 0;
    const yPos = 100;

    // Find related source
    const inputBundle = bundles.find(b => b.id === selectedFlow.input_bundle_id);
    const relatedSource = sources.find(s => s.output_bundle_id === selectedFlow.input_bundle_id);

    // Source
    if (relatedSource) {
      nodes.push({
        id: 'source',
        type: 'source',
        position: { x: xPos, y: yPos },
        data: relatedSource,
      });
      xPos += STEP_WIDTH;
    }

    // Input Bundle
    if (inputBundle) {
      nodes.push({
        id: 'input-bundle',
        type: 'bundle',
        position: { x: xPos, y: yPos },
        data: { ...inputBundle, role: 'input' },
      });
      if (relatedSource) {
        edges.push({
          id: 'e-source-input',
          source: 'source',
          target: 'input-bundle',
          animated: relatedSource.is_active && relatedSource.status === 'active',
          style: { stroke: '#3b82f6', strokeWidth: 2 },
        });
      }
      xPos += STEP_WIDTH;
    }

    // Steps
    let prevId = inputBundle ? 'input-bundle' : (relatedSource ? 'source' : null);
    steps.forEach((step, i) => {
      const stepId = `step-${i}`;
      const routeBundle = step.type === 'ROUTE' && step.bundle_id 
        ? bundles.find(b => b.id === step.bundle_id) 
        : null;
      
      nodes.push({
        id: stepId,
        type: 'step',
        position: { x: xPos, y: yPos },
        data: { 
          ...step, 
          bundle_name: routeBundle?.name,
        },
      });
      if (prevId) {
        edges.push({
          id: `e-${prevId}-${stepId}`,
          source: prevId,
          target: stepId,
          animated: selectedFlow.status === 'active',
          style: { stroke: '#8b5cf6', strokeWidth: 2 },
        });
      }
      prevId = stepId;
      xPos += STEP_WIDTH;
    });

    // Output Bundle
    const routeStep = steps.find(s => s.type === 'ROUTE');
    if (routeStep?.bundle_id) {
      const outputBundle = bundles.find(b => b.id === routeStep.bundle_id);
      if (outputBundle) {
        nodes.push({
          id: 'output-bundle',
          type: 'bundle',
          position: { x: xPos, y: yPos },
          data: { ...outputBundle, role: 'output' },
        });
        if (prevId) {
          edges.push({
            id: `e-${prevId}-output`,
            source: prevId,
            target: 'output-bundle',
            animated: selectedFlow.status === 'active',
            style: { stroke: '#10b981', strokeWidth: 2 },
          });
        }
      }
    }

    return { nodes, edges };
  }, [selectedFlow, bundles, sources]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
    setSelectedNode(null);
    if (initialNodes.length > 0) {
      setTimeout(() => fitView({ padding: 0.3, duration: 300 }), 50);
    }
  }, [initialNodes, initialEdges, setNodes, setEdges, fitView]);

  // Handle node click
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // Save flow updates
  const handleSaveFlow = async (updates: Partial<FlowUpdate>) => {
    if (!selectedFlow) return;
    await updateFlow(selectedFlow.id, updates);
    await fetchFlows();
  };

  // Create flow
  const handleCreate = async () => {
    if (!newFlowName.trim() || !newFlowInputBundle || newFlowSchemas.size === 0) return;
    
    setIsCreating(true);
    const steps: any[] = [
      { type: 'ANNOTATE', schema_ids: Array.from(newFlowSchemas) },
      { type: 'CURATE', fields: [] },
    ];
    if (newFlowOutputBundle) {
      steps.push({ type: 'ROUTE', bundle_id: parseInt(newFlowOutputBundle) });
    }

    const flowData: FlowCreate = {
      name: newFlowName.trim(),
      input_type: 'bundle',
      input_bundle_id: parseInt(newFlowInputBundle),
      trigger_mode: 'on_arrival',
      steps,
    };

    const result = await createFlow(flowData);
    setIsCreating(false);
    if (result) {
      setIsCreateOpen(false);
      setNewFlowName('');
      setNewFlowInputBundle('');
      setNewFlowOutputBundle('');
      setNewFlowSchemas(new Set());
      setSelectedFlowId(result.id);
    }
  };

  const handleDelete = async () => {
    if (!selectedFlow) return;
    if (confirm(`Delete "${selectedFlow.name}"?`)) {
      await deleteFlow(selectedFlow.id);
      setSelectedFlowId(null);
    }
  };

  // Add step
  const addStep = async (type: string) => {
    if (!selectedFlow) return;
    const currentSteps = [...(selectedFlow.steps as any[] || [])];
    
    let newStep: any = { type };
    if (type === 'ANNOTATE') {
      newStep.schema_ids = [];
    } else if (type === 'FILTER') {
      newStep.expression = { operator: 'and', rules: [] };
    } else if (type === 'CURATE') {
      newStep.fields = [];
    } else if (type === 'ROUTE') {
      newStep.bundle_id = null;
    }
    
    // Insert before ROUTE if exists, otherwise append
    const routeIndex = currentSteps.findIndex(s => s.type === 'ROUTE');
    if (routeIndex >= 0) {
      currentSteps.splice(routeIndex, 0, newStep);
    } else {
      currentSteps.push(newStep);
    }
    
    await updateFlow(selectedFlow.id, { steps: currentSteps });
    await fetchFlows();
  };

  if (!activeInfospace) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Select an infospace first</p>
      </div>
    );
  }

  return (
    <div className="h-full flex min-h-[91svh] md:min-h-[92.75svh] max-h-[92.75svh] w-full max-w-full overflow-hidden">
      {/* LEFT: Flow Selector */}
      <div className="w-56 border-r flex flex-col bg-muted/20">
        <div className="p-3 border-b flex items-center justify-between">
          <h2 className="font-semibold text-sm">Flows</h2>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : flows.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No flows yet</p>
              </div>
            ) : (
              flows.map(flow => (
                <button
                  key={flow.id}
                  onClick={() => { setSelectedFlowId(flow.id); setSelectedNode(null); }}
                  className={cn(
                    "w-full text-left p-2 rounded-md transition-colors",
                    selectedFlowId === flow.id
                      ? "bg-primary/10 border border-primary/30"
                      : "hover:bg-muted"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Activity className={cn(
                      "h-4 w-4 flex-shrink-0",
                      flow.status === 'active' ? "text-green-500" :
                      flow.status === 'paused' ? "text-yellow-500" : "text-gray-400"
                    )} />
                    <span className="font-medium text-sm truncate flex-1">{flow.name}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 ml-6 text-xs text-muted-foreground">
                    <Badge variant={flow.status === 'active' ? 'default' : 'secondary'} className="text-[10px] px-1">
                      {flow.status}
                    </Badge>
                  </div>
                </button>
              ))
            )}
          </div>
        </ScrollArea>

        <div className="p-2 border-t">
          <Button size="sm" variant="ghost" className="w-full justify-start text-xs" onClick={() => fetchFlows()}>
            <RefreshCw className="h-3 w-3 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* CENTER: Canvas */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedFlow ? (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b bg-background flex-shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <Activity className={cn(
                  "h-5 w-5 flex-shrink-0",
                  selectedFlow.status === 'active' ? "text-green-500" :
                  selectedFlow.status === 'paused' ? "text-yellow-500" : "text-gray-400"
                )} />
                <div className="min-w-0">
                  <h1 className="font-semibold truncate">{selectedFlow.name}</h1>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {selectedFlow.trigger_mode === 'on_arrival' && (
                      <span className="flex items-center gap-1">
                        <Radio className="h-3 w-3 text-green-500" />
                        auto-trigger
                      </span>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => triggerExecution(selectedFlow.id)}>
                  <Zap className="h-3.5 w-3.5" />
                </Button>
                {selectedFlow.status === 'active' ? (
                  <Button size="sm" variant="ghost" onClick={() => pauseFlow(selectedFlow.id)}>
                    <Pause className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => activateFlow(selectedFlow.id)}>
                    <Play className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="text-destructive" onClick={handleDelete}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Canvas */}
            <div className="flex-1 min-h-0">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={onNodeClick}
                onPaneClick={onPaneClick}
                nodeTypes={nodeTypes}
                fitView
                minZoom={0.5}
                maxZoom={2}
              >
                <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
                <Controls showInteractive={false} className="!bg-background !border" />
                
                {/* Add Step Panel */}
                <Panel position="top-left" className="flex items-center gap-1 bg-background/90 border rounded-md p-1">
                  <span className="text-xs text-muted-foreground px-2">Add:</span>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => addStep('FILTER')}>
                    <Filter className="h-3 w-3 mr-1" />Filter
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => addStep('ANNOTATE')}>
                    <Microscope className="h-3 w-3 mr-1" />Annotate
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => addStep('CURATE')}>
                    <Tag className="h-3 w-3 mr-1" />Curate
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => addStep('ROUTE')}>
                    <GitBranch className="h-3 w-3 mr-1" />Route
                  </Button>
                </Panel>

                <Panel position="top-right">
                  <Button size="sm" variant="outline" onClick={() => fitView({ padding: 0.3 })}>
                    <Maximize2 className="h-3 w-3" />
                  </Button>
                </Panel>
              </ReactFlow>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-4 px-4 py-1.5 border-t text-xs text-muted-foreground bg-muted/30 flex-shrink-0">
              <span>Runs: <strong>{selectedFlow.total_executions || 0}</strong></span>
              <span>Assets: <strong>{selectedFlow.total_assets_processed || 0}</strong></span>
              <span className="ml-auto text-[10px]">Click a node to edit</span>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Activity className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>Select a flow to view its pipeline</p>
            </div>
          </div>
        )}
      </div>

      {/* RIGHT: Node Editor */}
      {selectedNode && (
        <NodeEditor
          node={selectedNode}
          flow={selectedFlow}
          bundles={bundles}
          schemas={schemas}
          onClose={() => setSelectedNode(null)}
          onSave={handleSaveFlow}
        />
      )}

      {/* Create Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Flow</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={newFlowName}
                onChange={(e) => setNewFlowName(e.target.value)}
                placeholder="My Analysis Flow"
              />
            </div>

            <div className="space-y-2">
              <Label>Input Bundle</Label>
              <Select value={newFlowInputBundle} onValueChange={setNewFlowInputBundle}>
                <SelectTrigger>
                  <SelectValue placeholder="Select bundle to watch..." />
                </SelectTrigger>
                <SelectContent>
                  {bundles.map(b => (
                    <SelectItem key={b.id} value={b.id.toString()}>
                      <div className="flex items-center gap-2">
                        <FolderOpen className="h-4 w-4" />
                        {b.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Annotation Schemas</Label>
              <div className="border rounded-md max-h-[150px] overflow-y-auto p-2 space-y-1">
                {schemas.filter(s => s.is_active !== false).map(schema => (
                  <label
                    key={schema.id}
                    className="flex items-center gap-2 p-2 rounded hover:bg-muted cursor-pointer"
                  >
                    <Checkbox
                      checked={newFlowSchemas.has(schema.id)}
                      onCheckedChange={(checked) => {
                        const next = new Set(newFlowSchemas);
                        if (checked) next.add(schema.id);
                        else next.delete(schema.id);
                        setNewFlowSchemas(next);
                      }}
                    />
                    <Microscope className="h-4 w-4 text-purple-500" />
                    <span className="text-sm">{schema.name}</span>
                  </label>
                ))}
                {schemas.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No schemas available</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Output Bundle (optional)</Label>
              <Select value={newFlowOutputBundle || "none"} onValueChange={(v) => setNewFlowOutputBundle(v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Route to bundle..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No routing</SelectItem>
                  {bundles.filter(b => b.id.toString() !== newFlowInputBundle).map(b => (
                    <SelectItem key={b.id} value={b.id.toString()}>
                      <div className="flex items-center gap-2">
                        <FolderOpen className="h-4 w-4" />
                        {b.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button 
              onClick={handleCreate} 
              disabled={!newFlowName.trim() || !newFlowInputBundle || newFlowSchemas.size === 0 || isCreating}
            >
              {isCreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function FlowsPage() {
  return (
    <ReactFlowProvider>
      <FlowsPageInner />
    </ReactFlowProvider>
  );
}
