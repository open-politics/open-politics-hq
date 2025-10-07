'use client';

import React, { useState, useEffect } from 'react';
import { sourceConfigurationRegistry, SourceKind, FieldSchema } from '@/lib/sourceConfigurationRegistry';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { SourceCreateRequest } from '@/client/types.gen';
import { useSourceStore } from '@/zustand_stores/storeSources';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { 
  Loader2, 
  Rss, 
  Search, 
  Globe, 
  FileText, 
  Info,
  Settings,
  Clock,
  Target,
  FolderOpen
} from 'lucide-react';

interface UnifiedSourceConfigurationProps {
  onSuccess: () => void;
  defaultKind?: SourceKind;
}

const sourceKindIcons = {
  'rss': Rss,
  'search': Search,
  'url_list': Globe,
  'site_discovery': Globe,
  'upload': FileText,
};

const sourceKindDescriptions = {
  'rss': 'Monitor RSS feeds for new articles and content updates',
  'search': 'Create search queries that run automatically to find new content',
  'url_list': 'Monitor a specific list of URLs for content changes',
  'site_discovery': 'Automatically discover and monitor content from entire websites',
  'upload': 'Upload files directly for processing and analysis'
};

const renderField = (field: FieldSchema, value: any, handleChange: (name: string, value: any) => void, errors: string[]) => {
  const hasError = errors.some(error => error.includes(field.name));
  const errorMessage = errors.find(error => error.includes(field.name));

  const baseClassName = `w-full ${hasError ? 'border-red-500 focus:ring-red-500' : ''}`;

  switch (field.type) {
    case 'text':
    case 'url':
      return (
        <div className="space-y-2">
          <Input 
            type={field.type === 'url' ? 'url' : 'text'} 
            value={value || ''} 
            onChange={(e) => handleChange(field.name, e.target.value)} 
            placeholder={field.placeholder} 
            required={field.required}
            className={baseClassName}
          />
          {hasError && <p className="text-xs text-red-500">{errorMessage}</p>}
        </div>
      );
    case 'number':
      return (
        <div className="space-y-2">
          <Input 
            type="number" 
            value={value || ''} 
            onChange={(e) => handleChange(field.name, parseInt(e.target.value) || 0)} 
            placeholder={field.placeholder} 
            required={field.required}
            min={field.validation?.min}
            max={field.validation?.max}
            className={baseClassName}
          />
          {hasError && <p className="text-xs text-red-500">{errorMessage}</p>}
        </div>
      );
    case 'textarea':
      return (
        <div className="space-y-2">
          <Textarea 
            value={value || ''} 
            onChange={(e) => handleChange(field.name, e.target.value)} 
            placeholder={field.placeholder} 
            required={field.required}
            className={baseClassName}
            rows={4}
          />
          {hasError && <p className="text-xs text-red-500">{errorMessage}</p>}
        </div>
      );
    case 'select':
      return (
        <div className="space-y-2">
          <Select onValueChange={(val) => handleChange(field.name, val)} value={value} required={field.required}>
            <SelectTrigger className={baseClassName}>
              <SelectValue placeholder={field.placeholder} />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasError && <p className="text-xs text-red-500">{errorMessage}</p>}
        </div>
      );
    case 'boolean':
      return (
        <div className="flex items-center space-x-2">
          <Switch 
            checked={value || false} 
            onCheckedChange={(val) => handleChange(field.name, val)} 
          />
          <Label className="text-sm">{field.label}</Label>
        </div>
      );
    case 'multiselect':
      return (
        <div className="space-y-2">
          <Textarea 
            value={Array.isArray(value) ? value.join(', ') : ''} 
            onChange={(e) => {
              const values = e.target.value.split(',').map(v => v.trim()).filter(v => v);
              handleChange(field.name, values);
            }} 
            placeholder={field.placeholder} 
            className={baseClassName}
            rows={3}
          />
          <p className="text-xs text-muted-foreground">Separate multiple values with commas</p>
          {hasError && <p className="text-xs text-red-500">{errorMessage}</p>}
        </div>
      );
    default:
      return null;
  }
};

