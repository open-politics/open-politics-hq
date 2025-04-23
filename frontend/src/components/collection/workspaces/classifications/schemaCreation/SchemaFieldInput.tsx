import { DictKeyDefinition, FieldType, SchemeField } from "@/lib/classification/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PlusIcon, XIcon, Clock } from "lucide-react";
import { useEffect } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface SchemaFieldInputProps {
  field: SchemeField;
  onChange: (field: SchemeField) => void;
  onRemove: () => void;
  readOnly?: boolean;
}

export function SchemaFieldInput({ field, onChange, onRemove, readOnly = false }: SchemaFieldInputProps) {
  // Debug log to see what field configuration is being passed
  useEffect(() => {
    console.log("SchemaFieldInput received field:", field);
    console.log("Field config:", field.config);
    console.log("is_set_of_labels:", field.config.is_set_of_labels);
    console.log("labels:", field.config.labels);
    console.log("dict_keys:", field.config.dict_keys);
  }, [field]);

  const handleConfigChange = (config: Partial<SchemeField['config']>) => {
    console.log("Updating field config:", config);
    onChange({
      ...field,
      config: {
        ...field.config,
        ...config
      }
    });
  };

  const handleDictKeyChange = (index: number, key: Partial<DictKeyDefinition>) => {
    const newDictKeys: DictKeyDefinition[] = [...(field.config.dict_keys || [])];
    newDictKeys[index] = { ...newDictKeys[index], ...key } as DictKeyDefinition;
    console.log("Updating dict_keys:", newDictKeys);
    onChange({
      ...field,
      config: { ...field.config, dict_keys: newDictKeys }
    });
  };

  const addDictKey = () => {
    const newKey: DictKeyDefinition = { name: '', type: 'str' };
    const newDictKeys: DictKeyDefinition[] = [...(field.config.dict_keys || []), newKey];
    console.log("Adding dict_key, new dict_keys:", newDictKeys);
    onChange({
      ...field,
      config: {
        ...field.config,
        dict_keys: newDictKeys
      }
    });
  };

  const removeDictKey = (index: number) => {
    const newDictKeys: DictKeyDefinition[] = [...(field.config.dict_keys || [])];
    newDictKeys.splice(index, 1);
    console.log("Removing dict_key, new dict_keys:", newDictKeys);
    onChange({
      ...field,
      config: { ...field.config, dict_keys: newDictKeys }
    });
  };

  // --- Common Time Axis Hint Switch ---
  const renderTimeAxisHintSwitch = () => (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center space-x-2 pt-3 mt-3 border-t border-border/50">
            <Switch
              id={`time-axis-hint-${field.name || 'new'}`}
              checked={field.config.is_time_axis_hint === true}
              onCheckedChange={(checked) => handleConfigChange({ is_time_axis_hint: checked })}
              disabled={readOnly}
            />
            <Label htmlFor={`time-axis-hint-${field.name || 'new'}`} className="text-xs font-normal flex items-center cursor-pointer">
                <Clock className="h-3 w-3 mr-1.5 text-muted-foreground" />
                Use as Time Axis
            </Label>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          <p className="text-xs max-w-xs">
            Enable this if the field represents a date or timestamp that can be used for time-series analysis in charts.
            The value should be parsable as a date (e.g., YYYY-MM-DD, ISO 8601).
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
  // --- End Common Time Axis Hint Switch ---

  switch (field.type) {
    case "int":
      return (
        <div className="space-y-2">
          <Label>Integer Configuration</Label>
          <div className="ml-6 space-y-4">
            <div className="space-y-2">
              <Label>Minimum Value</Label>
              <Input
                type="number"
                value={field.config.scale_min ?? 0}
                onChange={(e) => {
                  const value = e.target.value === '' ? 0 : parseInt(e.target.value);
                  handleConfigChange({ scale_min: isNaN(value) ? 0 : value });
                }}
                readOnly={readOnly}
              />
            </div>
            <div className="space-y-2">
              <Label>Maximum Value</Label>
              <Input
                type="number"
                value={field.config.scale_max ?? 1}
                onChange={(e) => {
                  const value = e.target.value === '' ? 1 : parseInt(e.target.value);
                  handleConfigChange({ scale_max: isNaN(value) ? 1 : value });
                }}
                readOnly={readOnly}
              />
            </div>
          </div>
          {renderTimeAxisHintSwitch()}
        </div>
      );

    case "List[str]":
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Switch
              checked={field.config.is_set_of_labels === true}
              onCheckedChange={(checked) => {
                console.log("Setting is_set_of_labels to:", checked);
                handleConfigChange({ is_set_of_labels: checked });
              }}
              disabled={readOnly}
            />
            <Label>Use predefined labels</Label>
          </div>
          
          {field.config.is_set_of_labels === true ? (
            <div className="space-y-2">
              <Label>Labels (one per line)</Label>
              <textarea
                value={(field.config.labels || []).join('\n')}
                onChange={(e) => {
                  const newLabels = e.target.value.split('\n').filter(l => l.trim());
                  console.log("Setting labels to:", newLabels);
                  handleConfigChange({ labels: newLabels });
                }}
                className="w-full min-h-[100px] p-2 border rounded"
                readOnly={readOnly}
              />
            </div>
          ) : null}
          {renderTimeAxisHintSwitch()}
        </div>
      );

    case "List[Dict[str, any]]":
      return (
        <div className="space-y-4">
          <Label>Structure Definition</Label>
          {(field.config.dict_keys || []).map((key, index) => (
            <div key={index} className="grid grid-cols-[1fr,1fr,auto] gap-2 mb-2">
              <Input
                placeholder="Key name"
                value={key.name || ''}
                onChange={(e) => handleDictKeyChange(index, { name: e.target.value })}
                readOnly={readOnly}
              />
              <Select
                value={key.type}
                onValueChange={(value: "str" | "int" | "float" | "bool") => handleDictKeyChange(index, { type: value })}
                disabled={readOnly}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="str">Text</SelectItem>
                  <SelectItem value="int">Number</SelectItem>
                  <SelectItem value="float">Decimal</SelectItem>
                  <SelectItem value="bool">Yes/No</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeDictKey(index)}
                disabled={readOnly}
              >
                <XIcon className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addDictKey}
            disabled={readOnly}
          >
            <PlusIcon className="h-4 w-4 mr-2" />
            Add Key
          </Button>
          {renderTimeAxisHintSwitch()}
        </div>
      );

    default:
      // For 'str' type, only show the time axis hint switch
      if (field.type === 'str') {
        return renderTimeAxisHintSwitch();
      }
      return null;
  }
} 