'use client'
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FileDown, Terminal, CheckSquare, Square, ChevronDown, ChevronUp, ExternalLink, HelpCircle, FolderDown, FolderOpen, BrainCircuit } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useBookMarkStore } from '@/zustand_stores/storeBookmark';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { ClassificationWidget } from '@/components/classification/ClassificationWidget';
import { ClassificationScheme, DataRecord } from '@/lib/classification/types';
import { CoreContentModel } from '@/lib/content';
import { useClassificationSettingsStore } from '@/zustand_stores/storeClassificationSettings';
import { useApiKeysStore } from '@/zustand_stores/storeApiKeys';
import { toast } from "@/components/ui/use-toast";
import { useClassificationSystem } from '@/hooks/useClassificationSystem';
import { ClassificationService } from '@/lib/classification/service';
import ClassificationResultDisplay from '@/components/collection/workspaces/classifications/ClassificationResultDisplay';
import { ClassificationResultRead, ClassificationSchemeRead } from '@/client';
import { useDataSourceStore } from '@/zustand_stores/storeDataSources';

export interface ContentCardProps extends CoreContentModel {
  id: string;
  dataSourceId?: number;
  className?: string;
  isHighlighted?: boolean;
  preloadedSchemes?: ClassificationSchemeRead[];
}

