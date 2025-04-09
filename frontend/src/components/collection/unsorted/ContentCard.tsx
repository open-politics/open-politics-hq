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
import { ClassifiableContent, ClassificationScheme } from '@/lib/classification/types';
import { CoreContentModel } from '@/lib/content';
import { useClassificationSettingsStore } from '@/zustand_stores/storeClassificationSettings';
import { useApiKeysStore } from '@/zustand_stores/storeApiKeys';
import { toast } from "@/components/ui/use-toast";
import { useClassificationSystem } from '@/hooks/useClassificationSystem';
import { ClassificationService } from '@/lib/classification/service';
import ClassificationResultDisplay from '@/components/collection/workspaces/classifications/ClassificationResultDisplay';
import { ClassificationResultRead, ClassificationSchemeRead } from '@/client';

export interface ContentCardProps extends CoreContentModel {
  id: string;
  className?: string;
  isHighlighted?: boolean;
  preloadedSchemes?: ClassificationScheme[];
}

export function ContentCard({ 
  id, 
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
  const { bookmarks, addBookmark, removeBookmark, isBookmarkPending } = useBookMarkStore();
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
    classifyContent,
    clearResultsCache
  } = useClassificationSystem({
    autoLoadSchemes: true,
    contentId: parseInt(id),
    useCache: true,
  });

  const isBookmarked = bookmarks.some(bookmark => bookmark.url === url);
  const isPending = isBookmarkPending(url || '');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  // Track if classification has been completed to avoid redundant API calls
  const [classificationCompleted, setClassificationCompleted] = useState(false);

  const classificationWidgetRef = useRef<HTMLButtonElement>(null);

  // Convert content to ClassifiableContent format - memoized to prevent unnecessary re-renders
  const classifiableContent = useMemo<ClassifiableContent>(() => ({
    id: parseInt(id) || 0, // Use 0 as fallback to ensure a new document is created
    title: title || 'Untitled Content',
    text_content: text_content || '',
    url: url || '',
    source: source || '',
    content_type: content_type || 'article',
    insertion_date: insertion_date || new Date().toISOString(),
    publication_date: publication_date || null,
    author: author || null,
    top_image: top_image || null
  }), [id, title, text_content, url, source, content_type, insertion_date, publication_date, author, top_image]);

  // Load classification results when component mounts or ID changes
  useEffect(() => {
    const contentId = parseInt(id);
    if (contentId > 0) {
      loadResults(contentId);
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
    
    // Pass runId from the result
    const contentId = parseInt(id);
    if (contentId > 0) {
      loadResults(contentId, result?.run_id);
    }
  }, [id, loadResults]);

  // Update the handleExternalClassify function to use the hook
  const handleExternalClassify = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    
    // Skip if already classifying
    if (isClassifying) {
      console.log("Classification already in progress, skipping");
      return;
    }
    
    try {
      // Get the workspace ID
      if (!activeWorkspace?.uid) {
        console.error("No active workspace");
        toast({
          title: "Error",
          description: "No active workspace",
          variant: "destructive"
        });
        return;
      }
      
      const workspaceId = typeof activeWorkspace.uid === 'string' 
        ? parseInt(activeWorkspace.uid) 
        : activeWorkspace.uid;
      
      // Get the default scheme ID using the store's validation
      const defaultSchemeId = classificationSettings.getDefaultSchemeId(workspaceId, schemes);
      
      if (!defaultSchemeId) {
        console.error("No default classification scheme available");
        toast({
          title: "Error",
          description: "No default classification scheme available",
          variant: "destructive"
        });
        return;
      }
      
      // Store the run ID
      const runId = Math.floor(Math.random() * 2147483647);
      
      // Use the classifyContent method from the hook
      const result = await classifyContent(
        classifiableContent,
        defaultSchemeId,
        runId,
        'Ad-hoc classification'
      );
      
      if (result) {
        console.log("ContentCard: Classification completed successfully");
        setClassificationCompleted(true);
        
        // Pass runId to loadResults
        const contentId = parseInt(id);
        if (contentId > 0) {
          loadResults(contentId, runId);
        }
      }
    } catch (error) {
      console.error("Error classifying content:", error);
      toast({
        title: "Classification Failed",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive"
      });
    }
  }, [id, classifiableContent, isClassifying, activeWorkspace, classificationSettings, schemes, classifyContent, loadResults]);

  const handleBookmark = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (isBookmarked) {
      removeBookmark(url || '');
    } else {
      await addBookmark({
        id,
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
        embeddings: null
      }, activeWorkspace?.uid);
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
      if (!activeWorkspace?.uid || schemes.length === 0) return;
      
      try {
        const workspaceId = typeof activeWorkspace.uid === 'string' 
          ? parseInt(activeWorkspace.uid) 
          : activeWorkspace.uid;
        
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
  }, [activeWorkspace?.uid, schemes, classificationSettings]);

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
                    // Force reload results
                    loadResults(parseInt(id) || 0);
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
          
          <div className="w-full pt-4 border-t mt-2">
            {isDialogOpen && (
              <ClassificationWidget 
                key={`classification-widget-${id}`}
                content={classifiableContent}
                buttonVariant="outline"
                buttonSize="sm"
                className="w-full"
                showResults={true}
                onClassificationComplete={handleClassificationComplete}
                loadResultsOnMount={true}
                buttonRef={classificationWidgetRef}
              />
            )}
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

export default ContentCard;