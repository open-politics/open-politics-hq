'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useFlowStore } from '@/zustand_stores/storeFlows';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { useSourceStore } from '@/zustand_stores/storeSources';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { FlowRead, FlowCreate } from '@/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import {
  Activity,
  Plus,
  Play,
  Pause,
  Trash2,
  Settings,
  Loader2,
  FolderOpen,
  ArrowRight,
  Zap,
  Filter,
  Microscope,
  Tag,
  RotateCcw,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  ChevronRight,
  Radio,
  GitBranch
} from 'lucide-react';

// Flow status colors and labels
const statusConfig: Record<string, { color: string; bgColor: string; label: string }> = {
  draft: { color: 'text-gray-600', bgColor: 'bg-gray-100 dark:bg-gray-800', label: 'Draft' },
  active: { color: 'text-green-600', bgColor: 'bg-green-100 dark:bg-green-900/30', label: 'Active' },
  paused: { color: 'text-yellow-600', bgColor: 'bg-yellow-100 dark:bg-yellow-900/30', label: 'Paused' },
  error: { color: 'text-red-600', bgColor: 'bg-red-100 dark:bg-red-900/30', label: 'Error' },
};

// Step type icons
const stepIcons: Record<string, React.ElementType> = {
  FILTER: Filter,
  ANNOTATE: Microscope,
  CURATE: Tag,
  ROUTE: ArrowRight,
  EMBED: Zap,
  ANALYZE: Activity,
};

interface FlowCardProps {
  flow: FlowRead;
  onSelect: (flow: FlowRead) => void;
  onActivate: (flowId: number) => void;
  onPause: (flowId: number) => void;
  onDelete: (flowId: number) => void;
  onTrigger: (flowId: number) => void;
  isSelected: boolean;
  bundles: { id: number; name: string }[];
}

