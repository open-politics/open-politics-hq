import { useState, useEffect, useCallback } from 'react';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { useApiKeysStore } from '@/zustand_stores/storeApiKeys';
import { useToast } from '@/components/ui/use-toast';
import { 
  ClassifiableContent, 
  ClassificationResult, 
  ClassificationScheme,
  ClassificationRun,
  FormattedClassificationResult,
  ClassifiableDocument
} from '@/lib/classification/types';
import { ClassificationService } from '@/lib/classification/service';
import { useClassificationSettingsStore } from '@/zustand_stores/storeClassificationSettings';

// Global cache for schemes to prevent redundant API calls
const schemesCache = new Map<number, {
  timestamp: number;
  schemes: ClassificationScheme[];
}>();

// Cache expiration time (5 minutes)
const SCHEMES_CACHE_EXPIRATION = 5 * 60 * 1000;

// Define the options for the hook
interface UseClassificationSystemOptions {
  autoLoadSchemes?: boolean;
  autoLoadDocuments?: boolean;
  autoLoadRuns?: boolean;
  contentId?: number;
  runId?: number;
  useCache?: boolean; // New option to control caching behavior
}

// Define the return type for the hook
interface UseClassificationSystemResult {
  // Schemes
  schemes: ClassificationScheme[];
  isLoadingSchemes: boolean;
  loadSchemes: () => Promise<void>;
  createScheme: (schemeData: any) => Promise<ClassificationScheme | null>;
  updateScheme: (schemeId: number, schemeData: any) => Promise<ClassificationScheme | null>;
  deleteScheme: (schemeId: number) => Promise<boolean>;
  
  // Documents
  documents: ClassifiableDocument[];
  selectedDocument: ClassifiableDocument | null;
  isLoadingDocuments: boolean;
  loadDocuments: () => Promise<void>;
  loadDocument: (documentId: number) => Promise<ClassifiableDocument | null>;
  createDocument: (documentData: Partial<ClassifiableDocument>) => Promise<ClassifiableDocument | null>;
  setSelectedDocument: (document: ClassifiableDocument | null) => void;
  
  // Results
  results: FormattedClassificationResult[];
  isLoadingResults: boolean;
  loadResults: (contentId?: number, runId?: number) => Promise<void>;
  loadResultsByRun: (runId: number, workspaceId?: number) => Promise<FormattedClassificationResult[]>;
  clearResultsCache: (contentId: number, runId?: number) => void;
  loadResultsByScheme: (schemeId: number) => Promise<FormattedClassificationResult[]>;
  
  // Classification
  isClassifying: boolean;
  classifyContent: (content: ClassifiableContent, schemeId: number, runId?: number, runName?: string, runDescription?: string) => Promise<FormattedClassificationResult | null>;
  batchClassify: (contents: ClassifiableContent[], schemeId: number, runName?: string, runDescription?: string) => Promise<FormattedClassificationResult[]>;
  
  // Runs
  runs: ClassificationRun[];
  activeRun: ClassificationRun | null;
  isLoadingRuns: boolean;
  isCreatingRun: boolean;
  loadRuns: () => Promise<void>;
  loadRun: (runId: number) => Promise<{
    run: ClassificationRun;
    results: FormattedClassificationResult[];
    schemes: ClassificationScheme[];
  } | null>;
  createRun: (contents: ClassifiableContent[], schemeIds: number[], options?: {
    name?: string;
    description?: string;
  }) => Promise<ClassificationRun | null>;
  setActiveRun: (run: ClassificationRun | null) => void;
  
  // Default scheme management
  getDefaultSchemeId: () => number | null;
  setDefaultSchemeId: (schemeId: number) => void;
  
  // Error handling
  error: string | null;
  setError: (error: string | null) => void;
}

/**
 * A consolidated hook for all classification operations
 * Replaces useClassification, useClassificationRun, useDocuments, and useClassify
 */
