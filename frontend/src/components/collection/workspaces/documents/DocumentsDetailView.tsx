import React, { useState, useEffect, useCallback } from 'react';
import { Separator } from "@/components/ui/separator";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import { format } from "date-fns"
import { Textarea } from '@/components/ui/text-area';
import { Button } from '@/components/ui/button';
import { DocumentRead, ClassificationResultRead, ClassificationSchemeRead, FieldType } from '@/client/models';
import { EnhancedClassificationResultRead } from '@/components/collection/workspaces/classifications/ClassificationResultDisplay';
import Image from 'next/image';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { useClassificationSystem } from '@/hooks/useClassificationSystem';
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import Link from "next/link";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useDocumentStore } from '@/zustand_stores/storeDocuments';
import { ClassificationResultsService, ClassificationSchemesService } from '@/client/services';
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils";
import ClassificationResultDisplay from '../classifications/ClassificationResultDisplay';
import { PlusCircle, Lock, Unlock, ArrowRight, Loader2, Check, ChevronDown, ChevronUp, ExternalLink, RefreshCw } from "lucide-react";
import { useToast } from '@/components/ui/use-toast';
import { Toaster } from '@/components/ui/toaster';
import DocumentLink from './DocumentLink';
import { useRunHistoryStore } from '@/zustand_stores/storeRunHistory';
import { ClassifiableContent } from '@/lib/classification/types';

interface DocumentDetailViewProps {
  documents: DocumentRead[];
  newlyInsertedDocumentIds: number[];
  onEdit: (document: DocumentRead) => void;
  schemes: ClassificationSchemeRead[];
  selectedDocumentId: number | null;
  onLoadIntoRunner?: (runId: number, runName: string) => void;
}

// Temporary compatibility layer for useClassificationResultStore
// This will be removed once the migration is complete
const useClassificationResultStore = (() => {
  // Create a store-like object with the necessary properties and methods
  const store = {
    classificationResults: [],
    workingResult: null,
    autoSave: true,
    activeRunId: null,
    
    // Actions
    setClassificationResults: (results: any[]) => {},
    setWorkingResult: (result: any) => {},
    setAutoSave: (autoSave: boolean) => {},
    setActiveRunId: (runId: number | null) => {},
    
    // Getter function to access the store
    getState: () => store
  };
  
  // Return a hook-like function
  return {
    ...store,
    // Add any additional properties or methods needed
  };
})();

