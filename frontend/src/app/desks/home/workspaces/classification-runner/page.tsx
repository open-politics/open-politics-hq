'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { useClassificationSystem } from '@/hooks/useClassificationSystem';
import { ClassificationJobRead, ClassificationSchemeRead, DataSourceRead, EnhancedClassificationResultRead } from '@/client';
import ClassificationRunner from '@/components/collection/workspaces/classifications/ClassificationRunner';
import { useToast } from '@/components/ui/use-toast';
import ClassificationRunnerDock from '@/components/collection/workspaces/classifications/ClassificationRunnerDock';
import RecurringTasksSettings from '@/components/collection/workspaces/recurring-jobs/RecurringTasksSettings';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import JobHistoryView from '@/components/collection/workspaces/jobs/JobHistoryView';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ClassificationJobParams } from '@/lib/classification/types';

export default function ClassificationRunnerPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const { toast } = useToast();

  const {
    schemes: allSchemesHook,
    dataSources: allDataSourcesHook,
    results: activeJobResultsHook,
    isLoadingJobData,
    isCreatingJob,
    error,
    loadSchemes,
    loadDataSources,
    loadJob,
    createJob,
    activeJob,
    setActiveJob,
    deleteJob,
    activeJobDataRecords,
  } = useClassificationSystem({ autoLoadSchemes: true, autoLoadDataSources: false });

  const [targetJobId, setTargetJobId] = useState<number | null>(null);

  const activeJobResults = useMemo(() => activeJobResultsHook, [activeJobResultsHook]);

  const handleRetryJob = useCallback(async (jobId: number): Promise<boolean> => {
    console.log(`Attempting to retry job ${jobId}`);
    toast({
      title: "Retry Not Implemented",
      description: `UI retry for job ${jobId} is not yet connected.`,
      variant: "default",
    });
    return false;
  }, [toast]);

  useEffect(() => {
    if (activeWorkspace) {
      console.log("[RunnerPage] Workspace changed, loading schemes and data sources.");
      loadSchemes();
      loadDataSources();
      setTargetJobId(null);
      setActiveJob(null);
    }
  }, [activeWorkspace?.id]);

  useEffect(() => {
    if (targetJobId !== null && activeWorkspace) {
      console.log("[RunnerPage] Target Job ID changed, calling loadJob:", targetJobId);
      loadJob(targetJobId).catch(err => {
          console.error("[RunnerPage] Error returned from loadJob:", err);
          toast({ title: "Error Loading Job", description: err.message || "Failed to load job details.", variant: "destructive" });
          setTargetJobId(null);
          setActiveJob(null);
      });
    } else if (targetJobId === null) {
        setActiveJob(null);
    }
  }, [targetJobId, activeWorkspace, loadJob, setActiveJob, toast]);

  const handleCreateJobCallback = useCallback(async (
      dataSourceIds: number[],
      schemeIds: number[],
      name?: string,
      description?: string
    ) => {
      if (!activeWorkspace) {
          toast({ title: "No Workspace", description: "Cannot create job without an active workspace.", variant: "destructive" });
          return;
      }
      
      const jobParams: ClassificationJobParams = {
          workspaceId: activeWorkspace.id,
          name: name || `Analysis @ ${new Date().toLocaleString()}`,
          description: description,
          datasourceIds: dataSourceIds,
          schemeIds: schemeIds
      };

      const newJob = await createJob(jobParams);

      if (newJob) {
          console.log("[RunnerPage] Job created via callback, setting target ID:", newJob.id);
          setTargetJobId(newJob.id);
          toast({ title: "Job Created", description: `Job "${newJob.name}" was created successfully.` });
      } else {
          console.error("[RunnerPage] Job creation callback failed.");
      }
  }, [activeWorkspace, createJob, toast]);

  const handleLoadJobCallback = useCallback((jobId: number) => {
     console.log(`[RunnerPage] Setting target job ID from callback: ${jobId}`);
     setTargetJobId(jobId);
  }, []);

  const handleClearJobCallback = useCallback(() => {
      console.log("[RunnerPage] Clearing active job.");
      setTargetJobId(null);
      toast({ title: "Job Cleared", description: "Loaded job data has been cleared." });
  }, [toast]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-muted/30">
      <div className="flex-1 overflow-auto pb-28 p-4 space-y-4">
          <Tabs defaultValue="runner" className="space-y-4">
            <TabsList>
              <TabsTrigger value="runner">Runner</TabsTrigger>
              <TabsTrigger value="recurring">Recurring Tasks</TabsTrigger>
              <TabsTrigger value="history">Job History</TabsTrigger>
            </TabsList>

            <TabsContent value="runner">
                <ClassificationRunner
                    key={activeJob?.id || 'no-job'}
                    allSchemes={allSchemesHook}
                    allDataSources={allDataSourcesHook}
                    activeJob={activeJob}
                    isClassifying={isCreatingJob}
                    results={activeJobResults}
                    activeJobDataRecords={activeJobDataRecords}
                    retryJob={handleRetryJob}
                    onClearJob={handleClearJobCallback}
                />
            </TabsContent>

            <TabsContent value="recurring">
                <RecurringTasksSettings onLoadJob={handleLoadJobCallback} />
            </TabsContent>

            <TabsContent value="history">
                <JobHistoryView
                    onLoadJob={handleLoadJobCallback}
                 />
            </TabsContent>
          </Tabs>
      </div>

      {activeWorkspace && (
        <ClassificationRunnerDock
          allDataSources={allDataSourcesHook}
          allSchemes={allSchemesHook}
          onCreateJob={handleCreateJobCallback}
          onLoadJob={handleLoadJobCallback}
          activeJobId={activeJob?.id ?? null}
          isCreatingJob={isCreatingJob}
          onClearJob={handleClearJobCallback}
        />
      )}
    </div>
  );
}