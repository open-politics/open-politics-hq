'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileText, Play, Loader2, ListChecks, ChevronUp, ChevronDown, Plus, Settings2, XCircle, Eye, ChevronRight } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { AnnotationSchemaRead, AssetRead } from '@/client/models';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';
import { useAnnotationSystem } from '@/hooks/useAnnotationSystem';
import { AnnotationRunParams } from '@/lib/annotations/types';
import { SchemePreview } from './schemaCreation/SchemePreview';
import AnnotationSchemaEditor from './AnnotationSchemaEditor';
import AssetSelector from '../assets/AssetSelector';
import { toast } from 'sonner';
import { useApiKeysStore } from '@/zustand_stores/storeApiKeys';
import ProviderSelector from '../management/ProviderSelector';

// --- NEW: Scheme Selector Component ---
interface SchemeSelectorForRunProps {
  allSchemes: AnnotationSchemaRead[];
  selectedSchemeIds: number[];
  onToggleScheme: (schemeId: number) => void;
  onPreviewScheme: (scheme: AnnotationSchemaRead) => void;
  onOpenSchemeEditor: () => void;
}

const SchemeSelectorForRun: React.FC<SchemeSelectorForRunProps> = ({
  allSchemes,
  selectedSchemeIds,
  onToggleScheme,
  onPreviewScheme,
  onOpenSchemeEditor,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredSchemes = useMemo(() => {
    return allSchemes.filter(scheme =>
      scheme.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [allSchemes, searchTerm]);

  return (
    <div className="flex flex-col h-full border rounded-md bg-background">
      <div className="flex-none p-3 border-b">
        <div className="flex items-center gap-2">
          <div className="relative flex-grow">
            <Input
                placeholder="Filter schemes..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-9"
            />
          </div>
          <Button variant="ghost" size="sm" onClick={onOpenSchemeEditor}>
            <Plus className="h-4 w-4 mr-1" />
            New
          </Button>
        </div>
      </div>
      <ScrollArea className="flex-1 overflow-hidden">
        <div className="px-4 pb-2">
        <div className="space-y-2">
          {allSchemes.length > 0 ? filteredSchemes.map(scheme => (
            <div key={scheme.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50">
              <input 
                type="checkbox" 
                id={`scheme-${scheme.id}`} 
                checked={selectedSchemeIds.includes(scheme.id)} 
                onChange={() => onToggleScheme(scheme.id)}
                className="flex-shrink-0"
              />
              <Label 
                htmlFor={`scheme-${scheme.id}`} 
                className="flex-1 truncate cursor-pointer text-sm leading-relaxed"
              >
                {scheme.name}
              </Label>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 flex-shrink-0" 
                onClick={() => onPreviewScheme(scheme)}
              >
                <Eye className="h-4 w-4" />
              </Button>
            </div>
          )) : <p className="text-xs text-muted-foreground text-center p-4">No schemes available. Please create one.</p>}
        </div>
        </div>
      </ScrollArea>
    </div>
  );
};

// --- MODIFIED: Props interface ---
interface AnnotationRunnerDockProps {
  allAssets: AssetRead[];
  allSchemes: AnnotationSchemaRead[];
  onCreateRun: (params: AnnotationRunParams) => Promise<void>;
  activeRunId: number | null;
  isCreatingRun: boolean;
  onClearRun: () => void;
}

export default function AnnotationRunnerDock({
  allAssets,
  allSchemes,
  onCreateRun,
  activeRunId,
  isCreatingRun,
  onClearRun,
}: AnnotationRunnerDockProps) {
  
  const [isExpanded, setIsExpanded] = useState(true);
  const [selectedAssetItems, setSelectedAssetItems] = useState<Set<string>>(new Set());
  const [selectedSchemeIds, setSelectedSchemeIds] = useState<Set<number>>(new Set());
  const [newRunName, setNewRunName] = useState<string>('');
  const [newRunDescription, setNewRunDescription] = useState<string>('');
  const [isPreviewDialogOpen, setIsPreviewDialogOpen] = useState(false);
  const [previewScheme, setPreviewScheme] = useState<AnnotationSchemaRead | null>(null);
  const [isSchemeEditorOpen, setIsSchemeEditorOpen] = useState(false);
  const [csvRowProcessing, setCsvRowProcessing] = useState(true);
  const [includeThoughts, setIncludeThoughts] = useState(false);
  const [annotationConcurrency, setAnnotationConcurrency] = useState(5);
  const [enableParallelProcessing, setEnableParallelProcessing] = useState(true);
  const [justificationOverride, setJustificationOverride] = useState<'schema' | 'all'>('schema');
  const { loadSchemas: refreshSchemasFromHook } = useAnnotationSystem();
  const { apiKeys, selectedProvider, selectedModel } = useApiKeysStore();

  // Helper function to check if AI is properly configured
  const isAiConfigured = useMemo(() => {
    if (!selectedProvider) {
      return false;
    }
    
    // Ollama doesn't require an API key since it runs locally
    if (selectedProvider === 'ollama') {
      return true;
    }
    
    // Other providers require API keys
    const configured = !!(apiKeys[selectedProvider]);
    console.log('DOCK AI Config Check:', {
      selectedProvider,
      apiKeys,
      hasKey: selectedProvider ? !!apiKeys[selectedProvider] : false,
      isConfigured: configured,
      isOllama: selectedProvider === 'ollama'
    });
    return configured;
  }, [selectedProvider, apiKeys]);

  // New state for collapsible sections
  const [expandedSections, setExpandedSections] = useState({
    processing: false,
    advanced: false,
  });

  const toggleSection = (section: 'processing' | 'advanced') => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const handleRunClick = async () => {
    if (selectedAssetItems.size === 0) {
      toast.error("Please select at least one asset to annotate.");
      return;
    }
    if (selectedSchemeIds.size === 0) {
      toast.error("Please select at least one schema to use for annotation.");
      return;
    }
    if (!isAiConfigured) {
      if (selectedProvider === 'ollama') {
        toast.error("Please ensure Ollama is running and has at least one model installed.");
      } else {
        toast.error("Please configure an AI provider and API key before running annotations.");
      }
      return;
    }

    const finalAssetIds = new Set<number>();
    selectedAssetItems.forEach(item => {
      if (item.startsWith('asset-')) {
        const assetId = parseInt(item.replace('asset-', ''));
        if (!isNaN(assetId)) {
          finalAssetIds.add(assetId);
        }
      }
    });

    const configuration: Record<string, any> = {};
    configuration.justification_mode = justificationOverride === 'all' ? "ALL_WITH_SCHEMA_OR_DEFAULT_PROMPT" : "SCHEMA_DEFAULT";
    configuration.csv_row_processing = csvRowProcessing;
    configuration.include_thoughts = includeThoughts;
    configuration.annotation_concurrency = annotationConcurrency;
    configuration.enable_parallel_processing = enableParallelProcessing;
    configuration.ai_provider = selectedProvider;
    configuration.ai_model = selectedModel;
    
    const runParams: AnnotationRunParams = {
        assetIds: Array.from(finalAssetIds),
        bundleId: null, 
        schemaIds: Array.from(selectedSchemeIds),
        name: newRunName || `Run - ${format(new Date(), 'yyyy-MM-dd HH:mm')}`,
        description: newRunDescription || undefined,
        configuration: {
          ...configuration,
        },
    };

    await onCreateRun(runParams);
    setIsExpanded(false);
    setNewRunName('');
    setNewRunDescription('');
  };

  const handleSchemeToggle = (id: number) => {
    if (selectedSchemeIds.has(id)) {
      setSelectedSchemeIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    } else {
      setSelectedSchemeIds(prev => {
        const newSet = new Set(prev);
        newSet.add(id);
        return newSet;
      });
    }
  };
  const handlePreviewSchemeClick = (scheme: AnnotationSchemaRead) => { setPreviewScheme(scheme); setIsPreviewDialogOpen(true); };
  const handleCloseSchemeEditor = async () => { setIsSchemeEditorOpen(false); await refreshSchemasFromHook({ force: true }); };

  // Compute actual asset count (excluding bundles)
  const actualAssetCount = useMemo(() => {
    return Array.from(selectedAssetItems).filter(item => item.startsWith('asset-')).length;
  }, [selectedAssetItems]);

  // Compute CSV processing info
  const csvProcessingInfo = useMemo(() => {
    const selectedAssetIds = Array.from(selectedAssetItems)
      .filter(item => item.startsWith('asset-'))
      .map(item => parseInt(item.replace('asset-', '')))
      .filter(id => !isNaN(id));
      
    const csvAssets = allAssets.filter(asset => 
      selectedAssetIds.includes(asset.id) && asset.kind === 'csv'
    );
    
    // Calculate total rows estimate from source metadata OR child assets
    const totalRowsEstimate = csvAssets.reduce((total, asset) => {
      // First try to get from source metadata (most efficient)
      const metadataRowCount = asset.source_metadata?.row_count || 
                               asset.source_metadata?.rows_processed || 
                               asset.source_metadata?.row_count_processed;
      
      if (metadataRowCount && typeof metadataRowCount === 'number' && metadataRowCount > 0) {
        return total + metadataRowCount;
      }
      
      // Fallback: count actual CSV_ROW children in allAssets
      const csvRowChildren = allAssets.filter(childAsset => 
        childAsset.parent_asset_id === asset.id && childAsset.kind === 'csv_row'
      );
      
      return total + csvRowChildren.length;
    }, 0);
    
    return {
      csvAssetCount: csvAssets.length,
      totalRowsEstimate
    };
  }, [selectedAssetItems, allAssets]);

  // Reset CSV row processing when no CSV assets are selected
  useEffect(() => {
    if (csvProcessingInfo.csvAssetCount === 0) {
      setCsvRowProcessing(true); // Reset to default
    }
  }, [csvProcessingInfo.csvAssetCount]);

  // Debug: Monitor store changes
  useEffect(() => {
    console.log('DOCK Store Changed:', { selectedProvider, apiKeys });
  }, [selectedProvider, apiKeys]);

  return (
    <TooltipProvider>
      <div className={cn(
        "fixed bottom-4 left-1/2 transform -translate-x-1/2 flex flex-col bg-card/95 backdrop-blur-lg text-card-foreground shadow-2xl z-40 transition-all duration-300 ease-in-out rounded-xl border",
        isExpanded 
          ? "w-[95vw] sm:w-auto sm:min-w-[600px] sm:max-w-[900px] max-w-[95vw] shadow-lg hover:shadow-xl"
          : "w-[95vw] sm:w-auto sm:min-w-[500px] sm:max-w-[700px] max-w-[95vw] shadow-2xl ring-1 ring-primary/20" 
      )}>
        <div className="flex items-center justify-between px-3 sm:px-6 py-3 sm:py-4 cursor-pointer hover:bg-muted/30 transition-colors rounded-t-xl" onClick={() => setIsExpanded(!isExpanded)}>
                      <div className="flex items-center gap-2 sm:gap-4">
            <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
              <ListChecks className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="text-base font-semibold">Annotation Runner</h3>
              <p className="text-sm text-muted-foreground">
                {isExpanded ? 'Configure and start runs' : 'Click to expand and run an analysis'}
              </p>
            </div>
            {activeRunId && (
              <Badge variant="secondary" className="ml-2 text-sm bg-primary/10 text-primary border-primary/20">
                Run #{activeRunId}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {activeRunId && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={(e) => { e.stopPropagation(); onClearRun(); }}
                className="h-8 px-3 hover:bg-destructive/10 hover:text-destructive"
              >
                <XCircle className="h-4 w-4 mr-1.5" />
                Clear
              </Button>
            )}
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8 p-0 hover:bg-muted/50" 
              onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUp className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {isExpanded && (
          <div className="p-3 sm:p-6 max-h-[70vh] sm:max-h-[75vh] overflow-y-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-6">
                                    <div className="space-y-3 sm:space-y-4">
                      {/* Basic Settings */}
                      <div className="space-y-2 sm:space-y-3">
                      <div className="space-y-2">
                        <Label htmlFor="new-job-name-dock" className="text-sm font-medium">Run Name</Label>
                        <Input 
                          id="new-job-name-dock" 
                          placeholder="Enter a descriptive name..." 
                          value={newRunName} 
                          onChange={(e) => setNewRunName(e.target.value)}
                          className="transition-all duration-200 focus:ring-2 focus:ring-primary/20"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="new-job-description-dock" className="text-sm font-medium">Description</Label>
                        <Textarea 
                          id="new-job-description-dock" 
                          placeholder="Optional description for this run..." 
                          value={newRunDescription} 
                          onChange={(e) => setNewRunDescription(e.target.value)}
                          className="transition-all duration-200 focus:ring-2 focus:ring-primary/20 min-h-[80px] resize-none"
                        />
                      </div>
                    </div>

                    {/* Processing Settings */}
                    <div className="border rounded-lg bg-muted/20">
                      <button
                        onClick={() => toggleSection('processing')}
                        className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/30 transition-colors rounded-t-lg"
                      >
                        <div className="flex items-center gap-2">
                          <Settings2 className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">Processing Settings</span>
                        </div>
                        <ChevronRight className={cn("h-4 w-4 transition-transform", expandedSections.processing && "rotate-90")} />
                      </button>
                      
                      {expandedSections.processing && (
                        <div className="p-3 pt-0 space-y-4 border-t">
                          {/* CSV Row Processing Configuration */}
                          {csvProcessingInfo.csvAssetCount > 0 && (
                            <div className="space-y-2">
                              <div className="flex items-center space-x-2">
                                <Switch
                                  id="csv-row-processing"
                                  checked={csvRowProcessing}
                                  onCheckedChange={setCsvRowProcessing}
                                />
                                <Label htmlFor="csv-row-processing" className="text-sm font-medium cursor-pointer">
                                  Process CSV Rows Individually
                                </Label>
                              </div>
                              <p className="text-xs text-muted-foreground ml-6">
                                {csvRowProcessing 
                                  ? `Process each row as a separate asset (~${csvProcessingInfo.totalRowsEstimate} rows)`
                                  : `Process CSV files as complete documents (${csvProcessingInfo.csvAssetCount} files)`
                                }
                              </p>
                            </div>
                          )}
                          
                          {/* Parallel Processing Configuration */}
                          <div className="space-y-3">
                            <div className="flex items-center space-x-2">
                              <Switch
                                id="enable-parallel-processing"
                                checked={enableParallelProcessing}
                                onCheckedChange={setEnableParallelProcessing}
                              />
                              <Label htmlFor="enable-parallel-processing" className="text-sm font-medium cursor-pointer">
                                Enable Parallel Processing
                              </Label>
                            </div>
                            <p className="text-xs text-muted-foreground ml-6">
                              {enableParallelProcessing 
                                ? 'Process multiple assets concurrently for faster completion'
                                : 'Process assets one at a time (slower but more reliable)'
                              }
                            </p>
                            
                            {enableParallelProcessing && (
                              <div className="ml-6 space-y-2">
                                <Label htmlFor="annotation-concurrency" className="text-sm font-medium">
                                  Concurrency Level: {annotationConcurrency}
                                </Label>
                                <div className="flex items-center space-x-3">
                                  <span className="text-xs text-muted-foreground">1</span>
                                  <input
                                    id="annotation-concurrency"
                                    type="range"
                                    min="1"
                                    max="20"
                                    value={annotationConcurrency}
                                    onChange={(e) => setAnnotationConcurrency(parseInt(e.target.value))}
                                    className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                                  />
                                  <span className="text-xs text-muted-foreground">20</span>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  Higher values process faster but may overwhelm external APIs
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Advanced Settings */}
                    <div className="border rounded-lg bg-muted/20">
                      <button
                        onClick={() => toggleSection('advanced')}
                        className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/30 transition-colors rounded-t-lg"
                      >
                        <div className="flex items-center gap-2">
                          <Settings2 className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">Advanced Settings</span>
                        </div>
                        <ChevronRight className={cn("h-4 w-4 transition-transform", expandedSections.advanced && "rotate-90")} />
                      </button>
                      
                      {expandedSections.advanced && (
                        <div className="p-3 pt-0 space-y-4 border-t">
                          {/* Justification Configuration */}
                          <div className="space-y-3">
                            <Label className="text-sm font-medium">Justification Mode</Label>
                            <div className="space-y-2">
                              <div className="flex items-center space-x-2">
                                <input
                                  type="radio"
                                  id="justification-schema"
                                  name="justification-mode"
                                  checked={justificationOverride === 'schema'}
                                  onChange={() => setJustificationOverride('schema')}
                                  className="w-4 h-4 text-primary bg-background border-border focus:ring-primary"
                                />
                                <Label htmlFor="justification-schema" className="text-sm font-medium cursor-pointer">
                                  Schema Default
                                </Label>
                              </div>
                              <p className="text-xs text-muted-foreground ml-6">
                                Only request justifications for fields specifically configured in each schema
                              </p>
                              
                              <div className="flex items-center space-x-2">
                                <input
                                  type="radio"
                                  id="justification-all"
                                  name="justification-mode"
                                  checked={justificationOverride === 'all'}
                                  onChange={() => setJustificationOverride('all')}
                                  className="w-4 h-4 text-primary bg-background border-border focus:ring-primary"
                                />
                                <Label htmlFor="justification-all" className="text-sm font-medium cursor-pointer">
                                  All Fields
                                </Label>
                              </div>
                              <p className="text-xs text-muted-foreground ml-6">
                                Request justifications for all fields in all schemas, regardless of configuration
                              </p>
                            </div>
                          </div>
                          
                          {/* Include Thoughts Configuration */}
                          <div className="space-y-2">
                            <div className="flex items-center space-x-2">
                              <Switch
                                id="include-thoughts"
                                checked={includeThoughts}
                                onCheckedChange={setIncludeThoughts}
                              />
                              <Label htmlFor="include-thoughts" className="text-sm font-medium cursor-pointer">
                                Include Reasoning Traces
                              </Label>
                            </div>
                            <p className="text-xs text-muted-foreground ml-6">
                              {includeThoughts 
                                ? 'Include detailed reasoning and thought processes in results'
                                : 'Only include final classification results'
                              }
                            </p>
                          </div>

                          {/* AI Model Configuration */}
                          <div className="space-y-3">
                            <Label className="text-sm font-medium">AI Model Configuration</Label>
                            <div className="space-y-2">
                              <ProviderSelector />
                              {isAiConfigured ? (
                                <div className="flex items-center gap-2 p-2 rounded-md bg-green-50 border border-green-200">
                                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                  <span className="text-xs text-green-700 font-medium">
                                    {selectedProvider} configured ({selectedModel || 'default model'})
                                    {selectedProvider === 'ollama' && ' - Local'}
                                  </span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2 p-2 rounded-md bg-amber-50 border border-amber-200">
                                  <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                                  <span className="text-xs text-amber-700">
                                    {selectedProvider === 'ollama'
                                      ? 'Ollama is ready - no API key needed'
                                      : selectedProvider 
                                        ? `Please add an API key for ${selectedProvider}` 
                                        : 'Please configure an AI provider'
                                    }
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                </div>
                <div className="flex flex-col justify-end space-y-3 sm:space-y-4">
                    <div className="p-4 rounded-lg border bg-muted/30 space-y-3">
                      <h4 className="text-sm font-medium text-muted-foreground">Run Summary</h4>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-blue-500 shadow-sm"></div>
                            <span className="text-sm font-medium">Assets Selected</span>
                          </div>
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                            {actualAssetCount}
                          </Badge>
                        </div>
                        {csvProcessingInfo.csvAssetCount > 0 && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="w-3 h-3 rounded-full bg-green-500 shadow-sm"></div>
                              <span className="text-sm font-medium">
                                {csvRowProcessing ? 'CSV Rows to Process' : 'CSV Files to Process'}
                              </span>
                            </div>
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                              {csvRowProcessing ? `~${csvProcessingInfo.totalRowsEstimate}` : csvProcessingInfo.csvAssetCount}
                            </Badge>
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-purple-500 shadow-sm"></div>
                            <span className="text-sm font-medium">Schemes Selected</span>
                          </div>
                          <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                            {selectedSchemeIds.size}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={cn(
                              "w-3 h-3 rounded-full shadow-sm",
                              isAiConfigured ? "bg-emerald-500" : "bg-red-500"
                            )}></div>
                            <span className="text-sm font-medium">AI Model</span>
                          </div>
                          <Badge variant="outline" className={cn(
                            isAiConfigured 
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-red-50 text-red-700 border-red-200"
                          )}>
                            {isAiConfigured 
                              ? `${selectedProvider}${selectedProvider === 'ollama' ? ' (Local)' : ''}` 
                              : selectedProvider === 'ollama'
                                ? 'Ollama Ready'
                                : selectedProvider 
                                  ? 'Missing API key'
                                  : 'Not configured'
                            }
                          </Badge>
                        </div>
                        {csvProcessingInfo.csvAssetCount > 0 && (
                          <div className="mt-3 p-2 rounded-md bg-blue-50 border border-blue-200">
                            <div className="flex items-start gap-2">
                              <div className="w-4 h-4 rounded-full bg-blue-500 shadow-sm mt-0.5 flex-shrink-0"></div>
                              <div className="text-xs text-blue-700">
                                <p className="font-medium mb-1">
                                  {csvRowProcessing ? 'CSV Row Processing Enabled' : 'CSV File Processing'}
                                </p>
                                <p>
                                  {csvRowProcessing 
                                    ? `${csvProcessingInfo.csvAssetCount} CSV file${csvProcessingInfo.csvAssetCount > 1 ? 's' : ''} will be expanded to process individual rows (~${csvProcessingInfo.totalRowsEstimate} total rows).`
                                    : `${csvProcessingInfo.csvAssetCount} CSV file${csvProcessingInfo.csvAssetCount > 1 ? 's' : ''} will be processed as complete documents.`
                                  }
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <Button 
                      onClick={handleRunClick} 
                      disabled={isCreatingRun || selectedAssetItems.size === 0 || selectedSchemeIds.size === 0 || !isAiConfigured}
                      className="h-12 font-medium transition-all duration-200 disabled:opacity-50 text-base"
                      size="lg"
                    >
                        {isCreatingRun ? (
                          <>
                            <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                            Creating Run...
                          </>
                        ) : (
                          <>
                            <Play className="h-5 w-5 mr-2" />
                            Create & Start Run
                          </>
                        )}
                    </Button>
                </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-6 border-t pt-3 sm:pt-6 mt-3 sm:mt-6">
                <div className="flex flex-col h-[300px] sm:h-[400px]">
                  <h3 className="text-sm font-semibold text-foreground mb-3 px-1">Select Assets to Annotate</h3>
                  <div className="flex-1 min-h-0">
                    <AssetSelector selectedItems={selectedAssetItems} onSelectionChange={setSelectedAssetItems} />
                  </div>
                </div>
                <div className="flex flex-col h-[300px] sm:h-[400px]">
                  <h3 className="text-sm font-semibold text-foreground mb-3 px-1">Choose Annotation Schemes</h3>
                  <div className="flex-1 min-h-0">
                    <SchemeSelectorForRun allSchemes={allSchemes} selectedSchemeIds={Array.from(selectedSchemeIds)} onToggleScheme={handleSchemeToggle} onPreviewScheme={handlePreviewSchemeClick} onOpenSchemeEditor={() => setIsSchemeEditorOpen(true)} />
                  </div>
                </div>
            </div>
          </div>
        )}
      </div>
      <Dialog open={isPreviewDialogOpen} onOpenChange={setIsPreviewDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Schema Preview: {previewScheme?.name}</DialogTitle>
            <DialogDescription>
              Review the schema structure before running annotations.
            </DialogDescription>
          </DialogHeader>
          {previewScheme && (
            <div className="mt-4">
              <SchemePreview scheme={previewScheme} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPreviewDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AnnotationSchemaEditor show={isSchemeEditorOpen} onClose={handleCloseSchemeEditor} mode={'create'} defaultValues={null} />
    </TooltipProvider>
  );
}