import React from "react";
import { AnnotationSchemaRead, FieldJustificationConfig } from "@/client";
import { AdvancedSchemeField, AnnotationSchemaFormData as SchemeFormData } from "@/lib/annotations/types";
import { Badge } from "@/components/ui/badge";
import { 
  Type, 
  Hash, 
  List, 
  FileText, 
  CheckSquare, 
  AlertCircle,
  Info,
  Tag,
  Settings,
  HelpCircle,
  MessageSquare
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface SchemePreviewProps {
  scheme: SchemeFormData | AnnotationSchemaRead;
}

const isSchemeFormData = (scheme: SchemeFormData | AnnotationSchemaRead): scheme is SchemeFormData => {
  return 'structure' in scheme && 
         Array.isArray(scheme.structure) && 
         scheme.structure.length > 0;
};

// Helper function to get justification config for a field
const getJustificationConfig = (
  fieldName: string, 
  scheme: SchemeFormData | AnnotationSchemaRead
): { enabled: boolean; custom_prompt?: string | null } | null => {
  if (isSchemeFormData(scheme)) {
    // For form data, check the field's justification property
    const allFields = scheme.structure.flatMap(section => section.fields);
    const field = allFields.find(f => f.name === fieldName);
    if (field?.justification?.enabled) {
      return {
        enabled: true,
        custom_prompt: field.justification.custom_prompt || null
      };
    }
  } else {
    // For API schema data, check field_specific_justification_configs
    const configs = scheme.field_specific_justification_configs;
    if (configs && configs[fieldName]) {
      return configs[fieldName];
    }
  }
  return null;
};

// Enhanced field type icons with better styling
const FieldTypeIcon = ({ type }: { type: string }) => {
  switch (type) {
    case 'string': return <Type className="h-4 w-4 text-blue-600" />;
    case 'number': 
    case 'integer': return <Hash className="h-4 w-4 text-green-600" />;
    case 'boolean': return <CheckSquare className="h-4 w-4 text-purple-600" />;
    case 'array': return <List className="h-4 w-4 text-orange-600" />;
    case 'object': return <FileText className="h-4 w-4 text-red-600" />;
    default: return <Type className="h-4 w-4 text-gray-500" />;
  }
};

const formatFieldType = (type: string): string => {
  switch (type) {
    case 'string': return 'Text';
    case 'number': return 'Number';
    case 'integer': return 'Integer';
    case 'boolean': return 'True/False';
    case 'array': return 'List';
    case 'object': return 'Object';
    default: return type.charAt(0).toUpperCase() + type.slice(1);
  }
};

// Enhanced field display component
const FieldCard = ({ field, depth = 0, scheme }: { field: any; depth?: number; scheme?: SchemeFormData | AnnotationSchemaRead }) => {
  const indentClass = depth > 0 ? `ml-${depth * 3}` : '';
  
  // Get justification config for this field
  const justificationConfig = scheme ? getJustificationConfig(field.name, scheme) : null;
  
  return (
    <div className={`py-2 ${indentClass} ${depth > 0 ? 'border-l-2 border-border/30 pl-3' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <FieldTypeIcon type={field.type} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="font-medium text-sm truncate">{field.name}</h4>
              <Badge variant="outline" className="text-xs h-5">
                {formatFieldType(field.type)}
              </Badge>
              {field.required && (
                <Badge variant="destructive" className="text-xs h-5">
                  Required
                </Badge>
              )}
              {justificationConfig?.enabled && (
                <TooltipProvider delayDuration={100}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1">
                        <Badge variant="secondary" className="text-xs h-5 bg-indigo-100 text-indigo-700 border-indigo-200">
                          <HelpCircle className="h-3 w-3 mr-1" />
                          Justification
                        </Badge>
                        {justificationConfig.custom_prompt && (
                          <MessageSquare className="h-3 w-3 text-indigo-600" />
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" align="start" className="max-w-sm z-[1001]">
                      <div className="space-y-1">
                        <p className="text-xs font-semibold">Justification Enabled</p>
                        <p className="text-xs text-muted-foreground">
                          AI will provide reasoning for this field's values
                        </p>
                        {justificationConfig.custom_prompt && (
                          <div className="pt-1 border-t">
                            <p className="text-xs font-semibold mb-1">Custom Prompt:</p>
                            <p className="text-xs bg-muted p-1 rounded text-wrap break-words">
                              {justificationConfig.custom_prompt}
                            </p>
                          </div>
                        )}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            {field.description && (
              <p className="text-xs text-muted-foreground mt-1">{field.description}</p>
            )}
          </div>
        </div>
      </div>

      {/* Show enum options for string fields with choices */}
      {field.enum && field.enum.length > 0 && (
        <div className="mt-2 ml-6">
          <div className="flex items-center gap-1 mb-1">
            <Tag className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">Options:</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {field.enum.map((option: string, idx: number) => (
              <Badge key={idx} variant="secondary" className="text-xs h-5">
                {option}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Show labels for set of labels fields */}
      {field.labels && field.labels.length > 0 && (
        <div className="mt-2 ml-6">
          <div className="flex items-center gap-1 mb-1">
            <Tag className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">Labels:</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {field.labels.map((label: string, idx: number) => (
              <Badge key={idx} variant="outline" className="text-xs h-5 bg-primary/5">
                {label}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Show array item details */}
      {field.type === 'array' && field.items && (
        <div className="mt-2 ml-6">
          <div className="flex items-center gap-1 mb-1">
            <List className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">Array of:</span>
          </div>
          <FieldCard field={{ ...field.items, name: `${field.name} item` }} depth={depth + 1} scheme={scheme} />
        </div>
      )}

      {/* Show object properties */}
      {field.type === 'object' && field.properties && field.properties.length > 0 && (
        <div className="mt-2 ml-6">
          <div className="flex items-center gap-1 mb-1">
            <FileText className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">Properties:</span>
          </div>
          <div className="space-y-1">
            {field.properties.map((prop: any, idx: number) => (
              <FieldCard key={idx} field={prop} depth={depth + 1} scheme={scheme} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// Component to parse and display JSON Schema structure
const JsonSchemaFields = ({ outputContract, scheme }: { outputContract: any; scheme?: SchemeFormData | AnnotationSchemaRead }) => {
  if (!outputContract?.properties) return null;

  const parseProperties = (properties: any, prefix = '', skipPrefix = false): any[] => {
    return Object.entries(properties).map(([key, value]: [string, any]) => {
      const field = {
        name: skipPrefix ? key : (prefix ? `${prefix}.${key}` : key),
        type: value.type || 'unknown',
        description: value.description || value.title || '',
        required: false, // Would need to check parent required array
        enum: value.enum,
        labels: value.labels,
        items: value.items,
        properties: value.properties ? parseProperties(value.properties, skipPrefix ? key : (prefix ? `${prefix}.${key}` : key)) : undefined
      };
      return field;
    });
  };

  // If there's a single top-level "document" object, unwrap it and show its properties directly
  const properties = outputContract.properties;
  if (properties.document && properties.document.type === 'object' && properties.document.properties && Object.keys(properties).length === 1) {
    const fields = parseProperties(properties.document.properties, '', true);
    return (
      <div className="space-y-1">
        {fields.map((field, idx) => (
          <FieldCard key={idx} field={field} scheme={scheme} />
        ))}
      </div>
    );
  }

  // Otherwise show all properties normally
  const fields = parseProperties(properties);
  return (
    <div className="space-y-1">
      {fields.map((field, idx) => (
        <FieldCard key={idx} field={field} scheme={scheme} />
      ))}
    </div>
  );
};

export function SchemePreview({ scheme }: SchemePreviewProps) {
  const isFormData = isSchemeFormData(scheme);
  
  // Simple field counting that matches the rest of the system
  const fieldCount = isFormData ? 
    scheme.structure?.reduce((total, section) => total + section.fields.length, 0) || 0 : 
    Object.keys((scheme.output_contract as any)?.properties || {}).length;
  
  return (
    <div className="space-y-3">
      {/* Schema Name & Description */}
      <div className="space-y-1">
        <h3 className="font-medium text-base">{scheme.name}</h3>
        {scheme.description && (
          <p className="text-sm text-muted-foreground">{scheme.description}</p>
        )}
      </div>

      {/* Metadata */}
      {!isFormData && (
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-green-500" />
            <span className="text-muted-foreground">Fields:</span>
            <Badge variant="secondary">{fieldCount}</Badge>
          </div>
          {(scheme as AnnotationSchemaRead).id && (
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-blue-500" />
              <span className="text-muted-foreground">ID:</span>
              <span className="text-sm">{(scheme as AnnotationSchemaRead).id}</span>
            </div>
          )}
          {(scheme as AnnotationSchemaRead).annotation_count !== undefined && (
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-purple-500" />
              <span className="text-muted-foreground">Annotations:</span>
              <span className="text-sm">{(scheme as AnnotationSchemaRead).annotation_count}</span>
            </div>
          )}
        </div>
      )}

      {/* Fields Section */}
      <div className="space-y-2">
        {fieldCount > 0 ? (
          isFormData ? (
            // Display form data fields from structure
            scheme.structure && scheme.structure.length > 0 ? (
              scheme.structure.map((section, sectionIdx) => (
                <div key={section.id || sectionIdx} className="space-y-2">
                  <div className="flex items-center gap-2 pb-1 border-b">
                    <Badge variant="secondary" className="text-xs h-5">
                      {section.name}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {section.fields.length} field{section.fields.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {section.fields.map((field, fieldIdx) => (
                      <FieldCard key={field.id || fieldIdx} field={field} scheme={scheme} />
                    ))}
                  </div>
                </div>
              ))
            ) : null
          ) : (
            // Display JSON schema fields
            <JsonSchemaFields outputContract={scheme.output_contract} scheme={scheme} />
          )
        ) : (
          <div className="text-center py-4 text-muted-foreground">
            <AlertCircle className="h-6 w-6 mx-auto mb-2" />
            <p>No fields defined</p>
          </div>
        )}
      </div>

      {/* Instructions Section */}
      {scheme.instructions && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileText className="h-4 w-4" />
            Model Instructions
          </div>
          <div className="bg-muted/30 rounded-lg p-3">
            <pre className="text-sm whitespace-pre-wrap font-mono text-muted-foreground">
              {scheme.instructions}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}