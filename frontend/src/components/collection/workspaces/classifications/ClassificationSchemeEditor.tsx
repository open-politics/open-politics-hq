"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { useWorkspaceStore } from "@/zustand_stores/storeWorkspace";
import { useClassificationSystem } from "@/hooks/useClassificationSystem";
import { FieldConfig, SCHEME_TYPE_OPTIONS, SchemeFormData, FieldType, DictKeyDefinition } from "@/lib/classification/types";
import { useTutorialStore } from "@/zustand_stores/storeTutorial";
import { Switch } from "@/components/ui/switch";
import ClassificationSchemeCard from "./ClassificationSchemeCard";
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Trash2, PlusCircle, GripVertical, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { ClassificationSchemeRead } from '@/client';
import { adaptSchemeReadToSchemeFormData, adaptSchemeFormDataToSchemeCreate } from '@/lib/classification/adapters';
import { useToast } from "@/components/ui/use-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ClassificationSchemeEditorProps {
  show: boolean;
  onClose: () => void;
  schemeId?: number;
  mode: 'create' | 'edit' | 'watch';
  defaultValues?: ClassificationSchemeRead | null;
}

const defaultSchemeFormData: SchemeFormData = {
  name: '',
  description: '',
  fields: [],
  model_instructions: '',
  // validation_rules: {}
};

