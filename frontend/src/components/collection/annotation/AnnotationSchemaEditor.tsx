"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useInfospaceStore } from "@/zustand_stores/storeInfospace";
import { useAnnotationSystem } from "@/hooks/useAnnotationSystem";
import { 
  AnnotationSchemaFormData,
  SchemaSection,
  AdvancedSchemeField,
  ADVANCED_SCHEME_TYPE_OPTIONS,
  JsonSchemaType,
} from "@/lib/annotations/types";
import { useTutorialStore } from "@/zustand_stores/storeTutorial";
import { Switch } from "@/components/ui/switch";
import AnnotationSchemaCard from "./AnnotationSchemaCard";
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Trash2, PlusCircle, Info, AlertTriangle, FileJson, FileText, Image, Mic, Video, Network, Settings } from 'lucide-react';
import GraphSchemaVisualEditor from './GraphSchemaVisualEditor';
import { AnnotationSchemaRead, AnnotationSchemaUpdate } from '@/client';
import { adaptSchemaReadToSchemaFormData, adaptSchemaFormDataToSchemaCreate } from '@/lib/annotations/adapters';
import { useToast } from "@/components/ui/use-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { nanoid } from 'nanoid';
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Checkbox } from "@/components/ui/checkbox";

interface AnnotationSchemaEditorProps {
  show: boolean;
  onClose: () => void;
  schemeId?: number;
  mode: 'create' | 'edit' | 'watch';
  defaultValues?: AnnotationSchemaRead | null;
}

const defaultSchemeFormData: AnnotationSchemaFormData = {
  name: '',
  description: '',
  instructions: '',
  structure: [{
      id: nanoid(),
      name: 'document',
      fields: []
  }],
};