export default function UnifiedSourceConfiguration({ onSuccess, defaultKind }: UnifiedSourceConfigurationProps) {
  const [selectedKind, setSelectedKind] = useState<SourceKind | null>(defaultKind || null);
  const [config, setConfig] = useState<any>({});
  const [name, setName] = useState('');
  const [monitoringEnabled, setMonitoringEnabled] = useState(false);
  const [schedule, setSchedule] = useState('0 * * * *');
  const [targetBundleId, setTargetBundleId] = useState<number | undefined>();
  const [targetBundleName, setTargetBundleName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const { createSource } = useSourceStore();
  const { activeInfospace } = useInfospaceStore();
  const { bundles, fetchBundles } = useBundleStore();

  // Load bundles when component mounts
  useEffect(() => {
    if (activeInfospace?.id) {
      fetchBundles(activeInfospace.id);
    }
  }, [activeInfospace?.id, fetchBundles]);

  const handleKindChange = (kind: SourceKind) => {
    setSelectedKind(kind);
    setConfig({});
    setValidationErrors([]);
    const schema = sourceConfigurationRegistry.getSchema(kind);
    if (schema) {
      setName(schema.uiSchema.title);
      
      // Initialize search_config for search sources
      if (kind === 'search') {
        setConfig({
          search_config: {
            query: '',
            provider: 'tavily',
            max_results: 10
          }
        });
      }
    }
  };

  const handleConfigChange = (fieldName: string, value: any) => {
    setConfig((prev: any) => {
      const newConfig = sourceConfigurationRegistry.setFieldValue(prev, fieldName, value);
      return newConfig;
    });
    // Clear validation errors for this field
    setValidationErrors(prev => prev.filter(error => !error.includes(fieldName)));
  };

  const validateForm = (): boolean => {
    const errors: string[] = [];
    
    if (!name.trim()) {
      errors.push('Source name is required');
    }
    
    if (!selectedKind) {
      errors.push('Please select a source type');
    }
    
    if (selectedKind) {
      const validationResult = sourceConfigurationRegistry.validateConfiguration(selectedKind, config);
      errors.push(...validationResult.errors);
    }
    
    setValidationErrors(errors);
    return errors.length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      toast.error('Please fix the validation errors before submitting');
      return;
    }

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
      target_bundle_id: targetBundleId,
      target_bundle_name: targetBundleName || undefined,
    };

    try {
      const result = await createSource(sourceData);
      if (result) {
        toast.success(`Source "${result.name}" created successfully.`);
        onSuccess();
      }
    } catch (error) {
      toast.error(`Failed to create source: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const schema = selectedKind ? sourceConfigurationRegistry.getSchema(selectedKind) : null;
  const supportedKinds = sourceConfigurationRegistry.getSupportedKinds();

  return (
    <div className="w-full max-w-4xl mx-auto">
      <Tabs defaultValue="configure" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="configure" className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Configure
          </TabsTrigger>
          <TabsTrigger value="monitoring" className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Monitoring
          </TabsTrigger>
        </TabsList>

        <TabsContent value="configure" className="space-y-6">
          {/* Source Type Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                Source Type
              </CardTitle>
              <CardDescription>
                Choose the type of content source you want to create
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {supportedKinds.map(kind => {
                  const kindSchema = sourceConfigurationRegistry.getSchema(kind);
                  const IconComponent = sourceKindIcons[kind] || FileText;
                  const isSelected = selectedKind === kind;

                  return (
                    <Card 
                      key={kind} 
                      className={`cursor-pointer transition-colors hover:bg-muted/50 ${
                        isSelected ? 'ring-2 ring-primary bg-primary/5' : ''
                      }`}
                      onClick={() => handleKindChange(kind)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className={`p-2 rounded-lg ${
                            isSelected ? 'bg-primary/10' : 'bg-muted'
                          }`}>
                            <IconComponent className={`h-5 w-5 ${
                              isSelected ? 'text-primary' : 'text-muted-foreground'
                            }`} />
                          </div>
                          <div className="flex-1">
                            <h3 className="font-medium">{kindSchema?.uiSchema.title || kind}</h3>
                            <p className="text-sm text-muted-foreground mt-1">
                              {sourceKindDescriptions[kind] || kindSchema?.uiSchema.description}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Configuration Form */}
          {schema && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  {schema.uiSchema.title} Configuration
                </CardTitle>
                <CardDescription>
                  {schema.uiSchema.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Source Name */}
                <div className="space-y-2">
                  <Label htmlFor="source-name">
                    Source Name <span className="text-red-500">*</span>
                  </Label>
                  <Input 
                    id="source-name" 
                    value={name} 
                    onChange={(e) => setName(e.target.value)} 
                    placeholder="Enter a descriptive name for this source"
                    className={validationErrors.some(e => e.includes('name')) ? 'border-red-500' : ''}
                  />
                  {validationErrors.some(e => e.includes('name')) && (
                    <p className="text-xs text-red-500">
                      {validationErrors.find(e => e.includes('name'))}
                    </p>
                  )}
                </div>

                {/* Dynamic Fields */}
                <div className="space-y-4">
                  {schema.uiSchema.fields.map(field => (
                    <div key={field.name} className="space-y-2">
                      <Label htmlFor={field.name} className="flex items-center gap-2">
                        {field.label}
                        {field.required && <span className="text-red-500">*</span>}
                        {field.help && (
                          <div className="group relative">
                            <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-black text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                              {field.help}
                            </div>
                          </div>
                        )}
                      </Label>
                      {renderField(field, sourceConfigurationRegistry.getFieldValue(config, field.name), handleConfigChange, validationErrors)}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="monitoring" className="space-y-6">
          {schema && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Monitoring & Automation
                </CardTitle>
                <CardDescription>
                  Configure automatic monitoring and content ingestion schedules
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Enable Monitoring */}
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <h4 className="font-medium">Enable Monitoring</h4>
                    <p className="text-sm text-muted-foreground">
                      Automatically check for new content on a schedule
                    </p>
                  </div>
                  <Switch 
                    checked={monitoringEnabled} 
                    onCheckedChange={setMonitoringEnabled} 
                  />
                </div>

                {monitoringEnabled && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="monitoring-schedule">Schedule (Cron Expression)</Label>
                      <Input 
                        id="monitoring-schedule" 
                        value={schedule} 
                        onChange={(e) => setSchedule(e.target.value)} 
                        placeholder="0 * * * * (every hour)"
                      />
                      <p className="text-xs text-muted-foreground">
                        Define how often the source should be checked for new content using cron syntax
                      </p>
                    </div>

                    {/* Target Bundle Selection */}
                    <div className="space-y-2 p-4 border rounded-lg">
                      <Label htmlFor="target-bundle" className="flex items-center gap-2">
                        <FolderOpen className="h-4 w-4" />
                        Target Bundle
                      </Label>
                      <p className="text-xs text-muted-foreground mb-2">
                        Select which bundle assets from this source should be added to
                      </p>
                      <Select
                        value={targetBundleId?.toString() || 'new'}
                        onValueChange={(value) => {
                          if (value === 'new') {
                            setTargetBundleId(undefined);
                            setTargetBundleName('');
                          } else if (value === 'none') {
                            setTargetBundleId(undefined);
                            setTargetBundleName('');
                          } else {
                            setTargetBundleId(parseInt(value));
                            setTargetBundleName('');
                          }
                        }}
                      >
                        <SelectTrigger id="target-bundle">
                          <SelectValue placeholder="Create new bundle">
                            {targetBundleId ? (
                              <div className="flex items-center gap-2">
                                <FolderOpen className="h-4 w-4" />
                                {bundles.find(b => b.id === targetBundleId)?.name || 'Unknown Bundle'}
                              </div>
                            ) : targetBundleName ? (
                              <div className="flex items-center gap-2">
                                <FolderOpen className="h-4 w-4" />
                                New: {targetBundleName}
                              </div>
                            ) : (
                              'Create new bundle'
                            )}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="new">
                            <span className="text-muted-foreground">Create new bundle</span>
                          </SelectItem>
                          <SelectItem value="none">
                            <span className="text-muted-foreground">No bundle (root level)</span>
                          </SelectItem>
                          {bundles.map((bundle) => (
                            <SelectItem key={bundle.id} value={bundle.id.toString()}>
                              <div className="flex items-center gap-2">
                                <FolderOpen className="h-4 w-4" />
                                {bundle.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      
                      {(!targetBundleId || targetBundleId === undefined) && (
                        <Input 
                          placeholder="Enter new bundle name (optional)" 
                          value={targetBundleName}
                          onChange={(e) => setTargetBundleName(e.target.value)}
                          className="mt-2"
                        />
                      )}
                    </div>

                    {/* Quick Schedule Presets */}
                    <div className="space-y-2">
                      <Label>Quick Presets</Label>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { label: 'Every hour', value: '0 * * * *' },
                          { label: 'Every 6 hours', value: '0 */6 * * *' },
                          { label: 'Daily at 9 AM', value: '0 9 * * *' },
                          { label: 'Weekly', value: '0 9 * * 1' }
                        ].map(preset => (
                          <Button
                            key={preset.value}
                            variant={schedule === preset.value ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setSchedule(preset.value)}
                            className="text-xs"
                          >
                            {preset.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Validation Errors */}
      {validationErrors.length > 0 && (
        <Card className="border-red-200 bg-red-50 dark:bg-red-950/20 mt-6">
          <CardContent className="p-4">
            <h4 className="font-medium text-red-800 dark:text-red-400 mb-2">
              Please fix the following issues:
            </h4>
            <ul className="text-sm text-red-700 dark:text-red-300 space-y-1">
              {validationErrors.map((error, index) => (
                <li key={index} className="flex items-center gap-2">
                  <span className="h-1 w-1 bg-current rounded-full" />
                  {error}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Submit Button */}
      <div className="flex justify-end gap-3 pt-6 border-t mt-6">
        <Button variant="outline" onClick={() => onSuccess()}>
          Cancel
        </Button>
        <Button 
          onClick={handleSubmit} 
          disabled={!selectedKind || isSubmitting}
          className="min-w-32"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating...
            </>
          ) : (
            'Create Source'
          )}
        </Button>
      </div>
    </div>
  );
}
