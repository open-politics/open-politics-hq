"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PlusIcon } from "lucide-react"
import { useWorkspaceStore } from "@/zustand_stores/storeWorkspace"
import { SchemaFieldInput } from "./SchemaFieldInput"
import { useClassificationSystem } from "@/hooks/useClassificationSystem"
import { FieldType, IntType, SchemeFormData, SchemeField, DictKeyDefinition, getFieldTypeDescription, SCHEME_TYPE_OPTIONS } from "@/lib/classification/types"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { SCHEMA_EXAMPLES } from "@/lib/schema-examples"
import { ChevronDown, ChevronUp } from "lucide-react"
import { ClassificationSchemeCreate } from "@/client/models"
import { HelpCircle } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

interface Field {
  name: string
  type: FieldType
  description: string
  config: {
    scale_min?: number
    scale_max?: number
    is_set_of_labels?: boolean
    labels?: string[]
    dict_keys?: DictKeyDefinition[]
    is_time_axis_hint?: boolean
  }
  request_justification?: boolean | null
  request_bounding_boxes?: boolean
  use_enum_for_labels?: boolean
}

interface SchemeFormProps {
  formData: SchemeFormData;
  setFormData: React.Dispatch<React.SetStateAction<SchemeFormData>>;
  showTutorial?: boolean;
  readOnly?: boolean;
  onSubmit?: () => void;
}