// --- Main Editor Component ---
const AnnotationSchemaEditor: React.FC<AnnotationSchemaEditorProps> = ({
  show,
  onClose,
  schemeId,
  mode,
  defaultValues = null,
}) => {
  const { activeInfospace } = useInfospaceStore();
  const { createSchema, updateScheme, isLoadingSchemas, error: apiError, loadSchemas } = useAnnotationSystem();
  const { showSchemaBuilderTutorial, toggleSchemaBuilderTutorial } = useTutorialStore();
  const { toast } = useToast();

  const [formData, setFormData] = useState<AnnotationSchemaFormData>(defaultSchemeFormData);
  const [formErrors, setFormErrors] = useState<Record<string, string | string[]>>({});
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // --- Structure Manipulation Handlers ---
  const handleAddSection = (sectionName: SchemaSection['name']) => {
      if (formData.structure.some(s => s.name === sectionName)) {
          toast({ title: "Section exists", description: `A section for '${sectionName}' already exists.`, variant: "default" });
          return;
      }
      const newSection: SchemaSection = {
          id: nanoid(),
          name: sectionName,
          fields: []
      };
      setFormData(prev => ({
          ...prev,
          structure: [...prev.structure, newSection]
      }));
      setSelectedNodeId(newSection.id);
  };

  const handleRemoveSection = (sectionId: string) => {
    setFormData(prev => ({
        ...prev,
        structure: prev.structure.filter(s => s.id !== sectionId)
    }));
    // If the selected node was in the removed section, deselect it
    if(selectedNodeId === sectionId || formData.structure.find(s => s.id === sectionId)?.fields.some(f => f.id === selectedNodeId)) {
        setSelectedNodeId(null);
    }
  };

  const handleAddField = (sectionId: string) => {
      const newField: AdvancedSchemeField = {
          id: nanoid(),
          name: `new_field_${nanoid(4)}`,
          type: 'string',
          required: false
      };
      setFormData(prev => ({
          ...prev,
          structure: prev.structure.map(s => 
              s.id === sectionId ? { ...s, fields: [...s.fields, newField] } : s
          )
      }));
      setSelectedNodeId(newField.id);
  };

  const handleRemoveField = (sectionId: string, fieldId: string) => {
      setFormData(prev => ({
          ...prev,
          structure: prev.structure.map(s => 
              s.id === sectionId ? { ...s, fields: s.fields.filter(f => f.id !== fieldId) } : s
          )
      }));
      if (selectedNodeId === fieldId) {
          setSelectedNodeId(null);
      }
  };

  // Adapt ClassificationSchemeRead to the new FormData structure
  useEffect(() => {
    if (mode === 'create') {
        const initialField = { id: nanoid(), name: 'summary', type: 'string' as JsonSchemaType, description: 'A summary of the document.', required: true };
        const initialStructure = {
            id: nanoid(),
            name: 'document' as const,
            fields: [ initialField ]
        };
        setFormData({
            name: '',
            description: '',
            instructions: '',
            structure: [initialStructure],
        });
        setSelectedNodeId(initialField.id); // Select the first field by default
    } else if (mode === 'edit' || mode === 'watch') {
        if (defaultValues) {
            try {
                const adaptedData = adaptSchemaReadToSchemaFormData(defaultValues);
                setFormData(adaptedData);
                // Select the first field if available
                if (adaptedData.structure.length > 0 && adaptedData.structure[0].fields.length > 0) {
                    setSelectedNodeId(adaptedData.structure[0].fields[0].id);
                }
            } catch (error) {
                toast({ title: "Error", description: "Failed to load schema data for editing.", variant: "destructive" });
                setFormData(defaultSchemeFormData);
            }
        } else {
             setFormData(defaultSchemeFormData);
        }
    }
  }, [defaultValues, mode, toast]);

  // Helper function to validate field names
  const isValidFieldName = (name: string): boolean => {
      // Only allow alphanumeric characters and underscores (Python-safe identifiers)
      return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
  };



  // Validation for the new structure
  const validateForm = (): boolean => {
      const errors: Record<string, string | string[]> = {};
      let isValid = true;
      
      if (!formData.name.trim()) {
          errors.name = "Scheme name cannot be empty";
          isValid = false;
      }
      
      if(formData.structure.length === 0) {
          errors.structure = "At least one section is required";
          isValid = false;
      } else if (formData.structure.every(s => s.fields.length === 0)) {
          errors.structure = "At least one field in one section is required";
          isValid = false;
      } else {
          // Validate field names are not empty and don't contain special characters
          for (const section of formData.structure) {
              for (const field of section.fields) {
                  if (!field.name.trim()) {
                      errors.structure = "All fields must have a name";
                      isValid = false;
                      break;
                  }

              }
              if (!isValid) break;
          }
      }
      
      setFormErrors(errors);
      return isValid;
  };

  const handleSubmit = async (event: React.FormEvent) => {
      event.preventDefault();
      const isValid = validateForm();
      
      if (!activeInfospace?.id || mode === 'watch' || !isValid) {
          return;
      }

      setFormErrors({});

      try {
          let response: AnnotationSchemaRead | null = null;
          
          if (mode === 'create') {
              response = await createSchema(formData);
              toast({ title: "Schema Created", description: `Schema "${response?.name}" created successfully.`, variant: "default" });
          } else if (mode === 'edit' && schemeId) {
              const updateData: AnnotationSchemaUpdate = adaptSchemaFormDataToSchemaCreate(formData);
              response = await updateScheme(schemeId, updateData); 
              toast({ title: "Schema Updated", description: `Schema "${response?.name}" updated successfully.`, variant: "default" });
          }
          
          await loadSchemas({ force: true }); // Force refresh schema list
          onClose(); // Close dialog on success
      } catch (error: any) { 
          const errorMsg = error.message || apiError || "An unexpected error occurred while saving.";
          setFormErrors({ submit: errorMsg });
          toast({ title: "Save Failed", description: errorMsg, variant: "destructive" });
      }
  };

  const title = {
    create: "Create New Annotation Schema",
    edit: `Edit: ${formData.name || 'Schema'}`,
    watch: `View: ${formData.name || 'Schema'}`
  }[mode];

  return (
    <AnnotationSchemaCard
      show={show}
      onClose={onClose}
      title={title}
      mode={mode}
      width="w-[95vw] max-w-[1600px]"
      height="h-[90vh]"
      className="border-2 border-schemes"
    >
        <form onSubmit={handleSubmit} className="flex flex-col h-full w-full overflow-hidden gap-4">
          {/* TOP SECTION: Schema Details (left) + Structure (right) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6 flex-shrink-0">
            {/* Left: Schema Details */}
            <div className="bg-card/50 border rounded-lg p-4 lg:p-5">
              <div className="flex items-center gap-2 mb-4">
                <FileText className="h-5 w-5 text-primary shrink-0" />
                <h3 className="text-lg font-semibold">Schema Details</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                      <Label htmlFor="scheme-name" className="text-sm font-medium">Name *</Label>
                      <Input
                          id="scheme-name"
                          value={formData.name}
                          onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                          placeholder="e.g., Article Analysis Schema"
                          disabled={isLoadingSchemas || mode === 'watch'}
                          className={cn(formErrors.name && "border-destructive focus-visible:ring-destructive")}
                      />
                       {formErrors.name && (
                         <div className="flex items-center gap-1.5 text-destructive">
                           <AlertTriangle className="h-3 w-3 shrink-0" />
                           <p className="text-xs">{formErrors.name as string}</p>
                         </div>
                       )}
                  </div>
                  <div className="space-y-2">
                      <Label htmlFor="scheme-description" className="text-sm font-medium">Description</Label>
                      <Input
                          id="scheme-description"
                          value={formData.description}
                          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                          placeholder="Brief description of what this schema analyzes..."
                          disabled={isLoadingSchemas || mode === 'watch'}
                      />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="model-instructions" className="text-sm font-medium">AI Instructions</Label>
                      <Textarea
                         id="model-instructions"
                         value={formData.instructions || ''}
                         onChange={(e) => setFormData(prev => ({ ...prev, instructions: e.target.value }))}
                         placeholder="Detailed instructions for the AI model on how to analyze content..."
                         rows={2}
                         disabled={isLoadingSchemas || mode === 'watch'}
                         className="text-sm font-mono resize-none"
                      />
                  </div>
              </div>
              
              {/* Action buttons inline */}
              {mode !== 'watch' && (
                <div className="flex items-center gap-3 mt-4 pt-4 border-t">
                    <div className="flex items-center gap-2 flex-1">
                        <div className={cn("h-2.5 w-2.5 rounded-full transition-colors", 
                          formData.name && formData.structure.some(s => s.fields.length > 0) 
                            ? "bg-green-500" 
                            : "bg-yellow-500"
                        )} />
                        <span className="text-sm text-muted-foreground">
                            {formData.name && formData.structure.some(s => s.fields.length > 0) 
                                ? 'Ready to save' 
                                : 'Complete required fields'
                            }
                        </span>
                    </div>
                    <Button 
                        type="button" 
                        variant="outline" 
                        size="sm"
                        onClick={onClose} 
                        disabled={isLoadingSchemas}
                    >
                        Cancel
                    </Button>
                    <Button 
                        type="submit" 
                        size="sm"
                        disabled={isLoadingSchemas || (!formData.name || !formData.structure.some(s => s.fields.length > 0))}
                    >
                        {isLoadingSchemas ? 'Saving...' : (mode === 'create' ? 'Create Schema' : 'Update Schema')}
                    </Button>
                </div>
              )}
            </div>

            {/* Right: Schema Structure */}
            <div className="bg-card/50 border rounded-lg p-4 lg:p-5 flex flex-col min-h-[200px]">
               <div className="flex items-center justify-between gap-2 mb-3 flex-shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileJson className="h-5 w-5 text-primary shrink-0" />
                    <h3 className="text-lg font-semibold truncate">Structure</h3>
                  </div>
                  <div className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full shrink-0 whitespace-nowrap">
                    {formData.structure.reduce((total, section) => total + section.fields.length, 0)} fields
                  </div>
               </div>
               
               <ScrollArea className="flex-1 min-h-0">
                  <div className="space-y-3 pr-2">
                      {formData.structure.map((section, sectionIndex) => (
                          <div key={section.id} className={cn(
                              "rounded-lg border-2 transition-all duration-200",
                              selectedNodeId === section.id 
                                ? "border-primary bg-primary/5 shadow-md" 
                                : "border-border bg-card/50 hover:border-primary/30 hover:shadow-sm"
                          )}>
                              <div 
                                  className="flex items-center justify-between p-3 lg:p-4 cursor-pointer group"
                                  onClick={() => setSelectedNodeId(section.id)}
                              >
                                  <div className="flex items-center gap-2 lg:gap-3 flex-1 min-w-0">
                                      {section.name === 'document' ? (
                                          <FileText className="h-5 w-5 text-blue-600 shrink-0" />
                                      ) : section.name === 'per_image' ? (
                                          // eslint-disable-next-line jsx-a11y/alt-text
                                          <Image className="h-5 w-5 text-green-600 shrink-0" />
                                      ) : section.name === 'per_audio' ? (
                                          <Mic className="h-5 w-5 text-purple-600 shrink-0" />
                                      ) : (
                                          <Video className="h-5 w-5 text-orange-600 shrink-0" />
                                      )}
                                      <div className="min-w-0">
                                          <span className="font-semibold text-sm lg:text-base capitalize block truncate">
                                              {section.name.replace('per_', '')} Analysis
                                          </span>
                                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                              <span className="text-xs text-muted-foreground">
                                                  {section.fields.length} field{section.fields.length !== 1 ? 's' : ''}
                                              </span>
                                              {section.fields.some(f => f.required) && (
                                                  <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">
                                                      {section.fields.filter(f => f.required).length} required
                                                  </span>
                                              )}
                                          </div>
                                      </div>
                                  </div>
                                  {section.name !== 'document' && mode !== 'watch' && (
                                      <Button 
                                          type="button" 
                                          variant="ghost" 
                                          size="icon" 
                                          className="h-8 w-8 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-opacity shrink-0"
                                          onClick={(e) => {
                                              e.stopPropagation();
                                              handleRemoveSection(section.id);
                                          }}
                                          title="Remove section"
                                      >
                                          <Trash2 className="h-4 w-4"/>
                                      </Button>
                                  )}
                              </div>
                              
                              {section.fields.length > 0 && (
                                  <div className="px-3 lg:px-4 pb-3 lg:pb-4">
                                      <div className="pl-6 lg:pl-8 space-y-1 border-l-2 border-muted ml-2">
                                          {section.fields.map((field, fieldIndex) => (
                                              <div 
                                                  key={field.id}
                                                  className={cn(
                                                      "flex items-center justify-between p-2 lg:p-3 rounded-md cursor-pointer group transition-all duration-150",
                                                      selectedNodeId === field.id 
                                                        ? "bg-primary/15 border border-primary/30 shadow-sm" 
                                                        : "hover:bg-muted/70 border border-transparent hover:border-border"
                                                  )}
                                                  onClick={(e) => {
                                                      e.stopPropagation();
                                                      setSelectedNodeId(field.id);
                                                  }}
                                              >
                                                  <div className="flex items-center gap-2 lg:gap-3 flex-1 min-w-0">
                                                      <div className="flex items-center gap-2 min-w-0">
                                                          {field.type === 'graph' && (
                                                              <div title="Knowledge Graph">
                                                                  <Network className="h-3.5 w-3.5 text-purple-600 shrink-0" />
                                                              </div>
                                                          )}
                                                          <span className="text-sm font-medium truncate">{field.name}</span>
                                                          {field.required && (
                                                              <span className="text-destructive text-sm font-bold shrink-0" title="Required field">*</span>
                                                          )}
                                                      </div>
                                                      {field.description && (
                                                          <span className="text-xs text-muted-foreground truncate hidden lg:inline max-w-[120px] xl:max-w-[200px]">
                                                              {field.description}
                                                          </span>
                                                      )}
                                                  </div>
                                                  <div className="flex items-center gap-2 shrink-0">
                                                      <span className={cn(
                                                          "text-xs px-2 lg:px-2.5 py-1 rounded-full font-mono shrink-0 whitespace-nowrap",
                                                          field.type === 'graph' 
                                                              ? "bg-purple-100 text-purple-700 border border-purple-300"
                                                              : "bg-muted text-muted-foreground"
                                                      )}>
                                                          {field.type === 'graph' 
                                                              ? 'Graph' 
                                                              : field.type === 'array' && field.items 
                                                                  ? `${field.items.type}[]` 
                                                                  : field.type}
                                                      </span>
                                                      {mode !== 'watch' && (
                                                          <Button
                                                              type="button"
                                                              variant="ghost"
                                                              size="icon"
                                                              className="h-7 w-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-opacity shrink-0"
                                                              onClick={(e) => {
                                                                  e.stopPropagation();
                                                                  handleRemoveField(section.id, field.id);
                                                              }}
                                                              title="Remove field"
                                                          >
                                                              <Trash2 className="h-3.5 w-3.5" />
                                                          </Button>
                                                      )}
                                                  </div>
                                              </div>
                                          ))}
                                      </div>
                                  </div>
                              )}
                              
                              {mode !== 'watch' && (
                                  <div className="px-3 lg:px-4 pb-3 lg:pb-4">
                                      <Button 
                                          type="button" 
                                          variant="outline" 
                                          size="sm"
                                          className="w-full h-9 border-dashed hover:border-solid hover:bg-primary/5 hover:border-primary/30 transition-all text-xs lg:text-sm"
                                          onClick={(e) => {
                                              e.stopPropagation();
                                              handleAddField(section.id);
                                          }}
                                      >
                                          <PlusCircle className="h-4 w-4 mr-2 shrink-0" />
                                          <span className="truncate">Add Field to {section.name.replace('per_', '').charAt(0).toUpperCase() + section.name.replace('per_', '').slice(1)}</span>
                                      </Button>
                                  </div>
                              )}
                          </div>
                      ))}
                  </div>
                  {formErrors.structure && (
                      <div className="flex items-center gap-2 text-destructive mt-3 p-3 bg-destructive/5 rounded-lg border border-destructive/20 mx-2">
                          <AlertTriangle className="h-4 w-4 shrink-0" />
                          <p className="text-sm">{formErrors.structure as string}</p>
                      </div>
                  )}
               </ScrollArea>
               
               {/* Add Media Analysis - inline */}
               {mode !== 'watch' && (
                   <div className="flex items-center gap-2 mt-3 pt-3 border-t flex-shrink-0">
                      <Label className="text-xs font-medium text-muted-foreground shrink-0">Add:</Label>
                      {[
                          { value: 'per_image', icon: Image, label: 'Images', color: 'text-green-600', disabled: formData.structure.some(s => s.name === 'per_image') },
                          { value: 'per_audio', icon: Mic, label: 'Audio', color: 'text-purple-600', disabled: formData.structure.some(s => s.name === 'per_audio') },
                          { value: 'per_video', icon: Video, label: 'Video', color: 'text-orange-600', disabled: formData.structure.some(s => s.name === 'per_video') }
                      ].map((mediaType) => (
                          <Button
                              key={mediaType.value}
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={mediaType.disabled}
                              className={cn(
                                  "h-8 px-2 gap-1.5 border-dashed hover:border-solid transition-all",
                                  mediaType.disabled 
                                      ? "opacity-50 cursor-not-allowed" 
                                      : "hover:bg-primary/5 hover:border-primary/30"
                              )}
                              onClick={() => handleAddSection(mediaType.value as SchemaSection['name'])}
                          >
                              <mediaType.icon className={cn("h-3.5 w-3.5", mediaType.color)} />
                              <span className="text-xs">{mediaType.label}</span>
                          </Button>
                      ))}
                   </div>
               )}
            </div>
          </div>

          {/* BOTTOM SECTION: Field Configuration (full width) */}
          <div className="bg-card/50 border rounded-lg p-4 lg:p-5 flex-1 min-h-0 flex flex-col overflow-hidden">
             <div className="flex items-center gap-2 mb-3 flex-shrink-0">
               <Settings className="h-5 w-5 text-primary shrink-0" />
               <h3 className="text-lg font-semibold">Field Configuration</h3>
               <span className="text-sm text-muted-foreground ml-2">
                 {selectedNodeId ? 'Configure the selected item' : 'Select a section or field above'}
               </span>
             </div>
             <ScrollArea className="flex-1 min-h-0">
                <div className="pr-4">
                  <PropertyInspector 
                     selectedNodeId={selectedNodeId}
                     formData={formData}
                     onFormChange={setFormData}
                     disabled={isLoadingSchemas || mode === 'watch'}
                  />
                </div>
             </ScrollArea>
          </div>

          {/* Global Submit/API Error Display */} 
          {formErrors.submit && (
                <Alert variant="destructive" className="mt-4 flex-shrink-0">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Error Saving Schema</AlertTitle>
                    <AlertDescription>{formErrors.submit as string}</AlertDescription>
                </Alert>
            )}
        </form>
    </AnnotationSchemaCard>
  );
};

