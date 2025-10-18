'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileText, Play, Loader2, ListChecks, ChevronUp, ChevronDown, Plus, Settings2, XCircle, Eye, ChevronRight, Microscope, Terminal, Minimize2 } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { AnnotationSchemaRead, AssetRead } from '@/client';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { useAnnotationSystem } from '@/hooks/useAnnotationSystem';
import { AnnotationRunParams } from '@/lib/annotations/types';
import { SchemePreview } from './schemaCreation/SchemePreview';
import AnnotationSchemaEditor from './AnnotationSchemaEditor';
import AssetSelector from '../assets/AssetSelector';
import { toast } from 'sonner';
import { useApiKeysStore } from '@/zustand_stores/storeApiKeys';
import ProviderSelector from '../management/ProviderSelector';
import { useFavoriteRunsStore } from '@/zustand_stores/storeFavoriteRuns';
import { AnnotationRunRead } from '@/client';

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
  allRuns: AnnotationRunRead[];
  onCreateRun: (params: AnnotationRunParams) => Promise<void>;
  onSelectRun: (runId: number) => void;
  activeRunId: number | null;
  isCreatingRun: boolean;
  onClearRun: () => void;
}

export default function AnnotationRunnerDock({
  allAssets,
  allSchemes,
  allRuns,
  onCreateRun,
  onSelectRun,
  activeRunId,
  isCreatingRun,
  onClearRun,
}: AnnotationRunnerDockProps) {
  
  const [isExpanded, setIsExpanded] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);
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
  const [tempApiKey, setTempApiKey] = useState('');
  const { loadSchemas: refreshSchemasFromHook } = useAnnotationSystem();
  const { apiKeys, selectedProvider, selectedModel, setApiKey, setSelectedProvider } = useApiKeysStore();
  const { isFavorite } = useFavoriteRunsStore();

  // Sort runs with favorites first, then by most recent
  const sortedRuns = useMemo(() => {
    return [...allRuns].sort((a, b) => {
      const aIsFavorite = isFavorite(a.id);
      const bIsFavorite = isFavorite(b.id);
      
      // Favorites first
      if (aIsFavorite && !bIsFavorite) return -1;
      if (!aIsFavorite && bIsFavorite) return 1;
      
      // Then by most recent (updated_at)
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  }, [allRuns, isFavorite]);

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
    // Pass API keys from frontend to backend for runtime provider creation
    configuration.api_keys = apiKeys;
    
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

  // Handler for saving API keys
  const handleSaveApiKey = useCallback(() => {
    if (selectedProvider && tempApiKey.trim()) {
      setApiKey(selectedProvider, tempApiKey.trim());
      setTempApiKey('');
      toast.success(`API key saved for ${selectedProvider}`);
    } else {
      toast.error('Please select a provider and enter an API key');
    }
  }, [selectedProvider, tempApiKey, setApiKey]);

  // Helper function to mask API keys for display
  const maskApiKey = useCallback((key: string) => {
    if (!key) return '';
    if (key.length <= 8) return key;
    // Show first 4 and last 4 characters with a fixed number of asterisks for better UI
    return `${key.slice(0, 4)}****${key.slice(-4)}`;
  }, []);

  // Debug: Monitor store changes
  useEffect(() => {
    console.log('DOCK Store Changed:', { selectedProvider, apiKeys });
  }, [selectedProvider, apiKeys]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+O to toggle dock
      if (e.key === 'o' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setIsExpanded(!isExpanded);
      }
      
      // Ctrl+M to minimize/restore dock
      if (e.key === 'm' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setIsMinimized(!isMinimized);
      }
      
      // Ctrl+N to clear/new run
      if (e.key === 'n' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        // Only trigger if we're not in an input/textarea
        const activeElement = document.activeElement;
        if (activeElement?.tagName !== 'INPUT' && activeElement?.tagName !== 'TEXTAREA') {
          e.preventDefault();
          if (activeRunId) {
            onClearRun();
          }
          // Reset form
          setSelectedAssetItems(new Set());
          setSelectedSchemeIds(new Set());
          setNewRunName('');
          setNewRunDescription('');
          toast.info('New run started');
        }
      }
      
      // Ctrl+[ to cycle to previous run
      if (e.key === '[' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (sortedRuns.length === 0) return;
        
        const currentIndex = sortedRuns.findIndex(r => r.id === activeRunId);
        if (currentIndex === -1) {
          // No active run, select the first one (most recent favorite or most recent)
          onSelectRun(sortedRuns[0].id);
          toast.info(`Loaded: ${sortedRuns[0].name}`);
        } else {
          // Go to previous run (wraps around to end)
          const prevIndex = currentIndex === 0 ? sortedRuns.length - 1 : currentIndex - 1;
          onSelectRun(sortedRuns[prevIndex].id);
          toast.info(`Loaded: ${sortedRuns[prevIndex].name}`);
        }
      }
      
      // Ctrl+] to cycle to next run
      if (e.key === ']' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (sortedRuns.length === 0) return;
        
        const currentIndex = sortedRuns.findIndex(r => r.id === activeRunId);
        if (currentIndex === -1) {
          // No active run, select the first one
          onSelectRun(sortedRuns[0].id);
          toast.info(`Loaded: ${sortedRuns[0].name}`);
        } else {
          // Go to next run (wraps around to start)
          const nextIndex = (currentIndex + 1) % sortedRuns.length;
          onSelectRun(sortedRuns[nextIndex].id);
          toast.info(`Loaded: ${sortedRuns[nextIndex].name}`);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isExpanded, isMinimized, activeRunId, onClearRun, sortedRuns, onSelectRun]);

  return (
    <TooltipProvider>
      <div className={cn(
        "fixed flex flex-col bg-card/95 backdrop-blur-lg text-card-foreground shadow-2xl z-40 transition-all duration-300 ease-in-out rounded-md border",
        isMinimized 
          ? "bottom-4 right-4 w-12 h-12 shadow-2xl ring-1 ring-primary/20"
          : isExpanded 
            ? "bottom-4 left-1/2 transform -translate-x-1/2 w-[95vw] sm:w-auto sm:min-w-[500px] sm:max-w-[1500px] max-w-[95vw] shadow-lg hover:shadow-xl"
            : "bottom-4 left-1/2 transform -translate-x-1/2 w-12 h-12 sm:w-auto sm:h-auto sm:min-w-[400px] sm:max-w-[700px] shadow-2xl ring-1 ring-primary/20"
      )}>
        <div className="flex items-center justify-center sm:justify-between px-2 sm:px-4 py-0.5 cursor-pointer hover:bg-muted/30 transition-colors rounded-none " onClick={() => {
          if (isMinimized) {
            setIsMinimized(false);
          } else {
            setIsExpanded(!isExpanded);
          }
        }}>
          {/* Mobile or Minimized: Just show icon */}
          <div className={cn(
            "flex items-center justify-center w-full h-full",
            isMinimized ? "sm:flex" : "sm:hidden"
          )}>
            <div className="p-1.5 flex items-center justify-center rounded bg-blue-50/20 dark:bg-transparent border border-blue-200 dark:border-blue-800 shadow-sm">
              <Terminal className="h-7 w-7 text-blue-700 dark:text-blue-400" />
            </div>
          </div>
          
          {/* Desktop: Full layout (when not minimized) */}
          {!isMinimized && (
            <>
              <div className="hidden sm:flex items-center gap-3 flex-1 min-w-0 md:pt-1">
                <div className="p-2 flex items-center gap-2">
                  <Terminal className="h-5 w-5 text-blue-700 dark:text-blue-400" />
                  <Play className="h-5 w-5 text-blue-700 dark:text-blue-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate mb-0.5">Annotation Runner</h3>
                  <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                    {isExpanded ? 'Configure and start runs' : 'Click to expand and run an analysis'}
                  </p>
                </div>
                
                {/* Keyboard shortcuts section - only show when expanded */}
                {isExpanded && (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 border border-border/50">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground font-medium">Toggle</span>
                      <KbdGroup>
                        <Kbd className="h-5 px-1.5">Ctrl</Kbd>
                        <Kbd className="h-5 px-1.5">O</Kbd>
                      </KbdGroup>
                    </div>
                    <div className="w-px h-4 bg-border"></div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground font-medium">New</span>
                      <KbdGroup>
                        <Kbd className="h-5 px-1.5">Ctrl</Kbd>
                        <Kbd className="h-5 px-1.5">N</Kbd>
                      </KbdGroup>
                    </div>
                    <div className="w-px h-4 bg-border"></div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted">
                          <span className="font-medium">More...</span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="p-3">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-muted-foreground w-20">Minimize</span>
                            <KbdGroup>
                              <Kbd>Ctrl</Kbd>
                              <Kbd>M</Kbd>
                            </KbdGroup>
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-muted-foreground w-20">Prev Run</span>
                            <KbdGroup>
                              <Kbd>Ctrl</Kbd>
                              <Kbd>[</Kbd>
                            </KbdGroup>
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-muted-foreground w-20">Next Run</span>
                            <KbdGroup>
                              <Kbd>Ctrl</Kbd>
                              <Kbd>]</Kbd>
                            </KbdGroup>
                          </div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                )}
                
                {activeRunId && (
                  <Badge variant="secondary" className="text-xs bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-800">
                    Run #{activeRunId}
                  </Badge>
                )}
              </div>
              
              {/* Desktop: Action buttons */}
              <div className="hidden sm:flex items-center gap-2">
                {activeRunId && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={(e) => { e.stopPropagation(); onClearRun(); }}
                    className="h-8 px-3 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <XCircle className="h-3.5 w-3.5 mr-1.5" />
                    Clear
                  </Button>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 p-0 hover:bg-muted/50" 
                      onClick={(e) => { e.stopPropagation(); setIsMinimized(true); }}
                    >
                      <Minimize2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs">Minimize (Ctrl+M)</p>
                  </TooltipContent>
                </Tooltip>
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
            </>
          )}
        </div>

        {isExpanded && !isMinimized && (
          <div className="p-3 sm:p-4 max-h-[70vh] sm:max-h-[75vh] overflow-y-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
                                    <div className="space-y-3">
                      {/* Basic Settings */}
                      <div className="space-y-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="new-job-name-dock" className="text-xs font-medium">Run Name</Label>
                        <Input 
                          id="new-job-name-dock" 
                          placeholder="Enter a descriptive name..." 
                          value={newRunName} 
                          onChange={(e) => setNewRunName(e.target.value)}
                          className="transition-all duration-200 focus:ring-2 focus:ring-primary/20 h-9"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="new-job-description-dock" className="text-xs font-medium">Description</Label>
                        <Textarea 
                          id="new-job-description-dock" 
                          placeholder="Optional description for this run..." 
                          value={newRunDescription} 
                          onChange={(e) => setNewRunDescription(e.target.value)}
                          className="transition-all duration-200 focus:ring-2 focus:ring-primary/20 min-h-[70px] resize-none text-sm"
                        />
                      </div>
                    </div>

                    {/* Processing Settings */}
                    <div className="border rounded-lg bg-muted/20">
                      <button
                        onClick={() => toggleSection('processing')}
                        className="w-full flex items-center justify-between p-2.5 text-left hover:bg-muted/30 transition-colors rounded-t-lg"
                      >
                        <div className="flex items-center gap-2">
                          <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs font-medium">Processing Settings</span>
                        </div>
                        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", expandedSections.processing && "rotate-90")} />
                      </button>
                      
                      {expandedSections.processing && (
                        <div className="p-2.5 pt-0 space-y-3 border-t">
                          {/* CSV Row Processing Configuration */}
                          {csvProcessingInfo.csvAssetCount > 0 && (
                            <div className="space-y-1.5">
                              <div className="flex items-center space-x-2">
                                <Switch
                                  id="csv-row-processing"
                                  checked={csvRowProcessing}
                                  onCheckedChange={setCsvRowProcessing}
                                />
                                <Label htmlFor="csv-row-processing" className="text-xs font-medium cursor-pointer">
                                  Process CSV Rows Individually
                                </Label>
                              </div>
                              <p className="text-[11px] text-muted-foreground ml-6">
                                {csvRowProcessing 
                                  ? `Process each row as a separate asset (~${csvProcessingInfo.totalRowsEstimate} rows)`
                                  : `Process CSV files as complete documents (${csvProcessingInfo.csvAssetCount} files)`
                                }
                              </p>
                            </div>
                          )}
                          
                          {/* Parallel Processing Configuration */}
                          <div className="space-y-2">
                            <div className="flex items-center space-x-2">
                              <Switch
                                id="enable-parallel-processing"
                                checked={enableParallelProcessing}
                                onCheckedChange={setEnableParallelProcessing}
                              />
                              <Label htmlFor="enable-parallel-processing" className="text-xs font-medium cursor-pointer">
                                Enable Parallel Processing
                              </Label>
                            </div>
                            <p className="text-[11px] text-muted-foreground ml-6">
                              {enableParallelProcessing 
                                ? 'Process multiple assets concurrently for faster completion'
                                : 'Process assets one at a time (slower but more reliable)'
                              }
                            </p>
                            
                            {enableParallelProcessing && (
                              <div className="ml-6 space-y-1.5">
                                <Label htmlFor="annotation-concurrency" className="text-xs font-medium">
                                  Concurrency Level: {annotationConcurrency}
                                </Label>
                                <div className="flex items-center space-x-2">
                                  <span className="text-[11px] text-muted-foreground">1</span>
                                  <input
                                    id="annotation-concurrency"
                                    type="range"
                                    min="1"
                                    max="20"
                                    value={annotationConcurrency}
                                    onChange={(e) => setAnnotationConcurrency(parseInt(e.target.value))}
                                    className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                                  />
                                  <span className="text-[11px] text-muted-foreground">20</span>
                                </div>
                                <p className="text-[11px] text-muted-foreground">
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
                        className="w-full flex items-center justify-between p-2.5 text-left hover:bg-muted/30 transition-colors rounded-t-lg"
                      >
                        <div className="flex items-center gap-2">
                          <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs font-medium">Advanced Settings</span>
                        </div>
                        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", expandedSections.advanced && "rotate-90")} />
                      </button>
                      
                      {expandedSections.advanced && (
                        <div className="p-2.5 pt-0 space-y-3 border-t">
                          {/* Justification Configuration */}
                          <div className="space-y-2">
                            <Label className="text-xs font-medium">Justification Mode</Label>
                            <div className="space-y-1.5">
                              <div className="flex items-center space-x-2">
                                <input
                                  type="radio"
                                  id="justification-schema"
                                  name="justification-mode"
                                  checked={justificationOverride === 'schema'}
                                  onChange={() => setJustificationOverride('schema')}
                                  className="w-3.5 h-3.5 text-primary bg-background border-border focus:ring-primary"
                                />
                                <Label htmlFor="justification-schema" className="text-xs font-medium cursor-pointer">
                                  Schema Default
                                </Label>
                              </div>
                              <p className="text-[11px] text-muted-foreground ml-5">
                                Only request justifications for fields specifically configured in each schema
                              </p>
                              
                              <div className="flex items-center space-x-2">
                                <input
                                  type="radio"
                                  id="justification-all"
                                  name="justification-mode"
                                  checked={justificationOverride === 'all'}
                                  onChange={() => setJustificationOverride('all')}
                                  className="w-3.5 h-3.5 text-primary bg-background border-border focus:ring-primary"
                                />
                                <Label htmlFor="justification-all" className="text-xs font-medium cursor-pointer">
                                  All Fields
                                </Label>
                              </div>
                              <p className="text-[11px] text-muted-foreground ml-5">
                                Request justifications for all fields in all schemas, regardless of configuration
                              </p>
                            </div>
                          </div>
                          
                          {/* Include Thoughts Configuration */}
                          <div className="space-y-1.5">
                            <div className="flex items-center space-x-2">
                              <Switch
                                id="include-thoughts"
                                checked={includeThoughts}
                                onCheckedChange={setIncludeThoughts}
                              />
                              <Label htmlFor="include-thoughts" className="text-xs font-medium cursor-pointer">
                                Include Reasoning Traces
                              </Label>
                            </div>
                            <p className="text-[11px] text-muted-foreground ml-6">
                              {includeThoughts 
                                ? 'Include detailed reasoning and thought processes in results'
                                : 'Only include final classification results'
                              }
                            </p>
                          </div>

                          {/* AI Model Configuration */}
                          <div className="space-y-2">
                            <Label className="text-xs font-medium">AI Model Configuration</Label>
                            <div className="space-y-2">
                              <ProviderSelector />
                              
                              {/* API Key Management */}
                              {selectedProvider && selectedProvider !== 'ollama' && (
                                <div className="space-y-1.5 max-w-full">
                                  <div className="flex items-center justify-between">
                                    <Label className="text-[11px] font-medium text-muted-foreground">
                                      API Key for {selectedProvider}
                                    </Label>
                                    {selectedProvider === 'gemini_native' && (
                                      <a 
                                        href="https://aistudio.google.com/app/apikey" 
                                        target="_blank" 
                                        rel="noopener noreferrer" 
                                        className="text-[11px] text-blue-600 hover:text-blue-800 hover:underline"
                                      >
                                        Get API key
                                      </a>
                                    )}
                                  </div>
                                  <div className="flex gap-1.5">
                                    <Input
                                      type="password"
                                      placeholder={`Enter API key for ${selectedProvider}`}
                                      value={tempApiKey}
                                      onChange={(e) => setTempApiKey(e.target.value)}
                                      className="text-xs h-8"
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          handleSaveApiKey();
                                        }
                                      }}
                                    />
                                    <Button 
                                      onClick={handleSaveApiKey}
                                      disabled={!tempApiKey.trim()}
                                      size="sm"
                                      className="px-2 h-8 text-xs"
                                    >
                                      Save
                                    </Button>
                                  </div>
                                  
                                  {/* Show saved API keys */}
                                  {Object.entries(apiKeys).length > 0 && (
                                    <div className="space-y-0.5">
                                      {Object.entries(apiKeys).map(([provider, key]) => (
                                        <div key={provider} className="flex items-center gap-1.5 text-[11px] min-w-0">
                                          <div className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0"></div>
                                          <span className="text-green-700 font-medium truncate">
                                            {provider}: {maskApiKey(key)}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                              
                              {/* Configuration Status */}
                              {isAiConfigured ? (
                                <div className="flex items-center gap-1.5 p-1.5 rounded-md bg-green-50 border border-green-200">
                                  <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                                  <span className="text-[11px] text-green-700 font-medium">
                                    {selectedProvider} configured ({selectedModel || 'default model'})
                                    {selectedProvider === 'ollama' && ' - Local'}
                                  </span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5 p-1.5 rounded-md bg-amber-50 border border-amber-200">
                                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div>
                                  <span className="text-[11px] text-amber-700">
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
                <div className="flex flex-col justify-end space-y-3">
                    <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/20 dark:bg-gray-950/10 space-y-2">
                      <h4 className="text-xs font-medium text-gray-700 dark:text-gray-300">Run Summary</h4>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full bg-green-500 shadow-sm"></div>
                            <span className="text-xs font-medium">Assets Selected</span>
                          </div>
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950/20 dark:text-green-400 dark:border-green-800 text-xs">
                            {actualAssetCount}
                          </Badge>
                        </div>
                        {csvProcessingInfo.csvAssetCount > 0 && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <div className="w-2 h-2 rounded-full bg-green-600 shadow-sm"></div>
                              <span className="text-xs font-medium">
                                {csvRowProcessing ? 'CSV Rows to Process' : 'CSV Files to Process'}
                              </span>
                            </div>
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950/20 dark:text-green-400 dark:border-green-800 text-xs">
                              {csvRowProcessing ? `~${csvProcessingInfo.totalRowsEstimate}` : csvProcessingInfo.csvAssetCount}
                            </Badge>
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full bg-sky-500 shadow-sm"></div>
                            <span className="text-xs font-medium">Schemas Selected</span>
                          </div>
                          <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/20 dark:text-sky-400 dark:border-sky-800 text-xs">
                            {selectedSchemeIds.size}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <div className={cn(
                              "w-2 h-2 rounded-full shadow-sm",
                              isAiConfigured ? "bg-emerald-500" : "bg-red-500"
                            )}></div>
                            <span className="text-xs font-medium">AI Model</span>
                          </div>
                          <Badge variant="outline" className={cn(
                            "text-xs",
                            isAiConfigured 
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-800"
                              : "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/20 dark:text-red-400 dark:border-red-800"
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
                          <div className="mt-2 p-2 rounded-md bg-green-50 border border-green-200 dark:bg-green-950/20 dark:border-green-800">
                            <div className="flex items-start gap-1.5">
                              <div className="w-3 h-3 rounded-full bg-green-500 shadow-sm mt-0.5 flex-shrink-0"></div>
                              <div className="text-[11px] text-green-700 dark:text-green-400">
                                <p className="font-medium mb-0.5">
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
                      className="h-10 font-medium transition-all duration-200 disabled:opacity-50 text-sm"
                      size="lg"
                    >
                        {isCreatingRun ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Creating Run...
                          </>
                        ) : (
                          <>
                            <Play className="h-4 w-4 mr-2" />
                            Create & Start Run
                          </>
                        )}
                    </Button>
                </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 border-t border-gray-200 dark:border-gray-700 pt-3 mt-3">
                <div className="flex flex-col h-[300px] sm:h-[400px]">
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <div className="p-1 rounded-md bg-green-500/20 dark:bg-green-500/20 text-green-700 dark:text-green-400">
                      <FileText className="w-3.5 h-3.5" />
                    </div>
                    <h3 className="text-xs font-semibold text-gray-900 dark:text-gray-100">Select Assets to Annotate</h3>
                  </div>
                  <div className="flex-1 min-h-0">
                    <AssetSelector selectedItems={selectedAssetItems} onSelectionChange={setSelectedAssetItems} />
                  </div>
                </div>
                <div className="flex flex-col h-[300px] sm:h-[400px]">
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <div className="p-1 rounded-md bg-sky-500/20 dark:bg-sky-500/20 text-sky-700 dark:text-sky-400">
                      <Microscope className="w-3.5 h-3.5" />
                    </div>
                    <h3 className="text-xs font-semibold text-gray-900 dark:text-gray-100">Choose Annotation Schemas</h3>
                  </div>
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