import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Copy, ExternalLink, Loader2, HelpCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDistanceToNowStrict } from 'date-fns';
import { toast } from 'sonner';
import { SingleFragmentProps } from './types';
import { 
  getDisplayFragmentKey, 
  extractRunIdFromSourceRef,
  isFromAnnotationRun,
  getFragmentColorScheme,
  getFieldDescriptionFromSchema
} from './utils';
import { cn } from '@/lib/utils';
import { useSchemaInfo } from '@/hooks/useSchemaInfo';

/**
 * Full detailed view of a fragment - shows all metadata and context
 */
export function FragmentFull({ 
  fragmentKey, 
  fragment,
  onFragmentClick,
  onRunClick,
  className 
}: SingleFragmentProps) {
  const displayKey = getDisplayFragmentKey(fragmentKey);
  const { getSchemaById, isLoading: isLoadingSchemas } = useSchemaInfo();
  const colors = getFragmentColorScheme(fragment);
  const runId = extractRunIdFromSourceRef(fragment.source_ref);
  const schemaId = fragment.schema_id || fragment.schema?.id;
  const schema = schemaId ? getSchemaById(schemaId) : null;
  const fieldDescription = schema ? getFieldDescriptionFromSchema(schema, fragmentKey) : null;

  const handleCopy = () => {
    navigator.clipboard.writeText(String(fragment.value || ''));
    toast.success(`Copied "${displayKey}" fragment value`);
  };

  const handleRunClick = () => {
    if (runId && onRunClick) {
      onRunClick(runId);
    }
  };

  return (
    <div 
      className={cn(
        "border rounded-lg p-3 min-w-0",
        colors.bg,
        className
      )}
      onClick={onFragmentClick}
    >
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <strong 
              className={cn("text-sm truncate", colors.text)} 
              title={fragmentKey}
            >
              {displayKey}
            </strong>
            {fieldDescription && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className={cn("h-3.5 w-3.5 flex-shrink-0 cursor-help", colors.text)} />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-sm">
                    <p className="text-sm">{fieldDescription}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          {isFromAnnotationRun(fragment) && runId && (
            <div className={cn("text-xs mt-0.5", colors.text)}>
              From Annotation Run #{runId}
              <Button
                variant="link"
                size="sm"
                className={cn("h-auto p-0 ml-2 text-xs", colors.text)}
                onClick={(e) => {
                  e.stopPropagation();
                  handleRunClick();
                }}
              >
                <ExternalLink className="h-3 w-3 mr-1" />
                Open in Runner
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              handleCopy();
            }}
            className="h-6 px-2 text-xs flex-shrink-0"
          >
            <Copy className="h-3 w-3" />
          </Button>
        </div>
      </div>
      
      {/* Fragment Value */}
      <div className="text-sm bg-white dark:bg-gray-800 p-3 rounded font-mono break-all w-full overflow-x-auto border mb-2">
        {String(fragment.value || '')}
      </div>
      
      {/* Metadata */}
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {fragment.source_ref && (
          <div className="flex items-center gap-1">
            <span className="font-medium">Source:</span>
            <span className="font-mono">{fragment.source_ref}</span>
          </div>
        )}
        {fragment.timestamp && (
          <div className="flex items-center gap-1">
            <span className="font-medium">Curated:</span>
            <span>{formatDistanceToNowStrict(new Date(fragment.timestamp), { addSuffix: true })}</span>
          </div>
        )}
        {fragment.curated_by_ref && (
          <div className="flex items-center gap-1">
            <span className="font-medium">By:</span>
            <span>{fragment.curated_by_ref}</span>
          </div>
        )}
      </div>
      
      {/* Schema Information */}
      {schemaId && !schema && isLoadingSchemas && (
        <div className={cn(
          "mt-2 p-2 rounded text-xs border-l-2",
          colors.bg,
          colors.text,
          colors.border
        )}>
          <div className="flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Loading schema information...</span>
          </div>
        </div>
      )}
      
      {schema && (
        <div className={cn(
          "mt-2 p-2 rounded text-xs border-l-2",
          colors.bg,
          colors.text,
          colors.border
        )}>
          <div className="flex items-center gap-2">
            <span className="font-medium">Schema:</span>
            <span>{schema.name}</span>
          </div>
          {schema.description && (
            <div className="mt-1 text-muted-foreground">
              {schema.description}
            </div>
          )}
        </div>
      )}
      
      {/* Fallback Schema Context Note */}
      {!schema && !schemaId && isFromAnnotationRun(fragment) && (
        <div className={cn(
          "mt-2 p-2 rounded text-xs border-l-2",
          colors.bg,
          colors.text,
          colors.border
        )}>
          <strong>Schema Context:</strong> This fragment was extracted from an annotation run. 
          The original schema definition and instructions are available in the annotation runner.
        </div>
      )}
    </div>
  );
}