// --- Property Inspector Component ---
const PropertyInspector: React.FC<{
    selectedNodeId: string | null;
    formData: AnnotationSchemaFormData;
    onFormChange: (data: AnnotationSchemaFormData) => void;
    disabled: boolean;
}> = ({ selectedNodeId, formData, onFormChange, disabled }) => {

    const { node, section, field } = React.useMemo(() => {
        if (!selectedNodeId) return { node: null, section: null, field: null };

        for (const sec of formData.structure) {
            if (sec.id === selectedNodeId) {
                return { node: 'section', section: sec, field: null };
            }
            for (const fld of sec.fields) {
                if (fld.id === selectedNodeId) {
                    return { node: 'field', section: sec, field: fld };
                }
            }
        }
        return { node: null, section: null, field: null };
    }, [selectedNodeId, formData]);
    
    const handleFieldUpdate = (update: Partial<AdvancedSchemeField>) => {
        if (!section || !field) return;

        const updatedField = { ...field, ...update };
        const newStructure = formData.structure.map(s => {
            if (s.id === section.id) {
                return {
                    ...s,
                    fields: s.fields.map(f => f.id === field.id ? updatedField : f)
                };
            }
            return s;
        });
        onFormChange({ ...formData, structure: newStructure });
    };

    const handleTypeChange = (value: string) => {
        if (!section || !field) return;
        
        const update: Partial<AdvancedSchemeField> = {};
        
        if (value === 'graph') {
            // Initialize graph field with default triplet configuration
            update.type = 'graph';
            update.graphConfig = {
                entityTypes: {
                    typeEnum: [],
                    typeConstrained: false
                },
                relationshipSchema: {
                    predicateEnum: [],
                    predicateConstrained: false,
                    optionalFields: []
                },
                graphConfig: {
                    deduplication: {
                        enabled: true,
                        strategy: 'normalized',
                        fields: ['name', 'type'],
                        caseSensitive: false,
                        normalizeWhitespace: true
                    }
                }
            };
            // Clean up non-graph properties
            delete update.items;
            delete update.properties;
        } else if (value.startsWith('array_')) {
            update.type = 'array';
            const itemType = value.split('_')[1] as JsonSchemaType;
            update.items = { type: itemType };
            if (itemType === 'object') {
                // Preserve existing properties when converting to array of objects
                update.items.properties = field.items?.properties || [];
            } else if (value === 'array_string_enum') {
                // Initialize enum array with empty labels and auto-enable "other" option
                update.items.enum = [];
                update.items.includeOther = true;
            } else if (value === 'array_string' && field.items?.enum !== undefined) {
                // Switching from array_string_enum to array_string - clean up enum properties
                const existingItems = field.items || { type: 'string' };
                update.items = { type: existingItems.type };
                // Remove enum and includeOther properties
                if (existingItems.properties) {
                    update.items.properties = existingItems.properties;
                }
            }
            // Clean up graph config if switching away from graph
            if (field.type === 'graph') {
                delete update.graphConfig;
            }
        } else {
            update.type = value as JsonSchemaType;
            delete update.items; // Remove items if not an array
            // Clean up graph config if switching away from graph
            if (field.type === 'graph') {
                delete update.graphConfig;
            }
        }
        
        if (update.type === 'object') {
            update.properties = field.properties || [];
        } else if (update.type !== 'graph') {
            delete update.properties;
        }

        handleFieldUpdate(update);
    }
    
    const getTypeValue = (): string => {
        if (field?.type === 'graph') {
            return 'graph';
        }
        if(field?.type === 'array' && field.items) {
            // Check if this is an array of strings with enum constraints
            if (field.items.type === 'string' && field.items.enum !== undefined) {
                return 'array_string_enum';
            }
            // Handle array of objects explicitly
            if (field.items.type === 'object') {
                return 'array_object';
            }
            return `array_${field.items.type}`;
        }
        return field?.type || 'string';
    }

    // Template generator for evidence prompts based on rigor level
    const getEvidencePromptTemplate = (rigorLevel: 'minimal' | 'standard' | 'thorough' | 'exhaustive'): string => {
        const snippetCounts = {
            minimal: '1-2',
            standard: '3-5',
            thorough: '5-8',
            exhaustive: '8+'
        };
        
        return `Explain your reasoning for this value and provide ${snippetCounts[rigorLevel]} direct quotations from the text that support your answer. Each quotation should be a complete sentence or meaningful phrase.`;
    };

    // Check if custom_prompt matches a template (to detect if it's still the default)
    const isCustomPromptDefault = (customPrompt: string | undefined, rigorLevel: string | undefined): boolean => {
        if (!customPrompt || !rigorLevel) return true;
        const template = getEvidencePromptTemplate(rigorLevel as 'minimal' | 'standard' | 'thorough' | 'exhaustive');
        return customPrompt.trim() === template.trim();
    };

    if (!node) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-center p-6 border-2 border-dashed rounded-md bg-muted/20">
                <div className="bg-primary/10 p-4 rounded-full mb-4">
                    <FileJson className="h-8 w-8 text-primary" />
                </div>
                <h4 className="font-semibold text-lg mb-2">Nothing Selected</h4>
                <p className="text-sm text-muted-foreground max-w-xs">
                    Click on any section or field in the schema structure to configure its properties here.
                </p>
            </div>
        );
    }
    
    if (node === 'section' && section) {
        const getSectionInfo = () => {
            switch (section.name) {
                case 'document':
                    return {
                        icon: <FileText className="h-6 w-6 text-blue-600" />,
                        title: 'Document Analysis',
                        description: 'Fields extracted from the main document content (text, metadata, etc.)',
                        color: 'border-blue-200'
                    };
                case 'per_image':
                    return {
                        // eslint-disable-next-line jsx-a11y/alt-text
                        icon: <Image className="h-6 w-6 text-green-600" />,
                        title: 'Image Analysis',
                        description: 'Fields extracted from each individual image in the document',
                        color: 'border-green-200'
                    };
                case 'per_audio':
                    return {
                        icon: <Mic className="h-6 w-6 text-purple-600" />,
                        title: 'Audio Analysis',
                        description: 'Fields extracted from each individual audio file in the document',
                        color: 'border-purple-200'
                    };
                case 'per_video':
                    return {
                        icon: <Video className="h-6 w-6 text-orange-600" />,
                        title: 'Video Analysis',
                        description: 'Fields extracted from each individual video file in the document',
                        color: 'border-orange-200'
                    };
                default:
                    return {
                        icon: <FileJson className="h-6 w-6 text-muted-foreground" />,
                        title: section.name,
                        description: 'Section configuration',
                        color: 'border-border'
                    };
            }
        };

        const sectionInfo = getSectionInfo();

        return (
             <div className={cn("space-y-4 p-5 border-2 rounded-md", sectionInfo.color)}>
                <div className="flex items-center gap-3">
                    {sectionInfo.icon}
                    <div>
                        <h3 className="text-xl font-semibold">{sectionInfo.title}</h3>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-sm text-muted-foreground">
                                {section.fields.length} field{section.fields.length !== 1 ? 's' : ''}
                            </span>
                            {section.fields.some(f => f.required) && (
                                <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                                    {section.fields.filter(f => f.required).length} required
                                </span>
                            )}
                        </div>
                    </div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                    {sectionInfo.description}
                </p>
                {section.fields.length === 0 && (
                    <div className="p-3 bg-muted/50 rounded-lg border border-dashed">
                        <p className="text-sm text-muted-foreground text-center">
                            No fields defined yet. Click "Add Field" to get started.
                        </p>
                    </div>
                )}
             </div>
        );
    }
    
    if (node === 'field' && field) {
        return (
            <div className="space-y-6">
                {/* Field Header */}
                <div className="bg-card/50 border-2 rounded-md p-4">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="bg-primary/10 p-2 rounded-lg">
                            <FileJson className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold">Field Configuration</h3>
                            <p className="text-sm text-muted-foreground">Configure how the AI extracts this data</p>
                        </div>
                    </div>
                </div>

                {/* Basic Properties */}
                <div className="space-y-4 p-2">
                    <div className="space-y-2">
                        <Label htmlFor="field-name" className="text-sm font-semibold">Field Name *</Label>
                        <Input 
                            id="field-name"
                            value={field.name}
                            onChange={(e) => handleFieldUpdate({ name: e.target.value })}
                            placeholder="e.g., summary, threat_level, article_type"
                            disabled={disabled}
                            className={cn(
                                "transition-all",
                                !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field.name) && field.name 
                                    ? "border-yellow-400 focus-visible:ring-yellow-400" 
                                    : ""
                            )}
                        />
                        {field.name && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field.name) && (
                            <div className="flex items-start gap-2 p-2 bg-yellow-50 border border-yellow-200 rounded-lg">
                                <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                                <p className="text-xs text-yellow-700">
                                    Consider using only letters, numbers, and underscores for better compatibility (e.g., summary_text, threat_level).
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="field-desc" className="text-sm font-semibold">Description</Label>
                        <Textarea 
                            id="field-desc"
                            value={field.description || ''}
                            onChange={(e) => handleFieldUpdate({ description: e.target.value })}
                            placeholder="Describe what this field should contain and how the AI should extract it..."
                            rows={3}
                            disabled={disabled}
                            className="text-sm resize-none"
                        />
                        <p className="text-xs text-muted-foreground">
                            A clear description helps the AI understand what to extract.
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="field-type" className="text-sm font-semibold">Data Type</Label>
                        <Select 
                            value={getTypeValue()}
                            onValueChange={handleTypeChange}
                            disabled={disabled}
                        >
                            <SelectTrigger id="field-type" className="h-10">
                                <SelectValue placeholder="Select a type" />
                            </SelectTrigger>
                            <SelectContent>
                                {ADVANCED_SCHEME_TYPE_OPTIONS.map(opt => (
                                    <SelectItem key={opt.value} value={opt.value} className="text-sm py-2">
                                        {opt.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {field.type === 'object' && field.properties && field.properties.length > 0 && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="w-full mt-2 border-dashed hover:border-solid hover:bg-primary/5"
                                onClick={() => {
                                    // Convert object to array of objects, preserving properties
                                    handleFieldUpdate({
                                        type: 'array',
                                        items: {
                                            type: 'object',
                                            properties: field.properties || []
                                        }
                                    });
                                }}
                                disabled={disabled}
                                title="Convert this object field to a list of objects (preserves all nested fields)"
                            >
                                <PlusCircle className="h-4 w-4 mr-2" />
                                Convert to List of Objects
                            </Button>
                        )}
                    </div>

                    {/* Graph Field Configuration */}
                    {field.type === 'graph' && field.graphConfig && (
                        <GraphSchemaVisualEditor
                            field={field}
                            section={section!}
                            disabled={disabled}
                            onFieldUpdate={handleFieldUpdate}
                        />
                    )}

                    {/* Enum Labels Configuration for array_string_enum */}
                    {field.type === 'array' && field.items?.type === 'string' && field.items.enum !== undefined && (
                        <div className="space-y-4 p-4 bg-gradient-to-br from-primary/5 to-primary/10 border-2 border-primary/20 rounded-lg">
                            <div className="flex items-center gap-2 mb-2">
                                <div className="h-2 w-2 bg-primary rounded-full" />
                                <Label className="text-sm font-semibold">Allowed Labels</Label>
                            </div>
                            <p className="text-xs text-muted-foreground mb-3">
                                Define the specific labels that can be selected. Each label will be a valid choice in the array.
                            </p>
                            
                            <div className="space-y-2">
                                {(field.items.enum || []).map((label, index) => (
                                    <div key={index} className="flex items-center gap-2 group">
                                        <Input
                                            value={label}
                                            onChange={(e) => {
                                                const newEnum = [...(field.items?.enum || [])];
                                                newEnum[index] = e.target.value;
                                                handleFieldUpdate({
                                                    items: {
                                                        ...field.items!,
                                                        enum: newEnum
                                                    }
                                                });
                                            }}
                                            placeholder={`Label ${index + 1}`}
                                            disabled={disabled}
                                            className="h-9 text-sm flex-1"
                                        />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="h-9 w-9 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                                            onClick={() => {
                                                const newEnum = (field.items?.enum || []).filter((_, i) => i !== index);
                                                handleFieldUpdate({
                                                    items: {
                                                        ...field.items!,
                                                        enum: newEnum
                                                    }
                                                });
                                            }}
                                            disabled={disabled}
                                            title="Remove label"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ))}
                                
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="w-full border-dashed hover:border-solid hover:bg-primary/5 h-9"
                                    onClick={() => {
                                        const newEnum = [...(field.items?.enum || []), ''];
                                        handleFieldUpdate({
                                            items: {
                                                ...field.items!,
                                                enum: newEnum
                                            }
                                        });
                                    }}
                                    disabled={disabled}
                                >
                                    <PlusCircle className="h-4 w-4 mr-2" />
                                    Add Label
                                </Button>
                            </div>

                            <div className="mt-4 pt-4 border-t border-primary/20">
                                <div className="flex items-center justify-between">
                                    <div className="flex-1">
                                        <Label htmlFor="include-other" className="text-sm font-medium cursor-pointer">
                                            Include "Other" Option
                                        </Label>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Allow AI to select "other" as a fallback when none of the labels fit
                                        </p>
                                    </div>
                                    <Switch
                                        id="include-other"
                                        checked={field.items.includeOther ?? false}
                                        onCheckedChange={(checked) => handleFieldUpdate({
                                            items: {
                                                ...field.items!,
                                                includeOther: checked
                                            }
                                        })}
                                        disabled={disabled}
                                    />
                                </div>
                            </div>

                            {(field.items.enum || []).length === 0 && (
                                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                                    <div className="flex items-start gap-2">
                                        <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                                        <p className="text-xs text-yellow-700">
                                            Add at least one label to restrict choices. Without labels, this will behave as a free-form list of text.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="bg-muted/30 border rounded-lg p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <Label htmlFor="field-required" className="text-sm font-semibold cursor-pointer">
                                    Required Field
                                </Label>
                                <p className="text-xs text-muted-foreground mt-1">
                                    AI must provide a value for this field
                                </p>
                            </div>
                            <Switch
                                id="field-required"
                                checked={field.required}
                                onCheckedChange={(checked) => handleFieldUpdate({ required: checked })}
                                disabled={disabled}
                            />
                        </div>
                    </div>
                </div>

                {/* Advanced Configuration */}
                <Accordion type="multiple" className="w-full space-y-3">
                  {/* Type-Specific Config */}
                  {field.type === 'string' && (
                    <AccordionItem value="type-config" className="border rounded-lg px-3">
                      <AccordionTrigger className="text-sm font-semibold py-3">
                        Value Constraints
                      </AccordionTrigger>
                      <AccordionContent className="pb-3">
                        <div className="space-y-3">
                          <div className="space-y-2">
                            <Label htmlFor="field-enum" className="text-sm font-medium">Allowed Values (Optional)</Label>
                            <Textarea
                              id="field-enum"
                              value={(field.enum || []).join('\n')}
                              onChange={(e) => handleFieldUpdate({ enum: e.target.value.split('\n').filter(v => v) })}
                              placeholder="One value per line to restrict choices"
                              rows={3}
                              disabled={disabled}
                              className="text-sm resize-none"
                            />
                            <p className="text-xs text-muted-foreground">
                              Restrict the AI to only these specific values.
                            </p>
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {field.type === 'number' && (
                    <AccordionItem value="number-constraints" className="border rounded-lg px-3">
                      <AccordionTrigger className="text-sm font-semibold py-3">
                        Value Constraints
                      </AccordionTrigger>
                      <AccordionContent className="pb-3">
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                              <Label htmlFor="field-minimum" className="text-sm font-medium">Minimum Value (Optional)</Label>
                              <Input
                                id="field-minimum"
                                type="number"
                                value={field.minimum ?? ''}
                                onChange={(e) => {
                                  const value = e.target.value === '' ? undefined : parseFloat(e.target.value);
                                  handleFieldUpdate({ minimum: isNaN(value as number) ? undefined : value });
                                }}
                                placeholder="No minimum"
                                disabled={disabled}
                                className="text-sm"
                              />
                              <p className="text-xs text-muted-foreground">
                                Minimum allowed value (inclusive)
                              </p>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="field-maximum" className="text-sm font-medium">Maximum Value (Optional)</Label>
                              <Input
                                id="field-maximum"
                                type="number"
                                value={field.maximum ?? ''}
                                onChange={(e) => {
                                  const value = e.target.value === '' ? undefined : parseFloat(e.target.value);
                                  handleFieldUpdate({ maximum: isNaN(value as number) ? undefined : value });
                                }}
                                placeholder="No maximum"
                                disabled={disabled}
                                className="text-sm"
                              />
                              <p className="text-xs text-muted-foreground">
                                Maximum allowed value (inclusive)
                              </p>
                            </div>
                          </div>
                          {(field.minimum !== undefined || field.maximum !== undefined) && (
                            <div className="p-2 bg-blue-50 border border-blue-200 rounded-lg">
                              <p className="text-xs text-blue-700">
                                {field.minimum !== undefined && field.maximum !== undefined
                                  ? `Value must be between ${field.minimum} and ${field.maximum}`
                                  : field.minimum !== undefined
                                  ? `Value must be at least ${field.minimum}`
                                  : `Value must be at most ${field.maximum}`
                                }
                              </p>
                            </div>
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {(field.type === 'object' || (field.type === 'array' && field.items?.type === 'object')) && (
                    <AccordionItem value="object-config" className="border rounded-lg px-3">
                      <AccordionTrigger className="text-sm font-semibold py-3">
                        {field.type === 'array' ? 'Array Item Properties' : 'Object Properties'}
                      </AccordionTrigger>
                      <AccordionContent className="pb-3">
                        <NestedPropertyEditor
                          field={field}
                          section={section}
                          disabled={disabled}
                          onFieldUpdate={handleFieldUpdate}
                        />
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {/* Justification Section */}
                  <AccordionItem value="justification" className="border rounded-lg px-3">
                    <AccordionTrigger className="text-sm font-semibold py-3">
                      <div className="flex items-center gap-2">
                        <span>AI Justification</span>
                        {field.justification?.enabled && (
                          <div className="h-2 w-2 bg-green-500 rounded-full" />
                        )}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-3">
                      <div className="space-y-4">
                        <div className="bg-muted/20 border rounded-lg p-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <Label htmlFor="justification-enabled" className="text-sm font-medium cursor-pointer">
                                Request Justification
                              </Label>
                              <p className="text-xs text-muted-foreground mt-1">
                                Ask AI to explain how it determined this value
                              </p>
                            </div>
                            <Switch
                              id="justification-enabled"
                              checked={field.justification?.enabled ?? false}
                              onCheckedChange={(checked) => {
                                const rigorLevel = checked && !field.justification?.rigor_level 
                                  ? 'standard' 
                                  : (field.justification?.rigor_level as 'minimal' | 'standard' | 'thorough' | 'exhaustive' | undefined);
                                
                                // Pre-fill custom_prompt with template if enabling and no custom prompt exists
                                const customPrompt = checked && !field.justification?.custom_prompt && rigorLevel
                                  ? getEvidencePromptTemplate(rigorLevel)
                                  : field.justification?.custom_prompt;
                                
                                handleFieldUpdate({ 
                                  justification: { 
                                    ...field.justification, 
                                    enabled: !!checked,
                                    rigor_level: rigorLevel,
                                    custom_prompt: customPrompt
                                  } as any
                                });
                              }}
                              disabled={disabled}
                            />
                          </div>
                        </div>
                        
                        {field.justification?.enabled && (
                          <div className="space-y-3">
                            {/* Evidence Rigor Level */}
                            <div className="space-y-2">
                              <Label htmlFor="evidence-rigor" className="text-sm font-medium">
                                Evidence Rigor Level
                              </Label>
                              <Select
                                value={(field.justification as any)?.rigor_level || 'standard'}
                                onValueChange={(value) => {
                                  const rigorLevel = value as 'minimal' | 'standard' | 'thorough' | 'exhaustive';
                                  
                                  // Auto-fill custom_prompt with template if it's empty or matches previous template
                                  const currentPrompt = field.justification?.custom_prompt;
                                  const currentRigor = field.justification?.rigor_level || 'standard';
                                  const shouldUpdatePrompt = !currentPrompt || isCustomPromptDefault(currentPrompt, currentRigor);
                                  
                                  handleFieldUpdate({ 
                                    justification: { 
                                      ...field.justification, 
                                      rigor_level: rigorLevel,
                                      custom_prompt: shouldUpdatePrompt 
                                        ? getEvidencePromptTemplate(rigorLevel)
                                        : currentPrompt
                                    } as any
                                  });
                                }}
                                disabled={disabled}
                              >
                                <SelectTrigger id="evidence-rigor" className="text-sm">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="minimal">
                                    <div className="flex flex-col items-start gap-0.5">
                                      <span className="font-medium">Minimal</span>
                                      <span className="text-xs text-muted-foreground">1-2 evidence snippets</span>
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="standard">
                                    <div className="flex flex-col items-start gap-0.5">
                                      <span className="font-medium">Standard</span>
                                      <span className="text-xs text-muted-foreground">3-5 snippets (recommended)</span>
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="thorough">
                                    <div className="flex flex-col items-start gap-0.5">
                                      <span className="font-medium">Thorough</span>
                                      <span className="text-xs text-muted-foreground">5-8 evidence snippets</span>
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="exhaustive">
                                    <div className="flex flex-col items-start gap-0.5">
                                      <span className="font-medium">Exhaustive</span>
                                      <span className="text-xs text-muted-foreground">8+ evidence snippets</span>
                                    </div>
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                              <p className="text-xs text-muted-foreground">
                                Specifies how many text quotations the AI should provide when justifying this field.
                              </p>
                            </div>

                            {/* Custom Prompt */}
                            <div className="space-y-2">
                              <Label htmlFor="justification-prompt" className="text-sm font-medium">
                                Custom Prompt (Optional, use e.g. to adapt to language assets or schema are in)
                              </Label>
                              <Textarea
                                id="justification-prompt"
                                value={field.justification.custom_prompt || ''}
                                onChange={(e) => handleFieldUpdate({ 
                                  justification: { 
                                    enabled: field.justification?.enabled ?? true, 
                                    custom_prompt: e.target.value 
                                  }
                                })}
                                placeholder="e.g., Explain step-by-step how you determined this value..."
                                rows={3}
                                disabled={disabled}
                                className="text-sm resize-none"
                              />
                              <p className="text-xs text-muted-foreground">
                                This prompt will be sent to the AI. You can edit it or write your own.
                              </p>
                            </div>
                            
                            {field.provider && field.model_name && (
                              <div className="flex items-center gap-3 p-3 bg-primary/5 border border-primary/20 rounded-lg">
                                <div className="flex-shrink-0 h-8 w-8 rounded-full bg-background flex items-center justify-center border">
                                  {field.provider?.includes('anthropic') && <img src="/anthropic-logo.png" className="h-5 w-5" alt="Anthropic" />}
                                  {field.provider?.includes('openai') && <img src="/openai-logo.png" className="h-5 w-5" alt="OpenAI" />}
                                  {field.provider?.includes('google') && <img src="/google-logo.png" className="h-4 w-4" alt="Google" />}
                                  {field.provider?.includes('groq') && <img src="/groq-logo.png" className="h-4 w-4" alt="Groq" />}
                                  {field.provider?.includes('together') && <img src="/together-logo.png" className="h-4 w-4" alt="Together" />}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium truncate">{field.model_name}</p>
                                  <p className="text-xs text-muted-foreground">Justification model</p>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
            </div>
        )
    }

    return null;
}

// --- Nested Property Editor Component ---
const NestedPropertyEditor: React.FC<{
    field: AdvancedSchemeField;
    section: SchemaSection;
    disabled: boolean;
    onFieldUpdate: (update: Partial<AdvancedSchemeField>) => void;
}> = ({ field, section, disabled, onFieldUpdate }) => {
    
    const isArrayOfObjects = field.type === 'array' && field.items?.type === 'object';
    const properties = isArrayOfObjects ? (field.items?.properties || []) : (field.properties || []);
    
    const handleAddProperty = () => {
        const newProperty: AdvancedSchemeField = {
            id: nanoid(),
            name: `property_${nanoid(4)}`,
            type: 'string',
            required: false
        };
        
        if (isArrayOfObjects) {
            onFieldUpdate({
                items: {
                    ...field.items!,
                    properties: [...properties, newProperty]
                }
            });
        } else {
            onFieldUpdate({
                properties: [...properties, newProperty]
            });
        }
    };
    
    const handleUpdateProperty = (propertyId: string, update: Partial<AdvancedSchemeField>) => {
        const updatedProperties = properties.map(prop => 
            prop.id === propertyId ? { ...prop, ...update } : prop
        );
        
        if (isArrayOfObjects) {
            onFieldUpdate({
                items: {
                    ...field.items!,
                    properties: updatedProperties
                }
            });
        } else {
            onFieldUpdate({
                properties: updatedProperties
            });
        }
    };
    
    const handleRemoveProperty = (propertyId: string) => {
        const updatedProperties = properties.filter(prop => prop.id !== propertyId);
        
        if (isArrayOfObjects) {
            onFieldUpdate({
                items: {
                    ...field.items!,
                    properties: updatedProperties
                }
            });
        } else {
            onFieldUpdate({
                properties: updatedProperties
            });
        }
    };
    
    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between p-2 bg-muted/20 rounded-md">
                <div className="text-xs text-muted-foreground">
                    {isArrayOfObjects 
                        ? `Define properties for each item in the "${field.name}" array`
                        : `Define properties for the "${field.name}" object`}
                </div>
                <Badge variant="secondary" className="text-xs">
                    {properties.length} {properties.length === 1 ? 'property' : 'properties'}
                </Badge>
            </div>
            
            {properties.length === 0 ? (
                <div className="p-4 bg-muted/30 border border-dashed rounded-lg text-center">
                    <p className="text-sm text-muted-foreground">
                        No properties defined yet.
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    {properties.map((prop, index) => (
                        <div key={prop.id} className="border rounded-md p-3 space-y-2 bg-background">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-muted-foreground w-6">#{index + 1}</span>
                                <Input
                                    value={prop.name}
                                    onChange={(e) => handleUpdateProperty(prop.id, { name: e.target.value })}
                                    placeholder="property_name"
                                    disabled={disabled}
                                    className="h-8 text-sm flex-1"
                                />
                                <Select
                                    value={prop.type === 'array' && prop.items?.type === 'string' ? 'array_string' : prop.type === 'array' && prop.items?.type === 'number' ? 'array_number' : prop.type}
                                    onValueChange={(value) => {
                                        if (value === 'array_string') {
                                            handleUpdateProperty(prop.id, { type: 'array', items: { type: 'string' } });
                                        } else if (value === 'array_number') {
                                            handleUpdateProperty(prop.id, { type: 'array', items: { type: 'number' } });
                                        } else {
                                            handleUpdateProperty(prop.id, { type: value as JsonSchemaType });
                                        }
                                    }}
                                    disabled={disabled}
                                >
                                    <SelectTrigger className="h-8 w-[140px] text-xs">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="string" className="text-xs">Text</SelectItem>
                                        <SelectItem value="integer" className="text-xs">Integer</SelectItem>
                                        <SelectItem value="number" className="text-xs">Number</SelectItem>
                                        <SelectItem value="boolean" className="text-xs">True/False</SelectItem>
                                        <SelectItem value="array_string" className="text-xs">List of Text</SelectItem>
                                        <SelectItem value="array_number" className="text-xs">List of Numbers</SelectItem>
                                    </SelectContent>
                                </Select>
                                <div className="flex items-center gap-1">
                                    <Checkbox
                                        id={`nested-required-${prop.id}`}
                                        checked={prop.required}
                                        onCheckedChange={(checked) => handleUpdateProperty(prop.id, { required: !!checked })}
                                        disabled={disabled}
                                    />
                                    <Label htmlFor={`nested-required-${prop.id}`} className="text-xs cursor-pointer">
                                        Req
                                    </Label>
                                </div>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                    onClick={() => handleRemoveProperty(prop.id)}
                                    disabled={disabled}
                                    title="Remove property"
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                            
                            {prop.description !== undefined && (
                                <Textarea
                                    value={prop.description || ''}
                                    onChange={(e) => handleUpdateProperty(prop.id, { description: e.target.value })}
                                    placeholder="Property description (optional)"
                                    rows={2}
                                    disabled={disabled}
                                    className="text-xs resize-none"
                                />
                            )}
                            
                            {!prop.description && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-full text-xs"
                                    onClick={() => handleUpdateProperty(prop.id, { description: '' })}
                                    disabled={disabled}
                                >
                                    <PlusCircle className="h-3 w-3 mr-1" />
                                    Add Description
                                </Button>
                            )}
                        </div>
                    ))}
                </div>
            )}
            
            {!disabled && (
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full border-dashed hover:border-solid hover:bg-primary/5"
                    onClick={handleAddProperty}
                >
                    <PlusCircle className="h-4 w-4 mr-2" />
                    Add Property
                </Button>
            )}
        </div>
    );
};

// GraphFieldEditor has been replaced by GraphSchemaVisualEditor (imported from ./GraphSchemaVisualEditor)

export default AnnotationSchemaEditor; 