function FlowCard({ flow, onSelect, onActivate, onPause, onDelete, onTrigger, isSelected, bundles }: FlowCardProps) {
  const status = statusConfig[flow.status || 'draft'] || statusConfig.draft;
  const inputBundle = bundles.find(b => b.id === flow.input_bundle_id);
  const steps = (flow.steps as any[]) || [];

  return (
    <Card 
      className={cn(
        "cursor-pointer transition-all hover:shadow-md",
        isSelected && "ring-2 ring-primary"
      )}
      onClick={() => onSelect(flow)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base truncate">{flow.name}</CardTitle>
            {flow.description && (
              <CardDescription className="text-xs mt-1 line-clamp-2">
                {flow.description}
              </CardDescription>
            )}
          </div>
          <Badge className={cn("ml-2 flex-shrink-0", status.bgColor, status.color)}>
            {status.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Input & Steps Summary */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground overflow-hidden">
          <div className="flex items-center gap-1 flex-shrink-0">
            <FolderOpen className="h-3 w-3" />
            <span className="truncate max-w-[100px]">{inputBundle?.name || 'No input'}</span>
          </div>
          {steps.length > 0 && (
            <>
              <ArrowRight className="h-3 w-3 flex-shrink-0" />
              <div className="flex items-center gap-1">
                {steps.slice(0, 3).map((step, i) => {
                  const StepIcon = stepIcons[step.type] || Activity;
                  return (
                    <div key={i} className="p-1 bg-muted rounded" title={step.type}>
                      <StepIcon className="h-3 w-3" />
                    </div>
                  );
                })}
                {steps.length > 3 && (
                  <span className="text-muted-foreground">+{steps.length - 3}</span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Play className="h-3 w-3" />
            <span>{flow.total_executions || 0} runs</span>
          </div>
          <div className="flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            <span>{flow.total_assets_processed || 0} assets</span>
          </div>
          {flow.trigger_mode === 'on_arrival' && (
            <div className="flex items-center gap-1">
              <Radio className="h-3 w-3 text-green-500" />
              <span>Auto</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2 border-t">
          {flow.status === 'active' ? (
            <Button 
              size="sm" 
              variant="outline"
              onClick={(e) => { e.stopPropagation(); onPause(flow.id); }}
            >
              <Pause className="h-3 w-3 mr-1" />
              Pause
            </Button>
          ) : (
            <Button 
              size="sm" 
              variant="outline"
              onClick={(e) => { e.stopPropagation(); onActivate(flow.id); }}
            >
              <Play className="h-3 w-3 mr-1" />
              Activate
            </Button>
          )}
          <Button 
            size="sm" 
            variant="ghost"
            onClick={(e) => { e.stopPropagation(); onTrigger(flow.id); }}
          >
            <Zap className="h-3 w-3 mr-1" />
            Run Now
          </Button>
          <Button 
            size="sm" 
            variant="ghost"
            className="ml-auto text-destructive hover:text-destructive"
            onClick={(e) => { e.stopPropagation(); onDelete(flow.id); }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface FlowCreatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bundles: { id: number; name: string }[];
  schemas: { id: number; name: string }[];
  onCreate: (flow: FlowCreate) => Promise<void>;
}

function FlowCreator({ open, onOpenChange, bundles, schemas, onCreate }: FlowCreatorProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [inputBundleId, setInputBundleId] = useState<number | null>(null);
  const [triggerMode, setTriggerMode] = useState<'manual' | 'on_arrival' | 'scheduled'>('manual');
  const [selectedSchemaIds, setSelectedSchemaIds] = useState<Set<number>>(new Set());
  const [outputBundleId, setOutputBundleId] = useState<number | null>(null);
  const [enablePreFilter, setEnablePreFilter] = useState(false);
  const [enablePostFilter, setEnablePostFilter] = useState(false);
  const [enableCurate, setEnableCurate] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('Please enter a flow name');
      return;
    }
    if (!inputBundleId) {
      toast.error('Please select an input bundle');
      return;
    }
    if (selectedSchemaIds.size === 0) {
      toast.error('Please select at least one schema');
      return;
    }

    setIsSubmitting(true);

    // Build steps array
    const steps: any[] = [];
    
    if (enablePreFilter) {
      steps.push({
        type: 'FILTER',
        expression: { field: 'text_content', operator: 'exists', value: true }
      });
    }
    
    steps.push({
      type: 'ANNOTATE',
      schema_ids: Array.from(selectedSchemaIds)
    });

    if (enablePostFilter) {
      steps.push({
        type: 'FILTER',
        expression: { field: 'annotation_count', operator: '>', value: 0 }
      });
    }

    if (enableCurate) {
      steps.push({
        type: 'CURATE',
        fields: [] // User can configure later
      });
    }

    if (outputBundleId) {
      steps.push({
        type: 'ROUTE',
        bundle_id: outputBundleId
      });
    }

    const flowData: FlowCreate = {
      name: name.trim(),
      description: description.trim() || undefined,
      input_type: 'bundle',
      input_bundle_id: inputBundleId,
      trigger_mode: triggerMode,
      steps: steps as any,
    };

    try {
      await onCreate(flowData);
      onOpenChange(false);
      // Reset form
      setName('');
      setDescription('');
      setInputBundleId(null);
      setTriggerMode('manual');
      setSelectedSchemaIds(new Set());
      setOutputBundleId(null);
      setEnablePreFilter(false);
      setEnablePostFilter(false);
      setEnableCurate(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            Create New Flow
          </DialogTitle>
          <DialogDescription>
            Set up an automated processing pipeline for your assets.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Basic Info */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="flow-name">Flow Name *</Label>
              <Input
                id="flow-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., News Analysis Pipeline"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="flow-description">Description</Label>
              <Textarea
                id="flow-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this flow do?"
                rows={2}
              />
            </div>
          </div>

          {/* Input Bundle */}
          <div className="space-y-2">
            <Label>Input Bundle *</Label>
            <p className="text-xs text-muted-foreground">
              The bundle to watch for new assets
            </p>
            <Select
              value={inputBundleId?.toString() || ''}
              onValueChange={(val) => setInputBundleId(parseInt(val))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select input bundle" />
              </SelectTrigger>
              <SelectContent>
                {bundles.map(bundle => (
                  <SelectItem key={bundle.id} value={bundle.id.toString()}>
                    <div className="flex items-center gap-2">
                      <FolderOpen className="h-4 w-4" />
                      {bundle.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Trigger Mode */}
          <div className="space-y-2">
            <Label>Trigger Mode</Label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'manual', label: 'Manual', icon: Play, desc: 'Run on demand' },
                { value: 'on_arrival', label: 'On Arrival', icon: Radio, desc: 'Auto-run when assets added' },
                { value: 'scheduled', label: 'Scheduled', icon: Clock, desc: 'Run on schedule' },
              ].map(({ value, label, icon: Icon, desc }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTriggerMode(value as any)}
                  className={cn(
                    "p-3 rounded-lg border-2 text-left transition-all",
                    triggerMode === value
                      ? "border-primary bg-primary/5"
                      : "border-muted hover:border-muted-foreground/30"
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className="h-4 w-4" />
                    <span className="font-medium text-sm">{label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Schema Selection */}
          <div className="space-y-2">
            <Label>Annotation Schemas *</Label>
            <p className="text-xs text-muted-foreground">
              Schemas to apply to incoming assets
            </p>
            <ScrollArea className="h-32 border rounded-md p-2">
              <div className="space-y-1">
                {schemas.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No schemas available. Create one first.
                  </p>
                ) : (
                  schemas.map(schema => (
                    <label
                      key={schema.id}
                      className={cn(
                        "flex items-center gap-2 p-2 rounded-md cursor-pointer hover:bg-muted/50",
                        selectedSchemaIds.has(schema.id) && "bg-primary/10"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selectedSchemaIds.has(schema.id)}
                        onChange={(e) => {
                          const newSet = new Set(selectedSchemaIds);
                          if (e.target.checked) {
                            newSet.add(schema.id);
                          } else {
                            newSet.delete(schema.id);
                          }
                          setSelectedSchemaIds(newSet);
                        }}
                        className="h-4 w-4"
                      />
                      <Microscope className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{schema.name}</span>
                    </label>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Pipeline Options */}
          <div className="space-y-3 border rounded-lg p-4">
            <Label className="text-sm font-medium">Pipeline Options</Label>
            
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm">Pre-filter assets</p>
                <p className="text-xs text-muted-foreground">Filter before annotation</p>
              </div>
              <Switch checked={enablePreFilter} onCheckedChange={setEnablePreFilter} />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm">Post-filter results</p>
                <p className="text-xs text-muted-foreground">Filter after annotation</p>
              </div>
              <Switch checked={enablePostFilter} onCheckedChange={setEnablePostFilter} />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm">Curate fields</p>
                <p className="text-xs text-muted-foreground">Promote annotation fields to asset metadata</p>
              </div>
              <Switch checked={enableCurate} onCheckedChange={setEnableCurate} />
            </div>
          </div>

          {/* Output Bundle */}
          <div className="space-y-2">
            <Label>Output Bundle (Optional)</Label>
            <p className="text-xs text-muted-foreground">
              Route processed assets to a bundle
            </p>
            <Select
              value={outputBundleId?.toString() || 'none'}
              onValueChange={(val) => setOutputBundleId(val === 'none' ? null : parseInt(val))}
            >
              <SelectTrigger>
                <SelectValue placeholder="No routing" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No routing</SelectItem>
                {bundles.map(bundle => (
                  <SelectItem key={bundle.id} value={bundle.id.toString()}>
                    <div className="flex items-center gap-2">
                      <FolderOpen className="h-4 w-4" />
                      {bundle.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                Create Flow
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function FlowManager() {
  const { activeInfospace } = useInfospaceStore();
  const { 
    flows, 
    activeFlow, 
    executions,
    isLoading, 
    isExecuting,
    fetchFlows, 
    createFlow,
    activateFlow, 
    pauseFlow, 
    deleteFlow,
    triggerExecution,
    setActiveFlow,
    resetCursor
  } = useFlowStore();
  const { bundles, fetchBundles } = useBundleStore();
  const { sources, fetchSources } = useSourceStore();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [schemas, setSchemas] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => {
    if (activeInfospace?.id) {
      fetchFlows();
      fetchBundles(activeInfospace.id);
      fetchSources();
      // TODO: Fetch schemas from a proper store/service
    }
  }, [activeInfospace?.id, fetchFlows, fetchBundles, fetchSources]);

  // Mock schemas for now - should come from a schema store
  useEffect(() => {
    // This should be replaced with actual schema fetching
    setSchemas([
      { id: 1, name: 'Sentiment Analysis' },
      { id: 2, name: 'Topic Classification' },
      { id: 3, name: 'Entity Extraction' },
    ]);
  }, []);

  const handleCreateFlow = async (flowData: FlowCreate) => {
    await createFlow(flowData);
  };

  const handleDeleteFlow = async (flowId: number) => {
    if (confirm('Are you sure you want to delete this flow?')) {
      await deleteFlow(flowId);
    }
  };

  // Group flows by status
  const groupedFlows = useMemo(() => {
    const active = flows.filter(f => f.status === 'active');
    const paused = flows.filter(f => f.status === 'paused');
    const draft = flows.filter(f => f.status === 'draft');
    const error = flows.filter(f => f.status === 'error');
    return { active, paused, draft, error };
  }, [flows]);

  const bundleOptions = bundles.map(b => ({ id: b.id, name: b.name }));

  if (!activeInfospace) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Please select an infospace first.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Activity className="h-5 w-5 text-orange-500" />
            Flows
          </h1>
          <p className="text-sm text-muted-foreground">
            Automated processing pipelines for your assets
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => fetchFlows()}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            New Flow
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : flows.length === 0 ? (
          <Card className="max-w-md mx-auto mt-8">
            <CardContent className="pt-6 text-center">
              <Activity className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
              <h3 className="text-lg font-medium mb-2">No Flows Yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Create your first flow to automate asset processing.
              </p>
              <Button onClick={() => setIsCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create Flow
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Tabs defaultValue="all" className="space-y-4">
            <TabsList>
              <TabsTrigger value="all">
                All ({flows.length})
              </TabsTrigger>
              <TabsTrigger value="active" className="text-green-600">
                Active ({groupedFlows.active.length})
              </TabsTrigger>
              <TabsTrigger value="paused" className="text-yellow-600">
                Paused ({groupedFlows.paused.length})
              </TabsTrigger>
              <TabsTrigger value="draft" className="text-gray-600">
                Draft ({groupedFlows.draft.length})
              </TabsTrigger>
            </TabsList>

            {['all', 'active', 'paused', 'draft'].map(tab => (
              <TabsContent key={tab} value={tab} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {(tab === 'all' ? flows : groupedFlows[tab as keyof typeof groupedFlows] || []).map(flow => (
                    <FlowCard
                      key={flow.id}
                      flow={flow}
                      onSelect={setActiveFlow}
                      onActivate={activateFlow}
                      onPause={pauseFlow}
                      onDelete={handleDeleteFlow}
                      onTrigger={triggerExecution}
                      isSelected={activeFlow?.id === flow.id}
                      bundles={bundleOptions}
                    />
                  ))}
                </div>
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>

      {/* Flow Creator Dialog */}
      <FlowCreator
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        bundles={bundleOptions}
        schemas={schemas}
        onCreate={handleCreateFlow}
      />
    </div>
  );
}