// --- Main Editor Component ---
const ClassificationSchemeEditor: React.FC<ClassificationSchemeEditorProps> = ({
  show,
  onClose,
  schemeId,
  mode,
  defaultValues = null,
}) => {
  const { activeWorkspace } = useWorkspaceStore();
  const { createScheme, updateScheme, isLoadingSchemes, error: apiError, loadSchemes } = useClassificationSystem();
  const { showSchemaBuilderTutorial, toggleSchemaBuilderTutorial } = useTutorialStore();
  const { toast } = useToast();

  // --- State Management with useState ---
  const [formData, setFormData] = useState<SchemeFormData>(defaultSchemeFormData);
  const [formErrors, setFormErrors] = useState<Record<string, string | string[]>>({});

  // Adapt ClassificationSchemeRead to SchemeFormData when defaultValues change
  useEffect(() => {
    if (mode === 'create') {
        setFormData(defaultSchemeFormData);
    } else if (mode === 'edit' || mode === 'watch') {
        if (defaultValues) {
            console.log("Adapting default values (SchemeRead) to form data:", defaultValues);
            const adaptedData = adaptSchemeReadToSchemeFormData(defaultValues);
            console.log("Adapted form data:", adaptedData);
            setFormData(adaptedData);
        } else {
             console.warn("Edit/Watch mode but no defaultValues provided.");
             setFormData(defaultSchemeFormData);
        }
    }
  }, [defaultValues, mode]);

  // Simple validation function (can be expanded)
  const validateForm = (): boolean => {
      const errors: Record<string, string | string[]> = {};
      let isValid = true;

      if (!formData.name.trim()) {
          errors.name = "Scheme name cannot be empty";
          isValid = false;
      }
      if (!formData.fields || formData.fields.length === 0) {
          errors.fields = "At least one field is required";
          isValid = false;
      } else {
          const fieldErrors: string[] = [];
          formData.fields.forEach((field, index) => {
              if (!field.name.trim()) {
                  fieldErrors[index] = `Field ${index + 1} name cannot be empty`;
                  isValid = false;
              }
              // Add more specific field validation here if needed (e.g., scale for int)
              if (field.type === 'int') {
                  if (field.config.scale_min === undefined || field.config.scale_min === null || field.config.scale_max === undefined || field.config.scale_max === null || field.config.scale_min >= field.config.scale_max) {
                     fieldErrors[index] = (fieldErrors[index] ? fieldErrors[index] + "; " : "") + `Field '${field.name}': Integer fields require Scale Min < Scale Max.`;
                     isValid = false;
                  }
              }
              if (field.type === 'List[str]' && field.config.is_set_of_labels) {
                   if (!field.config.labels || field.config.labels.length < 2 || field.config.labels.some(l => !l.trim())) {
                       fieldErrors[index] = (fieldErrors[index] ? fieldErrors[index] + "; " : "") + `Field '${field.name}': Multiple Choice requires at least 2 non-empty labels.`;
                       isValid = false;
                   }
              }
              if (field.type === 'List[Dict[str, any]]') {
                   if (!field.config.dict_keys || field.config.dict_keys.length < 1 || field.config.dict_keys.some(k => !k.name.trim())) {
                       fieldErrors[index] = (fieldErrors[index] ? fieldErrors[index] + "; " : "") + `Field '${field.name}': Complex Structure requires at least one non-empty key definition.`;
                       isValid = false;
                   }
              }
          });
          if (fieldErrors.some(e => e)) { // Check if any field has an error
              errors.fields = fieldErrors;
          }
      }
      
      setFormErrors(errors);
      return isValid;
  };

  // Handle form submission
  const handleSubmit = async (event: React.FormEvent) => {
      event.preventDefault(); // Prevent default form submission
      const isValid = validateForm();
      console.log(`[handleSubmit] Mode: ${mode}, Scheme ID: ${schemeId}, Is Valid: ${isValid}`); // Add detailed log
      // Condition to exit early:
      if (!activeWorkspace?.id || mode === 'watch' || !isValid) {
          console.log(`[handleSubmit] Exiting early. Workspace: ${!!activeWorkspace?.id}, Mode: ${mode}, Is Valid: ${isValid}`); // Log exit reason
          return;
      }

      console.log("Submitting form data:", formData); // This logs successfully
      setFormErrors({}); // Clear previous errors before submit attempt

      try {
          let response: ClassificationSchemeRead | null = null;
          // REMOVED: dataToSend reconstruction
          // const dataToSend: SchemeFormData = { ... };

          if (mode === 'create') {
              response = await createScheme(formData); // Pass formData directly
              toast({ title: "Scheme Created", description: `Scheme \"${response?.name}\" created successfully.`, variant: "default" });
          } else if (mode === 'edit' && schemeId) {
              response = await updateScheme(schemeId, formData); // Pass formData directly
              toast({ title: "Scheme Updated", description: `Scheme \"${response?.name}\" updated successfully.`, variant: "default" });
          }
          await loadSchemes(true); // Force refresh scheme list
          onClose(); // Close dialog on success
      } catch (error: any) { 
          console.error("Error saving classification scheme:", error);
          const errorMsg = error.message || apiError || "An unexpected error occurred while saving.";
          setFormErrors({ submit: errorMsg }); // Set a general submit error
          toast({ title: "Save Failed", description: errorMsg, variant: "destructive" });
      }
  };

  const title = {
    create: "Create New Classification Scheme",
    edit: `Edit: ${formData.name || 'Scheme'}`,
    watch: `View: ${formData.name || 'Scheme'}`
  }[mode];

  // --- Field Type Change Logic --- 
  const handleFieldTypeChange = (fieldIndex: number, newType: FieldType) => {
      const currentField = formData.fields[fieldIndex];
      const newConfig: FieldConfig = {}; // Reset config for new type

      if (newType === 'int') {
          newConfig.scale_min = 0;
          newConfig.scale_max = 10;
      } else if (newType === 'List[str]') {
          newConfig.is_set_of_labels = false;
          newConfig.labels = [];
      } else if (newType === 'List[Dict[str, any]]') {
          newConfig.dict_keys = [{ name: 'key1', type: 'str' }]; // Default key
      }

      // Update the specific field with the new type and config
      const newFields = formData.fields.map((field, index) =>
          index === fieldIndex ? { ...field, type: newType, config: newConfig } : field
      );
      setFormData(prev => ({ ...prev, fields: newFields }));
  };

  // --- Update Specific Field Value ---
  const updateField = (fieldIndex: number, key: keyof SchemeFormData['fields'][number], value: any) => {
      const newFields = formData.fields.map((field, index) =>
          index === fieldIndex ? { ...field, [key]: value } : field
      );
      setFormData(prev => ({ ...prev, fields: newFields }));
  };

  // --- Update Specific Config Value ---
   const updateConfig = (fieldIndex: number, configKey: keyof FieldConfig, value: any) => {
        const newFields = formData.fields.map((field, index) => {
            if (index === fieldIndex) {
                return {
                    ...field,
                    config: {
                        ...field.config,
                        [configKey]: value,
                    },
                };
            }
            return field;
        });
        setFormData(prev => ({ ...prev, fields: newFields }));
    };

  return (
    <ClassificationSchemeCard
      show={show}
      onClose={onClose}
      title={title}
      mode={mode}
      width="w-[900px]" // Increased width
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
              disabled={isLoadingSchemes} 
            />
          </div>
        )}

        {/* Use standard form element */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* General Scheme Info */} 
          <div className="space-y-4 p-4 border rounded-lg bg-card">
              <h3 className="text-lg font-medium border-b pb-2">Scheme Details</h3>
              {/* Name Field */}
              <div>
                  <Label htmlFor="scheme-name">Name</Label>
                  <Input
                      id="scheme-name"
                      value={formData.name}
                      onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="e.g., Sentiment Analysis"
                      disabled={isLoadingSchemes || mode === 'watch'}
                      aria-invalid={!!formErrors.name}
                  />
                  {formErrors.name && <p className="text-xs text-red-500 mt-1">{formErrors.name as string}</p>}
              </div>
              {/* Description Field */}
              <div>
                  <Label htmlFor="scheme-description">Description (Optional)</Label>
                  <Textarea
                      id="scheme-description"
                      value={formData.description || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Describe the purpose and output of this scheme"
                      rows={2}
                      disabled={isLoadingSchemes || mode === 'watch'}
                  />
              </div>
              {/* Model Instructions Field */}
              <div>
                  <Label htmlFor="model-instructions">Model Instructions (Optional)</Label>
                  <Textarea
                     id="model-instructions"
                     value={formData.model_instructions || ''}
                     onChange={(e) => setFormData(prev => ({ ...prev, model_instructions: e.target.value }))}
                     placeholder="Provide specific instructions for the AI model (e.g., focus on certain aspects, desired output format hints)"
                     rows={3}
                     disabled={isLoadingSchemes || mode === 'watch'}
                     className="text-sm font-mono"
                  />
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                     <Info className="h-3 w-3 shrink-0"/>
                     These instructions are passed directly to the classification model.
                   </p>
              </div>
          </div>

          {/* --- NEW: Global Scheme Settings --- */}
          <div className="space-y-4 p-4 border rounded-lg bg-card">
              <h3 className="text-lg font-medium border-b pb-2">Global AI Settings</h3>
              {/* Request Justifications Globally */}
              <div className="flex items-center justify-between">
                  <Label htmlFor="request-justifications-globally" className="flex flex-col space-y-1">
                      <span>Request Justifications Globally</span>
                      <span className="text-xs font-normal text-muted-foreground">If enabled, justification will be requested for all applicable fields unless overridden at the field level.</span>
                  </Label>
                  <Switch
                      id="request-justifications-globally"
                      checked={formData.request_justifications_globally ?? false}
                      onCheckedChange={(checked) => setFormData(prev => ({ ...prev, request_justifications_globally: checked }))}
                      disabled={isLoadingSchemes || mode === 'watch'}
                  />
              </div>
              {/* Default Thinking Budget */}
              <div>
                  <Label htmlFor="default-thinking-budget">Default Thinking Budget (Tokens)</Label>
                  <Input
                      id="default-thinking-budget"
                      type="number"
                      value={formData.default_thinking_budget === null || formData.default_thinking_budget === undefined ? '' : formData.default_thinking_budget}
                      onChange={(e) => setFormData(prev => ({ ...prev, default_thinking_budget: e.target.value === '' ? null : parseInt(e.target.value, 10) }))}
                      placeholder="e.g., 1024 (0 to disable for all, empty for provider default)"
                      disabled={isLoadingSchemes || mode === 'watch'}
                  />
                   <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                     <Info className="h-3 w-3 shrink-0"/>
                     Budget for AI reasoning. Overrides provider defaults if set. Field-specific requests may still apply.
                   </p>
              </div>
               {/* Enable Image Analysis Globally */}
              <div className="flex items-center justify-between">
                  <Label htmlFor="enable-image-analysis-globally" className="flex flex-col space-y-1">
                      <span>Enable Image Analysis Globally</span>
                      <span className="text-xs font-normal text-muted-foreground">If enabled, this scheme can process images, and fields can request bounding boxes.</span>
                  </Label>
                  <Switch
                      id="enable-image-analysis-globally"
                      checked={formData.enable_image_analysis_globally ?? false}
                      onCheckedChange={(checked) => setFormData(prev => ({ ...prev, enable_image_analysis_globally: checked }))}
                      disabled={isLoadingSchemes || mode === 'watch'}
                  />
              </div>
          </div>
          {/* --- END NEW: Global Scheme Settings --- */}

          {/* Fields Section */} 
          <div className="space-y-4">
              <h3 className="text-lg font-medium border-b pb-2">Fields</h3>
              {/* Display general fields error */}
              {typeof formErrors.fields === 'string' && <p className="text-sm text-red-500 mt-1">{formErrors.fields}</p>} 
              
              {/* Iterate over formData.fields */} 
              {formData.fields.map((item, index) => (
                  <div key={index} className="mb-4 relative bg-card p-4 border rounded-lg shadow-sm">
                     {/* Field Controls */} 
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {/* Field Name */} 
                        <div>
                            <Label htmlFor={`fields.${index}.name`}>Field Name</Label>
                            <Input
                                id={`fields.${index}.name`}
                                value={item.name}
                                onChange={(e) => updateField(index, 'name', e.target.value)}
                                placeholder="e.g., sentiment_score"
                                disabled={isLoadingSchemes || mode === 'watch'}
                                aria-invalid={!!(formErrors.fields && Array.isArray(formErrors.fields) && formErrors.fields[index])} // Check if error exists for this index
                            />
                             {/* Display specific field error string */}
                             {formErrors.fields && Array.isArray(formErrors.fields) && formErrors.fields[index] && <p className="text-xs text-red-500 mt-1">{formErrors.fields[index]}</p>} 
                        </div>
                        {/* Field Type */} 
                        <div>
                            <Label htmlFor={`fields.${index}.type`}>Type</Label>
                            <Select
                                value={item.type}
                                onValueChange={(value) => handleFieldTypeChange(index, value as FieldType)}
                                disabled={isLoadingSchemes || mode === 'watch'}
                            >
                                <SelectTrigger id={`fields.${index}.type`}>
                                    <SelectValue placeholder="Select type..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {SCHEME_TYPE_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        {/* Field Description */} 
                        <div className="md:col-span-3">
                            <Label htmlFor={`fields.${index}.description`}>Description (Optional)</Label>
                            <Textarea
                                id={`fields.${index}.description`}
                                value={item.description || ''}
                                onChange={(e) => updateField(index, 'description', e.target.value)}
                                placeholder="Describe what this field represents"
                                rows={1}
                                className="text-sm"
                                disabled={isLoadingSchemes || mode === 'watch'}
                            />
                        </div>
                    </div>

                    {/* Type-Specific Config */} 
                    <FieldConfigEditor 
                        fieldIndex={index} 
                        config={item.config}
                        fieldType={item.type} 
                        updateConfig={updateConfig}
                        disabled={isLoadingSchemes || mode === 'watch'}
                        errors={Array.isArray(formErrors.fields) ? formErrors.fields[index] : undefined}
                     />

                    {/* --- NEW: Per-Field AI Settings --- */}
                    <div className="mt-3 space-y-3 pt-3 border-t border-dashed">
                        <div className="flex items-center justify-between">
                            <Label htmlFor={`fields.${index}.request_justification`} className="text-xs flex items-center">
                                Request Justification for this Field
                                <TooltipProvider delayDuration={100}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="h-3 w-3 ml-1.5 text-muted-foreground cursor-help"/>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p className="text-xs max-w-xs">Overrides global setting. If null, inherits from global.</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                            </Label>
                            <Select
                                value={item.request_justification === null ? 'inherit' : (item.request_justification ? 'yes' : 'no')}
                                onValueChange={(value) => {
                                    let val: boolean | null = null;
                                    if (value === 'yes') val = true;
                                    else if (value === 'no') val = false;
                                    updateField(index, 'request_justification', val);
                                }}
                                disabled={isLoadingSchemes || mode === 'watch'}
                            >
                                <SelectTrigger id={`fields.${index}.request_justification`} className="h-7 w-[100px] text-xs">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="inherit">Inherit</SelectItem>
                                    <SelectItem value="yes">Yes</SelectItem>
                                    <SelectItem value="no">No</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {(item.type === 'str' || item.type === 'List[str]') && formData.enable_image_analysis_globally && (
                            <div className="flex items-center justify-between">
                                <Label htmlFor={`fields.${index}.request_bounding_boxes`} className="text-xs flex items-center">
                                    Request Bounding Boxes for this Field
                                    <TooltipProvider delayDuration={100}>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Info className="h-3 w-3 ml-1.5 text-muted-foreground cursor-help"/>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p className="text-xs max-w-xs">Only if image analysis is globally enabled and field value might come from image.</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                </Label>
                                <Switch
                                    id={`fields.${index}.request_bounding_boxes`}
                                    checked={item.request_bounding_boxes ?? false}
                                    onCheckedChange={(checked) => updateField(index, 'request_bounding_boxes', checked)}
                                    disabled={isLoadingSchemes || mode === 'watch'}
                                />
                            </div>
                        )}

                        {item.type === 'List[str]' && item.config.is_set_of_labels && (
                            <div className="flex items-center justify-between">
                                <Label htmlFor={`fields.${index}.use_enum_for_labels`} className="text-xs flex items-center">
                                    Use Strict Choices (Enum for AI)
                                    <TooltipProvider delayDuration={100}>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Info className="h-3 w-3 ml-1.5 text-muted-foreground cursor-help"/>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p className="text-xs max-w-xs">More reliable for predefined lists, but less flexible.</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                </Label>
                                <Switch
                                    id={`fields.${index}.use_enum_for_labels`}
                                    checked={item.use_enum_for_labels ?? false}
                                    onCheckedChange={(checked) => updateField(index, 'use_enum_for_labels', checked)}
                                    disabled={isLoadingSchemes || mode === 'watch'}
                                />
                            </div>
                        )}
                    </div>
                    {/* --- END NEW: Per-Field AI Settings --- */}

                     {/* Remove Field Button */} 
                    {mode !== 'watch' && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute bottom-2 right-2 h-7 w-7 text-muted-foreground hover:text-red-500 hover:bg-destructive/10"
                            onClick={() => {
                                const newFields = formData.fields.filter((_, i) => i !== index);
                                setFormData(prev => ({ ...prev, fields: newFields }));
                            }}
                            disabled={isLoadingSchemes || formData.fields.length <= 1} 
                            title="Remove Field"
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    )}
                  </div>
              ))}

              {mode !== 'watch' && (
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm" 
                    onClick={() => {
                       setFormData(prev => ({ 
                           ...prev, 
                           fields: [...(prev.fields ?? []), { name: `field_${(prev.fields?.length ?? 0) + 1}`, type: 'str' as FieldType, description: '', config: {} }] 
                       }));
                    }} 
                    disabled={isLoadingSchemes}
                  >
                      <PlusCircle className="h-4 w-4 mr-2" />
                      Add Field
                  </Button>
              )}
          </div>

           {/* Global Submit/API Error Display */} 
           {formErrors.submit && (
                <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Error Saving Scheme</AlertTitle>
                    <AlertDescription>{formErrors.submit as string}</AlertDescription>
                </Alert>
            )}

          {/* Actions */} 
          {mode !== 'watch' && (
              <div className="flex justify-end gap-3 pt-4 border-t">
                  <Button type="button" variant="outline" onClick={onClose} disabled={isLoadingSchemes}>Cancel</Button>
                  <Button type="submit" disabled={isLoadingSchemes}> 
                      {isLoadingSchemes ? 'Saving...' : (mode === 'create' ? 'Create Scheme' : 'Update Scheme')}
                  </Button>
              </div>
          )}
        </form>
      </div>
    </ClassificationSchemeCard>
  );
};

