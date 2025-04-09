"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useWorkspaceStore } from "@/zustand_stores/storeWorkspace";
import { useClassificationSystem } from "@/hooks/useClassificationSystem";
import { SchemeForm } from "../schemaCreation/SchemeForm";
import { SchemeFormData } from "@/lib/classification/types";
import { useTutorialStore } from "@/zustand_stores/storeTutorial";
import { Switch } from "@/components/ui/switch";
import ClassificationSchemeCard from "./ClassificationSchemeCard";

interface ClassificationSchemeEditorProps {
  show: boolean;
  onClose: () => void;
  schemeId?: number;
  mode: 'create' | 'edit' | 'watch';
  defaultValues?: SchemeFormData;
}

const defaultSchemeFormData: SchemeFormData = {
  name: '',
  description: '',
  fields: [],
  model_instructions: '',
  validation_rules: {}
};

export default function ClassificationSchemeEditor({
  show,
  onClose,
  schemeId,
  mode,
  defaultValues = defaultSchemeFormData,
}: ClassificationSchemeEditorProps) {
  const { activeWorkspace } = useWorkspaceStore();
  const { createScheme, updateScheme } = useClassificationSystem();
  const { showSchemaBuilderTutorial, toggleSchemaBuilderTutorial } = useTutorialStore();

  const [formData, setFormData] = useState<SchemeFormData>({
    ...defaultSchemeFormData,
    ...defaultValues
  });

  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (defaultValues) {
      console.log("Setting default values:", defaultValues);
      console.log("Default values fields:", defaultValues.fields);
      if (defaultValues.fields && defaultValues.fields.length > 0) {
        defaultValues.fields.forEach((field, index) => {
          console.log(`Field ${index}:`, field);
          console.log(`Field ${index} dict_keys:`, field.config?.dict_keys);
        });
      }
      setFormData(prev => ({
        ...prev,
        ...defaultValues
      }));
    }
  }, [defaultValues]);

  // Add debugging for form data changes
  useEffect(() => {
    console.log("Form data updated:", formData);
    console.log("Fields count:", formData.fields?.length || 0);
  }, [formData]);

  const handleSubmit = async () => {
    if (!activeWorkspace?.uid) return;
    
    // Validate that we have at least one field
    if (!formData.fields || formData.fields.length === 0) {
      setErrorMessage("Please add at least one field to your classification scheme");
      return;
    }
    
    console.log("Submitting form data:", formData);
    console.log("Fields:", formData.fields);
    
    setErrorMessage("");
    try {
      if (mode === 'create') {
        const response = await createScheme(formData);
        console.log("Classification scheme created successfully:", response);
      } else if (mode === 'edit' && schemeId) {
        await updateScheme(schemeId, formData);
        console.log("Classification scheme updated successfully");
      }
      onClose();
    } catch (error: any) {
      console.error("Error saving classification scheme:", error);
      setErrorMessage(error.message || "Error saving classification scheme");
    }
  };

  const title = {
    create: "Create New Classification Scheme",
    edit: `Edit: ${formData.name}`,
    watch: `View: ${formData.name}`
  }[mode];

  return (
    <ClassificationSchemeCard
      show={show}
      onClose={onClose}
      title={title}
      mode={mode}
      width="w-[800px]"
      height="h-[80vh]"
      className="border-2 border-schemes"
    >
      <div className="space-y-6">
        {mode !== 'watch' && (
          <div className="flex items-center justify-end space-x-2">
            <label className="text-sm text-muted-foreground">Show Tutorial</label>
            <Switch
              checked={showSchemaBuilderTutorial}
              onCheckedChange={toggleSchemaBuilderTutorial}
            />
          </div>
        )}

        <SchemeForm
          formData={formData}
          setFormData={setFormData}
          showTutorial={showSchemaBuilderTutorial}
          readOnly={mode === 'watch'}
          onSubmit={handleSubmit}
        />

        {errorMessage && (
          <p className="text-red-400">{errorMessage}</p>
        )}

        {mode !== 'watch' && (
          <div className="flex justify-end space-x-2 mt-6 border-t pt-4">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              className="bg-green-600 hover:bg-green-500 text-primary-950"
            >
              {mode === 'create' ? 'Create Scheme' : 'Save Changes'}
            </Button>
          </div>
        )}
      </div>
    </ClassificationSchemeCard>
  );
} 