const DocumentDetailView: React.FC<DocumentDetailViewProps> = ({ documents, newlyInsertedDocumentIds = [], onEdit, schemes, selectedDocumentId, onLoadIntoRunner }) => {
  const { setSelectedDocumentId, extractPdfContent } = useDocumentStore();
  const { updateDocument, fetchDocuments } = useDocumentStore();
  const document = documents.find((item) => item.id === selectedDocumentId) || null;
  const [isImageOpen, setIsImageOpen] = useState(false);
  const { classifyContent } = useClassificationSystem({
    autoLoadSchemes: true
  });
  const { workingResult, autoSave, setAutoSave } = useClassificationResultStore;
  const { setActiveRunId } = useClassificationResultStore;
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [selectedScheme, setSelectedScheme] = useState<number | null>(null);
  const [classificationResult, setClassificationResult] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedResult, setSelectedResult] = useState<EnhancedClassificationResultRead | null>(null);
  const [isResultDialogOpen, setIsResultDialogOpen] = useState(false);
  const { activeWorkspace } = useWorkspaceStore();
  const [isLoadingResults, setIsLoadingResults] = useState(false);
  const [resultsError, setResultsError] = useState<string | null>(null);
  const [classificationResults, setClassificationResults] = useState<EnhancedClassificationResultRead[]>([]);
  const [isTextLocked, setIsTextLocked] = useState(true);
  const { runs: availableRunsFromStore, isLoading: isLoadingRunsFromStore, fetchRunHistory } = useRunHistoryStore();
  const { toast } = useToast();

  const fetchClassificationResults = useCallback(
    async (documentId: number, workspaceId: string, runIdFilter: string | null) => {
      setIsLoadingResults(true);
      setResultsError(null);
      try {
        const filterParams: any = {
          workspaceId: parseInt(workspaceId),
          documentIds: [documentId],
        };
        
        // Filter by run ID if a specific run is selected (not "all")
        if (runIdFilter && runIdFilter !== "all") {
           filterParams.runId = parseInt(runIdFilter, 10); 
        }

        const results = await ClassificationResultsService.listClassificationResults(filterParams);
        
        // MODIFIED: Cast to EnhancedClassificationResultRead[]
        setClassificationResults(results as EnhancedClassificationResultRead[]);

      } catch (error: any) {
        console.error("Error fetching classification results:", error);
        setResultsError("Failed to load classification results.");
      } finally {
        setIsLoadingResults(false);
      }
    },
    []
  );

  const handleRefreshClassificationResults = async () => {
    if (!document?.id || !activeWorkspace?.uid) return;
    await fetchClassificationResults(document.id, activeWorkspace.uid.toString(), selectedRun);
  };

  useEffect(() => {
    const loadResults = async () => {
      if (!selectedDocumentId || !activeWorkspace?.uid) {
        setClassificationResults([]); // Clear results if no doc selected
        return;
      }

      setIsLoadingResults(true);
      setResultsError(null);

      try {
        if (document && document.id) {
          await fetchClassificationResults(document.id, activeWorkspace.uid.toString(), selectedRun);
        } else {
          // Clear results if document context is lost
          setClassificationResults([]);
        }
      } catch (error: any) {
        console.error("Error fetching classification results:", error);
        setResultsError("Failed to load classification results.");
        setClassificationResults([]); // Clear on error
      } finally {
        setIsLoadingResults(false);
      }
    };

    loadResults(); // Load results whenever document, workspace, or selected run changes

  }, [document?.id, activeWorkspace?.uid, fetchClassificationResults, selectedRun, selectedDocumentId]);

  useEffect(() => {
    if (activeWorkspace?.uid) {
      const workspaceId = typeof activeWorkspace.uid === 'string' 
        ? parseInt(activeWorkspace.uid, 10) 
        : activeWorkspace.uid;
      
      fetchRunHistory(workspaceId);
    }
  }, [activeWorkspace?.uid, fetchRunHistory]);

  const handleRunClassification = async () => {
    if (!selectedScheme || !document || !activeWorkspace?.uid) {
      console.error("Cannot classify: Missing scheme, document, or workspace.");
      return;
    }
    setIsLoading(true);
    setClassificationResult(null);

    try {
      // Create an object conforming to ClassifiableContent
      const contentToClassify: ClassifiableContent = {
        id: document.id,
        title: document.title,
        text_content: document.text_content ?? undefined,
        url: document.url ?? undefined,
        source: document.source ?? undefined,
        content_type: document.content_type ?? undefined,
      };

      // Call classifyContent with the prepared content object and scheme ID
      const result = await classifyContent(
        contentToClassify,
        selectedScheme
      );

      if (result) {
        setClassificationResult(result);
        await fetchClassificationResults(document.id, activeWorkspace.uid.toString(), selectedRun);
      } else {
         console.error("Classification returned null");
         toast({
           title: "Classification Failed",
           description: "The classification process did not return a result.",
           variant: "destructive",
         });
      }
    } catch (error) {
      console.error("Classification failed:", error);
      toast({
        title: "Classification Error",
        description: error instanceof Error ? error.message : "An unknown error occurred during classification.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Check if the current document is newly inserted
  const isNewDocument = selectedDocumentId ? newlyInsertedDocumentIds.includes(selectedDocumentId) : false;

  const renderClassificationBadges = () => (
    <div className="space-y-4">
      {classificationResults.map((result) => {
        const scheme = schemes.find(s => s.id === result.scheme_id);
        if (!scheme) return null; // Skip if scheme not found
        return (
          <div key={result.id} className="space-y-2">
            <div className="font-medium">{scheme?.name}</div>
            <ClassificationResultDisplay 
              result={result}
              scheme={scheme}
            />
          </div>
        );
      })}
    </div>
  );

  const QuickSchemeCreator = () => {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [type, setType] = useState("str");
    const { activeWorkspace } = useWorkspaceStore();
    const [isLoading, setIsLoading] = useState(false);

    const handleCreate = async () => {
      if (!activeWorkspace?.uid || !name) return;
      setIsLoading(true);
      try {
        // For now, we'll use the old API directly
        await ClassificationSchemesService.createClassificationScheme({
          workspaceId: parseInt(activeWorkspace.uid.toString()),
          requestBody: {
            name,
            description,
            fields: [
              {
                name: name,
                type: type as FieldType,
                description: description,
              }
            ],
            model_instructions: "",
            validation_rules: {}
          }
        });
        // Reset form
        setName("");
        setDescription("");
        setType("str");
      } catch (error) {
        console.error("Error creating scheme:", error);
      } finally {
        setIsLoading(false);
      }
    };

    return (
      <div className="p-4 space-y-4 w-[300px]">
        <h4 className="font-medium">Quick Create Scheme</h4>
        <div className="space-y-2">
          <Input
            placeholder="Scheme name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full p-2 rounded-md border"
          >
            <option value="str">String</option>
            <option value="int">Integer</option>
            <option value="list">List</option>
          </select>
          <Button 
            className="w-full"
            onClick={handleCreate}
            disabled={!name || isLoading}
          >
            {isLoading ? "Creating..." : "Create Scheme"}
          </Button>
        </div>
      </div>
    );
  };

  // Function to handle loading results into the runner
  const handleLoadIntoRunner = useCallback((result: EnhancedClassificationResultRead) => {
    // MODIFIED: Check run_id is not null/undefined
    const runId = result.run_id;
    if (runId === null || runId === undefined || !onLoadIntoRunner) return;

    // MODIFIED: Use optional run_name from Enhanced type, provide default
    const runName = result.run_name || `Run ${runId}`; 

    if (activeWorkspace?.uid) {
      toast({
        title: "Preparing data",
        description: "Gathering all classification results for this document...",
      });
      
      // Get all results for this specific run ID
      ClassificationResultsService.getResultsByRun({
        workspaceId: typeof activeWorkspace.uid === 'string' 
          ? parseInt(activeWorkspace.uid, 10) 
          : activeWorkspace.uid,
        runId: runId, // Use the specific run ID
      }).then(results => {
        // Filter results for the specific document *after* fetching all for the run
        const resultsForThisDocument = results.filter(r => r.document_id === result.document_id);
        const schemeIds = [...new Set(resultsForThisDocument.map(r => r.scheme_id))];
        
        // Use the confirmed runId and potentially fetched runName
        onLoadIntoRunner(runId, runName); 
        
        toast({
          title: "Success",
          description: `Loaded run "${runName}" with ${schemeIds.length} schemes for document ${result.document_id}`,
        });
      }).catch(error => {
        console.error("Error preparing data for runner:", error);
        toast({
          title: "Error",
          description: "Failed to gather all classification results",
          variant: "destructive",
        });
        
        // Still try to load what we have
        onLoadIntoRunner(runId, runName); 
      });
    } else {
      // Fallback if no workspace
      onLoadIntoRunner(runId, runName); 
    }
  }, [onLoadIntoRunner, activeWorkspace?.uid, toast]);

  // New function to render run selector
  const renderRunSelector = () => {
    // Use availableRunsFromStore directly as it's already filtered by workspace
    // Filter unique runs that have results for the current document
    const runsWithResultsForDocument = availableRunsFromStore.filter(run => 
      classificationResults.some(result => result.document_id === selectedDocumentId && result.run_id === run.id)
    );

    if (runsWithResultsForDocument.length === 0 && !isLoadingResults && !isLoadingRunsFromStore) {
      return (
        <div className="mb-4 p-3 bg-muted/20 rounded-lg border">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">Available Runs</h4>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            No classification runs available for this document.
          </p>
        </div>
      );
    }
    
    return (
      <div className="mb-4 p-3 bg-muted/20 rounded-lg border">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Filter by Run</h4>
          {(isLoadingResults || isLoadingRunsFromStore) && <Loader2 className="h-4 w-4 animate-spin" />}
        </div>
        <div className="mt-2">
          <Select
            value={selectedRun || "all"} // "all" or the run ID string
            onValueChange={(value) => setSelectedRun(value === "all" ? null : value)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a run to filter results" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All runs for this document</SelectItem>
              {runsWithResultsForDocument.map((run) => (
                <SelectItem key={run.id} value={run.id.toString()}>
                  {run.name} ({run.timestamp})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  };

  // --- Refactored Classification Section ---
  const renderClassificationSection = () => (
    <div className="p-6 w-full bg-secondary/70 rounded-lg shadow-md relative overflow-hidden border border-border/30">
      {/* Run Selector Filter */}
      {renderRunSelector()}
      
      {/* Unified Results List */}
      <div className="space-y-3">
        {isLoadingResults ? (
           <div className="text-center py-4 text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading results...
            </div>
        ) : classificationResults.length === 0 ? (
          <div className="text-center py-4 text-muted-foreground">
            No classification results available {selectedRun && selectedRun !== 'all' ? 'for the selected run' : ''}.
          </div>
        ) : (
          classificationResults
            // Filtering is now handled by the fetchClassificationResults based on selectedRun
            .map((result) => {
              const scheme = schemes.find(s => s.id === result.scheme_id);
              if (!scheme) {
                console.warn(`Scheme not found for result ID ${result.id} with scheme ID ${result.scheme_id}`);
                return null; // Skip rendering if scheme is missing
              }

              const runName = result.run_name || (result.run_id ? `Run ${result.run_id}` : null);

              return (
                <div 
                  key={result.id} 
                  className="p-4 bg-card rounded-lg shadow-sm border border-border/50 hover:shadow-md hover:border-border/80 transition-all duration-200 cursor-pointer"
                  onClick={() => {
                    setSelectedResult(result);
                    setIsResultDialogOpen(true);
                  }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-1">
                       <div className="flex items-center gap-2 mb-1">
                         <span className="font-medium text-sm">{scheme.name}</span>
                         {runName && (
                           <Badge variant="outline" className="text-xs font-normal">{runName}</Badge>
                         )}
                       </div>
                       <ClassificationResultDisplay 
                         result={result}
                         scheme={scheme}
                         compact={false}
                       />
                    </div>
                    <div className="flex flex-col items-end gap-2 mt-1 shrink-0">
                      <div className="text-xs text-muted-foreground whitespace-nowrap">
                        {result.timestamp && format(new Date(result.timestamp), "PP · p")}
                      </div>
                      {result.run_id && onLoadIntoRunner && (
                        <Button 
                          variant="ghost"
                          size="sm" 
                          className="text-xs h-7 px-2 text-primary hover:bg-primary/10"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleLoadIntoRunner(result);
                          }}
                        >
                          <ExternalLink className="h-3 w-3 mr-1" />
                          Load Run
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
            .filter(Boolean)
        )}
        {resultsError && (
          <div className="text-center py-4 text-red-600">{resultsError}</div>
        )}
      </div>
    </div>
  );
  // --- End Refactored Section ---

  const handleExtractPdfContent = async (fileId: number) => {
    if (!document?.id || !activeWorkspace?.uid) return;
    
    try {
      await extractPdfContent(document.id, fileId);
    } catch (err: any) {
      console.error(err);
    }
  };

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Fixed Header */}
        <div className="flex-none bg-background z-10">
          <div className="flex items-center justify-between px-4 py-2">
            <h1 className="text-xl font-bold">Detail View</h1>
            {document && (
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => onEdit(document)}
              >
                Edit
              </Button>
            )}
          </div>
          <Separator />
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 rounded-lg overflow-y-auto">
          {document ? (
            <div className={cn(
              "space-y-2",
              isNewDocument && " border-green-500"
            )}>
              <div className="p-4 border-b border-border/30"> 
                <div className="flex items-start gap-4 text-sm">
                  <Avatar>
                    <AvatarImage alt={document.title} />
                    <AvatarFallback>
                      {document.title
                        ?.split(" ")
                        ?.map((chunk) => chunk[0])
                        ?.join("") || 'D'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid gap-1 flex-1">
                    <div className="font-semibold">{document.title}</div>
                    <div className="line-clamp-1 text-xs text-muted-foreground">{document.content_type}</div>
                    <div className="line-clamp-1 text-xs">
                      <span className="font-medium">Source:</span> {document.source || 'N/A'}
                    </div>
                  </div>
                  {document.insertion_date && (
                    <div className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
                      Added: {format(new Date(document.insertion_date), "PPp")}
                    </div>
                  )}
                </div>
              </div>

              {document.files && document.files.length > 0 && (
                <div className="p-4 border-b border-border/30">
                  <h4 className="text-sm font-medium mb-2">Files</h4>
                  <div className="flex flex-wrap items-center gap-2">
                  {(document?.files || []).map((file) => (
                    <div key={file.id} className="flex items-center">
                      <Badge variant="secondary" className="truncate max-w-[350px] h-8">
                        <a
                          href={file.url || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate text-xs"
                          title={file.name}
                        >
                          {file.name}
                        </a>
                      </Badge>
                      {file.filetype?.toLowerCase().includes('pdf') && (
                        <Button
                          variant={useDocumentStore.getState().isExtractedPdf(file.id) ? "ghost" : "ghost"}
                          size="sm"
                          onClick={() => handleExtractPdfContent(file.id)}
                          className={cn(
                            "ml-1 text-xs h-7 px-2",
                            useDocumentStore.getState().isExtractedPdf(file.id) 
                              ? "text-green-600 hover:text-green-700 hover:bg-green-500/10" 
                              : "text-primary hover:bg-primary/10"
                          )}
                          disabled={useDocumentStore.getState().isExtractingPdf(file.id)}
                          title={useDocumentStore.getState().isExtractedPdf(file.id) ? "PDF text already extracted" : "Extract text content from this PDF"}
                        >
                          {useDocumentStore.getState().isExtractingPdf(file.id) ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin mr-1" />
                              Extracting...
                            </>
                          ) : useDocumentStore.getState().isExtractedPdf(file.id) ? (
                            <>
                              <Check className="h-4 w-4 mr-1" />
                              Extracted
                            </>
                          ) : (
                            <>
                              <ArrowRight className="h-4 w-4 mr-1" />
                              Extract Text
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  ))}
                  </div>
                </div>
              )}

              {document.top_image && (
                <div className="p-4 border-b border-border/30 relative h-[200px] overflow-hidden group">
                  <Image
                    src={document.top_image}
                    alt={document.title || 'Top Image'}
                    layout="fill"
                    objectFit="cover"
                    className="rounded-lg transition-transform duration-300 group-hover:scale-105"
                  />
                   <div 
                      className="absolute inset-0 bg-black/10 hover:bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 cursor-pointer" 
                      onClick={() => setIsImageOpen(true)}
                      title="View full image"
                    >
                      <ExternalLink className="h-8 w-8 text-white/80" />
                   </div>
                  <Dialog open={isImageOpen} onOpenChange={setIsImageOpen}>
                    <DialogContent className="sm:max-w-3xl">
                      <DialogHeader>
                        <DialogTitle>{document.title}</DialogTitle>
                      </DialogHeader>
                      <div className="relative w-full h-[70vh]">
                        <Image
                          src={document.top_image}
                          alt={document.title || 'Top Image'}
                          layout="fill"
                          objectFit="contain"
                          className="rounded-lg"
                        />
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              )}

              <div className="p-4 border-b border-border/30">
                <div className="flex items-center justify-start mb-2">
                  <h4 className="text-sm font-medium">Document Content</h4>
                </div>
                <div 
                  className={cn(
                    "whitespace-pre-wrap text-sm bg-secondary/30 p-3 rounded-lg relative border border-border/30",
                    isTextLocked ? "max-h-[150px] overflow-hidden" : "max-h-[400px] overflow-y-auto"
                  )}
                >
                  {document.text_content || <span className="text-muted-foreground italic">No text content available.</span>}
                  {document.text_content && isTextLocked && (
                    <div className="absolute bottom-0 left-0 w-full h-16 bg-gradient-to-t from-secondary/30 via-secondary/30 to-transparent pointer-events-none"></div>
                  )}
                </div>
                 {document.text_content && (
                    <div className="flex justify-center mt-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsTextLocked(!isTextLocked)}
                        className="flex items-center gap-1 rounded-full bg-secondary/50 px-3 h-7 text-xs text-muted-foreground hover:bg-secondary/70 transition-all duration-200"
                    >
                        {isTextLocked ? (
                        <>Show More <ChevronDown className="h-4 w-4" /></>
                        ) : (
                        <>Show Less <ChevronUp className="h-4 w-4" /></>
                        )}
                    </Button>
                    </div>
                 )}
              </div>

              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-lg font-semibold">Classification Results</h4>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefreshClassificationResults}
                    disabled={isLoadingResults}
                    className="text-xs h-7 px-2"
                  >
                    <RefreshCw className={`h-3 w-3 mr-1 ${isLoadingResults ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
                {renderClassificationSection()}
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              Select a document from the list to view its details.
            </div>
          )}
        </div>

        <Dialog open={isResultDialogOpen} onOpenChange={setIsResultDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {selectedResult?.scheme_id && schemes.find(s => s.id === selectedResult.scheme_id)?.name}
                {selectedResult?.run_name && (
                  <Badge variant="outline" className="text-sm font-normal">
                    {selectedResult.run_name}
                  </Badge>
                )}
              </DialogTitle>
              {selectedResult?.timestamp && (
                <p className="text-xs text-muted-foreground -mt-2">
                  Created: {format(new Date(selectedResult.timestamp), "PPpp")}
                </p>
              )}
            </DialogHeader>
            <div className="max-h-[60vh] overflow-y-auto pr-2">
              {selectedResult && (
                <ClassificationResultDisplay 
                  result={selectedResult}
                  scheme={schemes.find(s => s.id === selectedResult.scheme_id)!}
                  renderContext="dialog"
                />
              )}
            </div>
            <DialogFooter className="mt-4 pt-4 border-t flex justify-between sm:justify-between">
               {selectedResult?.run_id && onLoadIntoRunner && (
                 <Button
                   variant="default"
                   size="sm"
                   onClick={() => {
                     if (selectedResult) {
                       handleLoadIntoRunner(selectedResult);
                     }
                     setIsResultDialogOpen(false);
                   }}
                   className="bg-primary text-primary-foreground hover:bg-primary/90"
                 >
                   <ExternalLink className="h-4 w-4 mr-2" />
                   Load Run in Runner
                 </Button>
               )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsResultDialogOpen(false)}
              >
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Toaster />
    </>
  );
};

export default DocumentDetailView;