// --- Field Config Sub-Component (Using useState approach) ---
interface FieldConfigEditorProps {
  fieldIndex: number;
  config: FieldConfig;
  fieldType: FieldType | undefined;
  updateConfig: (fieldIndex: number, configKey: keyof FieldConfig, value: any) => void;
  disabled?: boolean;
  errors?: string;
}

const FieldConfigEditor: React.FC<FieldConfigEditorProps> = ({ fieldIndex, config, fieldType, updateConfig, disabled, errors }) => {

  // Helper to handle updates to list items (labels, dict_keys)
  const handleListItemChange = (listKey: 'labels' | 'dict_keys', itemIndex: number, itemValue: string | Partial<DictKeyDefinition>) => {
      const currentList = config?.[listKey] ?? []; // Safely access config property
      const newList = [...currentList];
      if (listKey === 'labels' && typeof itemValue === 'string') {
          newList[itemIndex] = itemValue;
      } else if (listKey === 'dict_keys' && typeof itemValue === 'object') {
          newList[itemIndex] = { ...(newList[itemIndex] as DictKeyDefinition), ...itemValue };
      }
      updateConfig(fieldIndex, listKey, newList);
  };

  const handleAddItem = (listKey: 'labels' | 'dict_keys') => {
      const currentList = config?.[listKey] ?? []; // Safely access config property
      let newItem: string | DictKeyDefinition;
      if (listKey === 'labels') {
          newItem = '';
      } else { // dict_keys
          newItem = { name: `key${currentList.length + 1}`, type: 'str' };
      }
      updateConfig(fieldIndex, listKey, [...currentList, newItem]);
  };

   const handleRemoveItem = (listKey: 'labels' | 'dict_keys', itemIndex: number) => {
        const currentList = config?.[listKey] ?? []; // Safely access config property
        const newList = currentList.filter((_, idx) => idx !== itemIndex);
        updateConfig(fieldIndex, listKey, newList);
    };

  if (fieldType === 'int') {
    return (
      <div className="mt-3 pl-4 border-l-2 border-blue-200 space-y-3">
         <p className="text-xs font-medium text-blue-600">Number Configuration</p>
          <div className="grid grid-cols-2 gap-3">
              <div>
                  <Label htmlFor={`fields.${fieldIndex}.config.scale_min`}>Scale Min</Label>
                  <Input
                      id={`fields.${fieldIndex}.config.scale_min`}
                      type="number"
                      value={config?.scale_min ?? ''}
                      onChange={(e) => updateConfig(fieldIndex, 'scale_min', e.target.valueAsNumber)}
                      disabled={disabled}
                  />
              </div>
              <div>
                  <Label htmlFor={`fields.${fieldIndex}.config.scale_max`}>Scale Max</Label>
                  <Input
                      id={`fields.${fieldIndex}.config.scale_max`}
                      type="number"
                      value={config?.scale_max ?? ''}
                      onChange={(e) => updateConfig(fieldIndex, 'scale_max', e.target.valueAsNumber)}
                      disabled={disabled}
                  />
              </div>
          </div>
           {/* Display error string */} 
           {errors && errors.includes('Scale') && <p className="text-xs text-red-500 mt-1">{errors}</p>} 
      </div>
    );
  } else if (fieldType === 'List[str]') {
    return (
      <div className="mt-3 pl-4 border-l-2 border-green-200 space-y-3">
         <p className="text-xs font-medium text-green-600">Multiple Choice / List Configuration</p>
          <div className="flex items-center space-x-2">
               <Checkbox
                   id={`fields.${fieldIndex}.config.is_set_of_labels`}
                   checked={config?.is_set_of_labels ?? false}
                   onCheckedChange={(checked) => updateConfig(fieldIndex, 'is_set_of_labels', !!checked)}
                   disabled={disabled}
               />
              <Label htmlFor={`fields.${fieldIndex}.config.is_set_of_labels`} className="text-sm">
                  Use predefined list of choices (Multiple Choice)?
              </Label>
          </div>

          {config?.is_set_of_labels && (
              <div className="space-y-2">
                  <Label>Choices (Labels)</Label>
                   {/* Display error string */} 
                   {errors && errors.includes('label') && <p className="text-xs text-red-500">{errors}</p>} 
                   {(config.labels ?? []).map((labelValue, labelIndex) => ( // Use config.labels
                      <div key={labelIndex} className="flex items-center gap-2">
                           <Input
                              id={`fields.${fieldIndex}.config.labels.${labelIndex}`}
                              value={labelValue} // Access label value directly
                              onChange={(e) => handleListItemChange('labels', labelIndex, e.target.value)} // Use handler
                              placeholder={`Choice ${labelIndex + 1}`}
                              className="flex-1 h-8 text-sm"
                              disabled={disabled}
                           />
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-500" onClick={() => handleRemoveItem('labels', labelIndex)} disabled={disabled || (config.labels?.length ?? 0) <= 2}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                  ))}
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm" 
                    onClick={() => handleAddItem('labels')}
                    disabled={disabled}
                  >
                      <PlusCircle className="h-3 w-3 mr-1" /> Add Choice
                  </Button>
              </div>
          )}
      </div>
    );
  } else if (fieldType === 'List[Dict[str, any]]') {
      return (
          <div className="mt-3 pl-4 border-l-2 border-purple-200 space-y-3">
              <p className="text-xs font-medium text-purple-600">Complex Structure Configuration</p>
              <Label>Define Keys for Structure</Label>
              {/* Display error string */} 
              {errors && errors.includes('key') && <p className="text-xs text-red-500">{errors}</p>} 
              <div className="space-y-2">
                  {(config.dict_keys ?? []).map((keyItem, keyIndex) => ( // Use config.dict_keys
                      <div key={keyIndex} className="flex items-center gap-2 p-2 border rounded bg-muted/20">
                           <Input
                              id={`fields.${fieldIndex}.config.dict_keys.${keyIndex}.name`}
                              value={keyItem.name} // Access key name
                              onChange={(e) => handleListItemChange('dict_keys', keyIndex, { name: e.target.value })} // Use handler
                              placeholder="Key Name (e.g., entity)"
                              className="flex-1 h-8 text-sm"
                              disabled={disabled}
                           />
                           <Select 
                                value={keyItem.type} // Access key type
                                onValueChange={(value) => handleListItemChange('dict_keys', keyIndex, { type: value as any })} // Use handler
                                disabled={disabled}
                            >
                                <SelectTrigger className="w-[100px] h-8 text-xs">
                                    <SelectValue placeholder="Type" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="str" className="text-xs">Text</SelectItem>
                                    <SelectItem value="int" className="text-xs">Integer</SelectItem>
                                    <SelectItem value="float" className="text-xs">Decimal</SelectItem>
                                    <SelectItem value="bool" className="text-xs">Yes/No</SelectItem>
                                </SelectContent>
                            </Select>
                           <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-500" onClick={() => handleRemoveItem('dict_keys', keyIndex)} disabled={disabled || (config.dict_keys?.length ?? 0) <= 1}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                  ))}
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm" 
                    onClick={() => handleAddItem('dict_keys')}
                    disabled={disabled}
                  >
                      <PlusCircle className="h-3 w-3 mr-1" /> Add Key
                  </Button>
              </div>
          </div>
      );
  }

  return null; // No config needed for 'str' type
};

export default ClassificationSchemeEditor; 