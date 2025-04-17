'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import ClassificationRunnerDock from '@/components/collection/workspaces/classifications/ClassificationRunnerDock';
import ClassificationRunner from '@/components/collection/workspaces/classifications/ClassificationRunner';
import { useClassificationSystem } from '@/hooks/useClassificationSystem';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { DocumentRead, ClassificationSchemeRead, ClassificationRunRead } from '@/client/models';
import { FormattedClassificationResult } from '@/lib/classification/types';
import { useToast } from '@/components/ui/use-toast';
import { schemesToSchemeReads, documentToDocumentRead } from '@/lib/classification/adapters';

export default function ClassificationRunnerPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const { toast } = useToast();
  const {
    schemes: allSchemesHook,
    documents: allDocumentsHook,
    isLoadingSchemes,
    isLoadingDocuments,
    isCreatingRun,
    classificationProgress,
    loadRun,
    createRun: createRunHook,
    updateRun,
    setActiveRun: setActiveRunHook, // Rename to avoid conflict
  } = useClassificationSystem({ autoLoadSchemes: true, autoLoadDocuments: true });

  // State for the active run details
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [activeRunName, setActiveRunName] = useState<string>('');
  const [activeRunDescription, setActiveRunDescription] = useState<string>('');
  const [activeRunResults, setActiveRunResults] = useState<FormattedClassificationResult[]>([]);
  const [activeRunSchemes, setActiveRunSchemes] = useState<ClassificationSchemeRead[]>([]);
  const [activeRunDocuments, setActiveRunDocuments] = useState<DocumentRead[]>([]);
  const [isLoadingRunDetails, setIsLoadingRunDetails] = useState(false);

  // State for selections made in the dock (for creating new runs) - REMOVED
  // const [selectedDocs, setSelectedDocs] = useState<number[]>([]);
  // const [selectedSchemes, setSelectedSchemes] = useState<number[]>([]);

  // Convert hook data to API Read types for props
  const allSchemes = useMemo(() => schemesToSchemeReads(allSchemesHook), [allSchemesHook]);
  const allDocuments = useMemo(() => allDocumentsHook.map(d => documentToDocumentRead(d)), [allDocumentsHook]);

  // --- Callback Handlers for Dock --- //

  // REMOVED handleDocSelect
  // const handleDocSelect = useCallback((docId: number, isSelected: boolean) => {
  //   setSelectedDocs(prev =>
  //     isSelected ? [...prev, docId] : prev.filter(id => id !== docId)
  //   );
  // }, []);

  // REMOVED handleSchemeSelect
  // const handleSchemeSelect = useCallback((schemeId: number, isSelected: boolean) => {
  //   setSelectedSchemes(prev =>
  //     isSelected ? [...prev, schemeId] : prev.filter(id => id !== schemeId)
  //   );
  // }, []);

  // REMOVED handleSelectAllDocs
  // const handleSelectAllDocs = useCallback((selectAll: boolean) => {
  //   if (selectAll) setSelectedDocs(allDocuments.map(doc => doc.id));
  //   else setSelectedDocs([]);
  // }, [allDocuments]);

  // REMOVED handleSelectAllSchemes
  // const handleSelectAllSchemes = useCallback((selectAll: boolean) => {
  //   if (selectAll) setSelectedSchemes(allSchemes.map(scheme => scheme.id));
  //   else setSelectedSchemes([]);
  // }, [allSchemes]);

  // UPDATED handleRunClassification signature
  const handleRunClassification = useCallback(async (runName: string | undefined, runDescription: string | undefined, docIds: number[], schemeIds: number[]) => {
    if (!activeWorkspace?.uid) {
      toast({ title: "No Workspace", description: "Please select a workspace.", variant: "destructive" });
      return;
    }
    // Use the passed-in docIds and schemeIds
    const documentsToClassify = allDocumentsHook.filter(doc => docIds.includes(doc.id));
    const schemesToUse = schemeIds;

    if (documentsToClassify.length === 0 || schemesToUse.length === 0) {
      toast({ title: "Missing Selection", description: "Please select documents and schemes for the run.", variant: "default" });
      return;
    }

    try {
      const newRun = await createRunHook(
        documentsToClassify,
        schemesToUse,
        { name: runName || undefined, description: runDescription || undefined }
      );

      if (newRun) {
        toast({ title: "Run Started", description: `Classification run "${(newRun as any).name}" created.` });
        // Load the newly created run
        await handleLoadFromRun((newRun as any).id, (newRun as any).name, (newRun as any).description);
        // Clear selections after starting run - Handled internally by dock now? Or clear store here?
        // For now, assume dock handles its own clearing or keeps state.
        // setSelectedDocs([]);
        // setSelectedSchemes([]);
      }
    } catch (err: any) {
      toast({ title: "Run Failed", description: err.message || "Could not start run.", variant: "destructive" });
    }
  }, [activeWorkspace?.uid, allDocumentsHook, createRunHook, toast]); // Removed selectedDocs, selectedSchemes dependency

  const handleLoadFromRun = useCallback(async (runId: number, runName: string, runDescription?: string) => {
    if (!activeWorkspace?.uid) return;
    setIsLoadingRunDetails(true);
    setActiveRunId(runId);
    setActiveRunName(runName);
    setActiveRunDescription(runDescription || '');
    setActiveRunResults([]); // Clear previous results while loading
    setActiveRunSchemes([]);
    setActiveRunDocuments([]);

    try {
      const runData = await loadRun(runId); // Use hook's loadRun

      if (runData) {
        const { run, results, schemes: loadedSchemes } = runData;
        setActiveRunName((run as any).name || `Run ${runId}`);
        setActiveRunDescription((run as any).description || '');
        setActiveRunResults(results);
        setActiveRunSchemes(schemesToSchemeReads(loadedSchemes));

        const docIds = [...new Set(results.map(r => r.document_id))];
        const documentsForRun = allDocumentsHook
          .filter(doc => docIds.includes(doc.id))
          .map(doc => documentToDocumentRead(doc));
        setActiveRunDocuments(documentsForRun);

        setActiveRunHook(run); // Update hook state
      } else {
        toast({
          title: "Error Loading Run",
          description: `Could not load details for run ${runId}.`,
          variant: "destructive",
        });
        // Optionally clear state here if load fails
        handleClearRun();
      }
    } catch (err: any) {
      console.error('Error fetching run details:', err);
      toast({
        title: "Error loading run",
        description: err.message || "An unexpected error occurred.",
        variant: "destructive",
      });
      handleClearRun();
    } finally {
      setIsLoadingRunDetails(false);
    }
  }, [activeWorkspace?.uid, loadRun, allDocumentsHook, setActiveRunHook, toast]);

  // --- Callback Handlers for Runner --- //

  const handleClearRun = useCallback(() => {
    setActiveRunId(null);
    setActiveRunName('');
    setActiveRunDescription('');
    setActiveRunResults([]);
    setActiveRunSchemes([]);
    setActiveRunDocuments([]);
    setActiveRunHook(null);
    // Clear dock selections?
    // setSelectedDocs([]);
    // setSelectedSchemes([]);
    toast({ title: "Run Cleared", description: "Current run data unloaded." });
  }, [setActiveRunHook, toast]);

  const handleUpdateRunName = useCallback(async (newName: string) => {
    if (!activeRunId) return;
    setActiveRunName(newName);
    try {
      await updateRun(activeRunId, { name: newName });
      toast({ title: "Run Name Updated", description: `Run name saved as "${newName}".` });
    } catch (error: any) {
      toast({ title: "Update Failed", description: `Failed to save run name: ${error.message}`, variant: "destructive" });
      // Optionally revert local state
      // setActiveRunName(previousName); // Need to store previous name if reverting
    }
  }, [activeRunId, updateRun, toast]);

  const handleUpdateRunDescription = useCallback(async (newDescription: string) => {
    if (!activeRunId) return;
    setActiveRunDescription(newDescription);
    try {
      await updateRun(activeRunId, { description: newDescription });
      toast({ title: "Run Description Updated", description: "Run description saved." });
    } catch (error: any) {
      toast({ title: "Update Failed", description: `Failed to save run description: ${error.message}`, variant: "destructive" });
      // Optionally revert local state
    }
  }, [activeRunId, updateRun, toast]);

  // Render the page
  return (
    <div className="flex flex-col h-full overflow-hidden bg-primary-950">
      {/* Main Runner Area - Takes most space */}
      <div className="flex-1 overflow-auto pb-28"> {/* Increased padding-bottom */}
        <ClassificationRunner
          activeRunId={activeRunId}
          activeRunName={activeRunName}
          activeRunDescription={activeRunDescription}
          activeRunResults={activeRunResults}
          activeRunSchemes={activeRunSchemes}
          activeRunDocuments={activeRunDocuments}
          isLoadingRunDetails={isLoadingRunDetails}
          onClearRun={handleClearRun}
          onUpdateRunName={handleUpdateRunName}
          onUpdateRunDescription={handleUpdateRunDescription}
        />
      </div>

      {/* Dock Area - Floating at bottom */}
      {activeWorkspace && (
        <ClassificationRunnerDock
          allDocuments={allDocuments}
          allSchemes={allSchemes}
          // REMOVED old selection props
          // selectedDocs={selectedDocs}
          // selectedSchemes={selectedSchemes}
          // onDocSelect={handleDocSelect}
          // onSchemeSelect={handleSchemeSelect}
          // onSelectAllDocs={handleSelectAllDocs}
          // onSelectAllSchemes={handleSelectAllSchemes}
          onRunClassification={handleRunClassification} // Pass updated handler
          onLoadFromRun={handleLoadFromRun}
          currentRunId={activeRunId}
          isCreatingRun={isCreatingRun}
          classificationProgress={classificationProgress}
        />
      )}
    </div>
  );
}