'use client';

import React, { useState, useEffect } from 'react';
import { useFlowStore } from '@/zustand_stores/storeFlows';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useAnnotationSystem } from '@/hooks/useAnnotationSystem';
import { FlowCreate } from '@/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Activity,
  Plus,
  FolderOpen,
  Microscope,
  Tag,
  GitBranch,
  Filter,
  Zap,
  Radio,
  Clock,
  Play,
  ArrowRight,
  CheckCircle2,
  Loader2,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';

interface FlowCreatorWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

type WizardStep = 'basics' | 'input' | 'processing' | 'output' | 'review';

const wizardSteps: { id: WizardStep; title: string; description: string }[] = [
  { id: 'basics', title: 'Basics', description: 'Name your flow' },
  { id: 'input', title: 'Input', description: 'Select input bundle' },
  { id: 'processing', title: 'Processing', description: 'Configure steps' },
  { id: 'output', title: 'Output', description: 'Set output bundle' },
  { id: 'review', title: 'Review', description: 'Confirm & create' },
];

export default function FlowCreatorWizard({ open, onOpenChange, onSuccess }: FlowCreatorWizardProps) {
  const { activeInfospace } = useInfospaceStore();
  const { createFlow } = useFlowStore();
  const { bundles, fetchBundles } = useBundleStore();
  const { schemas, loadSchemas, isLoadingSchemas } = useAnnotationSystem();

  const [currentStep, setCurrentStep] = useState<WizardStep>('basics');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [inputBundleId, setInputBundleId] = useState<number | null>(null);
  const [triggerMode, setTriggerMode] = useState<'manual' | 'on_arrival'>('on_arrival');
  const [selectedSchemaIds, setSelectedSchemaIds] = useState<Set<number>>(new Set());
  const [enablePreFilter, setEnablePreFilter] = useState(false);
  const [enableCurate, setEnableCurate] = useState(true);
  const [outputBundleId, setOutputBundleId] = useState<number | null>(null);

  // Load data when dialog opens
  useEffect(() => {
    if (open && activeInfospace?.id) {
      fetchBundles(activeInfospace.id);
      loadSchemas();
    }
  }, [open, activeInfospace?.id, fetchBundles, loadSchemas]);

  // Reset form when closed
  useEffect(() => {
    if (!open) {
      setCurrentStep('basics');
      setName('');
      setDescription('');
      setInputBundleId(null);
      setTriggerMode('on_arrival');
      setSelectedSchemaIds(new Set());
      setEnablePreFilter(false);
      setEnableCurate(true);
      setOutputBundleId(null);
    }
  }, [open]);

  const currentStepIndex = wizardSteps.findIndex(s => s.id === currentStep);

  const canProceed = () => {
    switch (currentStep) {
      case 'basics':
        return name.trim().length > 0;
      case 'input':
        return inputBundleId !== null;
      case 'processing':
        return selectedSchemaIds.size > 0;
      case 'output':
        return true; // Output is optional
      case 'review':
        return true;
    }
  };

  const goNext = () => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < wizardSteps.length) {
      setCurrentStep(wizardSteps[nextIndex].id);
    }
  };

  const goBack = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(wizardSteps[prevIndex].id);
    }
  };

  const handleSubmit = async () => {
    if (!name.trim() || !inputBundleId || selectedSchemaIds.size === 0) {
      toast.error('Please complete all required fields');
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

    if (enableCurate) {
      steps.push({
        type: 'CURATE',
        fields: [] // Will use defaults
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
      const result = await createFlow(flowData);
      if (result) {
        onOpenChange(false);
        onSuccess?.();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleSchema = (schemaId: number) => {
    const newSet = new Set(selectedSchemaIds);
    if (newSet.has(schemaId)) {
      newSet.delete(schemaId);
    } else {
      newSet.add(schemaId);
    }
    setSelectedSchemaIds(newSet);
  };

  const inputBundle = bundles.find(b => b.id === inputBundleId);
  const outputBundle = bundles.find(b => b.id === outputBundleId);
  const selectedSchemas = schemas.filter(s => selectedSchemaIds.has(s.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-violet-500" />
            Create Processing Flow
          </DialogTitle>
          <DialogDescription>
            Set up an automated pipeline for your assets
          </DialogDescription>
        </DialogHeader>

        {/* Progress */}
        <div className="px-6 py-3 border-b bg-muted/30">
          <div className="flex items-center justify-between">
            {wizardSteps.map((step, i) => (
              <React.Fragment key={step.id}>
                <button
                  onClick={() => i <= currentStepIndex && setCurrentStep(step.id)}
                  disabled={i > currentStepIndex}
                  className={cn(
                    "flex items-center gap-2 text-sm transition-colors",
                    step.id === currentStep 
                      ? "text-primary font-medium" 
                      : i < currentStepIndex 
                        ? "text-muted-foreground hover:text-foreground cursor-pointer"
                        : "text-muted-foreground/50"
                  )}
                >
                  <div className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium",
                    step.id === currentStep 
                      ? "bg-primary text-primary-foreground" 
                      : i < currentStepIndex 
                        ? "bg-green-500 text-white"
                        : "bg-muted text-muted-foreground"
                  )}>
                    {i < currentStepIndex ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                  </div>
                  <span className="hidden sm:inline">{step.title}</span>
                </button>
                {i < wizardSteps.length - 1 && (
                  <ArrowRight className="h-4 w-4 text-muted-foreground/50" />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Content */}
        <ScrollArea className="flex-1 px-6 py-4">
          {/* Step 1: Basics */}
          {currentStep === 'basics' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="flow-name">Flow Name *</Label>
                <Input
                  id="flow-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., News Analysis Pipeline"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="flow-description">Description (optional)</Label>
                <Textarea
                  id="flow-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does this flow do?"
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>Trigger Mode</Label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setTriggerMode('on_arrival')}
                    className={cn(
                      "p-4 rounded-lg border-2 text-left transition-all",
                      triggerMode === 'on_arrival'
                        ? "border-primary bg-primary/5"
                        : "border-muted hover:border-muted-foreground/30"
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Radio className="h-4 w-4 text-green-500" />
                      <span className="font-medium">On Arrival</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Automatically process new assets as they arrive
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTriggerMode('manual')}
                    className={cn(
                      "p-4 rounded-lg border-2 text-left transition-all",
                      triggerMode === 'manual'
                        ? "border-primary bg-primary/5"
                        : "border-muted hover:border-muted-foreground/30"
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Play className="h-4 w-4" />
                      <span className="font-medium">Manual</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Run only when you trigger it
                    </p>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Input */}
          {currentStep === 'input' && (
            <div className="space-y-4">
              <div>
                <Label className="mb-2 block">Select Input Bundle *</Label>
                <p className="text-sm text-muted-foreground mb-3">
                  The flow will watch this bundle and process new assets
                </p>
                <div className="grid grid-cols-1 gap-2 max-h-[300px] overflow-y-auto">
                  {bundles.map(bundle => (
                    <button
                      key={bundle.id}
                      type="button"
                      onClick={() => setInputBundleId(bundle.id)}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all",
                        inputBundleId === bundle.id
                          ? "border-primary bg-primary/5"
                          : "border-muted hover:border-muted-foreground/30"
                      )}
                    >
                      <FolderOpen className={cn(
                        "h-5 w-5",
                        inputBundleId === bundle.id ? "text-primary" : "text-muted-foreground"
                      )} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{bundle.name}</p>
                        {bundle.description && (
                          <p className="text-xs text-muted-foreground truncate">
                            {bundle.description}
                          </p>
                        )}
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {(bundle as any).asset_count ?? 0} assets
                      </Badge>
                    </button>
                  ))}
                  {bundles.length === 0 && (
                    <p className="text-center py-8 text-muted-foreground">
                      No bundles available. Create a bundle first.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Processing */}
          {currentStep === 'processing' && (
            <div className="space-y-6">
              {/* Schema Selection */}
              <div>
                <Label className="mb-2 block">Annotation Schemas *</Label>
                <p className="text-sm text-muted-foreground mb-3">
                  Select one or more schemas to apply to assets
                </p>
                {isLoadingSchemas ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2 max-h-[200px] overflow-y-auto">
                    {schemas.filter(s => s.is_active !== false).map(schema => (
                      <button
                        key={schema.id}
                        type="button"
                        onClick={() => toggleSchema(schema.id)}
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all",
                          selectedSchemaIds.has(schema.id)
                            ? "border-purple-400 bg-purple-50 dark:bg-purple-950/30"
                            : "border-muted hover:border-muted-foreground/30"
                        )}
                      >
                        <div className={cn(
                          "w-5 h-5 rounded border-2 flex items-center justify-center",
                          selectedSchemaIds.has(schema.id)
                            ? "border-purple-500 bg-purple-500"
                            : "border-muted-foreground/30"
                        )}>
                          {selectedSchemaIds.has(schema.id) && (
                            <CheckCircle2 className="h-3 w-3 text-white" />
                          )}
                        </div>
                        <Microscope className="h-4 w-4 text-purple-500" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{schema.name}</p>
                          {schema.description && (
                            <p className="text-xs text-muted-foreground truncate">
                              {schema.description}
                            </p>
                          )}
                        </div>
                      </button>
                    ))}
                    {schemas.length === 0 && (
                      <p className="text-center py-8 text-muted-foreground">
                        No schemas available. Create a schema first.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Processing Options */}
              <div className="space-y-3 border rounded-lg p-4">
                <Label className="text-sm font-medium">Processing Options</Label>
                
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm">Pre-filter assets</p>
                    <p className="text-xs text-muted-foreground">
                      Skip assets without text content
                    </p>
                  </div>
                  <Switch checked={enablePreFilter} onCheckedChange={setEnablePreFilter} />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm">Curate annotation results</p>
                    <p className="text-xs text-muted-foreground">
                      Promote annotation fields to asset fragments
                    </p>
                  </div>
                  <Switch checked={enableCurate} onCheckedChange={setEnableCurate} />
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Output */}
          {currentStep === 'output' && (
            <div className="space-y-4">
              <div>
                <Label className="mb-2 block">Output Bundle (Optional)</Label>
                <p className="text-sm text-muted-foreground mb-3">
                  Route processed assets to a different bundle
                </p>
                <div className="grid grid-cols-1 gap-2 max-h-[300px] overflow-y-auto">
                  <button
                    type="button"
                    onClick={() => setOutputBundleId(null)}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all",
                      outputBundleId === null
                        ? "border-primary bg-primary/5"
                        : "border-muted hover:border-muted-foreground/30"
                    )}
                  >
                    <FolderOpen className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">No routing</p>
                      <p className="text-xs text-muted-foreground">
                        Assets stay in the input bundle
                      </p>
                    </div>
                  </button>
                  {bundles.filter(b => b.id !== inputBundleId).map(bundle => (
                    <button
                      key={bundle.id}
                      type="button"
                      onClick={() => setOutputBundleId(bundle.id)}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all",
                        outputBundleId === bundle.id
                          ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30"
                          : "border-muted hover:border-muted-foreground/30"
                      )}
                    >
                      <FolderOpen className={cn(
                        "h-5 w-5",
                        outputBundleId === bundle.id ? "text-emerald-500" : "text-muted-foreground"
                      )} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{bundle.name}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 5: Review */}
          {currentStep === 'review' && (
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Flow Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Name</span>
                    <span className="font-medium">{name}</span>
                  </div>
                  {description && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Description</span>
                      <span className="font-medium truncate max-w-[200px]">{description}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Trigger</span>
                    <Badge variant="outline">
                      {triggerMode === 'on_arrival' ? 'Auto (On Arrival)' : 'Manual'}
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Pipeline</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 flex-wrap">
                    {inputBundle && (
                      <div className="flex items-center gap-1 px-2 py-1 bg-blue-50 dark:bg-blue-950/30 rounded border border-blue-200">
                        <FolderOpen className="h-3 w-3 text-blue-600" />
                        <span className="text-xs font-medium">{inputBundle.name}</span>
                      </div>
                    )}
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    {enablePreFilter && (
                      <>
                        <div className="flex items-center gap-1 px-2 py-1 bg-orange-50 dark:bg-orange-950/30 rounded border border-orange-200">
                          <Filter className="h-3 w-3 text-orange-600" />
                          <span className="text-xs font-medium">Filter</span>
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </>
                    )}
                    <div className="flex items-center gap-1 px-2 py-1 bg-purple-50 dark:bg-purple-950/30 rounded border border-purple-200">
                      <Microscope className="h-3 w-3 text-purple-600" />
                      <span className="text-xs font-medium">Annotate ({selectedSchemas.length})</span>
                    </div>
                    {enableCurate && (
                      <>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        <div className="flex items-center gap-1 px-2 py-1 bg-teal-50 dark:bg-teal-950/30 rounded border border-teal-200">
                          <Tag className="h-3 w-3 text-teal-600" />
                          <span className="text-xs font-medium">Curate</span>
                        </div>
                      </>
                    )}
                    {outputBundle && (
                      <>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        <div className="flex items-center gap-1 px-2 py-1 bg-emerald-50 dark:bg-emerald-950/30 rounded border border-emerald-200">
                          <FolderOpen className="h-3 w-3 text-emerald-600" />
                          <span className="text-xs font-medium">{outputBundle.name}</span>
                        </div>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Schemas</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {selectedSchemas.map(schema => (
                      <Badge key={schema.id} variant="outline" className="bg-purple-50">
                        <Microscope className="h-3 w-3 mr-1 text-purple-600" />
                        {schema.name}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t">
          <div className="flex items-center justify-between w-full">
            <Button
              variant="outline"
              onClick={goBack}
              disabled={currentStepIndex === 0}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
            
            {currentStep === 'review' ? (
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
            ) : (
              <Button onClick={goNext} disabled={!canProceed()}>
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
