import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter,
  DialogDescription 
} from '@/components/ui/dialog';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuSeparator,
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { 
  Save, 
  Settings2, 
  Plus, 
  Download, 
  Upload, 
  Share2, 
  Grid3X3,
  MoreHorizontal,
  Table,
  PieChart,
  MapPin,
  Network,
  TrendingUp,
  Layers
} from 'lucide-react';
import { DashboardConfig, PanelViewConfig, useAnnotationRunStore } from '@/zustand_stores/useAnnotationRunStore';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { AnnotationRunRead, AnnotationSchemaRead } from '@/client';
import ShareAnnotationRunDialog from './ShareAnnotationRunDialog';
import { VariableSplittingControls, VariableSplittingConfig } from './VariableSplittingControls';
import { FormattedAnnotation } from '@/lib/annotations/types';

interface DashboardToolbarProps {
  dashboardConfig: DashboardConfig | null;
  isDirty: boolean;
  onSave: () => Promise<void>;
  onUpdateConfig: (updates: Partial<DashboardConfig>) => void;
  onAddPanel: (panel: Omit<PanelViewConfig, 'id' | 'gridPos' | 'filters'>) => void;
  onCompactLayout?: () => void;
  activeRun?: AnnotationRunRead | null;
  // NEW: Props for variable splitting management
  allSchemas?: AnnotationSchemaRead[];
  allResults?: FormattedAnnotation[];
}

const panelTypes = [
  {
    type: 'table',
    name: 'Data Table',
    description: 'Tabular view of annotation results with filtering and sorting',
    icon: Table,
    color: 'bg-blue-500 dark:bg-blue-600'
  },
  {
    type: 'chart',
    name: 'Time Series/ Bar Chart',
    description: 'Line charts showing trends over time or bar charts showing count comparisons',
    icon: TrendingUp,
    color: 'bg-green-500 dark:bg-green-600'
  },
  {
    type: 'pie',
    name: 'Pie Chart',
    description: 'Distribution and proportion visualization',
    icon: PieChart,
    color: 'bg-amber-500 dark:bg-amber-600'
  },
  {
    type: 'map',
    name: 'Geographic Map',
    description: 'Spatial visualization of geocoded data',
    icon: MapPin,
    color: 'bg-red-500 dark:bg-red-600'
  },
  {
    type: 'graph',
    name: 'Knowledge Graph',
    description: 'Network visualization of relationships',
    icon: Network,
    color: 'bg-purple-500 dark:bg-purple-600'
  }
];