export function useClassificationSystem(options: UseClassificationSystemOptions = {}): UseClassificationSystemResult {
  const { activeWorkspace } = useWorkspaceStore();
  const { apiKeys, selectedProvider, selectedModel } = useApiKeysStore();
  const { toast } = useToast();
  const classificationSettings = useClassificationSettingsStore();
  
  // State for schemes
  const [schemes, setSchemes] = useState<ClassificationScheme[]>([]);
  const [isLoadingSchemes, setIsLoadingSchemes] = useState(false);
  
  // State for documents
  const [documents, setDocuments] = useState<ClassifiableDocument[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<ClassifiableDocument | null>(null);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);
  
  // State for runs
  const [runs, setRuns] = useState<ClassificationRun[]>([]);
  const [activeRun, setActiveRun] = useState<ClassificationRun | null>(null);
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  
  // State for results
  const [results, setResults] = useState<FormattedClassificationResult[]>([]);
  const [isLoadingResults, setIsLoadingResults] = useState(false);
  
  // State for operations
  const [isClassifying, setIsClassifying] = useState(false);
  const [isCreatingRun, setIsCreatingRun] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Get workspace ID as a number
  const getWorkspaceId = useCallback(() => {
    if (!activeWorkspace?.uid) {
      throw new Error('No active workspace');
    }
    
    return typeof activeWorkspace.uid === 'string' 
      ? parseInt(activeWorkspace.uid) 
      : activeWorkspace.uid;
  }, [activeWorkspace?.uid]);
  
  // Load classification schemes
  const loadSchemes = useCallback(async () => {
    if (!activeWorkspace?.uid) return;
    
    try {
      const workspaceId = getWorkspaceId();
      
      // Check if we should use cache and if there's a valid cached entry
      if (options.useCache !== false) {
        const cachedData = schemesCache.get(workspaceId);
        
        if (cachedData && (Date.now() - cachedData.timestamp < SCHEMES_CACHE_EXPIRATION)) {
          console.log('Using cached schemes for workspace:', workspaceId);
          setSchemes(cachedData.schemes);
          return;
        }
      }
      
      setIsLoadingSchemes(true);
      setError(null);
      
      const loadedSchemes = await ClassificationService.getSchemes(workspaceId);
      setSchemes(loadedSchemes);
      
      // Cache the schemes for future use
      if (options.useCache !== false) {
        schemesCache.set(workspaceId, {
          timestamp: Date.now(),
          schemes: loadedSchemes
        });
      }
    } catch (err: any) {
      console.error('Error loading schemes:', err);
      setError('Failed to load classification schemes');
      toast({
        title: 'Error',
        description: 'Failed to load classification schemes',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingSchemes(false);
    }
  }, [activeWorkspace?.uid, getWorkspaceId, toast, options.useCache]);
  
  // Clear schemes cache
  const clearSchemesCache = useCallback((workspaceId?: number) => {
    if (workspaceId) {
      schemesCache.delete(workspaceId);
    } else {
      schemesCache.clear();
    }
  }, []);
  
  // Load documents
  const loadDocuments = useCallback(async () => {
    if (!activeWorkspace?.uid) return;
    
    setIsLoadingDocuments(true);
    setError(null);
    
    try {
      const workspaceId = getWorkspaceId();
      const loadedDocuments = await ClassificationService.getDocuments(workspaceId);
      setDocuments(loadedDocuments);
    } catch (err: any) {
      console.error('Error loading documents:', err);
      setError('Failed to load documents');
      toast({
        title: 'Error',
        description: 'Failed to load documents',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingDocuments(false);
    }
  }, [activeWorkspace?.uid, getWorkspaceId, toast]);
  
  // Load a specific document
  const loadDocument = useCallback(async (documentId: number) => {
    if (!activeWorkspace?.uid) return null;
    
    setIsLoadingDocuments(true);
    setError(null);
    
    try {
      const workspaceId = getWorkspaceId();
      const document = await ClassificationService.getDocument(workspaceId, documentId);
      setSelectedDocument(document);
      return document;
    } catch (err: any) {
      console.error('Error loading document:', err);
      setError('Failed to load document');
      toast({
        title: 'Error',
        description: 'Failed to load document',
        variant: 'destructive',
      });
      return null;
    } finally {
      setIsLoadingDocuments(false);
    }
  }, [activeWorkspace?.uid, getWorkspaceId, toast]);
  
  // Load classification runs
  const loadRuns = useCallback(async () => {
    if (!activeWorkspace?.uid) return;
    
    setIsLoadingRuns(true);
    setError(null);
    
    try {
      const workspaceId = getWorkspaceId();
      const loadedRuns = await ClassificationService.getRuns(workspaceId);
      setRuns(loadedRuns);
    } catch (err: any) {
      console.error('Error loading runs:', err);
      setError('Failed to load classification runs');
      toast({
        title: 'Error',
        description: 'Failed to load classification runs',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingRuns(false);
    }
  }, [activeWorkspace?.uid, getWorkspaceId, toast]);
  
  // Load a specific run
  const loadRun = useCallback(async (runId: number) => {
    if (!activeWorkspace?.uid) return null;
    
    setIsLoadingRuns(true);
    setIsLoadingResults(true);
    setError(null);
    
    try {
      const workspaceId = getWorkspaceId();
      const { run, results, schemes } = await ClassificationService.getRun(workspaceId, runId);
      
      setActiveRun(run);
      setResults(results);
      
      // Update schemes if we got new ones
      if (schemes.length > 0) {
        setSchemes(prevSchemes => {
          // Merge new schemes with existing ones, avoiding duplicates
          const schemeMap = new Map(prevSchemes.map(s => [s.id, s]));
          schemes.forEach(s => schemeMap.set(s.id, s));
          return Array.from(schemeMap.values());
        });
      }
      
      return { run, results, schemes };
    } catch (err: any) {
      console.error('Error loading run:', err);
      setError('Failed to load classification run');
      toast({
        title: 'Error',
        description: 'Failed to load classification run',
        variant: 'destructive',
      });
      return null;
    } finally {
      setIsLoadingRuns(false);
      setIsLoadingResults(false);
    }
  }, [activeWorkspace?.uid, getWorkspaceId, toast]);
  
  // Load classification results
  const loadResults = useCallback(async (contentId?: number, runId?: number) => {
    if (!activeWorkspace?.uid) return;
    
    setIsLoadingResults(true);
    setError(null);
    
    try {
      const workspaceId = getWorkspaceId();
      
      // Get results using our service
      const apiResults = await ClassificationService.getResults(workspaceId, {
        documentId: contentId,
        runId
      });
      
      // Format results with their display values
      const formattedResults = await Promise.all(
        apiResults.map(async result => {
          // Find the scheme for this result
          const schemeId = result.scheme_id;
          let scheme = schemes.find(s => s.id === schemeId);
          
          // If scheme not found in local state, fetch it
          if (!scheme) {
            try {
              scheme = await ClassificationService.getScheme(workspaceId, schemeId);
              
              // Update schemes state with the new scheme
              setSchemes(prevSchemes => [...prevSchemes, scheme!]);
            } catch (err) {
              console.error(`Error fetching scheme ${schemeId}:`, err);
              return null;
            }
          }
          
          if (!scheme) return null;
          
          // Format the result
          return ClassificationService.formatResult(result, scheme);
        })
      );
      
      // Filter out null results
      const validResults = formattedResults.filter(Boolean) as FormattedClassificationResult[];
      
      setResults(validResults);
    } catch (err: any) {
      console.error('Error loading results:', err);
      setError('Failed to load classification results');
      toast({
        title: 'Error',
        description: 'Failed to load classification results',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingResults(false);
    }
  }, [activeWorkspace?.uid, getWorkspaceId, schemes, toast]);
  
  // Clear cache for a specific content
  const clearResultsCache = useCallback((contentId: number, runId?: number) => {
    if (!activeWorkspace?.uid) return;
    
    const workspaceId = getWorkspaceId();
    ClassificationService.clearResultsCache(contentId, runId, workspaceId);
  }, [activeWorkspace?.uid, getWorkspaceId]);
  
  // Classify a content item
  const classifyContent = useCallback(async (
    content: ClassifiableContent,
    schemeId: number,
    runId?: number,
    runName?: string,
    runDescription?: string
  ) => {
    if (!activeWorkspace?.uid) {
      toast({
        title: 'Error',
        description: 'No active workspace',
        variant: 'destructive',
      });
      return null;
    }
    
    setIsClassifying(true);
    setError(null);
    
    // Add optimistic update - ensure it conforms to FormattedClassificationResult
    const tempId = Date.now(); // Use a temporary ID for the optimistic result
    const tempResult: FormattedClassificationResult = {
      id: tempId, 
      document_id: content.id || 0, // Use content id or 0
      scheme_id: schemeId,
      timestamp: new Date().toISOString(),
      run_id: runId || 0, // Use provided runId or 0
      run_name: runName || 'Optimistic Classification',
      value: null, // Placeholder value
      scheme: schemes.find(s => s.id === schemeId),
      displayValue: 'Classifying...', // Indicate loading state
      isOptimistic: true
    };
    
    // Add the optimistic result to the state
    setResults(prev => [tempResult, ...prev.filter(r => !r.isOptimistic)]);

    try {
      const workspaceId = getWorkspaceId();
      
      // Get the API provider and model
      const provider = selectedProvider || undefined;
      const model = selectedModel || undefined;
      
      if (provider && !apiKeys[provider]) {
        throw new Error('API key not found for selected provider');
      }
      
      // Get the API key if a provider is selected
      const apiKey = provider ? apiKeys[provider] : undefined;
      
      // Use our service to classify
      const result = await ClassificationService.classifyContent(
        content,
        schemeId,
        workspaceId,
        {
          runId,
          runName,
          runDescription,
          provider,
          model,
          apiKey,
          onProgress: (status) => {
            console.log(`Classification progress: ${status}`);
          }
        }
      );
      
      // Find the scheme
      let scheme = schemes.find(s => s.id === schemeId);
      
      // If scheme not found in local state, fetch it
      if (!scheme) {
        try {
          scheme = await ClassificationService.getScheme(workspaceId, schemeId);
          
          // Update schemes state with the new scheme
          setSchemes(prevSchemes => [...prevSchemes, scheme!]);
        } catch (err) {
          console.error(`Error fetching scheme ${schemeId}:`, err);
          throw new Error(`Scheme with ID ${schemeId} not found`);
        }
      }
      
      // Remove optimistic result after completion (success or failure)
      setResults(prev => prev.filter(r => r.id !== tempId));

      // Format the actual result
      const formattedResult = ClassificationService.formatResult(result, scheme);
      
      // Update results list with the actual result
      setResults(prev => [formattedResult, ...prev]);
      
      toast({
        title: 'Success',
        description: `Classified with scheme: ${scheme.name}`,
      });
      
      return formattedResult;
    } catch (err: any) {
      console.error('Classification error:', err);
      setError(`Classification failed: ${err.message}`);
      toast({
        title: 'Classification failed',
        description: err.message,
        variant: 'destructive',
      });
      // Ensure optimistic result is removed on error
      setResults(prev => prev.filter(r => r.id !== tempId));
      return null;
    } finally {
      setIsClassifying(false);
      // This filter might be redundant now as it's handled in try/catch, but keep for safety
      // setResults(prev => prev.filter(r => r.id !== tempId)); 
    }
  }, [activeWorkspace?.uid, getWorkspaceId, schemes, toast, selectedProvider, selectedModel, apiKeys]);
  
  // Batch classify multiple content items
  const batchClassify = useCallback(async (
    contents: ClassifiableContent[],
    schemeId: number,
    runName?: string,
    runDescription?: string
  ) => {
    if (!activeWorkspace?.uid || contents.length === 0) {
      toast({
        title: 'Error',
        description: 'No active workspace or no content to classify',
        variant: 'destructive',
      });
      return [];
    }
    
    setIsClassifying(true);
    setError(null);
    
    try {
      const workspaceId = getWorkspaceId();
      
      // Get the API provider and model
      const provider = selectedProvider || undefined;
      const model = selectedModel || undefined;
      
      if (provider && !apiKeys[provider]) {
        throw new Error('API key not found for selected provider');
      }
      
      // Get the API key if a provider is selected
      const apiKey = provider ? apiKeys[provider] : undefined;
      
      // Show a toast that we're starting batch classification
      toast({
        title: 'Starting batch classification',
        description: `Classifying ${contents.length} items`,
      });
      
      // Use our service to batch classify
      const results = await ClassificationService.batchClassify(
        contents,
        schemeId,
        workspaceId,
        {
          runName,
          runDescription,
          provider,
          model,
          apiKey
        }
      );
      
      // Find the scheme
      let scheme = schemes.find(s => s.id === schemeId);
      
      // If scheme not found in local state, fetch it
      if (!scheme) {
        try {
          scheme = await ClassificationService.getScheme(workspaceId, schemeId);
          
          // Update schemes state with the new scheme
          setSchemes(prevSchemes => [...prevSchemes, scheme!]);
        } catch (err) {
          console.error(`Error fetching scheme ${schemeId}:`, err);
          throw new Error(`Scheme with ID ${schemeId} not found`);
        }
      }
      
      // Format the results
      const formattedResults = results.map(result => 
        ClassificationService.formatResult(result, scheme!)
      );
      
      // Update results list
      setResults(prev => [...formattedResults, ...prev]);
      
      // Show a toast with the results
      toast({
        title: 'Classification complete',
        description: `Successfully classified ${results.length} items`,
      });
      
      return formattedResults;
    } catch (err: any) {
      console.error('Error during batch classification:', err);
      const errorMessage = err.message || 'Failed to classify content';
      setError(errorMessage);
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
      return [];
    } finally {
      setIsClassifying(false);
    }
  }, [activeWorkspace?.uid, getWorkspaceId, schemes, toast, selectedProvider, selectedModel, apiKeys]);
  
  // Create a new classification run
  const createRun = useCallback(async (
    contents: ClassifiableContent[],
    schemeIds: number[],
    options: {
      name?: string;
      description?: string;
    } = {}
  ) => {
    if (!activeWorkspace?.uid || contents.length === 0 || schemeIds.length === 0) {
      toast({
        title: 'Error',
        description: 'Missing required data for classification run',
        variant: 'destructive',
      });
      return null;
    }
    
    setIsCreatingRun(true);
    setError(null);
    
    try {
      const workspaceId = getWorkspaceId();
      
      // Get the API provider and model
      const provider = selectedProvider || undefined;
      const model = selectedModel || undefined;
      
      if (provider && !apiKeys[provider]) {
        throw new Error('API key not found for selected provider');
      }
      
      // Get the API key if a provider is selected
      const apiKey = provider ? apiKeys[provider] : undefined;
      
      // Show a toast that we're starting the run
      toast({
        title: 'Starting classification run',
        description: `Classifying ${contents.length} items with ${schemeIds.length} schemes`,
      });
      
      // Use our service to create a run
      const run = await ClassificationService.createRun(
        contents,
        schemeIds,
        workspaceId,
        {
          name: options.name,
          description: options.description,
          provider,
          model,
          apiKey,
          onProgress: (status, current, total) => {
            console.log(`Run progress: ${status} (${current}/${total})`);
          }
        }
      );
      
      // Update runs list
      setRuns(prev => [run, ...prev]);
      setActiveRun(run);
      
      // Load the full run to get formatted results
      await loadRun(run.id);
      
      toast({
        title: 'Classification run complete',
        description: `Successfully classified ${contents.length} items with ${schemeIds.length} schemes`,
      });
      
      return run;
    } catch (err: any) {
      console.error('Error creating run:', err);
      setError(`Failed to create run: ${err.message}`);
      toast({
        title: 'Error',
        description: `Failed to create run: ${err.message}`,
        variant: 'destructive',
      });
      return null;
    } finally {
      setIsCreatingRun(false);
    }
  }, [activeWorkspace?.uid, getWorkspaceId, loadRun, toast, selectedProvider, selectedModel, apiKeys]);
  
  // Create a new document
  const createDocument = useCallback(async (documentData: Partial<ClassifiableDocument>) => {
    if (!activeWorkspace?.uid) {
      toast({
        title: 'Error',
        description: 'No active workspace',
        variant: 'destructive',
      });
      return null;
    }
    
    setError(null);
    
    try {
      const workspaceId = getWorkspaceId();
      const createdDocument = await ClassificationService.createDocument(workspaceId, documentData);
      
      // Update documents list
      setDocuments(prev => [createdDocument, ...prev]);
      
      toast({
        title: 'Success',
        description: 'Document created successfully',
      });
      
      return createdDocument;
    } catch (err: any) {
      console.error('Error creating document:', err);
      setError(`Failed to create document: ${err.message}`);
      toast({
        title: 'Error',
        description: `Failed to create document: ${err.message}`,
        variant: 'destructive',
      });
      return null;
    }
  }, [activeWorkspace?.uid, getWorkspaceId, toast]);
  
  // Create a new classification scheme
  const createScheme = useCallback(async (schemeData: any) => {
    if (!activeWorkspace?.uid) {
      toast({
        title: 'Error',
        description: 'No active workspace',
        variant: 'destructive',
      });
      return null;
    }
    
    setError(null);
    
    try {
      const workspaceId = getWorkspaceId();
      const createdScheme = await ClassificationService.createScheme(workspaceId, schemeData);
      
      // Update schemes list
      setSchemes(prev => [...prev, createdScheme]);
      
      toast({
        title: 'Success',
        description: `Created scheme: ${createdScheme.name}`,
      });
      
      return createdScheme;
    } catch (err: any) {
      console.error('Error creating scheme:', err);
      setError(`Failed to create scheme: ${err.message}`);
      toast({
        title: 'Error',
        description: `Failed to create scheme: ${err.message}`,
        variant: 'destructive',
      });
      return null;
    }
  }, [activeWorkspace?.uid, getWorkspaceId, toast]);
  
  // Update an existing classification scheme
  const updateScheme = useCallback(async (schemeId: number, schemeData: any) => {
    if (!activeWorkspace?.uid) {
      toast({
        title: 'Error',
        description: 'No active workspace',
        variant: 'destructive',
      });
      return null;
    }
    
    setError(null);
    
    try {
      const workspaceId = getWorkspaceId();
      const updatedScheme = await ClassificationService.updateScheme(workspaceId, schemeId, schemeData);
      
      // Update schemes list
      setSchemes(prev => prev.map(scheme => 
        scheme.id === schemeId ? updatedScheme : scheme
      ));
      
      toast({
        title: 'Success',
        description: `Updated scheme: ${updatedScheme.name}`,
      });
      
      return updatedScheme;
    } catch (err: any) {
      console.error('Error updating scheme:', err);
      setError(`Failed to update scheme: ${err.message}`);
      toast({
        title: 'Error',
        description: `Failed to update scheme: ${err.message}`,
        variant: 'destructive',
      });
      return null;
    }
  }, [activeWorkspace?.uid, getWorkspaceId, toast]);
  
  // Delete a classification scheme
  const deleteScheme = useCallback(async (schemeId: number) => {
    if (!activeWorkspace?.uid) {
      toast({
        title: 'Error',
        description: 'No active workspace',
        variant: 'destructive',
      });
      return false;
    }
    
    setError(null);
    
    try {
      const workspaceId = getWorkspaceId();
      await ClassificationService.deleteScheme(workspaceId, schemeId);
      
      // Update schemes list
      setSchemes(prev => prev.filter(scheme => scheme.id !== schemeId));
      
      toast({
        title: 'Success',
        description: 'Deleted scheme',
      });
      
      return true;
    } catch (err: any) {
      console.error('Error deleting scheme:', err);
      setError(`Failed to delete scheme: ${err.message}`);
      toast({
        title: 'Error',
        description: `Failed to delete scheme: ${err.message}`,
        variant: 'destructive',
      });
      return false;
    }
  }, [activeWorkspace?.uid, getWorkspaceId, toast]);
  
  // Get the default scheme ID for the current workspace
  const getDefaultSchemeId = useCallback(() => {
    if (!activeWorkspace?.uid || schemes.length === 0) return null;
    
    const workspaceId = getWorkspaceId();
    return classificationSettings.getDefaultSchemeId(workspaceId, schemes);
  }, [activeWorkspace?.uid, getWorkspaceId, schemes, classificationSettings]);
  
  // Set the default scheme ID for the current workspace
  const setDefaultSchemeId = useCallback((schemeId: number) => {
    if (!activeWorkspace?.uid) return;
    
    const workspaceId = getWorkspaceId();
    classificationSettings.setDefaultSchemeId(workspaceId, schemeId);
    
    const scheme = schemes.find(s => s.id === schemeId);
    if (scheme) {
      toast({
        title: 'Default scheme updated',
        description: `Set "${scheme.name}" as the default classification scheme.`,
      });
    }
  }, [activeWorkspace?.uid, getWorkspaceId, schemes, classificationSettings, toast]);
  
  // Add the loadResultsByRun function
  const loadResultsByRun = useCallback(async (runId: number, workspaceId?: number) => {
    if (!activeWorkspace?.uid && !workspaceId) {
      console.error('No active workspace');
      return [];
    }
    
    setIsLoadingResults(true);
    setError(null);
    
    try {
      // Use provided workspaceId or get it from activeWorkspace
      const wsId = workspaceId || (activeWorkspace && typeof activeWorkspace.uid === 'string' 
        ? parseInt(activeWorkspace.uid) 
        : activeWorkspace?.uid);
      
      if (!wsId) {
        throw new Error('No valid workspace ID');
      }
      
      console.log(`Loading results for run ID: ${runId} in workspace: ${wsId}`);
      
      // Use the existing loadResults function with the runId parameter
      const results = await ClassificationService.getResults(wsId, { runId });
      
      // Format the results with their display values
      const formattedResults = results.map(result => {
        const scheme = schemes.find(s => s.id === result.scheme_id);
        if (!scheme) return result as FormattedClassificationResult;
        return ClassificationService.formatResult(result, scheme);
      });
      
      setResults(formattedResults);
      return formattedResults;
    } catch (error: any) {
      console.error('Error loading results by run:', error);
      setError(`Failed to load results: ${error.message}`);
      return [];
    } finally {
      setIsLoadingResults(false);
    }
  }, [activeWorkspace, schemes]);
  
  // Add a function to load results filtered by scheme ID
  const loadResultsByScheme = useCallback(async (schemeId: number) => {
    if (!activeWorkspace?.uid) {
      toast({
        title: 'Error',
        description: 'No active workspace',
        variant: 'destructive',
      });
      return [];
    }

    setIsLoadingResults(true); // Use the existing loading state for simplicity
    setError(null);

    try {
      const workspaceId = getWorkspaceId();
      
      // Get results using our service, filtered by schemeId
      const apiResults = await ClassificationService.getResults(workspaceId, {
        schemeId,
        limit: 50 // Add a limit to avoid loading too many results initially
      });

      // Fetch the specific scheme details (needed for formatting)
      let scheme = schemes.find(s => s.id === schemeId);
      if (!scheme) {
        scheme = await ClassificationService.getScheme(workspaceId, schemeId);
        // Add the fetched scheme to the state if it wasn't there
        if (scheme) {
          setSchemes(prev => {
            // Ensure scheme exists and isn't already in the state before adding
            if (scheme && !prev.some(s => s.id === schemeId)) {
              return [...prev, scheme]; 
            }
            return prev;
          });
        }
      }
      
      if (!scheme) {
         throw new Error(`Scheme with ID ${schemeId} not found`);
      }

      // Format results
      const formattedResults = apiResults
        .map(result => ClassificationService.formatResult(result, scheme!))
        .filter(Boolean) as FormattedClassificationResult[];
        
      // Unlike loadResults, we don't automatically set the main `results` state here,
      // as this is specific to the scheme being viewed in the table context.
      // We return the results for the calling component to manage.
      
      return formattedResults;

    } catch (err: any) {
      console.error('Error loading results by scheme:', err);
      setError(`Failed to load results for scheme ${schemeId}`);
      toast({
        title: 'Error',
        description: `Failed to load results for scheme: ${err.message}`,
        variant: 'destructive',
      });
      return []; // Return empty array on error
    } finally {
      setIsLoadingResults(false);
    }
  }, [activeWorkspace?.uid, getWorkspaceId, schemes, toast]); // Added schemes to dependencies
  
  // Load initial data based on options
  useEffect(() => {
    if (activeWorkspace?.uid) {
      if (options.autoLoadSchemes) {
        loadSchemes();
      }
      
      if (options.autoLoadDocuments) {
        loadDocuments();
      }
      
      if (options.autoLoadRuns) {
        loadRuns();
      }
      
      if (options.contentId) {
        loadResults(options.contentId, options.runId);
      }
      
      if (options.runId) {
        loadRun(options.runId);
      }
    }
  }, [
    activeWorkspace?.uid,
    options.autoLoadSchemes,
    options.autoLoadDocuments,
    options.autoLoadRuns,
    options.contentId,
    options.runId,
    loadSchemes,
    loadDocuments,
    loadRuns,
    loadResults,
    loadRun
  ]);
  
  return {
    // Schemes
    schemes,
    isLoadingSchemes,
    loadSchemes,
    createScheme,
    updateScheme,
    deleteScheme,
    getDefaultSchemeId,
    setDefaultSchemeId,
    
    // Documents
    documents,
    selectedDocument,
    isLoadingDocuments,
    loadDocuments,
    loadDocument,
    createDocument,
    setSelectedDocument,
    
    // Runs
    runs,
    activeRun,
    isLoadingRuns,
    isCreatingRun,
    loadRuns,
    loadRun,
    createRun,
    setActiveRun,
    
    // Results
    results,
    isLoadingResults,
    loadResults,
    clearResultsCache,
    
    // Classification
    isClassifying,
    classifyContent,
    batchClassify,
    
    // Error handling
    error,
    setError,
    
    // Add the new functions
    loadResultsByRun,
    loadResultsByScheme
  };
} 