export function SchemeForm({ formData, setFormData, showTutorial = false, readOnly = false, onSubmit }: SchemeFormProps) {
  const { activeWorkspace } = useWorkspaceStore()
  const { createScheme } = useClassificationSystem({
    autoLoadSchemes: true
  })
  const [fields, setFields] = useState<Field[]>([])
  const [currentField, setCurrentField] = useState<SchemeField>({
    name: "",
    type: "str",
    description: "",
    config: {
      scale_min: 0,
      scale_max: 1,
      is_set_of_labels: false,
      labels: [],
      dict_keys: [],
      is_time_axis_hint: false
    },
    request_justification: null,
    request_bounding_boxes: false,
    use_enum_for_labels: false
  })
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)

  // Initialize fields from formData.fields when formData changes
  useEffect(() => {
    if (formData.fields && formData.fields.length > 0) {
      // Make sure we convert the fields to match our Field interface
      const convertedFields = formData.fields.map(field => ({
        name: field.name,
        type: field.type,
        description: field.description,
        config: {
          scale_min: field.config.scale_min,
          scale_max: field.config.scale_max,
          is_set_of_labels: field.config.is_set_of_labels,
          labels: field.config.labels ? [...field.config.labels] : [],
          dict_keys: field.config.dict_keys ? [...field.config.dict_keys] : [],
          is_time_axis_hint: field.config.is_time_axis_hint
        },
        request_justification: field.request_justification,
        request_bounding_boxes: field.request_bounding_boxes,
        use_enum_for_labels: field.use_enum_for_labels
      }));
      setFields(convertedFields);
    }
  }, [formData]);

  // Debug log for currentField
  useEffect(() => {
    console.log("Current field updated:", currentField);
  }, [currentField]);

  const addField = () => {
    console.log("Adding field:", currentField);
    
    const newFieldToAdd: Field = {
      name: currentField.name,
      type: currentField.type,
      description: currentField.description,
      config: {
        scale_min: currentField.config.scale_min,
        scale_max: currentField.config.scale_max,
        is_set_of_labels: currentField.config.is_set_of_labels,
        labels: currentField.config.labels ? [...currentField.config.labels] : [],
        dict_keys: currentField.config.dict_keys ? [...currentField.config.dict_keys] : [],
        is_time_axis_hint: currentField.config.is_time_axis_hint
      },
      request_justification: currentField.request_justification,
      request_bounding_boxes: currentField.request_bounding_boxes,
      use_enum_for_labels: currentField.use_enum_for_labels
    };
    
    console.log("New field to add:", newFieldToAdd);
    
    // Update both the local fields state and the formData
    setFields(prevFields => [...prevFields, newFieldToAdd]);
    setFormData(prevFormData => ({
      ...prevFormData,
      fields: [...prevFormData.fields, newFieldToAdd]
    }));
    
    // Reset the current field *after* it has been used
    setCurrentField({
      name: '',
      description: '',
      type: 'str',
      config: {
        scale_min: 0,
        scale_max: 1,
        is_set_of_labels: false,
        labels: [],
        dict_keys: [],
        is_time_axis_hint: false
      },
      request_justification: null,
      request_bounding_boxes: false,
      use_enum_for_labels: false
    });
    
    // Reset editing state
    setIsEditing(false);
  }

  const addLabel = (label: string) => {
    setCurrentField({
      ...currentField,
      config: {
        ...currentField.config,
        labels: [...(currentField.config.labels || []), label],
      },
    })
  }

  const addDictKey = (key: string, type: "str" | "int" | "float" | "bool") => {
    const newKey: DictKeyDefinition = { name: key, type };
    setCurrentField({
      ...currentField,
      config: {
        ...currentField.config,
        dict_keys: [...(currentField.config.dict_keys || []), newKey],
      },
    })
  }

  const handleFieldChange = (fieldData: SchemeField) => {
    console.log("Field data changed:", fieldData);
    
    setCurrentField({
      name: fieldData.name,
      type: fieldData.type,
      description: fieldData.description,
      config: {
        scale_min: fieldData.config.scale_min,
        scale_max: fieldData.config.scale_max,
        is_set_of_labels: fieldData.config.is_set_of_labels,
        labels: fieldData.config.labels ? [...fieldData.config.labels] : [],
        dict_keys: fieldData.config.dict_keys ? [...fieldData.config.dict_keys] : [],
        is_time_axis_hint: fieldData.config.is_time_axis_hint
      },
      request_justification: fieldData.request_justification,
      request_bounding_boxes: fieldData.request_bounding_boxes,
      use_enum_for_labels: fieldData.use_enum_for_labels
    });
  }

  return (
    <form 
      id="scheme-form"
      onSubmit={(e) => {
        e.preventDefault(); // Prevent form submission
        // Don't do anything here, let the parent component handle submission
      }}
      className="space-y-6"
    >
      {showTutorial && (
        <div className="bg-secondary/10 p-4 rounded-lg">
          <h3 className="font-semibold mb-2">
            {SCHEMA_EXAMPLES[formData.fields[0]?.type as keyof typeof SCHEMA_EXAMPLES]?.title}
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            {SCHEMA_EXAMPLES[formData.fields[0]?.type as keyof typeof SCHEMA_EXAMPLES]?.description}
          </p>
          
          <div className="space-y-4">
            {SCHEMA_EXAMPLES[formData.fields[0]?.type as keyof typeof SCHEMA_EXAMPLES]?.examples.map((example, idx) => (
              <div key={idx} className="border-l-2 border-primary/20 pl-4">
                <h4 className="font-medium">{example.name}</h4>
                <p className="text-sm text-muted-foreground">{example.description}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => setFormData({
                    ...formData,
                    name: example.name,
                    description: example.description,
                    model_instructions: example.modelInstructions,
                    fields: [{
                      name: example.name,
                      type: "List[str]",
                      description: example.description,
                      config: {
                        scale_min: example.scale_min,
                        scale_max: example.scale_max,
                        is_set_of_labels: example.is_set_of_labels,
                        labels: example.labels,
                        dict_keys: example.dict_keys,
                        is_time_axis_hint: example.is_time_axis_hint
                      }
                    }]
                  })}
                >
                  Use this template
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Basic Info Section */}
      <div className="space-y-4">
        <div>
          <Label htmlFor="modelName">Name</Label>
          <Input
            id="modelName"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g., PoliticalSentiment"
            readOnly={readOnly}
          />
        </div>
        <div>
          <Label htmlFor="modelDescription">Description</Label>
          <Textarea
            id="modelDescription"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="What does this classification scheme measure?"
            className="h-40"
            readOnly={readOnly}
          />
        </div>
      </div>

      {/* Fields Section - Visual Builder */}
      <div className="space-y-4">
        {/* Existing Fields */}
        <div className="space-y-2">
          {fields.map((field, index) => (
            <Card key={index} className="bg-secondary/5 hover:bg-secondary/10 transition-colors">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium">{field.name}</h4>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-secondary/20">
                      {field.type}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{field.description}</p>
                  {field.type === "int" && field.config.scale_min === 0 && field.config.scale_max === 1 && (
                    <p className="text-xs text-muted-foreground">
                      Yes/No (0/1)
                    </p>
                  )}
                  {field.type === "int" && field.config.scale_min !== undefined && field.config.scale_max !== undefined && (
                    <p className="text-xs text-muted-foreground">
                      Scale: {field.config.scale_min} to {field.config.scale_max}
                    </p>
                  )}
                  {field.type === "List[Dict[str, any]]" && field.config.is_set_of_labels && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {field.config.labels?.map((label, i) => (
                        <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-primary/10">
                          {label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button 
                    variant="ghost" 
                    size="sm"
                    className="text-primary hover:text-primary"
                    onClick={() => {
                      console.log("Editing field:", field);
                      console.log("Field type:", field.type);
                      console.log("Field config:", field.config);
                      console.log("Field is_set_of_labels:", field.config?.is_set_of_labels);
                      console.log("Field labels:", field.config?.labels);
                      console.log("Field dict_keys:", field.config?.dict_keys);
                      
                      // Create a properly structured field object for editing
                      const fieldForEditing: SchemeField = {
                        name: field.name,
                        type: field.type,
                        description: field.description,
                        config: {
                          scale_min: field.config?.scale_min ?? 0,
                          scale_max: field.config?.scale_max ?? 1,
                          is_set_of_labels: field.config?.is_set_of_labels === true,
                          labels: field.config?.labels ? [...field.config.labels] : [],
                          dict_keys: field.config?.dict_keys ? [...field.config.dict_keys] : [],
                          is_time_axis_hint: field.config?.is_time_axis_hint === true
                        },
                        request_justification: field.request_justification,
                        request_bounding_boxes: field.request_bounding_boxes,
                        use_enum_for_labels: field.use_enum_for_labels
                      };
                      
                      // Special handling for List[str] fields
                      if (field.type === "List[str]") {
                        // Force is_set_of_labels to true if we have labels
                        if (field.config?.labels && field.config.labels.length > 0) {
                          fieldForEditing.config.is_set_of_labels = true;
                          console.log("Setting is_set_of_labels to true because we have labels");
                        }
                        console.log("List[str] field for editing:", fieldForEditing);
                        console.log("Labels:", fieldForEditing.config.labels);
                      }
                      
                      // Special handling for List[Dict[str, any]] fields
                      if (field.type === "List[Dict[str, any]]") {
                        console.log("List[Dict] field dict_keys:", field.config?.dict_keys);
                        // Ensure dict_keys is properly mapped
                        if (field.config?.dict_keys && field.config.dict_keys.length > 0) {
                          const typedDictKeys: DictKeyDefinition[] = field.config.dict_keys.map(key => ({
                            name: key.name,
                            type: key.type
                          }));
                          fieldForEditing.config.dict_keys = typedDictKeys;
                          console.log("Dict keys after mapping:", fieldForEditing.config.dict_keys);
                        } else {
                          // Initialize with an empty array if no dict_keys are present
                          fieldForEditing.config.dict_keys = [];
                        }
                        console.log("List[Dict] field for editing:", fieldForEditing);
                      }
                      
                      console.log("Field for editing:", fieldForEditing);
                      
                      // Set the current field to the selected field for editing
                      setCurrentField(fieldForEditing);
                      
                      // Set editing state to true
                      setIsEditing(true);
                      
                      // Remove the field from the arrays
                      const newFields = fields.filter((_, i) => i !== index);
                      const newFormDataFields = formData.fields.filter((_, i) => i !== index);
                      
                      // Update both states
                      setFields(newFields);
                      setFormData({
                        ...formData,
                        fields: newFormDataFields
                      });

                      // Ensure the hint is carried over when editing
                      fieldForEditing.config.is_time_axis_hint = field.config?.is_time_axis_hint === true;
                    }}
                    disabled={readOnly}
                  >
                    Edit
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      // Create new arrays without the field at the specified index
                      const newFields = fields.filter((_, i) => i !== index);
                      const newFormDataFields = formData.fields.filter((_, i) => i !== index);
                      
                      // Update both states
                      setFields(newFields);
                      setFormData({
                        ...formData,
                        fields: newFormDataFields
                      });
                    }}
                    disabled={readOnly}
                  >
                    Remove
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Add Field Section */}
        <Card className="border-dashed">
          <CardContent className="p-4">
            <div className="space-y-4">
              <div className="grid grid-cols-[1fr,1fr,2fr] gap-4">
                <div>
                  <Label htmlFor="fieldName">Field Name</Label>
                  <Input
                    id="fieldName"
                    value={currentField.name}
                    onChange={(e) => setCurrentField({ ...currentField, name: e.target.value })}
                    placeholder="e.g., sentiment"
                  />
                </div>
                <div>
                  <Label htmlFor="fieldType">Type</Label>
                  <Select
                    value={currentField.type}
                    onValueChange={(value: FieldType) => setCurrentField({ ...currentField, type: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="str">Text</SelectItem>
                      <SelectItem value="int">Number</SelectItem>
                      <SelectItem value="List[str]">Multiple Choice</SelectItem>
                      <SelectItem value="List[Dict[str, any]]">Complex Structure</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="fieldDescription">Description</Label>
                  <Input
                    id="fieldDescription"
                    value={currentField.description}
                    onChange={(e) => setCurrentField({ ...currentField, description: e.target.value })}
                    placeholder="What does this field measure?"
                  />
                </div>
              </div>

              {/* Field Type Specific Options */}
              <div>
                <p className="text-xs text-muted-foreground mb-2">
                  {isEditing ? "Editing field: " + currentField.name : "Adding new field"}
                </p>
                {currentField.type === "List[str]" && (
                  <p className="text-xs text-muted-foreground mb-2">
                    is_set_of_labels: {currentField.config.is_set_of_labels ? "true" : "false"}, 
                    labels: {currentField.config.labels?.length || 0} items
                  </p>
                )}
                {currentField.type === "List[Dict[str, any]]" && (
                  <p className="text-xs text-muted-foreground mb-2">
                    dict_keys: {currentField.config.dict_keys?.length || 0} items
                  </p>
                )}
                <SchemaFieldInput
                  field={currentField}
                  onChange={(updatedField) => {
                    console.log("Field updated from SchemaFieldInput:", updatedField);
                    handleFieldChange(updatedField);
                  }}
                  onRemove={() => {
                    // Create new arrays without the last field
                    const newFields = fields.filter((_, i) => i !== fields.length - 1);
                    const newFormDataFields = formData.fields.filter((_, i) => i !== formData.fields.length - 1);
                    
                    // Update both states
                    setFields(newFields);
                    setFormData({
                      ...formData,
                      fields: newFormDataFields
                    });
                  }}
                  readOnly={readOnly}
                />
              </div>

              <div className="flex justify-end">
                <Button 
                  onClick={addField}
                  disabled={!currentField.name || !currentField.type || readOnly}
                >
                  {isEditing ? "Update Field" : "Add Field"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Preview Section - Collapsible */}
      {fields.length > 0 && (
        <div className="space-y-2">
          <Button
            variant="ghost"
            className="w-full justify-between"
            onClick={() => setIsPreviewOpen(!isPreviewOpen)}
            disabled={readOnly}
          >
            <span className="font-medium">Classification Structure Preview</span>
            {isPreviewOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
          
          {isPreviewOpen && (
            <Card className="bg-primary/5">
              <CardContent className="p-4">
                <div className="space-y-2 text-sm">
                  <p className="font-medium">{formData.name}</p>
                  <p className="text-muted-foreground">{formData.description}</p>
                  <div className="pl-4 border-l-2 border-primary/20 space-y-2 mt-2">
                    {fields.map((field, index) => (
                      <div key={index}>
                        <span className="font-medium">{field.name}</span>
                        <span className="text-muted-foreground ml-2">
                          ({getFieldTypeDescription(field as SchemeField)})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Scheme-level Advanced Settings */}
      <div className="space-y-3 pt-4 border-t">
        <h4 className="text-sm font-medium text-muted-foreground">Advanced Scheme Settings</h4>
        {/* Request Justifications Globally */}
        <div className="flex items-center space-x-3">
          <Switch
            id="request-justifications-globally"
            checked={formData.request_justifications_globally === true}
            onCheckedChange={(checked) => setFormData({ ...formData, request_justifications_globally: checked })}
            disabled={readOnly}
          />
          <Label htmlFor="request-justifications-globally" className="text-xs font-normal cursor-pointer flex items-center">
            Request Justifications Globally
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild><HelpCircle className="h-3 w-3 ml-1.5 cursor-help" /></TooltipTrigger>
                <TooltipContent><p className="text-xs max-w-xs">If enabled, justification will be requested for all applicable fields by default (can be overridden per field).</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Label>
        </div>
        {/* Default Thinking Budget */}
        <div>
          <Label htmlFor="default-thinking-budget" className="text-xs font-normal flex items-center mb-1">
            Default Thinking Budget (Optional)
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild><HelpCircle className="h-3 w-3 ml-1.5 cursor-help" /></TooltipTrigger>
                <TooltipContent><p className="text-xs max-w-xs">Set a default thinking token budget (0-24576) for fields requesting justification. 0 disables thinking unless overridden. Leave blank for model default.</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Label>
          <Input
            id="default-thinking-budget"
            type="number"
            placeholder="Model default (e.g., 1024)"
            value={formData.default_thinking_budget ?? ''}
            onChange={(e) => {
              const value = e.target.value;
              setFormData({ ...formData, default_thinking_budget: value === '' ? null : parseInt(value, 10) });
            }}
            readOnly={readOnly}
            min="0"
            max="24576"
            className="h-8 text-sm w-48"
          />
        </div>
        {/* Enable Image Analysis Globally */}
        <div className="flex items-center space-x-3">
          <Switch
            id="enable-image-analysis-globally"
            checked={formData.enable_image_analysis_globally === true}
            onCheckedChange={(checked) => setFormData({ ...formData, enable_image_analysis_globally: checked })}
            disabled={readOnly}
          />
          <Label htmlFor="enable-image-analysis-globally" className="text-xs font-normal cursor-pointer flex items-center">
            Enable Image Analysis Capabilities
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild><HelpCircle className="h-3 w-3 ml-1.5 cursor-help" /></TooltipTrigger>
                <TooltipContent><p className="text-xs max-w-xs">Indicates this scheme might involve image input. Allows fields to request bounding boxes.</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Label>
        </div>
      </div>
    </form>
  )
}

export const transformFormDataToApi = (formData: SchemeFormData): ClassificationSchemeCreate => ({
  name: formData.name,
  description: formData.description,
  fields: formData.fields.map(field => ({
    name: field.name,
    type: field.type,
    description: field.description,
    scale_min: field.config.scale_min,
    scale_max: field.config.scale_max,
    is_set_of_labels: field.config.is_set_of_labels,
    labels: field.config.labels,
    dict_keys: field.config.dict_keys,
    is_time_axis_hint: field.config.is_time_axis_hint
  })),
  model_instructions: formData.model_instructions,
  validation_rules: formData.validation_rules,
  default_thinking_budget: formData.default_thinking_budget,
  request_justifications_globally: formData.request_justifications_globally,
  enable_image_analysis_globally: formData.enable_image_analysis_globally
});
