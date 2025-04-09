import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ClassificationSchemeRead } from "@/client/models";
import { SchemeField, SchemeFormData } from "@/lib/classification/types";

interface SchemePreviewProps {
  scheme: SchemeFormData | ClassificationSchemeRead;
}

const isSchemeFormData = (scheme: SchemeFormData | ClassificationSchemeRead): scheme is SchemeFormData => {
  return 'fields' in scheme && 
         Array.isArray(scheme.fields) && 
         scheme.fields.length > 0 && 
         'config' in scheme.fields[0];
};

// Helper function to adapt a field to SchemeField format for getFieldTypeDescription
const adaptFieldForDescription = (field: any, isFormData: boolean): SchemeField => {
  if (isFormData) return field as SchemeField;
  
  return {
    name: field.name,
    type: field.type,
    description: field.description,
    config: {
      scale_min: field.scale_min,
      scale_max: field.scale_max,
      is_set_of_labels: field.is_set_of_labels,
      labels: field.labels,
      dict_keys: field.dict_keys
    }
  };
};

export function SchemePreview({ scheme }: SchemePreviewProps) {
  const isFormData = isSchemeFormData(scheme);
  
  return (
    <Card className="bg-primary/5">
      <CardContent className="p-4">
        <div className="space-y-2 text-sm">
          <p className="font-medium">{scheme.name}</p>
          <p className="text-muted-foreground">{scheme.description}</p>
          
          <div className="pl-4 border-l-2 border-primary/20 space-y-2 mt-2">
            {scheme.fields.map((field, index) => {
              const adaptedField = adaptFieldForDescription(field, isFormData);
              
              return (
                <div key={index}>
                  <span className="font-medium">{field.name}</span>
                  <span className="text-muted-foreground ml-2">
                    ({adaptedField.type}, {adaptedField.description})
                  </span>
                  
                  {((isFormData && field.config?.is_set_of_labels && field.config?.labels?.length > 0) ||
                   (!isFormData && field.is_set_of_labels && field.labels?.length > 0)) && (
                    <div className="mt-1 pl-4">
                      {(isFormData ? field.config.labels : field.labels)?.map((label, idx) => (
                        <span key={idx} className="text-xs mr-2 px-2 py-1 bg-primary/10 rounded-full">
                          {label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          
          {scheme.model_instructions && (
            <div className="mt-4">
              <p className="font-medium">Model Instructions:</p>
              <p className="text-muted-foreground whitespace-pre-wrap">
                {scheme.model_instructions}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}