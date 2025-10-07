'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AnnotationSchemaRead } from '@/client';
import { getTargetKeysForScheme, getAnnotationFieldValue } from '@/lib/annotations/utils';
import { FormattedAnnotation } from '@/lib/annotations/types';
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Split, Eye, EyeOff, Palette, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

// === VARIABLE SPLITTING SYSTEM ===
// A systematic approach to grouping annotation results by field values
// with support for ambiguity resolution and visibility controls

// Core configuration for variable splitting
export interface VariableSplittingConfig {
  enabled: boolean;
  schemaId?: number;
  fieldKey?: string;
  // Visibility management
  visibleSplits?: Set<string>; // Which split values to show
  maxSplits?: number; // Maximum splits before grouping as "Other"
  groupOthers?: boolean; // Whether to group infrequent values
  // Ambiguity resolution: many-to-one mapping
  valueAliases?: Record<string, string[]>; // canonical → [alias1, alias2, ...]
}

// Analysis of current splitting results
export interface SplitAnalysis {
  splitValues: Array<{
    value: string;
    count: number;
    percentage: number;
    visible: boolean;
  }>;
  totalCount: number;
  otherCount: number;
}

// Results after applying splitting
export interface SplitResults {
  [splitValue: string]: FormattedAnnotation[];
}

interface VariableSplittingControlsProps {
  schemas: AnnotationSchemaRead[];
  results: FormattedAnnotation[];
  value: VariableSplittingConfig | null;
  onChange: (config: VariableSplittingConfig | null) => void;
  // Optional: Allow hiding advanced controls in compact views
  showAdvancedControls?: boolean;
  // Optional: Maximum number of splits to recommend
  maxRecommendedSplits?: number;
}

