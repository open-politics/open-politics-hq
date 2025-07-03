import React from 'react';
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";

// This component has been replaced by the Advanced Schema Builder
// in AnnotationSchemaEditor.tsx
export function SchemaFieldInput() {
  return (
    <Alert>
      <Info className="h-4 w-4" />
      <AlertDescription>
        This component has been replaced by the new Advanced Schema Builder. 
        Please use the AnnotationSchemaEditor component instead.
      </AlertDescription>
    </Alert>
  );
} 