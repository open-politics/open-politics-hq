'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useFlowStore } from '@/zustand_stores/storeFlows';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { FlowRead } from '@/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { formatDistanceToNowStrict } from 'date-fns';
import {
  Activity,
  Plus,
  Play,
  Pause,
  Trash2,
  Loader2,
  FolderOpen,
  ArrowRight,
  Zap,
  Filter,
  Microscope,
  Tag,
  Search,
  MoreVertical,
  Radio,
  Clock,
  CheckCircle2,
  AlertCircle,
  GitBranch,
  ChevronRight,
  RefreshCw,
  Settings,
  Eye,
} from 'lucide-react';

// Status configuration
const statusConfig: Record<string, { color: string; bgColor: string; icon: React.ElementType }> = {
  draft: { color: 'text-gray-500', bgColor: 'bg-gray-100 dark:bg-gray-800', icon: Settings },
  active: { color: 'text-green-600', bgColor: 'bg-green-100 dark:bg-green-900/30', icon: CheckCircle2 },
  paused: { color: 'text-yellow-600', bgColor: 'bg-yellow-100 dark:bg-yellow-900/30', icon: Pause },
  error: { color: 'text-red-600', bgColor: 'bg-red-100 dark:bg-red-900/30', icon: AlertCircle },
};

// Step icons
const stepIcons: Record<string, React.ElementType> = {
  FILTER: Filter,
  ANNOTATE: Microscope,
  CURATE: Tag,
  ROUTE: GitBranch,
  EMBED: Zap,
  ANALYZE: Activity,
};

const stepColors: Record<string, string> = {
  FILTER: 'bg-orange-500',
  ANNOTATE: 'bg-purple-500',
  CURATE: 'bg-teal-500',
  ROUTE: 'bg-blue-500',
  EMBED: 'bg-yellow-500',
  ANALYZE: 'bg-pink-500',
};

interface FlowListViewProps {
  onSelectFlow: (flow: FlowRead) => void;
  onCreateFlow: () => void;
}

