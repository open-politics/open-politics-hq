'use client';

import React, { useState, useEffect } from 'react';
import { sourceConfigurationRegistry, SourceKind, FieldSchema } from '@/lib/sourceConfigurationRegistry';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
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
  FolderOpen,
  ArrowRight,
  ArrowDown,
  Radio,
  Zap,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';

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

const pollIntervalPresets = [
  { label: '5 min', value: 300, icon: Zap },
  { label: '15 min', value: 900, icon: Clock },
  { label: '1 hour', value: 3600, icon: Clock },
  { label: '6 hours', value: 21600, icon: Clock },
];

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
  const [streamEnabled, setStreamEnabled] = useState(false);
  const [pollInterval, setPollInterval] = useState(300);
  const [targetBundleId, setTargetBundleId] = useState<number | undefined>();
  const [targetBundleName, setTargetBundleName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [activeStep, setActiveStep] = useState<'source' | 'config' | 'stream'>('source');

  const { createSource } = useSourceStore();
  const { activeInfospace } = useInfospaceStore();
  const { bundles, fetchBundles } = useBundleStore();

  // Load bundles when component mounts
  useEffect(() => {
    if (activeInfospace?.id) {
      fetchBundles(activeInfospace.id);
    }
  }, [activeInfospace?.id, fetchBundles]);

  // Auto-advance to config when source is selected
  useEffect(() => {
    if (selectedKind && activeStep === 'source') {
      setActiveStep('config');
    }
  }, [selectedKind, activeStep]);

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
    
    const sourceData: SourceCreateRequest & {
      is_active?: boolean;
      poll_interval_seconds?: number;
      output_bundle_id?: number;
    } = {
      name: name,
      kind: selectedKind,
      details: config,
      target_bundle_id: targetBundleId,
      target_bundle_name: targetBundleName || undefined,
      // Streaming fields
      is_active: streamEnabled,
      poll_interval_seconds: streamEnabled ? pollInterval : 300,
      output_bundle_id: targetBundleId,
    } as any;

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
  const IconComponent = selectedKind ? sourceKindIcons[selectedKind] : null;

  return (
    <div className="w-full max-w-7xl mx-auto px-2 sm:px-4">
      {/* Visual Flow Indicator */}
      <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950/20 dark:to-purple-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
        {/* Desktop: Horizontal Flow */}
        <div className="hidden md:flex items-center justify-between">
          <div className="flex items-center gap-3 lg:gap-4 flex-1">
            {/* Source */}
            <div className={cn(
              "flex items-center gap-2 lg:gap-3 px-3 lg:px-4 py-2 rounded-lg transition-all",
              selectedKind ? "bg-primary/10 border-2 border-primary" : "bg-muted/50 border-2 border-dashed border-muted-foreground/30"
            )}>
              {IconComponent ? (
                <IconComponent className="h-4 w-4 lg:h-5 lg:w-5 text-primary flex-shrink-0" />
              ) : (
                <div className="h-4 w-4 lg:h-5 lg:w-5 rounded-full bg-muted-foreground/30 flex-shrink-0" />
              )}
              <span className="font-medium text-xs lg:text-sm truncate">
                {selectedKind ? name || 'Source' : 'Select Source'}
              </span>
            </div>

            <ArrowRight className="h-4 w-4 lg:h-5 lg:w-5 text-muted-foreground flex-shrink-0" />

            {/* Stream Settings */}
            <div className={cn(
              "flex items-center gap-2 lg:gap-3 px-3 lg:px-4 py-2 rounded-lg transition-all",
              streamEnabled ? "bg-green-100 dark:bg-green-900/20 border-2 border-green-500" : "bg-muted/50 border-2 border-dashed border-muted-foreground/30"
            )}>
              {streamEnabled ? (
                <Radio className="h-4 w-4 lg:h-5 lg:w-5 text-green-600 dark:text-green-400 animate-pulse flex-shrink-0" />
              ) : (
                <div className="h-4 w-4 lg:h-5 lg:w-5 rounded-full bg-muted-foreground/30 flex-shrink-0" />
              )}
              <span className="font-medium text-xs lg:text-sm truncate">
                {streamEnabled ? `Poll every ${pollInterval / 60} min` : 'Stream Settings'}
              </span>
            </div>

            <ArrowRight className="h-4 w-4 lg:h-5 lg:w-5 text-muted-foreground flex-shrink-0" />

            {/* Output Bundle */}
            <div className={cn(
              "flex items-center gap-2 lg:gap-3 px-3 lg:px-4 py-2 rounded-lg transition-all",
              (targetBundleId || targetBundleName) ? "bg-purple-100 dark:bg-purple-900/20 border-2 border-purple-500" : "bg-muted/50 border-2 border-dashed border-muted-foreground/30"
            )}>
              <FolderOpen className={cn(
                "h-4 w-4 lg:h-5 lg:w-5 flex-shrink-0",
                (targetBundleId || targetBundleName) ? "text-purple-600 dark:text-purple-400" : "text-muted-foreground/30"
              )} />
              <span className="font-medium text-xs lg:text-sm truncate">
                {targetBundleId 
                  ? bundles.find(b => b.id === targetBundleId)?.name || 'Bundle'
                  : targetBundleName 
                    ? `New: ${targetBundleName}`
                    : 'Output Bundle'}
              </span>
            </div>
          </div>
        </div>

        {/* Mobile: Vertical Flow */}
        <div className="flex md:hidden flex-col gap-2">
          {/* Source */}
          <div className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg transition-all",
            selectedKind ? "bg-primary/10 border-2 border-primary" : "bg-muted/50 border-2 border-dashed border-muted-foreground/30"
          )}>
            {IconComponent ? (
              <IconComponent className="h-4 w-4 text-primary flex-shrink-0" />
            ) : (
              <div className="h-4 w-4 rounded-full bg-muted-foreground/30 flex-shrink-0" />
            )}
            <span className="font-medium text-xs truncate">
              {selectedKind ? name || 'Source' : 'Select Source'}
            </span>
          </div>

          <div className="flex justify-center">
            <ArrowDown className="h-4 w-4 text-muted-foreground" />
          </div>

          {/* Stream Settings */}
          <div className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg transition-all",
            streamEnabled ? "bg-green-100 dark:bg-green-900/20 border-2 border-green-500" : "bg-muted/50 border-2 border-dashed border-muted-foreground/30"
          )}>
            {streamEnabled ? (
              <Radio className="h-4 w-4 text-green-600 dark:text-green-400 animate-pulse flex-shrink-0" />
            ) : (
              <div className="h-4 w-4 rounded-full bg-muted-foreground/30 flex-shrink-0" />
            )}
            <span className="font-medium text-xs truncate">
              {streamEnabled ? `Poll every ${pollInterval / 60} min` : 'Stream Settings'}
            </span>
          </div>

          <div className="flex justify-center">
            <ArrowDown className="h-4 w-4 text-muted-foreground" />
          </div>

          {/* Output Bundle */}
          <div className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg transition-all",
            (targetBundleId || targetBundleName) ? "bg-purple-100 dark:bg-purple-900/20 border-2 border-purple-500" : "bg-muted/50 border-2 border-dashed border-muted-foreground/30"
          )}>
            <FolderOpen className={cn(
              "h-4 w-4 flex-shrink-0",
              (targetBundleId || targetBundleName) ? "text-purple-600 dark:text-purple-400" : "text-muted-foreground/30"
            )} />
            <span className="font-medium text-xs truncate">
              {targetBundleId 
                ? bundles.find(b => b.id === targetBundleId)?.name || 'Bundle'
                : targetBundleName 
                  ? `New: ${targetBundleName}`
                  : 'Output Bundle'}
            </span>
          </div>
        </div>
      </div>

      {/* Main Content - Responsive Layout */}
      <div className="flex flex-col lg:grid lg:grid-cols-12 gap-4 sm:gap-6">
        {/* Source Type Selection */}
        <div className="lg:col-span-3">
          <Card className="lg:sticky lg:top-4">
            <CardHeader className="pb-3 px-4 sm:px-6">
              <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                <Target className="h-4 w-4" />
                Source Type
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 px-4 sm:px-6">
              {supportedKinds.map(kind => {
                const kindSchema = sourceConfigurationRegistry.getSchema(kind);
                const KindIcon = sourceKindIcons[kind] || FileText;
                const isSelected = selectedKind === kind;

                return (
                  <button
                    key={kind}
                    onClick={() => handleKindChange(kind)}
                    className={cn(
                      "w-full text-left p-2.5 sm:p-3 rounded-lg border-2 transition-all",
                      isSelected 
                        ? "border-primary bg-primary/5 shadow-sm" 
                        : "border-transparent hover:border-muted-foreground/30 hover:bg-muted/50"
                    )}
                  >
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className={cn(
                        "p-1.5 sm:p-2 rounded-lg flex-shrink-0",
                        isSelected ? "bg-primary/10" : "bg-muted"
                      )}>
                        <KindIcon className={cn(
                          "h-3.5 w-3.5 sm:h-4 sm:w-4",
                          isSelected ? "text-primary" : "text-muted-foreground"
                        )} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-xs sm:text-sm truncate">
                          {kindSchema?.uiSchema.title || kind}
                        </div>
                      </div>
                      {isSelected && (
                        <CheckCircle2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-primary flex-shrink-0" />
                      )}
                    </div>
                  </button>
                );
              })}
            </CardContent>
          </Card>
        </div>

        {/* Configuration */}
        <div className="lg:col-span-6">
          {selectedKind && schema ? (
            <Card>
              <CardHeader className="px-4 sm:px-6">
                <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                  <Settings className="h-4 w-4 sm:h-5 sm:w-5" />
                  Configuration
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  {schema.uiSchema.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 sm:space-y-6 px-4 sm:px-6">
                {/* Source Name */}
                <div className="space-y-2">
                  <Label htmlFor="source-name" className="flex items-center gap-2 text-xs sm:text-sm">
                    Source Name
                    <span className="text-red-500">*</span>
                  </Label>
                  <Input 
                    id="source-name" 
                    value={name} 
                    onChange={(e) => setName(e.target.value)} 
                    placeholder="Enter a descriptive name for this source"
                    className={cn(
                      "text-sm",
                      validationErrors.some(e => e.includes('name')) ? 'border-red-500' : ''
                    )}
                  />
                  {validationErrors.some(e => e.includes('name')) && (
                    <p className="text-xs text-red-500 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {validationErrors.find(e => e.includes('name'))}
                    </p>
                  )}
                </div>

                {/* Dynamic Fields - Responsive Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  {schema.uiSchema.fields.map(field => (
                    <div key={field.name} className={cn(
                      "space-y-2",
                      field.type === 'textarea' || field.type === 'multiselect' ? "sm:col-span-2" : ""
                    )}>
                      <Label htmlFor={field.name} className="flex items-center gap-2 text-xs sm:text-sm">
                        {field.label}
                        {field.required && <span className="text-red-500">*</span>}
                        {field.help && (
                          <div className="group relative">
                            <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 border max-w-xs">
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
          ) : (
            <Card>
              <CardContent className="py-8 sm:py-12 text-center px-4">
                <Target className="h-10 w-10 sm:h-12 sm:w-12 text-muted-foreground mx-auto mb-3 sm:mb-4 opacity-50" />
                <p className="text-sm sm:text-base text-muted-foreground">Select a source type to begin</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Stream Settings & Output */}
        <div className="lg:col-span-3 space-y-4 sm:space-y-6">
          {/* Stream Settings */}
          <Card>
            <CardHeader className="pb-3 px-4 sm:px-6">
              <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                <Radio className="h-4 w-4" />
                Stream Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 sm:space-y-4 px-4 sm:px-6">
              {/* Enable Stream */}
              <div className="flex items-center justify-between p-2.5 sm:p-3 border rounded-lg bg-muted/30">
                <div className="flex-1 min-w-0 pr-2">
                  <div className="font-medium text-xs sm:text-sm">Enable Stream</div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    Automatically poll for new content
                  </p>
                </div>
                <Switch 
                  checked={streamEnabled} 
                  onCheckedChange={setStreamEnabled} 
                  className="flex-shrink-0"
                />
              </div>

              {streamEnabled && (
                <>
                  {/* Poll Interval */}
                  <div className="space-y-2 sm:space-y-3">
                    <Label className="text-xs sm:text-sm">Poll Interval</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {pollIntervalPresets.map(preset => {
                        const PresetIcon = preset.icon;
                        const isSelected = pollInterval === preset.value;
                        return (
                          <button
                            key={preset.value}
                            onClick={() => setPollInterval(preset.value)}
                            className={cn(
                              "p-2 sm:p-3 rounded-lg border-2 transition-all text-left",
                              isSelected 
                                ? "border-primary bg-primary/5" 
                                : "border-muted hover:border-muted-foreground/30"
                            )}
                          >
                            <div className="flex items-center gap-1.5 sm:gap-2">
                              <PresetIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground flex-shrink-0" />
                              <span className="text-xs sm:text-sm font-medium truncate">{preset.label}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <div className="pt-2 border-t">
                      <Label htmlFor="custom-interval" className="text-xs text-muted-foreground">
                        Custom (seconds)
                      </Label>
                      <Input
                        id="custom-interval"
                        type="number"
                        value={pollInterval}
                        onChange={(e) => setPollInterval(parseInt(e.target.value) || 300)}
                        min={60}
                        className="mt-1 text-sm"
                      />
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Output Routing */}
          <Card>
            <CardHeader className="pb-3 px-4 sm:px-6">
              <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                <FolderOpen className="h-4 w-4" />
                Output Routing
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 sm:space-y-4 px-4 sm:px-6">
              <div className="space-y-2">
                <Label htmlFor="target-bundle" className="text-xs sm:text-sm">
                  Target Bundle
                </Label>
                <p className="text-xs text-muted-foreground">
                  Where new items will be routed
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
                  <SelectTrigger id="target-bundle" className="text-sm">
                    <SelectValue placeholder="Select bundle">
                      {targetBundleId ? (
                        <div className="flex items-center gap-2">
                          <FolderOpen className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
                          <span className="truncate">{bundles.find(b => b.id === targetBundleId)?.name || 'Unknown Bundle'}</span>
                        </div>
                      ) : (
                        'Select bundle'
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">
                      <span className="text-muted-foreground text-xs sm:text-sm">Create new bundle</span>
                    </SelectItem>
                    <SelectItem value="none">
                      <span className="text-muted-foreground text-xs sm:text-sm">No bundle (root level)</span>
                    </SelectItem>
                    {bundles.map((bundle) => (
                      <SelectItem key={bundle.id} value={bundle.id.toString()}>
                        <div className="flex items-center gap-2">
                          <FolderOpen className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
                          <span className="truncate text-xs sm:text-sm">{bundle.name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                {(!targetBundleId || targetBundleId === undefined) && (
                  <Input 
                    placeholder="New bundle name (optional)" 
                    value={targetBundleName}
                    onChange={(e) => setTargetBundleName(e.target.value)}
                    className="mt-2 text-sm"
                  />
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Validation Errors */}
      {validationErrors.length > 0 && (
        <Card className="border-red-200 bg-red-50 dark:bg-red-950/20 mt-4 sm:mt-6">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0" />
              <h4 className="font-medium text-xs sm:text-sm text-red-800 dark:text-red-400">
                Please fix the following issues:
              </h4>
            </div>
            <ul className="text-xs sm:text-sm text-red-700 dark:text-red-300 space-y-1 ml-6">
              {validationErrors.map((error, index) => (
                <li key={index} className="flex items-start gap-2">
                  <span className="h-1 w-1 bg-current rounded-full mt-1.5 flex-shrink-0" />
                  <span className="flex-1">{error}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Submit Button */}
      <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 pt-4 sm:pt-6 border-t mt-4 sm:mt-6">
        <Button variant="outline" onClick={() => onSuccess()} className="w-full sm:w-auto text-sm">
          Cancel
        </Button>
        <Button 
          onClick={handleSubmit} 
          disabled={!selectedKind || isSubmitting}
          className="w-full sm:w-auto sm:min-w-32 text-sm"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-3.5 w-3.5 sm:h-4 sm:w-4 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <CheckCircle2 className="mr-2 h-3.5 w-3.5 sm:h-4 sm:w-4" />
              Create Stream
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
