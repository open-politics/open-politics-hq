import React, { useState, useEffect } from 'react';
import { SourceKind, sourceConfigurationRegistry, ValidationResult } from '@/lib/sourceConfigurationRegistry';
import { FormField } from './FormField';

interface SourceConfigurationFormProps {
  kind: SourceKind;
  initialConfig?: any;
  onChange: (config: any, isValid: boolean) => void;
}

export function SourceConfigurationForm({ kind, initialConfig = {}, onChange }: SourceConfigurationFormProps) {
  const [config, setConfig] = useState(initialConfig);
  const [validation, setValidation] = useState<ValidationResult>({ valid: true, errors: [] });

  const schema = sourceConfigurationRegistry.getSchema(kind);

  useEffect(() => {
    if (schema) {
      const validationResult = sourceConfigurationRegistry.validateConfiguration(kind, config);
      setValidation(validationResult);
      onChange(config, validationResult.valid);
    }
  }, [config, kind, onChange, schema]);

  if (!schema) {
    return <div className="text-red-500">Unsupported source kind: {kind}</div>;
  }

  const handleFieldChange = (fieldName: string, value: any) => {
    const newConfig = sourceConfigurationRegistry.setFieldValue(config, fieldName, value);
    setConfig(newConfig);
  };

  const getFieldValue = (fieldName: string) => {
    return sourceConfigurationRegistry.getFieldValue(config, fieldName);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900">{schema.uiSchema.title} Configuration</h3>
        <p className="text-sm text-gray-500">{schema.uiSchema.description}</p>
      </div>

      <div className="space-y-4">
        {schema.uiSchema.fields.map((field) => (
          <FormField
            key={field.name}
            field={field}
            value={getFieldValue(field.name)}
            onChange={(value) => handleFieldChange(field.name, value)}
            error={validation.errors.find(error => error.includes(field.name))}
          />
        ))}
      </div>

      {validation.errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <h4 className="text-sm font-medium text-red-800">Configuration Errors:</h4>
          <ul className="mt-2 text-sm text-red-700 list-disc list-inside">
            {validation.errors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}



