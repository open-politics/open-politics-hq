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
          // Validate field names are not empty
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
        <form onSubmit={handleSubmit} className="flex flex-col md:flex-row gap-4 h-full w-full">
          {/* Panel 1: Left - Schema Details */}
          <div className="w-full md:w-1/4 lg:w-1/5 border-r pr-4 flex flex-col gap-4">
              <ScrollArea className="flex-1">
                <div className="space-y-4">
                    <h3 className="text-lg font-medium">Schema Details</h3>
                    <div>
                        <Label htmlFor="scheme-name">Name</Label>
                        <Input
                            id="scheme-name"
                            value={formData.name}
                            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                            placeholder="e.g., Threat Assessment Report"
                            disabled={isLoadingSchemas || mode === 'watch'}
                        />
                         {formErrors.name && <p className="text-xs text-red-500 mt-1">{formErrors.name as string}</p>}
                    </div>
                    <div>
                        <Label htmlFor="scheme-description">Description</Label>
                        <Textarea
                            id="scheme-description"
                            value={formData.description}
                            onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                            placeholder="Describe the schema's purpose"
                            rows={3}
                            disabled={isLoadingSchemas || mode === 'watch'}
                        />
                    </div>
                    <div>
                        <Label htmlFor="model-instructions">Instructions</Label>
                        <Textarea
                           id="model-instructions"
                           value={formData.instructions || ''}
                           onChange={(e) => setFormData(prev => ({ ...prev, instructions: e.target.value }))}
                           placeholder="High-level instructions for the AI model..."
                           rows={5}
                           disabled={isLoadingSchemas || mode === 'watch'}
                           className="text-sm font-mono"
                        />
                    </div>
                </div>
              </ScrollArea>
              {mode !== 'watch' && (
                <div className="flex justify-end gap-3 pt-4 border-t">
                    <Button type="button" variant="outline" onClick={onClose} disabled={isLoadingSchemas}>Cancel</Button>
                    <Button type="submit" disabled={isLoadingSchemas}>
                        {isLoadingSchemas ? 'Saving...' : (mode === 'create' ? 'Create Schema' : 'Update Schema')}
                    </Button>
                </div>
              )}
          </div>

          {/* Panel 2: Center - Schema Structure */}
          <div className="w-full md:w-1/2 lg:w-2/5 border-r pr-4 flex flex-col">
             <div className="flex-shrink-0">
                <h3 className="text-lg font-medium mb-2">Schema Structure</h3>
                <p className="text-xs text-muted-foreground mb-4">Define sections and fields for the AI. Select an item to edit its properties.</p>
             </div>
             <ScrollArea className="flex-1 pr-2">
                <div className="space-y-4">
                    {formData.structure.map((section, sectionIndex) => (
                        <div key={section.id} className={cn(
                            "p-3 rounded-lg border",
                            selectedNodeId === section.id ? "border-blue-500 bg-blue-500/5" : "border-border"
                        )}>
                            <div 
                                className="flex items-center justify-between cursor-pointer"
                                onClick={() => setSelectedNodeId(section.id)}
                            >
                                <div className="flex items-center gap-2">
                                    <FileJson className="h-4 w-4 text-muted-foreground" />
                                    <span className="font-medium capitalize">{section.name}</span>
                                </div>
                                <Button 
                                    type="button" 
                                    variant="ghost" 
                                    size="icon" 
                                    className="h-6 w-6"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleRemoveSection(section.id);
                                    }}
                                    disabled={section.name === 'document'}
                                >
                                    <Trash2 className="h-4 w-4 text-muted-foreground hover:text-red-500"/>
                                </Button>
                            </div>
                            <div className="mt-3 space-y-2 pl-4 border-l ml-2">
                                {section.fields.map((field, fieldIndex) => (
                                    <div 
                                        key={field.id}
                                        className={cn(
                                            "flex items-center justify-between p-2 rounded-md cursor-pointer group",
                                            selectedNodeId === field.id ? "bg-primary/10" : "hover:bg-muted/50"
                                        )}
                                        onClick={() => setSelectedNodeId(field.id)}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm">{field.name}</span>
                                            {field.required && <span className="text-red-500 text-xs">*</span>}
                                        </div>
                                        <div className="flex items-center">
                                            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-sm mr-2">{field.type}</span>
                                            <Trash2 
                                                className="h-3.5 w-3.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 hover:text-red-500"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleRemoveField(section.id, field.id);
                                                }}
                                            />
                                        </div>
                                    </div>
                                ))}
                                 <Button 
                                    type="button" 
                                    variant="outline" 
                                    size="sm"
                                    className="mt-2"
                                    onClick={() => handleAddField(section.id)}
                                >
                                    <PlusCircle className="h-3 w-3 mr-1.5" />
                                    Add Field
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
                {formErrors.structure && <p className="text-xs text-red-500 mt-1">{formErrors.structure as string}</p>}
             </ScrollArea>
             <div className="pt-2 border-t mt-2">
                <Select onValueChange={(value: SchemaSection['name']) => {
                    if(value) handleAddSection(value);
                }} value="">
                    <SelectTrigger className="h-8 text-xs text-muted-foreground">
                        <SelectValue placeholder="Add another section..." />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="per_image" className="text-xs"><Image className="h-3 w-3 mr-2 inline-block"/>per_image</SelectItem>
                        <SelectItem value="per_audio" className="text-xs"><Mic className="h-3 w-3 mr-2 inline-block"/>per_audio</SelectItem>
                        <SelectItem value="per_video" className="text-xs"><Video className="h-3 w-3 mr-2 inline-block"/>per_video</SelectItem>
                    </SelectContent>
                </Select>
             </div>
          </div>

          {/* Panel 3: Right - Properties Inspector */}
          <div className="w-full md:w-1/4 lg:w-2/5">
             <h3 className="text-lg font-medium mb-2">Properties</h3>
             <p className="text-xs text-muted-foreground mb-4">Configure the selected section or field.</p>
             <ScrollArea className="h-full pr-2">
                 <PropertyInspector 
                    selectedNodeId={selectedNodeId}
                    formData={formData}
                    onFormChange={setFormData}
                    disabled={isLoadingSchemas || mode === 'watch'}
                 />
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
            <div className="flex flex-col items-center justify-center h-full text-center p-4 border border-dashed rounded-lg bg-muted/30">
                <FileJson className="h-10 w-10 text-muted-foreground mb-2" />
                <h4 className="font-semibold">Nothing Selected</h4>
                <p className="text-sm text-muted-foreground">Select a section or field from the structure panel to see its properties.</p>
            </div>
        );
    }
    
    if (node === 'section' && section) {
        return (
             <div className="space-y-4 p-4 border rounded-lg bg-card">
                <div className="flex items-center gap-2">
                    <FileJson className="h-5 w-5 text-muted-foreground" />
                    <h3 className="text-lg font-medium capitalize">{section.name}</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                    {section.name === 'document' 
                        ? 'This section defines the fields to be extracted from the main document content (e.g., the text of an article).'
                        : `This section defines fields to be extracted from each individual ${section.name.replace('per_', '')} associated with the main document.`
                    }
                </p>
             </div>
        );
    }
    
    if (node === 'field' && field) {
        return (
            <div className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="field-name">Field Name</Label>
                    <Input 
                        id="field-name"
                        value={field.name}
                        onChange={(e) => handleFieldUpdate({ name: e.target.value })}
                        placeholder="e.g., summary"
                        disabled={disabled}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="field-desc">Description</Label>
                    <Textarea 
                        id="field-desc"
                        value={field.description || ''}
                        onChange={(e) => handleFieldUpdate({ description: e.target.value })}
                        placeholder="A hint for the AI of what to extract."
                        rows={3}
                        disabled={disabled}
                        className="text-sm"
                    />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="field-type">Type</Label>
                    <Select 
                        value={getTypeValue()}
                        onValueChange={handleTypeChange}
                        disabled={disabled}
                    >
                        <SelectTrigger id="field-type">
                            <SelectValue placeholder="Select a type" />
                        </SelectTrigger>
                        <SelectContent>
                            {ADVANCED_SCHEME_TYPE_OPTIONS.map(opt => (
                                <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex items-center space-x-2 pt-3">
                    <Switch
                        id="field-required"
                        checked={field.required}
                        onCheckedChange={(checked) => handleFieldUpdate({ required: checked })}
                        disabled={disabled}
                    />
                    <Label htmlFor="field-required" className="cursor-pointer">Required Field</Label>
                </div>

                {/* --- Type-Specific Config --- */}
                {field.type === 'string' && (
                    <div className="space-y-2 pt-2 border-t mt-3">
                         <Label htmlFor="field-enum">Allowed Values (Optional)</Label>
                         <Textarea
                            id="field-enum"
                            value={(field.enum || []).join('\n')}
                            onChange={(e) => handleFieldUpdate({ enum: e.target.value.split('\n').filter(v => v) })}
                            placeholder="One value per line to restrict choices"
                            rows={3}
                            disabled={disabled}
                            className="text-sm"
                         />
                         <p className="text-xs text-muted-foreground">If you add values here, the AI will be forced to choose one of them.</p>
                    </div>
                )}
                {(field.type === 'object' || (field.type === 'array' && field.items?.type === 'object')) && (
                    <div className="space-y-2 pt-2 border-t mt-3">
                        <Label>Sub-fields</Label>
                        <div className="p-3 border border-dashed rounded-lg text-center">
                            <p className="text-sm text-muted-foreground">Recursive field definition is not yet implemented.</p>
                        </div>
                    </div>
                )}


                {/* --- Justification --- */}
                <Accordion type="single" collapsible className="w-full">
                  <AccordionItem value="justification">
                    <AccordionTrigger>Justification</AccordionTrigger>
                    <AccordionContent className="space-y-4 pt-2">
                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="justification-enabled"
                                checked={field.justification?.enabled ?? false}
                                onCheckedChange={(checked) => handleFieldUpdate({ justification: { ...field.justification, enabled: !!checked }})}
                                disabled={disabled}
                            />
                            <Label htmlFor="justification-enabled" className="cursor-pointer leading-none">
                                Request justification for this field
                            </Label>
                        </div>
                        {field.justification?.enabled && (
                            <div className="space-y-2">
                                <Label htmlFor="justification-prompt">Custom Prompt (Optional)</Label>
                                <Textarea
                                    id="justification-prompt"
                                    value={field.justification.custom_prompt || ''}
                                    onChange={(e) => handleFieldUpdate({ justification: { enabled: field.justification?.enabled ?? true, custom_prompt: e.target.value }})}
                                    placeholder="e.g., Explain step-by-step how you arrived at this summary."
                                    rows={3}
                                    disabled={disabled}
                                    className="text-sm"
                                />
                            </div>
                        )}
                        <div className="flex-shrink-0 h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                            {field.provider?.includes('anthropic') && <img src="/anthropic-logo.png" className="h-6 w-6" alt="Anthropic logo" />}
                            {field.provider?.includes('openai') && <img src="/openai-logo.png" className="h-6 w-6" alt="OpenAI logo" />}
                            {field.provider?.includes('google') && <img src="/google-logo.png" className="h-5 w-5" alt="Google logo" />}
                            {field.provider?.includes('groq') && <img src="/groq-logo.png" className="h-5 w-5" alt="Groq logo" />}
                            {field.provider?.includes('together') && <img src="/together-logo.png" className="h-5 w-5" alt="Together AI logo" />}
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 truncate">{field.model_name}</p>
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