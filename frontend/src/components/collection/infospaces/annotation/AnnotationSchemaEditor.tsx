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
  JsonSchemaType
} from "@/lib/annotations/types";
import { useTutorialStore } from "@/zustand_stores/storeTutorial";
import { Switch } from "@/components/ui/switch";
import AnnotationSchemaCard from "./AnnotationSchemaCard";
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Trash2, PlusCircle, Info, AlertTriangle, FileJson, FileText, Image, Mic, Video } from 'lucide-react';
import { AnnotationSchemaRead, AnnotationSchemaUpdate } from '@/client';
import { adaptSchemaReadToSchemaFormData, adaptSchemaFormDataToSchemaCreate } from '@/lib/annotations/adapters';
import { useToast } from "@/components/ui/use-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { nanoid } from 'nanoid';
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
      width="w-[95vw] max-w-[1400px]" // Greatly increased width for 3-panel layout
      height="h-[90vh]"
      className="border-2 border-schemes"
    >
        <form onSubmit={handleSubmit} className="flex flex-col lg:flex-row gap-6 h-full w-full overflow-hidden">
          {/* Panel 1: Left - Schema Details */}
          <div className="w-full lg:w-80 xl:w-96 flex flex-col gap-6">
              <div className="bg-card/50 border rounded-lg p-5">
                <div className="flex items-center gap-2 mb-4">
                  <FileText className="h-5 w-5 text-primary" />
                  <h3 className="text-lg font-semibold">Schema Details</h3>
                </div>
                <div className="space-y-4">
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
                             <AlertTriangle className="h-3 w-3" />
                             <p className="text-xs">{formErrors.name as string}</p>
                           </div>
                         )}
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="scheme-description" className="text-sm font-medium">Description</Label>
                        <Textarea
                            id="scheme-description"
                            value={formData.description}
                            onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                            placeholder="Brief description of what this schema analyzes..."
                            rows={3}
                            disabled={isLoadingSchemas || mode === 'watch'}
                            className="resize-none"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="model-instructions" className="text-sm font-medium">AI Instructions</Label>
                        <Textarea
                           id="model-instructions"
                           value={formData.instructions || ''}
                           onChange={(e) => setFormData(prev => ({ ...prev, instructions: e.target.value }))}
                           placeholder="Detailed instructions for the AI model on how to analyze content..."
                           rows={4}
                           disabled={isLoadingSchemas || mode === 'watch'}
                           className="text-sm font-mono resize-none"
                        />
                        <p className="text-xs text-muted-foreground">These instructions guide the AI's analysis approach.</p>
                    </div>
                </div>
              </div>
              
              {mode !== 'watch' && (
                <div className="bg-gradient-to-r from-primary/5 to-primary/10 border-2 border-primary/20 rounded-xl p-5 shadow-sm">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="bg-primary/10 p-2 rounded-full">
                            <div className={cn("h-3 w-3 rounded-full transition-colors", 
                              formData.name && formData.structure.some(s => s.fields.length > 0) 
                                ? "bg-green-500" 
                                : "bg-yellow-500"
                            )} />
                        </div>
                        <div>
                            <span className="text-base font-semibold">
                                {mode === 'create' ? 'Create Schema' : 'Save Changes'}
                            </span>
                            <p className="text-sm text-muted-foreground">
                                {formData.name && formData.structure.some(s => s.fields.length > 0) 
                                    ? 'Ready to save' 
                                    : 'Complete required fields'
                                }
                            </p>
                        </div>
                    </div>
                    <div className="flex gap-3">
                        <Button 
                            type="button" 
                            variant="outline" 
                            onClick={onClose} 
                            disabled={isLoadingSchemas}
                            className="flex-1 h-11 border-2 hover:border-primary/30"
                        >
                            Cancel
                        </Button>
                        <Button 
                            type="submit" 
                            disabled={isLoadingSchemas || (!formData.name || !formData.structure.some(s => s.fields.length > 0))}
                            className="flex-1 h-11 font-semibold shadow-sm"
                        >
                            {isLoadingSchemas ? (
                                <div className="flex items-center gap-2">
                                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                    Saving...
                                </div>
                            ) : (
                                mode === 'create' ? 'Create Schema' : 'Update Schema'
                            )}
                        </Button>
                    </div>
                </div>
              )}
          </div>

          {/* Panel 2: Center - Schema Structure */}
          <div className="flex-1 min-w-0 flex flex-col">
             <div className="bg-card/30 border rounded-lg p-4 mb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileJson className="h-5 w-5 text-primary" />
                    <h3 className="text-lg font-semibold">Schema Structure</h3>
                  </div>
                  <div className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full">
                    {formData.structure.reduce((total, section) => total + section.fields.length, 0)} total fields
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mt-2">Define sections and fields for the AI. Click any item to edit its properties.</p>
             </div>
             
             <ScrollArea className="flex-1">
                <div className="space-y-3">
                    {formData.structure.map((section, sectionIndex) => (
                        <div key={section.id} className={cn(
                            "rounded-lg border-2 transition-all duration-200",
                            selectedNodeId === section.id 
                              ? "border-primary bg-primary/5 shadow-md" 
                              : "border-border bg-card/50 hover:border-primary/30 hover:shadow-sm"
                        )}>
                            <div 
                                className="flex items-center justify-between p-4 cursor-pointer group"
                                onClick={() => setSelectedNodeId(section.id)}
                            >
                                <div className="flex items-center gap-3 flex-1">
                                    {section.name === 'document' ? (
                                        <FileText className="h-5 w-5 text-blue-600" />
                                    ) : section.name === 'per_image' ? (
                                        <Image className="h-5 w-5 text-green-600" />
                                    ) : section.name === 'per_audio' ? (
                                        <Mic className="h-5 w-5 text-purple-600" />
                                    ) : (
                                        <Video className="h-5 w-5 text-orange-600" />
                                    )}
                                    <div>
                                        <span className="font-semibold text-base capitalize">
                                            {section.name.replace('per_', '')} Analysis
                                        </span>
                                        <div className="flex items-center gap-2 mt-0.5">
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
                                        className="h-8 w-8 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-opacity"
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
                                <div className="px-4 pb-4">
                                    <div className="pl-8 space-y-1 border-l-2 border-muted ml-2">
                                        {section.fields.map((field, fieldIndex) => (
                                            <div 
                                                key={field.id}
                                                className={cn(
                                                    "flex items-center justify-between p-3 rounded-md cursor-pointer group transition-all duration-150",
                                                    selectedNodeId === field.id 
                                                      ? "bg-primary/15 border border-primary/30 shadow-sm" 
                                                      : "hover:bg-muted/70 border border-transparent hover:border-border"
                                                )}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectedNodeId(field.id);
                                                }}
                                            >
                                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-medium truncate">{field.name}</span>
                                                        {field.required && (
                                                            <span className="text-destructive text-sm font-bold shrink-0" title="Required field">*</span>
                                                        )}
                                                    </div>
                                                    {field.description && (
                                                        <span className="text-xs text-muted-foreground truncate max-w-40">
                                                            {field.description}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <span className="text-xs bg-muted text-muted-foreground px-2.5 py-1 rounded-full font-mono">
                                                        {field.type === 'array' && field.items ? `${field.items.type}[]` : field.type}
                                                    </span>
                                                    {mode !== 'watch' && (
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-7 w-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-opacity"
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
                                <div className="px-4 pb-4">
                                    <Button 
                                        type="button" 
                                        variant="outline" 
                                        size="sm"
                                        className="w-full h-9 border-dashed hover:border-solid hover:bg-primary/5 hover:border-primary/30 transition-all"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleAddField(section.id);
                                        }}
                                    >
                                        <PlusCircle className="h-4 w-4 mr-2" />
                                        Add Field to {section.name.replace('per_', '').charAt(0).toUpperCase() + section.name.replace('per_', '').slice(1)}
                                    </Button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
                {formErrors.structure && (
                    <div className="flex items-center gap-2 text-destructive mt-3 p-3 bg-destructive/5 rounded-lg border border-destructive/20">
                        <AlertTriangle className="h-4 w-4" />
                        <p className="text-sm">{formErrors.structure as string}</p>
                    </div>
                )}
             </ScrollArea>
             
             {mode !== 'watch' && (
                 <div className="bg-card/30 border rounded-lg p-4 mt-4">
                    <div className="flex items-center gap-2 mb-3">
                        <PlusCircle className="h-4 w-4 text-primary" />
                        <Label className="text-sm font-semibold">Add Media Analysis</Label>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
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
                                    "h-12 flex-col gap-1 border-dashed hover:border-solid transition-all",
                                    mediaType.disabled 
                                        ? "opacity-50 cursor-not-allowed" 
                                        : "hover:bg-primary/5 hover:border-primary/30"
                                )}
                                onClick={() => handleAddSection(mediaType.value as SchemaSection['name'])}
                            >
                                <mediaType.icon className={cn("h-4 w-4", mediaType.color)} />
                                <span className="text-xs font-medium">{mediaType.label}</span>
                            </Button>
                        ))}
                    </div>
                 </div>
             )}
          </div>

          {/* Panel 3: Right - Properties Inspector */}
          <div className="w-full lg:w-80 xl:w-96 flex flex-col">
             <div className="bg-card/30 border rounded-lg p-4 mb-4">
                <div className="flex items-center gap-2">
                  <Info className="h-5 w-5 text-primary" />
                  <h3 className="text-lg font-semibold">Properties</h3>
                </div>
                <p className="text-sm text-muted-foreground mt-2">Configure the selected section or field.</p>
             </div>
             <ScrollArea className="flex-1 pr-2">
                 <div className="space-y-4 pb-4">
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
                <Alert variant="destructive" className="absolute bottom-4 left-4 right-4">
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
        
        if (value.startsWith('array_')) {
            update.type = 'array';
            const itemType = value.split('_')[1] as JsonSchemaType;
            update.items = { type: itemType };
            if (itemType === 'object') {
                update.items.properties = [];
            }
        } else {
            update.type = value as JsonSchemaType;
            delete update.items; // Remove items if not an array
        }
        
        if (update.type === 'object') {
            update.properties = field.properties || [];
        } else {
            delete update.properties;
        }

        handleFieldUpdate(update);
    }
    
    const getTypeValue = (): string => {
        if(field?.type === 'array' && field.items) {
            return `array_${field.items.type}`;
        }
        return field?.type || 'string';
    }

    if (!node) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-center p-6 border-2 border-dashed rounded-xl bg-muted/20">
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
             <div className={cn("space-y-4 p-5 border-2 rounded-xl", sectionInfo.color)}>
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
                <div className="bg-card/50 border-2 rounded-xl p-4">
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
                    </div>

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

                  {(field.type === 'object' || (field.type === 'array' && field.items?.type === 'object')) && (
                    <AccordionItem value="object-config" className="border rounded-lg px-3">
                      <AccordionTrigger className="text-sm font-semibold py-3">
                        Object Structure
                      </AccordionTrigger>
                      <AccordionContent className="pb-3">
                        <div className="p-4 bg-muted/30 border border-dashed rounded-lg text-center">
                          <p className="text-sm text-muted-foreground">
                            Nested object configuration is coming soon.
                          </p>
                        </div>
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
                              onCheckedChange={(checked) => handleFieldUpdate({ justification: { ...field.justification, enabled: !!checked }})}
                              disabled={disabled}
                            />
                          </div>
                        </div>
                        
                        {field.justification?.enabled && (
                          <div className="space-y-3">
                            <div className="space-y-2">
                              <Label htmlFor="justification-prompt" className="text-sm font-medium">
                                Custom Prompt (Optional)
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
                                Custom instructions for how the AI should justify this field.
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

export default AnnotationSchemaEditor; 