export function ContentCard({ 
  id, 
  dataSourceId,
  title, 
  text_content, 
  url, 
  source, 
  insertion_date,
  content_type,
  content_language,
  author,
  publication_date, 
  top_image,
  entities = [], 
  tags = [], 
  evaluation, 
  className,
  isHighlighted,
  preloadedSchemes,
  ...props 
}: ContentCardProps) {
  const { addBookmark, removeBookmark, isOperationPending } = useBookMarkStore();
  const { dataSources } = useDataSourceStore();
  const { activeWorkspace } = useWorkspaceStore();
  const classificationSettings = useClassificationSettingsStore();
  const { apiKeys, selectedProvider } = useApiKeysStore();

  // Use the classification hook to get schemes and results
  const {
    schemes,
    results: classificationResults,
    isLoadingSchemes,
    isLoadingResults,
    isClassifying,
    loadSchemes,
    loadResults,
    createJob,
    startClassificationJob,
    clearResultsCache
  } = useClassificationSystem({
    autoLoadSchemes: true,
    useCache: true,
  });

  // Determine if the item is bookmarked by checking if a corresponding DataSource exists
  const isBookmarked = useMemo(() => {
    if (!url) return false;
    // Use the same logic as in the store to find the DataSource
    return findDataSourceByIdentifier(url, dataSources) !== null;
  }, [url, dataSources]);

  // Check if an add/remove operation is pending for this item's URL
  const pendingOperation = isOperationPending(url || '');

  const isPending = pendingOperation === 'add' || pendingOperation === 'remove'; // Combine pending states

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  // Track if classification has been completed to avoid redundant API calls
  const [classificationCompleted, setClassificationCompleted] = useState(false);

  const classificationWidgetRef = useRef<HTMLButtonElement>(null);

  // Load classification results when component mounts or ID changes
  useEffect(() => {
    const dataRecordId = parseInt(id);
    if (!isNaN(dataRecordId) && dataRecordId > 0) {
      // Pass options object to loadResults
      loadResults({ datarecordId: dataRecordId, useCache: true }); 
    }
  }, [id, loadResults]);

  // Update classification completion state based on results
  useEffect(() => {
    if (classificationResults.length > 0) {
      setClassificationCompleted(true);
    }
  }, [classificationResults]);

  // Update the classification completion callback to store results
  const handleClassificationComplete = useCallback((result) => {
    console.log("Classification completed from dialog:", result);
    setClassificationCompleted(true);
    
    // Pass runId from the result? The result structure might not have run_id.
    // Let's reload results based on the data record ID instead.
    const dataRecordId = parseInt(id);
    if (!isNaN(dataRecordId) && dataRecordId > 0) {
      loadResults({ datarecordId: dataRecordId }); // Reload results for this record
    }
  }, [id, loadResults]);

  // Update the handleExternalClassify function to use the job system
  const handleExternalClassify = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();

    // Assuming isClassifying reflects if a job is currently running/being created
    if (isClassifying) {
      console.log("Classification process already active, skipping");
      return;
    }

    // Ensure we have the necessary info
    const dataRecordId = parseInt(id);
    if (isNaN(dataRecordId) || dataRecordId <= 0) {
      console.error("Invalid DataRecord ID for classification:", id);
      toast({ title: "Error", description: "Cannot classify item with invalid ID.", variant: "destructive" });
      return;
    }

    // We need the DataSource ID to create a job properly.
    // If not passed as prop, this won't work.
    if (!dataSourceId) {
      console.error("Missing DataSource ID for classification.");
      toast({ title: "Error", description: "Missing DataSource information for this item.", variant: "destructive" });
      return;
    }

    try {
      // Get the workspace ID
      if (!activeWorkspace?.id) { // Changed uid to id
        console.error("No active workspace");
        toast({ title: "Error", description: "No active workspace", variant: "destructive" });
        return;
      }

      const workspaceId = activeWorkspace.id; // Changed uid to id

      // Get the default scheme ID using the store's validation
      const defaultSchemeId = classificationSettings.getDefaultSchemeId(workspaceId, schemes);

      if (!defaultSchemeId) {
        console.error("No default classification scheme available");
        toast({ title: "Error", description: "No default classification scheme available", variant: "destructive" });
        return;
      }

      // Prepare job parameters according to ClassificationJobParams
      const jobParams /*: ClassificationJobParams */ = {
        workspaceId: workspaceId,
        name: `Single Classification: ${title || 'Item ' + dataRecordId} - ${new Date().toISOString()}`,
        // Pass schemeId as schemeIds array
        schemeIds: [defaultSchemeId],
        // Pass dataSourceId as datasourceIds array
        datasourceIds: [dataSourceId],
        // datarecord_ids: [dataRecordId] // Not directly in ClassificationJobParams interface
        // Add configuration if needed, e.g., to target specific record
        configuration: {
          target_datarecord_ids: [dataRecordId] // Assuming backend/hook uses this
        }
      };

      // Create the classification job
      const newJob = await createJob(jobParams);

      if (newJob) {
        console.log("ContentCard: Classification job created successfully", newJob);
        toast({
          title: "Classification Started",
          description: `Job created (ID: ${newJob.id}). Results will appear soon.`,
          variant: "default"
        });
        setClassificationCompleted(true); // Mark as completed (job created)
        // Optionally start the job if needed (depends on backend setup)
        // await startClassificationJob(newJob.id);
        // Reload results optimistically or wait for job completion
        loadResults({ datarecordId: dataRecordId });
      } else {
        // Handle case where job creation failed but didn't throw an error
        toast({ title: "Error", description: "Failed to create classification job.", variant: "destructive" });
      }

    } catch (error) {
      console.error("Error creating classification job:", error);
      toast({
        title: "Classification Failed",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive"
      });
    }
  }, [
    id,
    dataSourceId,
    title,
    isClassifying,
    activeWorkspace,
    classificationSettings,
    schemes,
    createJob,
    loadResults,
    toast
  ]);

  const handleBookmark = async (event: React.MouseEvent) => {
    event.stopPropagation();
    const identifier = url;
    if (!identifier || !activeWorkspace?.id) {
      console.error("Cannot bookmark/unbookmark: Missing URL or Workspace ID");
      toast({ title: "Error", description: "Cannot perform action: Missing URL or workspace context.", variant: "destructive" });
      return;
    }

    // Use the CoreContentModel structure expected by the store
    const itemData: CoreContentModel = {
      id, // Pass the current ID (likely DataRecord ID from content view)
      title,
      text_content,
      url,
      source,
      insertion_date,
      content_type: content_type || 'article',
      content_language: content_language || null,
      author: author || null,
      publication_date: publication_date || null,
      top_image: top_image || null,
      entities,
      tags,
      evaluation,
      // embeddings: null // Assuming embeddings are not part of bookmark payload
    };

    if (isBookmarked) {
      await removeBookmark(identifier, activeWorkspace.id);
    } else {
      await addBookmark(itemData, activeWorkspace.id);
    }
  };

  const handleCardClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    setIsDialogOpen(true);
  };

  // Reset classification completed state when dialog closes
  const handleDialogOpenChange = (open: boolean) => {
    setIsDialogOpen(open);
    // Don't reset classification state when dialog closes to prevent unnecessary reloading
  };

  const displayDate = publication_date 
    ? new Date(publication_date).toLocaleDateString() 
    : insertion_date ? new Date(insertion_date).toLocaleDateString() : new Date().toLocaleDateString();

  // Add a useEffect to log classification results whenever they change
  useEffect(() => {
    if (classificationResults.length > 0) {
      console.log(`ContentCard has ${classificationResults.length} classification results:`, 
        classificationResults.map(r => ({
          id: r.id,
          scheme: r.scheme?.name,
          displayValue: r.displayValue
        }))
      );
    }
  }, [classificationResults]);

  // Update the useEffect to load the default scheme name
  useEffect(() => {
    const loadDefaultScheme = async () => {
      if (!activeWorkspace?.id || schemes.length === 0) return; // Changed uid to id

      try {
        const workspaceId = activeWorkspace.id; // Changed uid to id

        // Get the default scheme ID using the hook instance
        const defaultSchemeId = classificationSettings.getDefaultSchemeId(workspaceId, schemes);
        
        if (defaultSchemeId) {
          const defaultScheme = schemes.find(s => s.id === defaultSchemeId);
          if (defaultScheme) {
            // Update the state with the new default scheme name
            // This is a placeholder implementation. You might want to update this to use a state management library
            // or a more robust method to update the component's state.
          }
        }
      } catch (error) {
        console.error('Error loading default scheme:', error);
      }
    };
    
    loadDefaultScheme();
  }, [activeWorkspace?.id, schemes, classificationSettings]);

  return (
    <Dialog open={isDialogOpen} onOpenChange={handleDialogOpenChange}>
      <DialogTrigger asChild>
        <Card 
          className={cn(
            "rounded-md opacity-90 bg-background-blur overflow-y-auto cursor-pointer relative max-h-[500px]",
            isHighlighted && "border-2 border-blue-500",
            className
          )} 
          {...props} 
          onClick={handleCardClick}
        >
          {top_image && (
            <div className="absolute top-0 right-0 w-1/4 h-full bg-cover bg-center opacity-30 z-0" style={{ backgroundImage: `url(${top_image})` }}></div>
          )}
          
          <div className="p-3 relative z-10 w-full">
            <div className="absolute top-2 right-2 z-20 flex items-center gap-2 p-1 bg-background/80 backdrop-blur-sm rounded-md shadow-sm">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div 
                      className="p-1.5 rounded-md transition-all hover:bg-primary/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        // If dialog is already open, use the widget's button
                        if (isDialogOpen) {
                          setTimeout(() => {
                            const classifyButton = document.querySelector('[data-classification-button]');
                            if (classifyButton instanceof HTMLElement) {
                              classifyButton.click();
                            }
                          }, 300);
                        } else {
                          // Otherwise, classify directly without opening the dialog
                          handleExternalClassify(e);
                        }
                      }}
                      data-classification-trigger
                    >
                      <div className={cn(
                        "animate-shimmer-once",
                        classificationCompleted && "text-primary"
                      )}>
                        <BrainCircuit className={cn(
                          "h-5 w-5",
                          classificationCompleted && "stroke-[url(#shimmer)]"
                        )} />
                      </div>
                      <svg width="0" height="0">
                        <linearGradient id="shimmer" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="#7AEFFF" />
                          <stop offset="50%" stopColor="#7CFF7A" />
                          <stop offset="100%" stopColor="#FEEC90" />
                        </linearGradient>
                      </svg>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Classify content</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div 
                      className="p-1.5 rounded-md transition-all hover:bg-gray-100"
                      onClick={(e) => { e.stopPropagation(); handleBookmark(e); }}
                    >
                      <FolderDown 
                        className={cn(
                          "h-5 w-5 transition-all duration-300",
                          isBookmarked
                            ? "text-blue-600 fill-blue-100" 
                            : isPending 
                              ? "text-yellow-600 animate-pulse" 
                              : "text-gray-600 hover:text-blue-500"
                        )} 
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{isBookmarked ? "Remove from workspace" : "Import to workspace"}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            
            <span className="text-xs text-muted-foreground mb-2 block pt-8">
              {source && <span>Source: <span className="text-green-500">{source}</span></span>}
              {author && ` • ${author}`}
              {` • ${displayDate}`}
              {dataSourceId && <span className="ml-2 text-xs italic opacity-60">(DS: {dataSourceId})</span>}
            </span>
            <h4 className="mb-2 text-lg font-semibold">{title}</h4>
            <p className="text-sm text-muted-foreground mb-2 line-clamp-2 leading-relaxed tracking-wide">
              {text_content}
            </p>
            
            {classificationResults.length > 0 && (
              <div className="mt-2 mb-2 p-2 border rounded-md bg-primary/5">
                <div className="flex items-center gap-1 mb-1">
                  <BrainCircuit className="h-3 w-3 text-primary" />
                  <span className="text-xs font-medium">Classifications</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {classificationResults.slice(0, 3).map((result, index) => {
                    if (!result.scheme) {
                      return (
                        <Badge 
                          key={`${result.id || index}-no-scheme`} 
                          variant="outline" 
                          className="text-xs text-muted-foreground italic"
                        >
                          Scheme missing
                        </Badge>
                      );
                    }

                    return (
                      <div key={result.id || index}> 
                        <ClassificationResultDisplay 
                          result={result as unknown as ClassificationResultRead} 
                          scheme={result.scheme as unknown as ClassificationSchemeRead} 
                          compact={true}
                        />
                      </div>
                    );
                  })}
                  {classificationResults.length > 3 && ( 
                    <Badge variant="outline" className="text-xs">
                      +{classificationResults.length - 3} more
                    </Badge>
                  )}
                </div>
              </div>
            )}
            
            {isLoadingResults && (
              <div className="mt-2 mb-2">
                <div className="flex items-center gap-1">
                  <div className="animate-spin h-3 w-3 border-2 border-primary border-t-transparent rounded-full"></div>
                  <span className="text-xs text-muted-foreground">Loading classifications...</span>
                </div>
              </div>
            )}
            
            {evaluation && <EvaluationSummary evaluation={evaluation} />}

            {process.env.NODE_ENV === 'development' && (
              <div className="mt-2 mb-2 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    console.log('Debug - Classification state:', {
                      classificationCompleted,
                      isLoadingResults,
                      classificationResults
                    });
                    // Force reload results - pass object
                    const dataRecordId = parseInt(id);
                    if (!isNaN(dataRecordId)) {
                      loadResults({ datarecordId: dataRecordId });
                    }
                  }}
                >
                  <HelpCircle className="h-3 w-3 mr-1" />
                  Refresh Classification
                </Button>
              </div>
            )}
          </div>
        </Card>
      </DialogTrigger>

      <DialogContent 
          className="max-h-[95vh] 
          bg-background/95 
          backdrop-blur 
          supports-[backdrop-filter]:bg-background/60 
          max-w-[95vw] md:max-w-[55vw] lg:max-w-[50vw] 
          xl:max-w-[45vw] p-6 rounded-lg shadow-lg flex flex-col
          overflow-y-auto
          ">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {source && <span>Source: <span className="text-green-500">{source}</span></span>}
            {author && ` • ${author}`}
            {` • ${displayDate}`}
            {dataSourceId && <span className="ml-2 text-xs italic opacity-60">(DS: {dataSourceId})</span>}
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex flex-col gap-4 mt-4">
          {top_image && (
            <div className="w-full">
              <img src={top_image} alt={title || 'Top Image'} className="w-full h-auto mb-2" />
            </div>
          )}
          
          {classificationResults.length > 0 && (
            <div className="w-full p-3 bg-primary/5 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <BrainCircuit className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-medium">Classification Results</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {classificationResults.map((result, index) => (
                  <div key={index} className="p-2 bg-background rounded-md border w-full">
                    <div className="flex justify-between items-center">
                      <span className="font-medium text-sm">{result.scheme?.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {result.timestamp ? new Date(result.timestamp).toLocaleDateString() : 'N/A'}
                      </Badge>
                    </div>
                    <div className="mt-1">
                      {result.scheme ? (
                        <ClassificationResultDisplay 
                          result={result as unknown as ClassificationResultRead} 
                          scheme={result.scheme as unknown as ClassificationSchemeRead}
                          compact={false}
                        />
                      ) : (
                        <div className="text-sm text-red-500 italic">Scheme data missing for this result (ID: {result.id}).</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {evaluation && (
            <div className="w-full">
              <EvaluationDetails evaluation={evaluation} />
            </div>
          )}
          
          <div className="w-full max-h-[40vh] overflow-y-auto">
            <p className="text-sm leading-relaxed tracking-wide whitespace-pre-line">
              {text_content}
            </p>
          </div>
        </div>

        <DialogFooter className="mt-4 pt-4 border-t">
          <div className="flex flex-col items-center gap-4 w-full">
            <Button
              variant="outline"
              size="sm"
              className="gap-2 w-full"
              onClick={() => window.open(url, '_blank')}
            >
              <span>Read full article</span>
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EvaluationSummary({ evaluation }: { evaluation: ContentCardProps['evaluation'] }) {
  return (
    <div className="grid grid-cols-1 gap-1 text-xs text-muted-foreground mb-2">
      <div className="grid grid-cols-2 gap-1">
        <div className="p-1 border border-transparent hover:border-blue-500 transition-colors">
          <p className="text-sm text-green-500 font-semibold">{evaluation?.event_type}</p>
          <p className="text-xs text-blue-500">{evaluation?.event_subtype}</p>
        </div>
        <div className="p-1 border border-transparent hover:border-blue-500 transition-colors">
          <p className="text-sm font-semibold">🗣️ {evaluation?.rhetoric}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-1">
        <div className="p-1 border border-transparent hover:border-blue-500 transition-colors"> 
          <p className="font-semibold mb-1">Impact</p>
          <div className="grid grid-cols-4 gap-1">
            <ImpactDetail label="Global Political" value={evaluation?.global_political_impact ?? null} />
            <ImpactDetail label="Regional Political" value={evaluation?.regional_political_impact ?? null} />
            <ImpactDetail label="Global Economic" value={evaluation?.global_economic_impact ?? null} />
            <ImpactDetail label="Regional Economic" value={evaluation?.regional_economic_impact ?? null} />
          </div>
        </div>
      </div>
    </div>
  );
}

function EvaluationDetails({ evaluation }: { evaluation: ContentCardProps['evaluation'] }) {
  return (
    <>
      <div className="flex flex-wrap gap-1 mb-2">
        <Badge variant="secondary">{evaluation?.rhetoric}</Badge>
        {evaluation?.keywords?.map((keyword) => (
          <Badge key={keyword} variant="outline">{keyword}</Badge>
        ))}
      </div>
      
      <div className="grid grid-cols-1 gap-1 text-xs text-muted-foreground mb-4">
        <div className="grid grid-cols-2 gap-1">
          <div className="p-1 border border-transparent hover:border-blue-500 transition-colors">
            <p className="text-sm font-semibold">🔍 {evaluation?.event_type}</p>
          </div>
          <div className="p-1 border border-transparent hover:border-blue-500 transition-colors">
            <p className="text-sm font-semibold">🏛️ {evaluation?.rhetoric}</p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 gap-1">
          <div className="p-1 border border-transparent hover:border-blue-500 transition-colors">
            <p className="font-semibold mb-1">Impact Assessment</p>
            <div className="grid grid-cols-4 gap-1">
              <ImpactDetail label="Global Political" value={evaluation?.global_political_impact ?? null} />
              <ImpactDetail label="Regional Political" value={evaluation?.regional_political_impact ?? null} />
              <ImpactDetail label="Global Economic" value={evaluation?.global_economic_impact ?? null} />
              <ImpactDetail label="Regional Economic" value={evaluation?.regional_economic_impact ?? null} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function ImpactDetail({ label, value }: { label: string, value: number | null }) {
  return (
    <div className="p-0.5">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-xs"><span className={`font-bold ${getColorClass(value, false)}`}>
        {value?.toFixed(1)}
      </span></p>
    </div>
  );
}

function getColorClass(value: number | null, isNegative: boolean = false): string {
  if (value === null || value === undefined) return 'text-gray-500';
  
  if (isNegative) {
    if (value < 3.33) return 'text-red-500';
    if (value < 6.66) return 'text-yellow-500';
    return 'text-green-500';
  } else {
    if (value < 3.33) return 'text-green-500';
    if (value < 6.66) return 'text-yellow-500';
    return 'text-red-500';
  }
}

// Helper function copied/adapted from storeBookmark.tsx
// TODO: Consider moving this to a shared utility file
const findDataSourceByIdentifier = (identifier: string, dataSources: any[]): number | null => {
  const found = dataSources.find(ds => {
    if (ds.type === "url_list" && Array.isArray(ds.origin_details?.urls) && ds.origin_details.urls.includes(identifier)) {
      return true;
    }
    // Add checks for other types if needed (e.g., text block hash)
    return false;
  });
  return found ? found.id : null;
};

export default ContentCard;