function FlowCard({ 
  flow, 
  bundles,
  onSelect,
  onActivate,
  onPause,
  onTrigger,
  onDelete,
}: {
  flow: FlowRead;
  bundles: { id: number; name: string }[];
  onSelect: () => void;
  onActivate: () => void;
  onPause: () => void;
  onTrigger: () => void;
  onDelete: () => void;
}) {
  const status = statusConfig[flow.status || 'draft'] || statusConfig.draft;
  const StatusIcon = status.icon;
  const inputBundle = bundles.find(b => b.id === flow.input_bundle_id);
  const steps = (flow.steps as any[]) || [];
  
  // Find output bundle from ROUTE step
  const routeStep = steps.find(s => s.type === 'ROUTE');
  const outputBundle = routeStep?.bundle_id ? bundles.find(b => b.id === routeStep.bundle_id) : null;

  return (
    <Card 
      className={cn(
        "group cursor-pointer transition-all hover:shadow-lg hover:border-primary/50",
        flow.status === 'active' && "border-green-300 dark:border-green-700"
      )}
      onClick={onSelect}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={cn(
              "p-2 rounded-lg",
              status.bgColor
            )}>
              <Activity className={cn("h-5 w-5", status.color)} />
            </div>
            <div>
              <CardTitle className="text-base group-hover:text-primary transition-colors">
                {flow.name}
              </CardTitle>
              {flow.description && (
                <CardDescription className="text-xs mt-0.5 line-clamp-1">
                  {flow.description}
                </CardDescription>
              )}
            </div>
          </div>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onSelect(); }}>
                <Eye className="h-4 w-4 mr-2" />
                View Pipeline
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {flow.status === 'active' ? (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onPause(); }}>
                  <Pause className="h-4 w-4 mr-2" />
                  Pause
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onActivate(); }}>
                  <Play className="h-4 w-4 mr-2" />
                  Activate
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onTrigger(); }}>
                <Zap className="h-4 w-4 mr-2" />
                Run Now
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                className="text-destructive focus:text-destructive"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Pipeline Visualization */}
        <div className="flex items-center gap-2 text-sm overflow-x-auto pb-1">
          {/* Input Bundle */}
          {inputBundle ? (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-blue-50 dark:bg-blue-950/30 rounded border border-blue-200 dark:border-blue-800 flex-shrink-0">
              <FolderOpen className="h-3.5 w-3.5 text-blue-600" />
              <span className="text-xs font-medium text-blue-700 dark:text-blue-300 truncate max-w-[80px]">
                {inputBundle.name}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-muted rounded border border-dashed flex-shrink-0">
              <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">No input</span>
            </div>
          )}

          <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />

          {/* Steps */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {steps.map((step, i) => {
              const StepIcon = stepIcons[step.type] || Activity;
              return (
                <div
                  key={i}
                  className={cn(
                    "p-1.5 rounded",
                    stepColors[step.type] ? `${stepColors[step.type]}/10` : 'bg-muted'
                  )}
                  title={step.type}
                >
                  <StepIcon className={cn(
                    "h-3.5 w-3.5",
                    stepColors[step.type]?.replace('bg-', 'text-') || 'text-muted-foreground'
                  )} />
                </div>
              );
            })}
          </div>

          {/* Output Bundle */}
          {outputBundle && (
            <>
              <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-50 dark:bg-emerald-950/30 rounded border border-emerald-200 dark:border-emerald-800 flex-shrink-0">
                <FolderOpen className="h-3.5 w-3.5 text-emerald-600" />
                <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300 truncate max-w-[80px]">
                  {outputBundle.name}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Status & Stats Row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge className={cn("text-xs", status.bgColor, status.color)}>
              <StatusIcon className="h-3 w-3 mr-1" />
              {flow.status}
            </Badge>
            {flow.trigger_mode === 'on_arrival' && (
              <Badge variant="outline" className="text-xs">
                <Radio className="h-3 w-3 mr-1 text-green-500" />
                Auto
              </Badge>
            )}
          </div>
          
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Play className="h-3 w-3" />
              {flow.total_executions || 0}
            </span>
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              {flow.total_assets_processed || 0}
            </span>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-2 pt-2 border-t">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={(e) => { e.stopPropagation(); onSelect(); }}
          >
            <Eye className="h-3.5 w-3.5 mr-1.5" />
            View
          </Button>
          {flow.status === 'active' ? (
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={(e) => { e.stopPropagation(); onPause(); }}
            >
              <Pause className="h-3.5 w-3.5 mr-1.5" />
              Pause
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              className="flex-1"
              onClick={(e) => { e.stopPropagation(); onActivate(); }}
            >
              <Play className="h-3.5 w-3.5 mr-1.5" />
              Activate
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function FlowListView({ onSelectFlow, onCreateFlow }: FlowListViewProps) {
  const { activeInfospace } = useInfospaceStore();
  const { flows, isLoading, fetchFlows, activateFlow, pauseFlow, deleteFlow, triggerExecution } = useFlowStore();
  const { bundles, fetchBundles } = useBundleStore();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useEffect(() => {
    if (activeInfospace?.id) {
      fetchFlows();
      fetchBundles(activeInfospace.id);
    }
  }, [activeInfospace?.id, fetchFlows, fetchBundles]);

  const filteredFlows = useMemo(() => {
    return flows.filter(f => {
      const matchesSearch = !searchQuery || 
        f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.description?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'all' || f.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [flows, searchQuery, statusFilter]);

  const stats = useMemo(() => ({
    total: flows.length,
    active: flows.filter(f => f.status === 'active').length,
    paused: flows.filter(f => f.status === 'paused').length,
    draft: flows.filter(f => f.status === 'draft').length,
  }), [flows]);

  const bundleOptions = bundles.map(b => ({ id: b.id, name: b.name }));

  const handleDelete = async (flowId: number) => {
    if (confirm('Are you sure you want to delete this flow?')) {
      await deleteFlow(flowId);
    }
  };

  if (!activeInfospace) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Please select an infospace first.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 border-b">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Activity className="h-5 w-5 text-violet-500" />
            Processing Flows
          </h1>
          <p className="text-sm text-muted-foreground">
            Automated pipelines for annotation, curation, and routing
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => fetchFlows()}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
          <Button onClick={onCreateFlow}>
            <Plus className="h-4 w-4 mr-1" />
            New Flow
          </Button>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="flex items-center gap-4 p-4 bg-muted/30 border-b">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Total:</span>
          <span className="font-medium">{stats.total}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-muted-foreground">Active:</span>
          <span className="font-medium">{stats.active}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <div className="w-2 h-2 rounded-full bg-yellow-500" />
          <span className="text-muted-foreground">Paused:</span>
          <span className="font-medium">{stats.paused}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <div className="w-2 h-2 rounded-full bg-gray-400" />
          <span className="text-muted-foreground">Draft:</span>
          <span className="font-medium">{stats.draft}</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 p-4 border-b">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search flows..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Tabs value={statusFilter} onValueChange={setStatusFilter}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="paused">Paused</TabsTrigger>
            <TabsTrigger value="draft">Draft</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredFlows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64">
            <Activity className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-medium mb-2">
              {flows.length === 0 ? 'No Flows Yet' : 'No Matching Flows'}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {flows.length === 0 
                ? 'Create your first processing flow to automate your pipeline.'
                : 'Try adjusting your search or filter.'}
            </p>
            {flows.length === 0 && (
              <Button onClick={onCreateFlow}>
                <Plus className="h-4 w-4 mr-2" />
                Create Flow
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredFlows.map(flow => (
              <FlowCard
                key={flow.id}
                flow={flow}
                bundles={bundleOptions}
                onSelect={() => onSelectFlow(flow)}
                onActivate={() => activateFlow(flow.id)}
                onPause={() => pauseFlow(flow.id)}
                onTrigger={() => triggerExecution(flow.id)}
                onDelete={() => handleDelete(flow.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
