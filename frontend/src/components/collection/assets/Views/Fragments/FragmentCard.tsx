import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Copy, ExternalLink, HelpCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDistanceToNowStrict } from 'date-fns';
import { toast } from 'sonner';
import { SingleFragmentProps } from './types';
import { 
  getDisplayFragmentKey, 
  formatFragmentValue, 
  extractRunIdFromSourceRef,
  isFromAnnotationRun,
  getFragmentColorScheme,
  getFieldDescriptionFromSchema
} from './utils';
import { cn } from '@/lib/utils';
import { useSchemaInfo } from '@/hooks/useSchemaInfo';

/**
 * Compact card view of a fragment - shows key, value preview, and basic metadata
 */
export function FragmentCard({ 
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
        "border rounded-lg p-3 transition-colors",
        colors.bg,
        onFragmentClick && "cursor-pointer hover:shadow-sm",
        className
      )}
      onClick={onFragmentClick}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
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
              <Badge 
                variant="outline" 
                className={cn(
                  "text-xs cursor-pointer hover:opacity-80",
                  colors.badgeBg,
                  colors.badgeText
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  handleRunClick();
                }}
              >
                <ExternalLink className="h-3 w-3 mr-1" />
                Run #{runId}
              </Badge>
            )}
            {schema && (
              <Badge variant="outline" className="text-xs">
                {schema.name}
              </Badge>
            )}
          </div>
        </div>
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
      
      {/* Value Preview */}
      <div className="text-sm bg-white dark:bg-gray-800/50 p-2 rounded font-mono text-muted-foreground line-clamp-2 border">
        {formatFragmentValue(fragment.value, 150)}
      </div>
      
      {/* Metadata */}
      {fragment.timestamp && (
        <div className="mt-2 text-xs text-muted-foreground">
          <span className="font-medium">Curated:</span>{' '}
          {formatDistanceToNowStrict(new Date(fragment.timestamp), { addSuffix: true })}
        </div>
      )}
    </div>
  );
}
