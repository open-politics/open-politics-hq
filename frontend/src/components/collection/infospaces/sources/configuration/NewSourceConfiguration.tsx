'use client';

import React, { useState, useEffect } from 'react';
import { sourceConfigurationRegistry, SourceKind, FieldSchema } from '@/services/sourceConfigurationRegistry';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { SourceCreateRequest } from '@/client/schemas';
import { useSourceStore } from '@/zustand_stores/storeSources';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { Loader2 } from 'lucide-react';

interface NewSourceConfigurationProps {
  onSuccess: () => void;
}

const renderField = (field: FieldSchema, value: any, handleChange: (name: string, value: any) => void) => {
  switch (field.type) {
    case 'text':
    case 'url':
    case 'number':
      return <Input type={field.type} value={value || ''} onChange={(e) => handleChange(field.name, e.target.value)} placeholder={field.placeholder} required={field.required} />;
    case 'textarea':
      return <Textarea value={value || ''} onChange={(e) => handleChange(field.name, e.target.value)} placeholder={field.placeholder} required={field.required} />;
    case 'select':
      return (
        <Select onValueChange={(val) => handleChange(field.name, val)} value={value} required={field.required}>
          <SelectTrigger><SelectValue placeholder={field.placeholder} /></SelectTrigger>
          <SelectContent>
            {field.options?.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    case 'boolean':
        return <Switch checked={value} onCheckedChange={(val) => handleChange(field.name, val)} />;
    default:
      return null;
  }
};

export default function NewSourceConfiguration({ onSuccess }: NewSourceConfigurationProps) {
  const [selectedKind, setSelectedKind] = useState<SourceKind | null>(null);
  const [config, setConfig] = useState<any>({});
  const [name, setName] = useState('');
  const [monitoringEnabled, setMonitoringEnabled] = useState(false);
  const [schedule, setSchedule] = useState('0 * * * *');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { createSource } = useSourceStore();
  const { activeInfospace } = useInfospaceStore();

  const handleKindChange = (kind: SourceKind) => {
    setSelectedKind(kind);
    setConfig({});
    const schema = sourceConfigurationRegistry.getSchema(kind);
    if(schema) {
        setName(schema.uiSchema.title);
    }
  };

  const handleConfigChange = (fieldName: string, value: any) => {
    setConfig((prev: any) => ({ ...prev, [fieldName]: value }));
  };

  const handleSubmit = async () => {
    if (!selectedKind || !activeInfospace) {
      toast.error("Please select a source type and ensure an infospace is active.");
      return;
    }
    
    setIsSubmitting(true);
    
    const sourceData: SourceCreateRequest = {
      name: name,
      kind: selectedKind,
      details: config,
      enable_monitoring: monitoringEnabled,
      schedule: monitoringEnabled ? schedule : undefined,
    };

    try {
      const result = await createSource(sourceData);
      if (result) {
        toast.success(`Source "${result.name}" created successfully.`);
        onSuccess();
      }
    } finally {
        setIsSubmitting(false);
    }
  };

  const schema = selectedKind ? sourceConfigurationRegistry.getSchema(selectedKind) : null;
  const supportedKinds = sourceConfigurationRegistry.getSupportedKinds();

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Create New Source</CardTitle>
        <CardDescription>Configure a new data source for ingestion.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>Source Type</Label>
          <Select onValueChange={(value: SourceKind) => handleKindChange(value)}>
            <SelectTrigger><SelectValue placeholder="Select a source type..." /></SelectTrigger>
            <SelectContent>
              {supportedKinds.map(kind => (
                <SelectItem key={kind} value={kind}>
                  {sourceConfigurationRegistry.getSchema(kind)?.uiSchema.title || kind}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {schema && (
          <>
            <div className="space-y-2">
                <Label htmlFor="source-name">Source Name</Label>
                <Input id="source-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter a name for the source" />
            </div>

            {schema.uiSchema.fields.map(field => (
              <div key={field.name} className="space-y-2">
                <Label htmlFor={field.name}>{field.label}</Label>
                {renderField(field, config[field.name], handleConfigChange)}
                {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
              </div>
            ))}

            <div className="flex items-center space-x-2 pt-4">
              <Switch id="monitoring-enabled" checked={monitoringEnabled} onCheckedChange={setMonitoringEnabled} />
              <Label htmlFor="monitoring-enabled">Enable Monitoring</Label>
            </div>
            
            {monitoringEnabled && (
                <div className="space-y-2 pl-8">
                    <Label htmlFor="monitoring-schedule">Schedule (Cron)</Label>
                    <Input id="monitoring-schedule" value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="e.g., 0 * * * *" />
                    <p className="text-xs text-muted-foreground">
                        Define how often the source should be checked for new content.
                    </p>
                </div>
            )}
          </>
        )}
      </CardContent>
      <CardFooter>
        <Button onClick={handleSubmit} disabled={!selectedKind || isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isSubmitting ? 'Creating...' : 'Create Source'}
        </Button>
      </CardFooter>
    </Card>
  );
}
