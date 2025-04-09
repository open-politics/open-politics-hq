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
import { DocumentRead, ClassificationResultRead, ClassificationSchemeRead, EnhancedClassificationResultRead, FieldType } from '@/client/models';
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
  const [classificationResults, setClassificationResults] = useState<ClassificationResultRead[]>([]);
  const [isTextLocked, setIsTextLocked] = useState(true);
  const { runs: availableRunsFromStore, isLoading: isLoadingRunsFromStore, fetchRunHistory } = useRunHistoryStore();
  const { toast } = useToast();

  const fetchClassificationResults = useCallback(
    async (documentId: number, workspaceId: string, runName: string | null) => {
      setIsLoadingResults(true);
      setResultsError(null);
      try {
        const results = await ClassificationResultsService.listClassificationResults({
          workspaceId: parseInt(workspaceId),
          documentIds: [documentId],
          runName: runName || undefined,
        });
        setClassificationResults(results);
        
        // Extract unique runs from results
        const uniqueRuns = [...new Set(results
          .filter(r => r.run_id && r.run_name)
          .map(r => JSON.stringify({id: r.run_id, name: r.run_name})))]
          .map(str => JSON.parse(str));
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
      if (!selectedDocumentId || !activeWorkspace?.uid) return;

      setIsLoadingResults(true);
      setResultsError(null);

      try {
        if (document && document.id) {
          await fetchClassificationResults(document.id, activeWorkspace.uid.toString(), selectedRun);
        } else {
          console.warn("Document or document.id is undefined, skipping fetchClassificationResults");
          return;
        }
      } catch (error: any) {
        console.error("Error fetching classification results:", error);
        setResultsError("Failed to load classification results.");
      } finally {
        setIsLoadingResults(false);
      }
    };

    if (document) {
      loadResults();
    }
  }, [document, activeWorkspace?.uid, fetchClassificationResults, selectedRun, selectedDocumentId]);

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

  const formatDisplayValue = (value: any, scheme: ClassificationSchemeRead | undefined) => {
    if (!scheme || !value) return null;

    // Extract value from scheme-specific field if exists
    const schemeValue = value[scheme.name] || value?.value || value;

    if (scheme.fields && scheme.fields.length > 0) {
      const field = scheme.fields[0];
      
      switch (field.type) {
        case 'int':
          if (field.scale_min === 0 && field.scale_max === 1) {
            return schemeValue > 0.5 ? 'Positive' : 'Negative';
          }
          return typeof schemeValue === 'number' ? schemeValue.toFixed(2) : schemeValue;
          
        case 'List[str]':
          if (Array.isArray(schemeValue)) {
            return schemeValue.join(', ');
          }
          return schemeValue;
          
        case 'str':
          return schemeValue;
          
        default:
          if (typeof schemeValue === 'object' && schemeValue !== null) {
            try {
              if (Array.isArray(schemeValue)) {
                return schemeValue.map((item, index) => {
                  const key = index;
                  const val = item;
                  if (typeof val === 'object' && val !== null) {
                    return Object.entries(val)
                      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                      .join(', ');
                  }
                  return `${key}: ${JSON.stringify(val)}`;
                }).join(', ');
              } else {
                return Object.entries(schemeValue)
                  .map(([key, val]) => `${key}: ${JSON.stringify(val)}`)
                  .join(', ');
              }
            } catch (error) {
              console.error("Error stringifying object:", error);
              return "Error displaying value";
            }
          }
          return JSON.stringify(schemeValue);
      }
    }
    
    return String(schemeValue);
  };

  const renderClassificationBadges = () => (
    <div className="space-y-4">
      {classificationResults.map((result) => {
        const scheme = schemes.find(s => s.id === result.scheme_id);
        return (
          <div key={result.id} className="space-y-2">
            <div className="font-medium">{scheme?.name}</div>
            <ClassificationResultDisplay 
              result={result}
              scheme={scheme!}
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
  const handleLoadIntoRunner = useCallback((result: ClassificationResultRead) => {
    if (!result.run_id || !result.run_name || !onLoadIntoRunner) return;
    
    // Get all results for this run and document to ensure we have the complete context
    if (activeWorkspace?.uid) {
      // First show a loading toast
      toast({
        title: "Preparing data",
        description: "Gathering all classification results for this document...",
      });
      
      // Get all results for this document and run
      ClassificationResultsService.listClassificationResults({
        workspaceId: typeof activeWorkspace.uid === 'string' 
          ? parseInt(activeWorkspace.uid, 10) 
          : activeWorkspace.uid,
        documentIds: [result.document_id],
        runName: result.run_name,
      }).then(results => {
        // Extract all scheme IDs from the results
        const schemeIds = [...new Set(results.map(r => r.scheme_id))];
        
        // Now call the onLoadIntoRunner callback with the run ID and name
        onLoadIntoRunner(result.run_id, result.run_name || '');
        
        toast({
          title: "Success",
          description: `Loaded run "${result.run_name}" with ${schemeIds.length} schemes for document ${result.document_id}`,
        });
      }).catch(error => {
        console.error("Error preparing data for runner:", error);
        toast({
          title: "Error",
          description: "Failed to gather all classification results",
          variant: "destructive",
        });
        
        // Still try to load what we have
        onLoadIntoRunner(result.run_id, result.run_name || '');
      });
    } else {
      // Fallback if no workspace
      onLoadIntoRunner(result.run_id, result.run_name || '');
    }
  }, [onLoadIntoRunner, activeWorkspace?.uid, toast]);

  // New function to render run selector
  const renderRunSelector = () => {
    // Filter runs for the current document
    const documentRuns = availableRunsFromStore.filter(run => {
      // If we have classification results for this document, check if any belong to this run
      return classificationResults.some(result => 
        result.document_id === selectedDocumentId && result.run_id === run.id
      );
    });
    
    if (documentRuns.length === 0) {
      return (
        <div className="mb-4 p-3 bg-muted/20 rounded-lg border border-2 border-metadata">
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
      <div className="mb-4 p-3 bg-muted/20 rounded-lg border border-2 border-metadata">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Available Runs</h4>
          {isLoadingRunsFromStore && <Loader2 className="h-4 w-4 animate-spin" />}
        </div>
        <div className="mt-2">
          <Select
            value={selectedRun || "all"}
            onValueChange={(value) => setSelectedRun(value === "all" ? null : value)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a run" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All runs</SelectItem>
              {documentRuns.map((run) => (
                <SelectItem key={run.id} value={run.id.toString()}>
                  {run.name} ({run.timestamp})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {selectedRun && selectedRun !== "all" && (
          <div className="mt-2 flex justify-end">
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                const run = documentRuns.find(r => r.id.toString() === selectedRun);
                if (run && onLoadIntoRunner) {
                  onLoadIntoRunner(run.id, run.name || '');
                }
              }}
              className="text-xs"
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              Load Selected Run in Runner
            </Button>
          </div>
        )}
      </div>
    );
  };

  const renderClassificationSection = () => (
    <div className="p-6 w-full backdrop-blur-md bg-secondary/70 rounded-lg shadow-md relative overflow-hidden border-2 border-results">
      {/* Run Selector */}
      {renderRunSelector()}
      
      {/* Unified Results List */}
      <div className="space-y-4">
        {classificationResults.length === 0 ? (
          <div className="text-center py-4 text-muted-foreground">
            No classification results available
          </div>
        ) : (
          classificationResults.map((result) => {
            const scheme = schemes.find(s => s.id === result.scheme_id);
            return (
              <div 
                key={result.id} 
                className="p-4 bg-card rounded-lg shadow-sm hover:shadow-md hover:scale-105 transition-all duration-200 cursor-pointer"
                onClick={() => {
                  setSelectedResult(result);
                  setIsResultDialogOpen(true);
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-sm">{scheme?.name}</span>
                      {result.run_name && (
                        <Badge variant="outline" className="text-xs">
                          {result.run_name}
                        </Badge>
                      )}
                    </div>
                    <ClassificationResultDisplay 
                      result={result}
                      scheme={scheme!}
                      compact={true}
                    />
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className="text-xs text-muted-foreground">
                      {result.timestamp && format(new Date(result.timestamp), "PP · p")}
                    </div>
                    {result.run_id && onLoadIntoRunner && (
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="text-xs hover:bg-primary hover:text-primary-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleLoadIntoRunner(result);
                        }}
                      >
                        <ExternalLink className="h-3 w-3 mr-1" />
                        Load in Runner
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

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
              isNewDocument && "border-2 border-green-500"
            )}>
              <div className="flex items-start p-4 border-b border-2 border-documents rounded-t-lg">
                <div className="flex items-start gap-4 text-sm">
                  <Avatar>
                    <AvatarImage alt={document.title} />
                    <AvatarFallback>
                      {document.title
                        .split(" ")
                        .map((chunk) => chunk[0])
                        .join("")}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid gap-1">
                    <div className="font-semibold">{document.title}</div>
                    <div className="line-clamp-1 text-xs">{document.content_type}</div>
                    <div className="line-clamp-1 text-xs">
                      <span className="font-medium">Source:</span> {document.source}
                    </div>
                  </div>
                </div>
                {document.insertion_date && (
                  <div className="ml-auto text-xs">
                    {format(new Date(document.insertion_date), "PPpp")}
                  </div>
                )}
              </div>
              {document.files && document.files.length > 0 && (
                <div className="p-4 border-t border-2 border-documents">
                  <h4 className="text-sm font-medium mb-2">Files</h4>
                  <div className="flex flex-wrap items-center gap-2">
                  {(document?.files || []).map((file) => (
                    <div key={file.id} className="flex items-center">
                      <Badge variant="outline" className="truncate max-w-[350px] h-8">
                        <a
                          href={file.url || ''}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate text-xs"
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
                            "ml-1 text-xs",
                            useDocumentStore.getState().isExtractedPdf(file.id) && "text-green-500 hover:text-green-600"
                          )}
                          disabled={useDocumentStore.getState().isExtractingPdf(file.id)}
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
                <>
              <Separator />
              <div className="p-4 relative overflow-hidden border-t border-2 border-documents">
                {document.top_image && (
                  <>
                    <div className="absolute inset-6 cursor-pointer hover:scale-110 transition-transform duration-200" onClick={() => setIsImageOpen(true)}>
                      <Image
                        src={document.top_image}
                        alt={document.title}
                        className="rounded-lg object-cover w-full h-full"
                        width={500}
                        height={200}
                        style={{ objectFit: 'cover', width: '100%', height: '100%' }}
                      />
                      <div className="absolute inset-0 shadow-lg rounded-lg"></div>
                    </div>
                    <Dialog open={isImageOpen} onOpenChange={() => setIsImageOpen(false)}>
                      <DialogContent className="sm:max-w-lg">
                        <DialogHeader>
                          <DialogTitle>{document.title}</DialogTitle>
                        </DialogHeader>
                        <Image
                          src={document.top_image}
                          alt={document.title}
                          className="rounded-lg object-cover w-full h-full"
                          width={800}
                          height={600}
                          style={{ objectFit: 'contain', width: '100%', height: '100%' }}
                        />
                      </DialogContent>
                    </Dialog>
                  </>
                )}
              </div>
              </>
              )}

              

              <Separator />
              <div className="p-4 border-t border-2 border-documents rounded-b-lg">
                <div className="flex items-center justify-start mb-2">
                  <h4 className="text-sm font-medium">Document Content</h4>
                  
                </div>
                <div 
                  className={cn(
                    "whitespace-pre-wrap text-sm backdrop-blur-md bg-secondary/70 md:p-2 rounded-lg relative",
                    isTextLocked ? "line-clamp-6" : "max-h-[300px] overflow-y-auto"
                  )}
                >
                  {document.text_content}
                  {isTextLocked && (
                    <div className="absolute bottom-0 left-0 w-full h-1/2 bg-gradient-to-t from-secondary/70 to-transparent"></div>
                  )}
                </div>
                <div className="flex justify-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsTextLocked(!isTextLocked)}
                    className="flex rounded-xl bg-secondary/20 p-2 mt-2 justify-center hover:bg-secondary/70 transition-all duration-200 cursor-pointer"
                  >
                    <div className="flex items-center justify-center">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {isTextLocked ? "Show More" : "Show Less"}
                        </span>
                      </div>
                      {isTextLocked ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronUp className="h-4 w-4" />
                      )}
                    </div>
                  </Button>
                </div>
              </div>

              {/* Classification Section - Always visible */}
              <div className="p-4 pt-0">
                <div className="flex items-center justify-between">
                  <h4 className="text-lg font-semibold">Classification Results</h4>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefreshClassificationResults}
                    disabled={isLoadingResults}
                    className="text-xs"
                  >
                    <RefreshCw className={`h-3 w-3 mr-1 ${isLoadingResults ? 'animate-spin' : ''}`} />
                    Refresh Results
                  </Button>
                </div>
              </div>
              <div className="p-4 pt-0 h-full rounded-lg">
                {renderClassificationSection()}
              </div>
            </div>
          ) : (
            <div className="p-8 text-center">
              No document selected
            </div>
          )}
        </div>

        {/* Result Dialog */}
        <Dialog open={isResultDialogOpen} onOpenChange={setIsResultDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {selectedResult?.scheme_id && schemes.find(s => s.id === selectedResult.scheme_id)?.name}
                {selectedResult?.run_name && (
                  <Badge variant="outline" className="text-sm">
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
            <div className="space-y-4">
              {selectedResult && (
                <ClassificationResultDisplay 
                  result={selectedResult}
                  scheme={schemes.find(s => s.id === selectedResult.scheme_id)!}
                />
              )}
              <div className="mt-4 pt-4 border-t flex justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onEdit(documents.find(d => d.id === selectedResult?.document_id) || document!);
                    setIsResultDialogOpen(false);
                  }}
                  className="text-primary"
                >
                  View Full Document →
                </Button>
                {selectedResult?.run_id && onLoadIntoRunner && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => {
                      handleLoadIntoRunner(selectedResult);
                      setIsResultDialogOpen(false);
                    }}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Load in Classification Runner
                  </Button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <Toaster />
    </>
  );
};

export default DocumentDetailView;