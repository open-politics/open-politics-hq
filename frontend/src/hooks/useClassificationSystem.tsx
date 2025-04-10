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
import { ClassificationRunRead, ClassificationRunUpdate } from '@/client/models';
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
  updateRun: (runId: number, data: ClassificationRunUpdate) => Promise<ClassificationRun | null>;
  deleteRun: (runId: number) => Promise<boolean>;
  
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
      const loadedRuns = await ClassificationService.getRunsAPI(workspaceId);
      const internalRuns: ClassificationRun[] = loadedRuns.map(runRead => ({
          id: runRead.id,
          name: runRead.name || `Run ${runRead.id}`,
          timestamp: runRead.updated_at || runRead.created_at,
          documentCount: runRead.document_count ?? 0,
          schemeCount: runRead.scheme_count ?? 0,
          description: runRead.description || undefined,
          status: runRead.status === 'pending' || runRead.status === 'running' || runRead.status === 'completed' || runRead.status === 'failed' ? runRead.status : undefined,
      }));
      setRuns(internalRuns);
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
      
      // Fetch run details and results separately
      // 1. Fetch Run Details
      const runDetailsRead = await ClassificationService.getRunAPI(workspaceId, runId);

      // Convert runDetailsRead (ClassificationRunRead) to internal ClassificationRun type
      const runDetails: ClassificationRun = {
        id: runDetailsRead.id,
        name: runDetailsRead.name || `Run ${runDetailsRead.id}`,
        timestamp: runDetailsRead.updated_at || runDetailsRead.created_at,
        documentCount: runDetailsRead.document_count ?? 0,
        schemeCount: runDetailsRead.scheme_count ?? 0,
        description: runDetailsRead.description || undefined,
        status: runDetailsRead.status === 'pending' || runDetailsRead.status === 'running' || runDetailsRead.status === 'completed' || runDetailsRead.status === 'failed' ? runDetailsRead.status : undefined,
      };

      // 2. Fetch Results by Run ID
      const runResults = await ClassificationService.getResultsByRunAPI(workspaceId, runId);

      if (runResults.length === 0) {
        console.warn(`No results found for run ID ${runId}, but run exists.`);
        // Still set the active run, but results will be empty
        setActiveRun(runDetails);
        setResults([]);
        // Since there are no results, we can't infer schemes reliably. Return empty schemes array.
        return { run: runDetails, results: [], schemes: [] };
      }

      // 3. Extract unique scheme IDs
      const schemeIds = [...new Set(runResults.map(r => r.scheme_id))].filter(id => typeof id === 'number') as number[];

      // 4. Fetch Schemes (ensure they are loaded or fetch missing ones)
      const currentSchemesMap = new Map(schemes.map(s => [s.id, s]));
      const schemesToFetch = schemeIds.filter(id => !currentSchemesMap.has(id));

      if (schemesToFetch.length > 0) {
        const fetchedSchemes = await Promise.all(
          schemesToFetch.map(id => ClassificationService.getScheme(workspaceId, id))
        );
        fetchedSchemes.forEach(s => currentSchemesMap.set(s.id, s));
        // Update global schemes state if new ones were fetched
        setSchemes(Array.from(currentSchemesMap.values()));
      }
      const runSchemes = schemeIds.map(id => currentSchemesMap.get(id)).filter(Boolean) as ClassificationScheme[];

      // 5. Format Results
      const formattedResults = runResults
        .map(result => {
          const scheme = runSchemes.find(s => s.id === result.scheme_id);
          // Cast result to ClassificationResult expected by formatResult
          const resultToFormat: ClassificationResult = {
              id: result.id,
              document_id: result.document_id,
              scheme_id: result.scheme_id,
              value: result.value || {},
              timestamp: result.timestamp || new Date().toISOString(),
              run_id: result.run_id || runId,
              run_name: runDetails.name,
              run_description: runDetails.description,
          };
          return scheme ? ClassificationService.formatResult(resultToFormat, scheme) : null;
        })
        .filter(Boolean) as FormattedClassificationResult[];

      // 6. Update State
      setActiveRun(runDetails);
      setResults(formattedResults);

      return { run: runDetails, results: formattedResults, schemes: runSchemes };
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
  }, [activeWorkspace?.uid, getWorkspaceId, toast, schemes]);
  
  // Load classification results
  const loadResults = useCallback(async (contentId?: number, runId?: number) => {
    if (!activeWorkspace?.uid) return;
    
    setIsLoadingResults(true);
    setError(null);
    
    try {
      const workspaceId = getWorkspaceId();
      
      // Use getResultsAPI which should return ClassificationResultRead[]
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
          const resultToFormat: ClassificationResult = {
            id: result.id,
            document_id: result.document_id,
            scheme_id: result.scheme_id,
            value: result.value || {},
            timestamp: result.timestamp || new Date().toISOString(),
            run_id: result.run_id || runId || 0,
            run_name: (runId ? `Run ${runId}` : 'Unknown Run'),
            run_description: undefined,
          };

          return ClassificationService.formatResult(resultToFormat, scheme);
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
      run_description: runDescription,
      value: {}, // Placeholder value, ensure it's a dict
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
      
      // Use our service to classify (this should hit the V2 endpoint)
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

      // The result from classifyContent might be ClassificationResultRead, adapt it
      const resultToFormat: ClassificationResult = {
        id: result.id,
        document_id: result.document_id,
        scheme_id: result.scheme_id,
        value: result.value || {}, // Ensure value is a dict
        timestamp: result.timestamp || new Date().toISOString(), // Provide fallback timestamp
        run_id: result.run_id || runId || 0, // Use passed runId if available
        run_name: runName || (result.run_id ? `Run ${result.run_id}` : 'Classified Item'), // Use runName from function scope
        run_description: runDescription || undefined, // Use runDescription from function scope
      };
      const formattedResult = ClassificationService.formatResult(resultToFormat, scheme);
      
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
      
      // Use our service to batch classify (this likely calls classifyContent internally)
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
      const formattedResults = results.map(result => {
        const resultToFormat: ClassificationResult = {
            id: result.id,
            document_id: result.document_id,
            scheme_id: result.scheme_id,
            value: result.value || {},
            timestamp: result.timestamp || new Date().toISOString(),
            run_id: result.run_id || 0,
            run_name: runName || (result.run_id ? `Run ${result.run_id}` : 'Classified Item'),
            run_description: runDescription || undefined,
        };
        return ClassificationService.formatResult(resultToFormat, scheme!)
      });
      
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
    let createdRun: ClassificationRun | null = null; // Store the created run

    try {
      const workspaceId = getWorkspaceId();
      const runName = options.name || `Run - ${new Date().toLocaleString()}`;
      const runDescription = options.description;

      // Call new API flow
      // 1. Create the ClassificationRun record via API
      toast({ title: 'Creating run record...' });
      const createdRunRead = await ClassificationService.createRunAPI(workspaceId, {
        name: runName,
        description: runDescription,
        status: 'pending', // Start as pending
      });
      
      // Convert to internal ClassificationRun type
      createdRun = {
          id: createdRunRead.id,
          name: createdRunRead.name || `Run ${createdRunRead.id}`,
          timestamp: createdRunRead.updated_at || createdRunRead.created_at,
          documentCount: createdRunRead.document_count ?? 0,
          schemeCount: createdRunRead.scheme_count ?? 0,
          description: createdRunRead.description || undefined,
          status: createdRunRead.status === 'pending' || createdRunRead.status === 'running' || createdRunRead.status === 'completed' || createdRunRead.status === 'failed' ? createdRunRead.status : undefined,
      }

      if (!createdRun) {
        throw new Error('Failed to create run record in the backend.');
      }
      const runId = createdRun.id;
      setActiveRun(createdRun); // Optimistically set active run

      // 2. Get API provider and model details
      const provider = selectedProvider || undefined;
      const model = selectedModel || undefined;
      const apiKey = provider ? apiKeys[provider] : undefined;
      if (provider && !apiKey) {
        throw new Error('API key not found for selected provider');
      }

      // 3. Iterate and classify each document with each scheme using V2 endpoint
      toast({ title: `Classifying ${contents.length * schemeIds.length} items for Run ${runId}` });
      const allClassificationResults: ClassificationResult[] = [];
      let completedCount = 0;
      const totalTasks = contents.length * schemeIds.length;

      // Update run status to running
      await ClassificationService.updateRunAPI(workspaceId, runId, { status: 'running' });

      for (const content of contents) {
        for (const schemeId of schemeIds) {
          try {
            // Ensure document exists before classifying
            const documentId = await ClassificationService.ensureDocumentExists(content, workspaceId);

            // Call classify service (which should hit V2 endpoint)
            const classificationResult = await ClassificationService.classify(workspaceId, {
                documentId: documentId,
                schemeId: schemeId,
                runId: runId,
                runName: runName, // Pass run name/desc here
                runDescription: runDescription,
                provider: provider,
                model: model,
                apiKey: apiKey,
                // No content needed here as classify uses documentId
            });

            // Adapt ClassificationResultRead to ClassificationResult before pushing
            const resultToPush: ClassificationResult = {
              id: classificationResult.id,
              document_id: classificationResult.document_id,
              scheme_id: classificationResult.scheme_id,
              value: classificationResult.value || {}, // Ensure value is a dict
              timestamp: classificationResult.timestamp || new Date().toISOString(), // Provide fallback timestamp
              run_id: classificationResult.run_id || runId, // Use runId from function scope
              run_name: runName, // Use runName from function scope (options)
              run_description: runDescription, // Use runDescription from function scope (options)
            };
            allClassificationResults.push(resultToPush);
            completedCount++;
            console.log(`Run progress: Classified ${completedCount}/${totalTasks}`);
            // Optionally update progress toast/state here if needed

          } catch (individualError: any) {
            console.error(`Error classifying doc ${content.id || 'new'} with scheme ${schemeId} for run ${runId}:`, individualError);
            // Decide how to handle partial failures: continue, stop, mark run as failed?
            // For now, we log and continue.
            setError(`Partial failure during run: ${individualError.message}`);
            toast({
              title: 'Partial Run Failure',
              description: `Error classifying doc ${content.id || 'new'} with scheme ${schemeId}. Check console.`,
              variant: 'default'
            });
          }
        }
      }

      // 4. Update Run Status (e.g., completed)
      await ClassificationService.updateRunAPI(workspaceId, runId, { status: 'completed' });
      createdRun.status = 'completed'; // Update local object

      // 5. Update State and Return
      // Update global runs list
      setRuns(prev => {
          const existingRunIndex = prev.findIndex(r => r.id === runId);
          if (existingRunIndex > -1) {
              const updatedRuns = [...prev];
              updatedRuns[existingRunIndex] = createdRun!;
              return updatedRuns;
          } else {
              return [createdRun!, ...prev];
          }
      });
      // Set active run and results (loadRun might be better for consistency)
      setActiveRun(createdRun);
      // Optionally format and set results directly, or rely on loadRun to be called after
      // const formattedResults = allClassificationResults.map(r => ... format ...);
      // setResults(formattedResults);

      // For more robust state, call loadRun to fetch the complete picture
      await loadRun(runId);

      toast({
        title: 'Classification run complete',
        description: `Finished Run ${runId}: ${runName}. Classified ${completedCount}/${totalTasks} items.`,
      });

      return createdRun;

    } catch (err: any) {
      console.error('Error creating run:', err);
      setError(`Failed to create run: ${err.message}`);
      toast({
        title: 'Error Creating Run',
        description: err.message,
        variant: 'destructive',
      });
      // Optionally update run status to failed if createdRun exists
       if (createdRun?.id) {
          try {
              const workspaceId = getWorkspaceId();
              await ClassificationService.updateRunAPI(workspaceId, createdRun.id, { status: 'failed' });
          } catch (updateError) {
              console.error("Failed to update run status to failed:", updateError);
          }
       }
      return null;
    } finally {
      setIsCreatingRun(false);
    }
  }, [activeWorkspace?.uid, getWorkspaceId, loadRun, toast, selectedProvider, selectedModel, apiKeys, schemes]);
  
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
      
      // Use the specific service method for loading results by run
      const results = await ClassificationService.getResultsByRunAPI(wsId, runId);

      // Format the results with their display values
      // Need run details to properly format run_name/description
      let runDetails: ClassificationRun | null = null;
      if (results.length > 0) {
          // Try to find run details from the active run or fetch if necessary
          const currentActiveRun = activeRun;
          if (currentActiveRun && currentActiveRun.id === runId) {
              runDetails = currentActiveRun;
          } else {
              try {
                  const runDetailsRead = await ClassificationService.getRunAPI(wsId, runId);
                  runDetails = {
                      id: runDetailsRead.id,
                      name: runDetailsRead.name || `Run ${runDetailsRead.id}`,
                      timestamp: runDetailsRead.updated_at || runDetailsRead.created_at,
                      documentCount: runDetailsRead.document_count ?? 0,
                      schemeCount: runDetailsRead.scheme_count ?? 0,
                      description: runDetailsRead.description || undefined,
                      status: runDetailsRead.status === 'pending' || runDetailsRead.status === 'running' || runDetailsRead.status === 'completed' || runDetailsRead.status === 'failed' ? runDetailsRead.status : undefined,
                  };
              } catch (runFetchError) {
                  console.warn(`Could not fetch run details for run ${runId}:`, runFetchError);
              }
          }
      }

      const formattedResults = results.map(result => {
        const scheme = schemes.find(s => s.id === result.scheme_id);
        // Adapt ClassificationResultRead to ClassificationResult
        const resultToFormat: ClassificationResult = {
            id: result.id,
            document_id: result.document_id,
            scheme_id: result.scheme_id,
            value: result.value || {},
            timestamp: result.timestamp || new Date().toISOString(),
            run_id: result.run_id || runId,
            run_name: runDetails?.name || `Run ${runId}`,
            run_description: runDetails?.description || undefined,
        };
        if (!scheme) return resultToFormat as FormattedClassificationResult; // Return adapted result if scheme missing
        return ClassificationService.formatResult(resultToFormat, scheme);
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
  }, [activeWorkspace, schemes, activeRun, getWorkspaceId, toast]);
  
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
      
      // Use getResultsAPI
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
        .map(result => {
            // result here is ClassificationResultRead
            const resultToFormat: ClassificationResult = {
                id: result.id,
                document_id: result.document_id,
                scheme_id: result.scheme_id,
                value: result.value || {}, // Ensure value is dict
                timestamp: result.timestamp || new Date().toISOString(), // Fallback timestamp
                run_id: result.run_id || 0,
                // Use placeholders as run details aren't readily available here
                // Corrected: Do not access result.run_name or result.run_description
                run_name: (result.run_id ? `Run ${result.run_id}` : 'Unknown Run'), 
                run_description: undefined, 
            };
            return ClassificationService.formatResult(resultToFormat, scheme!) // scheme is guaranteed here
        })
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
  
  // Update a classification run
  const updateRun = useCallback(async (runId: number, data: ClassificationRunUpdate): Promise<ClassificationRun | null> => {
    if (!activeWorkspace?.uid) return null;
    setIsLoadingRuns(true);
    setError(null);
    try {
      const workspaceId = getWorkspaceId();
      const updatedRunRead = await ClassificationService.updateRunAPI(workspaceId, runId, data);
      // Convert to internal type
      const updatedRun: ClassificationRun = {
        id: updatedRunRead.id,
        name: updatedRunRead.name || `Run ${updatedRunRead.id}`,
        timestamp: updatedRunRead.updated_at || updatedRunRead.created_at,
        documentCount: updatedRunRead.document_count ?? 0,
        schemeCount: updatedRunRead.scheme_count ?? 0,
        description: updatedRunRead.description || undefined,
        status: updatedRunRead.status === 'pending' || updatedRunRead.status === 'running' || updatedRunRead.status === 'completed' || updatedRunRead.status === 'failed' ? updatedRunRead.status : undefined,
      };
      // Update local state
      setRuns(prev => prev.map(r => r.id === runId ? updatedRun : r));
      if (activeRun?.id === runId) {
        setActiveRun(updatedRun);
      }
      toast({ title: 'Run Updated', description: `Run "${updatedRun.name}" details saved.` });
      return updatedRun;
    } catch (err: any) {
      console.error('Error updating run:', err);
      setError(`Failed to update run: ${err.message}`);
      toast({ title: 'Error Updating Run', description: err.message, variant: 'destructive' });
      return null;
    } finally {
      setIsLoadingRuns(false);
    }
  }, [activeWorkspace?.uid, getWorkspaceId, toast, activeRun]);

  // Delete a classification run
  const deleteRun = useCallback(async (runId: number): Promise<boolean> => {
    if (!activeWorkspace?.uid) return false;
    setIsLoadingRuns(true); // Reuse loading state
    setError(null);
    try {
      const workspaceId = getWorkspaceId();
      await ClassificationService.deleteRunAPI(workspaceId, runId);
      // Update local state
      setRuns(prev => prev.filter(r => r.id !== runId));
      if (activeRun?.id === runId) {
        setActiveRun(null);
        setResults([]); // Clear results if the active run was deleted
      }
      toast({ title: 'Run Deleted', description: `Run ${runId} successfully deleted.` });
      return true;
    } catch (err: any) {
      console.error('Error deleting run:', err);
      setError(`Failed to delete run: ${err.message}`);
      toast({ title: 'Error Deleting Run', description: err.message, variant: 'destructive' });
      return false;
    } finally {
      setIsLoadingRuns(false);
    }
  }, [activeWorkspace?.uid, getWorkspaceId, toast, activeRun]);
  
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
    updateRun,
    deleteRun,
    
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