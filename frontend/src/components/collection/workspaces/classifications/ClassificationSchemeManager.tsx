'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import ClassificationSchemesTablePage from '@/components/collection/workspaces/tables/classification-schemas/page';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { useClassificationSystem } from '@/hooks/useClassificationSystem';
import { ClassificationSchemesService } from '@/client/services';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { cn } from '@/lib/utils';
import { SchemeForm } from '../schemaCreation/SchemeForm';
import { SchemeFormData } from '@/lib/classification/types';
import { useTutorialStore } from '@/zustand_stores/storeTutorial';
import { Switch } from "@/components/ui/switch"
import FixedCard from '@/components/collection/wrapper/fixed-card';
import ClassificationSchemeEditor from './ClassificationSchemeEditor';
import { transformFormDataToApi } from '@/lib/classification/service';
import { schemesToSchemeReads } from '@/lib/classification/adapters';
import { Plus } from 'lucide-react';

export default function ClassificationSchemeManager() {
  const { activeWorkspace } = useWorkspaceStore();
  const {
    schemes,
    isLoadingSchemes,
    loadSchemes,
    createScheme,
    deleteScheme,
  } = useClassificationSystem({ autoLoadSchemes: false });

  // State variables
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [selectedSchemeId, setSelectedSchemeId] = useState<number | null>(null);
  const [deleteAllConfirmationOpen, setDeleteAllConfirmationOpen] = useState(false);
  const [workspaceNameConfirmation, setWorkspaceNameConfirmation] = useState('');
  const [formData, setFormData] = useState<SchemeFormData>({
    name: '',
    description: '',
    fields: [],
    model_instructions: '',
    validation_rules: {}
  });

  // Add tutorial store
  const { showSchemaBuilderTutorial, toggleSchemaBuilderTutorial } = useTutorialStore();

  // Handlers
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prevValues => ({
      ...prevValues,
      [name]: value,
    }));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWorkspace?.uid) return;

    try {
      await createScheme(
        formData,
      );

      setFormData({
        name: '',
        description: '',
        fields: [],
        model_instructions: '',
        validation_rules: {}
      });

      setIsSheetOpen(false);
      alert('Classification scheme created successfully');
    } catch (error) {
      console.error('Error creating classification scheme:', error);
    }
  };

  const handleDelete = async (schemeId: number) => {
    if (!activeWorkspace?.uid) return;
    if (confirm('Are you sure you want to delete this classification scheme?')) {
      try {
        await deleteScheme(schemeId);
        alert('Classification scheme deleted successfully');
      } catch (error) {
        console.error('Error deleting classification scheme:', error);
      }
    }
  };

  const handleDeleteAll = async () => {
    if (!activeWorkspace) {
      alert('No active workspace found.');
      return;
    }

    if (workspaceNameConfirmation !== activeWorkspace.name) {
      alert('Workspace name confirmation does not match.');
      return;
    }

    try {
      await ClassificationSchemesService.deleteAllClassificationSchemes({
        workspaceId: activeWorkspace.uid,
      });
      alert('All classification schemes deleted successfully.');
      loadSchemes();
    } catch (error) {
      console.error('Error deleting all classification schemes:', error);
    } finally {
      setDeleteAllConfirmationOpen(false);
      setWorkspaceNameConfirmation('');
    }
  };

  // --- ADDING Effect to explicitly load schemes on workspace change ---
  useEffect(() => {
    console.log("[SchemeManager] useEffect triggered. Workspace UID:", activeWorkspace?.uid);
    if (activeWorkspace?.uid) {
      console.log("[SchemeManager] Calling loadSchemes for workspace:", activeWorkspace.uid);
      loadSchemes(); // Call loadSchemes from the hook
    } else {
      console.log("[SchemeManager] No active workspace UID yet.");
    }
    // Depend on workspace uid and the loadSchemes function itself
  }, [activeWorkspace?.uid, loadSchemes]);

  // --- Moved Hook Call Before Conditional Return ---
  // Adapt delete function to match expected return type
  const handleDeleteProp = useCallback(async (schemeId: number): Promise<void> => {
    await deleteScheme(schemeId); // Call original function, ignore boolean return
  }, [deleteScheme]);

  // --- Conditional Rendering ---
  if (!activeWorkspace) {
    return (
      <p className="text-center text-red-400">
        Please select a workspace to manage classification schemes.
      </p>
    );
  }

  // Adapt schemes to the expected type
  const adaptedSchemes = schemesToSchemeReads(schemes);

  return (
    <div className="grid grid-cols-1 gap-4 w-full">
      <Card className="h-full p-4 px-0">
        <CardHeader>
          <div className="flex justify-between w-full">
            <CardTitle>Classification Schemes</CardTitle>
            <Button variant="outline" onClick={() => loadSchemes()}>Reload Schemes</Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingSchemes ? (
            <div className="flex justify-center items-center h-40">
              <p className="text-muted-foreground">Loading schemes...</p>
            </div>
          ) : adaptedSchemes.length === 0 ? (
            <div className="flex flex-col justify-center items-center h-40 text-center">
              <p className="text-muted-foreground mb-4">No classification schemes found.</p>
              <Button onClick={() => setIsSheetOpen(true)}>
                <Plus className="h-4 w-4 mr-2" /> Create New Scheme
              </Button>
            </div>
          ) : (
            <ClassificationSchemesTablePage 
              schemes={adaptedSchemes}
              onCreateClick={() => setIsSheetOpen(true)}
              onDelete={handleDeleteProp}
            />
          )}
        </CardContent>
        <div className="flex justify-end p-4">  
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                className="w-50"
                onClick={() => setDeleteAllConfirmationOpen(true)}
              >
                Delete All Classification Schemes
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. This will permanently delete all classification schemes in the workspace.
                  Please type <b>{activeWorkspace?.name}</b> to confirm.
                  <Input
                    type="text"
                    value={workspaceNameConfirmation}
                    onChange={(e) => setWorkspaceNameConfirmation(e.target.value)}
                    placeholder="Workspace Name"
                    className="w-full p-3 bg-primary-800 shadow-inner mt-4"
                  />
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteAll}>Continue</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </Card>

      <ClassificationSchemeEditor
        show={isSheetOpen}
        onClose={() => setIsSheetOpen(false)}
        mode="create"
        defaultValues={{
          name: '',
          description: '',
          fields: [],
          model_instructions: '',
          validation_rules: {}
        }}
      />
    </div>
  );
}