export function DashboardToolbar({ 
  dashboardConfig, 
  isDirty, 
  onSave, 
  onUpdateConfig, 
  onAddPanel, 
  onCompactLayout,
  activeRun,
  allSchemas = [],
  allResults = []
}: DashboardToolbarProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [editingName, setEditingName] = useState('');
  const [editingDescription, setEditingDescription] = useState('');
  
  // Get global variable splitting settings from the store
  const { getGlobalVariableSplitting, setGlobalVariableSplitting } = useAnnotationRunStore();

  const handleSave = async () => {
    if (!dashboardConfig) return;
    
    setIsSaving(true);
    try {
      await onSave();
      toast.success('Dashboard saved successfully');
    } catch (error) {
      toast.error('Failed to save dashboard');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddSinglePanel = (panelType: string) => {
    const panelConfig = panelTypes.find(p => p.type === panelType);
    if (!panelConfig) return;

    onAddPanel({
      type: panelType as any,
      name: panelConfig.name,
      description: panelConfig.description
    });
    
    toast.success(`${panelConfig.name} panel added`);
  };

  const handleShare = () => {
    if (!activeRun) {
      toast.error('No active run to share');
      return;
    }
    setIsShareDialogOpen(true);
  };

  const handleOpenSettings = () => {
    if (!dashboardConfig) return;
    setEditingName(dashboardConfig.name || '');
    setEditingDescription(dashboardConfig.description || '');
    setIsSettingsDialogOpen(true);
  };

  const handleSaveSettings = () => {
    if (!dashboardConfig) return;
    
    onUpdateConfig({
      name: editingName.trim() || 'Untitled Dashboard',
      description: editingDescription.trim() || undefined
    });
    
    setIsSettingsDialogOpen(false);
    toast.success('Dashboard settings updated');
  };

  if (!dashboardConfig) {
    return (
      <div className="flex items-center justify-center p-4 bg-muted/20 rounded-lg">
        <span className="text-muted-foreground">Loading dashboard configuration...</span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between p-4 bg-card rounded-lg border shadow-sm">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Grid3X3 className="h-5 w-5 text-muted-foreground" />
          <div>
            <h3 className="font-semibold text-sm">{dashboardConfig.name}</h3>
            {dashboardConfig.description && (
              <p className="text-xs text-muted-foreground">{dashboardConfig.description}</p>
            )}
          </div>
        </div>
        
        {isDirty && (
          <div className="flex items-center gap-2 text-amber-600">
            <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
            <span className="text-xs font-medium">Unsaved changes</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">

        {/* Add Individual Panels */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Panel
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <div className="p-2">
              <h4 className="font-medium text-sm mb-3 px-2">Add Visualization Panel</h4>
              <div className="grid grid-cols-1 gap-1">
                {panelTypes.map(panel => {
                  const Icon = panel.icon;
                  return (
                    <button
                      key={panel.type}
                      onClick={() => handleAddSinglePanel(panel.type)}
                      className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors text-left w-full"
                    >
                      <div className={cn("p-2 rounded-md text-white", panel.color)}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h5 className="font-medium text-sm">{panel.name}</h5>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                          {panel.description}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="h-6" />

        {/* Compact Layout Button */}
        {onCompactLayout && (
          <Button 
            onClick={onCompactLayout}
            variant="outline" 
            size="sm"
            className="min-w-[100px]"
          >
            <Layers className="h-4 w-4 mr-2" />
            Compact
          </Button>
        )}

        <Separator orientation="vertical" className="h-6" />

        {/* Save Button */}
        <Button 
          onClick={handleSave} 
          disabled={!isDirty || isSaving}
          size="sm"
          className="min-w-[80px]"
        >
          {isSaving ? (
            <span className="flex items-center gap-2">
              <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              Saving...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Save className="h-4 w-4" />
              Save
            </span>
          )}
        </Button>

        {/* More Options */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>
              <Download className="h-4 w-4 mr-2" />
              Export Dashboard
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Upload className="h-4 w-4 mr-2" />
              Import Dashboard
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleShare}>
              <Share2 className="h-4 w-4 mr-2" />
              Share Dashboard
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleOpenSettings}>
              <Settings2 className="h-4 w-4 mr-2" />
              Dashboard Settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      
      {/* Share Dialog */}
      {isShareDialogOpen && activeRun && (
        <ShareAnnotationRunDialog
          run={activeRun}
          onClose={() => setIsShareDialogOpen(false)}
        />
      )}

      {/* Dashboard Settings Dialog */}
      <Dialog open={isSettingsDialogOpen} onOpenChange={setIsSettingsDialogOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Dashboard Settings</DialogTitle>
            <DialogDescription>
              Configure your dashboard properties and run-wide analysis settings.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">
            <div className="grid gap-6 py-4">
              {/* Basic Settings */}
              <div className="space-y-4">
                <h4 className="text-sm font-medium text-foreground">Basic Settings</h4>
                <div className="grid gap-2">
                  <Label htmlFor="dashboard-name">Dashboard Name</Label>
                  <Input
                    id="dashboard-name"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    placeholder="Enter dashboard name..."
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="dashboard-description">Description</Label>
                  <Textarea
                    id="dashboard-description"
                    value={editingDescription}
                    onChange={(e) => setEditingDescription(e.target.value)}
                    placeholder="Enter dashboard description (optional)..."
                    rows={3}
                  />
                </div>
              </div>

              {/* Variable Splitting Settings */}
              <Separator />
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-foreground">Variable Splitting & Grouping</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    Configure how data is grouped and split across all dashboard panels.
                  </p>
                </div>
                <VariableSplittingControls
                  schemas={allSchemas}
                  results={allResults}
                  value={(() => {
                    const globalSettings = getGlobalVariableSplitting();
                    if (!globalSettings) return null;
                    
                    return {
                      enabled: globalSettings.enabled,
                      schemaId: globalSettings.schemaId,
                      fieldKey: globalSettings.fieldKey,
                      visibleSplits: globalSettings.visibleSplits ? new Set(globalSettings.visibleSplits) : undefined,
                      maxSplits: globalSettings.maxSplits,
                      groupOthers: globalSettings.groupOthers,
                      valueAliases: globalSettings.valueAliases || {}
                    };
                  })()}
                  onChange={(config) => {
                    // Convert component format back to store format
                    const storeConfig = config ? {
                      enabled: config.enabled,
                      schemaId: config.schemaId,
                      fieldKey: config.fieldKey,
                      visibleSplits: config.visibleSplits ? Array.from(config.visibleSplits) : undefined,
                      maxSplits: config.maxSplits,
                      groupOthers: config.groupOthers,
                      valueAliases: config.valueAliases || {}
                    } : undefined;
                    
                    setGlobalVariableSplitting(storeConfig);
                  }}
                  showAdvancedControls={true}
                />
              </div>
            </div>
          </div>
          <DialogFooter className="flex-shrink-0">
            <Button variant="outline" onClick={() => setIsSettingsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveSettings}>
              Save Settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
} 