export const VariableSplittingControls: React.FC<VariableSplittingControlsProps> = ({
  schemas,
  results,
  value,
  onChange,
  showAdvancedControls = true,
  maxRecommendedSplits = 10,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [aliasEditMode, setAliasEditMode] = useState(false);
  const [newAliasFrom, setNewAliasFrom] = useState('');
  const [newAliasTo, setNewAliasTo] = useState('');

  const enabled = value?.enabled ?? false;
  const selectedSchemaId = value?.schemaId ?? null;
  const selectedFieldKey = value?.fieldKey ?? null;
  const visibleSplits = value?.visibleSplits ?? new Set();
  const maxSplits = value?.maxSplits ?? maxRecommendedSplits;
  const groupOthers = value?.groupOthers ?? true;
  const valueAliases = value?.valueAliases ?? {};

  // Get available fields for the selected schema
  const fieldOptions = useMemo(() => {
    if (!selectedSchemaId || !enabled) return [];
    
    const targetKeys = getTargetKeysForScheme(selectedSchemaId, schemas);
    
    // Prefer string and enum fields for splitting, but allow others
    return targetKeys
      .filter(tk => ['string', 'boolean', 'integer', 'number'].includes(tk.type) || tk.type.startsWith('List['))
      .map(tk => ({
        value: tk.key,
        label: `${tk.name} (${tk.type})`,
        type: tk.type,
      }));
  }, [selectedSchemaId, schemas, enabled]);

  // Analyze current splitting based on selected field
  const splitAnalysis = useMemo((): SplitAnalysis | null => {
    if (!enabled || !selectedSchemaId || !selectedFieldKey) {
      return null;
    }

    const relevantResults = results.filter(r => r.schema_id === selectedSchemaId);
    const valueCounts: Record<string, number> = {};
    let totalCount = 0;

    relevantResults.forEach(result => {
      const fieldValue = getAnnotationFieldValue(result.value, selectedFieldKey);
      let processedValues: string[] = [];

      if (fieldValue === null || fieldValue === undefined) {
        processedValues = ['N/A'];
      } else if (Array.isArray(fieldValue)) {
        processedValues = fieldValue.length > 0 
          ? fieldValue.map(v => String(v).trim()).filter(v => v !== '')
          : ['Empty Array'];
      } else if (typeof fieldValue === 'boolean') {
        processedValues = [fieldValue ? 'True' : 'False'];
      } else {
        processedValues = [String(fieldValue).trim()];
      }

      processedValues.forEach(val => {
        // Apply enhanced ambiguity resolution (many-to-one)
        const canonicalValue = applyAmbiguityResolution(val, valueAliases || {});
        valueCounts[canonicalValue] = (valueCounts[canonicalValue] || 0) + 1;
        totalCount++;
      });
    });

    // Sort by frequency
    const sortedEntries = Object.entries(valueCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({
        value,
        count,
        percentage: totalCount > 0 ? (count / totalCount) * 100 : 0,
        visible: visibleSplits.size === 0 || visibleSplits.has(value), // Default all visible if none specified
      }));

    // Calculate "other" count for values beyond maxSplits
    const topSplits = sortedEntries.slice(0, maxSplits);
    const otherSplits = sortedEntries.slice(maxSplits);
    const otherCount = otherSplits.reduce((sum, split) => sum + split.count, 0);

    return {
      splitValues: topSplits,
      totalCount,
      otherCount,
    };
  }, [enabled, selectedSchemaId, selectedFieldKey, results, valueAliases, visibleSplits, maxSplits]);

  const handleToggleEnabled = () => {
    if (enabled) {
      onChange(null);
    } else {
      // Initialize with first available schema and field
      const defaultSchemaId = schemas.length > 0 ? schemas[0].id : undefined;
      if (defaultSchemaId) {
        const defaultFields = getTargetKeysForScheme(defaultSchemaId, schemas);
        const defaultFieldKey = defaultFields.length > 0 ? defaultFields[0].key : undefined;
        
        onChange({
          enabled: true,
          schemaId: defaultSchemaId,
          fieldKey: defaultFieldKey,
          visibleSplits: new Set(),
          maxSplits: maxRecommendedSplits,
          groupOthers: true,
          valueAliases: {},
        });
      }
    }
  };

  const handleSchemaChange = (schemaIdStr: string) => {
    const newSchemaId = parseInt(schemaIdStr, 10);
    const defaultFields = getTargetKeysForScheme(newSchemaId, schemas);
    const defaultFieldKey = defaultFields.length > 0 ? defaultFields[0].key : undefined;
    
    onChange({
      ...value,
      enabled: true,
      schemaId: newSchemaId,
      fieldKey: defaultFieldKey,
      visibleSplits: new Set(), // Reset visibility when changing schema
    });
  };

  const handleFieldChange = (newFieldKey: string) => {
    onChange({
      ...value,
      enabled: true,
      schemaId: selectedSchemaId!,
      fieldKey: newFieldKey,
      visibleSplits: new Set(), // Reset visibility when changing field
    });
  };

  const handleVisibilityToggle = (splitValue: string) => {
    const newVisibleSplits = new Set(visibleSplits);
    if (newVisibleSplits.has(splitValue)) {
      newVisibleSplits.delete(splitValue);
    } else {
      newVisibleSplits.add(splitValue);
    }
    
    onChange({
      enabled: true,
      schemaId: value?.schemaId,
      fieldKey: value?.fieldKey,
      maxSplits: value?.maxSplits ?? maxRecommendedSplits,
      groupOthers: value?.groupOthers ?? true,
      valueAliases: value?.valueAliases ?? {},
      visibleSplits: newVisibleSplits,
    });
  };

  const handleSelectAllSplits = () => {
    if (!splitAnalysis) return;
    
    const allValues = new Set(splitAnalysis.splitValues.map(s => s.value));
    onChange({
      enabled: true,
      schemaId: value?.schemaId,
      fieldKey: value?.fieldKey,
      maxSplits: value?.maxSplits ?? maxRecommendedSplits,
      groupOthers: value?.groupOthers ?? true,
      valueAliases: value?.valueAliases ?? {},
      visibleSplits: allValues,
    });
  };

  const handleDeselectAllSplits = () => {
    onChange({
      enabled: true,
      schemaId: value?.schemaId,
      fieldKey: value?.fieldKey,
      maxSplits: value?.maxSplits ?? maxRecommendedSplits,
      groupOthers: value?.groupOthers ?? true,
      valueAliases: value?.valueAliases ?? {},
      visibleSplits: new Set(),
    });
  };

  const handleMaxSplitsChange = (newMax: string) => {
    const maxNum = parseInt(newMax, 10);
    if (!isNaN(maxNum) && maxNum > 0) {
      onChange({
        enabled: true,
        schemaId: value?.schemaId,
        fieldKey: value?.fieldKey,
        visibleSplits: value?.visibleSplits ?? new Set(),
        groupOthers: value?.groupOthers ?? true,
        valueAliases: value?.valueAliases ?? {},
        maxSplits: maxNum,
      });
    }
  };

  const handleAddAlias = () => {
    if (!newAliasFrom.trim() || !newAliasTo.trim()) return;
    
    const canonical = newAliasTo.trim();
    const alias = newAliasFrom.trim();
    
    onChange({
      enabled: true,
      schemaId: value?.schemaId,
      fieldKey: value?.fieldKey,
      visibleSplits: value?.visibleSplits ?? new Set(),
      maxSplits: value?.maxSplits ?? maxRecommendedSplits,
      groupOthers: value?.groupOthers ?? true,
      valueAliases: {
        ...valueAliases,
        [canonical]: [...(valueAliases?.[canonical] || []), alias],
      },
    });
    
    setNewAliasFrom('');
    setNewAliasTo('');
  };

  const handleRemoveAlias = (canonical: string, aliasToRemove: string) => {
    const currentAliases = valueAliases?.[canonical] || [];
    const updatedAliases = currentAliases.filter(alias => alias !== aliasToRemove);
    
    const newValueAliases = { ...valueAliases };
    if (updatedAliases.length === 0) {
      // Remove the canonical entry if no aliases remain
      delete newValueAliases[canonical];
    } else {
      newValueAliases[canonical] = updatedAliases;
    }
    
    onChange({
      enabled: true,
      schemaId: value?.schemaId,
      fieldKey: value?.fieldKey,
      visibleSplits: value?.visibleSplits ?? new Set(),
      maxSplits: value?.maxSplits ?? maxRecommendedSplits,
      groupOthers: value?.groupOthers ?? true,
      valueAliases: newValueAliases,
    });
  };

  return (
    <Card className="mb-3">
      <CardHeader className="pb-2 pt-3 px-3">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <div className="flex items-center">
            <Split className="h-4 w-4 mr-2 text-muted-foreground"/>
            Variable Splitting
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={handleToggleEnabled}
          />
        </CardTitle>
      </CardHeader>
      
      {enabled && (
        <CardContent className="px-3 pb-3 space-y-3">
          {/* Schema and Field Selection */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="split-schema-select" className="text-xs mb-1 block text-muted-foreground">
                Schema
              </Label>
              <Select
                value={selectedSchemaId?.toString() ?? ""}
                onValueChange={handleSchemaChange}
                disabled={schemas.length === 0}
              >
                <SelectTrigger id="split-schema-select" className="h-8 text-xs">
                  <SelectValue placeholder="Select schema..." />
                </SelectTrigger>
                <SelectContent>
                  <ScrollArea className="max-h-60">
                    {schemas.map(s => (
                      <SelectItem key={s.id} value={s.id.toString()} className="text-xs">
                        {s.name}
                      </SelectItem>
                    ))}
                  </ScrollArea>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="split-field-select" className="text-xs mb-1 block text-muted-foreground">
                Field
              </Label>
              <Select
                value={selectedFieldKey ?? ""}
                onValueChange={handleFieldChange}
                disabled={!selectedSchemaId || fieldOptions.length === 0}
              >
                <SelectTrigger id="split-field-select" className="h-8 text-xs">
                  <SelectValue placeholder="Select field..." />
                </SelectTrigger>
                <SelectContent>
                  <ScrollArea className="max-h-60">
                    {fieldOptions.map(opt => (
                      <SelectItem key={opt.value} value={opt.value} className="text-xs">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </ScrollArea>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Split Analysis and Visibility Controls */}
          {splitAnalysis && splitAnalysis.splitValues.length > 0 && (
            <div className="border-t pt-3">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs text-muted-foreground">
                  Split Values ({splitAnalysis.splitValues.length} found)
                </Label>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSelectAllSplits}
                    className="h-6 px-2 text-xs"
                  >
                    All
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDeselectAllSplits}
                    className="h-6 px-2 text-xs"
                  >
                    None
                  </Button>
                </div>
              </div>
              
              <ScrollArea className="max-h-40 overflow-y-auto scrollbar-thin scrollbar-thumb-muted-foreground scrollbar-track-muted-foreground/50 border rounded p-2">
                <div className="space-y-1">
                  {splitAnalysis.splitValues.map(split => (
                    <div key={split.value} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <Checkbox
                          checked={split.visible}
                          onCheckedChange={() => handleVisibilityToggle(split.value)}
                        />
                        <span className="truncate flex-1" title={split.value}>
                          {split.value}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge variant="outline" className="text-xs">
                          {split.count}
                        </Badge>
                        <span className="text-muted-foreground text-xs">
                          {split.percentage.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  ))}
                  
                  {splitAnalysis.otherCount > 0 && groupOthers && (
                    <div className="flex items-center justify-between text-xs border-t pt-1 mt-1">
                      <span className="text-muted-foreground italic">Other values</span>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {splitAnalysis.otherCount}
                        </Badge>
                        <span className="text-muted-foreground text-xs">
                          {((splitAnalysis.otherCount / splitAnalysis.totalCount) * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Advanced Controls */}
          {showAdvancedControls && (
            <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="w-full h-8 px-2 text-xs justify-between">
                  Advanced Settings
                  {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </Button>
              </CollapsibleTrigger>
              
              <CollapsibleContent className="space-y-3 pt-3 border-t">
                {/* Max Splits Control */}
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">
                    Maximum Splits Shown
                  </Label>
                  <Select value={maxSplits.toString()} onValueChange={handleMaxSplitsChange}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5" className="text-xs">5</SelectItem>
                      <SelectItem value="10" className="text-xs">10</SelectItem>
                      <SelectItem value="15" className="text-xs">15</SelectItem>
                      <SelectItem value="20" className="text-xs">20</SelectItem>
                      <SelectItem value="50" className="text-xs">50 (All)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Value Aliases for Ambiguity Resolution */}
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">
                    Value Aliases (for ambiguity resolution)
                  </Label>
                  
                  {Object.entries(valueAliases).length > 0 && (
                    <div className="mb-2 space-y-1">
                      {Object.entries(valueAliases).map(([canonical, aliases]) => (
                        <div key={canonical} className="flex items-center justify-between text-xs bg-muted/50 p-2 rounded">
                          <span>"{canonical}" → {aliases.length > 0 ? aliases.map(a => `"${a}"`).join(', ') : ''}</span>
                          {aliases.length > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveAlias(canonical, aliases[0])}
                              className="h-4 w-4 p-0 text-destructive hover:text-destructive"
                            >
                              ×
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  
                  <div className="grid grid-cols-3 gap-1">
                    <Input
                      placeholder="Canonical value..."
                      value={newAliasTo}
                      onChange={(e) => setNewAliasTo(e.target.value)}
                      className="h-7 text-xs"
                    />
                    <Input
                      placeholder="Alias (e.g., 'Party A', 'party-a')"
                      value={newAliasFrom}
                      onChange={(e) => setNewAliasFrom(e.target.value)}
                      className="h-7 text-xs"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleAddAlias}
                      disabled={!newAliasFrom.trim() || !newAliasTo.trim()}
                      className="h-7 text-xs"
                    >
                      Add
                    </Button>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
        </CardContent>
      )}
    </Card>
  );
};

// === UTILITY FUNCTIONS FOR AMBIGUITY RESOLUTION === //

/**
 * Creates a reverse lookup map from aliases to canonical values
 * Input: { "Party A": ["PartyA", "party-a", "The A Party"], "Party B": ["PartyB", "party-b"] }
 * Output: { "PartyA": "Party A", "party-a": "Party A", "The A Party": "Party A", ... }
 */
export const createAliasLookupMap = (valueAliases: Record<string, string[]>): Record<string, string> => {
  const lookupMap: Record<string, string> = {};
  
  Object.entries(valueAliases).forEach(([canonical, aliases]) => {
    // Include the canonical value itself
    lookupMap[canonical] = canonical;
    
    // Map all aliases to the canonical value
    aliases.forEach(alias => {
      if (alias && alias.trim()) {
        lookupMap[alias.trim()] = canonical;
      }
    });
  });
  
  return lookupMap;
};

/**
 * Applies ambiguity resolution using many-to-one mapping
 */
export const applyAmbiguityResolution = (
  value: any, 
  valueAliases: Record<string, string[]> = {}
): string => {
  if (value === null || value === undefined) {
    return 'N/A';
  }
  
  let stringValue: string;
  if (typeof value === 'boolean') {
    stringValue = value ? 'True' : 'False';
  } else if (typeof value === 'object') {
    try {
      stringValue = JSON.stringify(value);
    } catch (e) {
      stringValue = '[Complex Object]';
    }
  } else {
    stringValue = String(value).trim();
  }
  
  // Apply alias resolution with many-to-one mapping
  const aliasLookup = createAliasLookupMap(valueAliases);
  return aliasLookup[stringValue] || stringValue;
};

// Utility function to apply splitting configuration to results
export const applySplittingToResults = (
  results: FormattedAnnotation[],
  config: VariableSplittingConfig | null
): SplitResults => {
  if (!config || !config.enabled || !config.schemaId || !config.fieldKey) {
    return { 'all': results };
  }

  const relevantResults = results.filter(r => r.schema_id === config.schemaId);
  
  const splitGroups: SplitResults = {};
  
  relevantResults.forEach(result => {
    const fieldValue = getAnnotationFieldValue(result.value, config.fieldKey!);
    let processedValues: string[] = [];

    if (fieldValue === null || fieldValue === undefined) {
      processedValues = ['N/A'];
    } else if (Array.isArray(fieldValue)) {
      processedValues = fieldValue.length > 0 
        ? fieldValue.map(v => String(v).trim()).filter(v => v !== '')
        : ['Empty Array'];
    } else if (typeof fieldValue === 'boolean') {
      processedValues = [fieldValue ? 'True' : 'False'];
    } else {
      processedValues = [String(fieldValue).trim()];
    }

    processedValues.forEach(val => {
      // Apply enhanced ambiguity resolution (many-to-one)
      const canonicalValue = applyAmbiguityResolution(val, config.valueAliases || {});
      
      // Always include groups - visibility filtering is handled by the chart component
      if (!splitGroups[canonicalValue]) {
        splitGroups[canonicalValue] = [];
      }
      splitGroups[canonicalValue].push(result);
    });
  });

  // Add non-split results to 'all' group if no splitting config applied
  if (Object.keys(splitGroups).length === 0) {
    return { 'all': results };
  }

  return splitGroups;
};

export default VariableSplittingControls; 