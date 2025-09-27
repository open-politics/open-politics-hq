'use client';

import React, { useState, useEffect, useCallback, useRef, ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlusCircle, Edit, Blocks, Trash2, Eye, Search, XCircle, Loader2, Microscope, ListTree, AlertTriangle, Upload, Download, LayoutGrid, List } from 'lucide-react';
import { AnnotationSchemaRead } from '@/client/models';
import AnnotationSchemaEditor from './AnnotationSchemaEditor';
import { useAnnotationSystem } from '@/hooks/useAnnotationSystem';
import { useToast } from "@/components/ui/use-toast"
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { adaptSchemaReadToSchemaFormData as transformApiToFormData } from '@/lib/annotations/adapters';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useIsMobile } from '@/hooks/use-mobile';
import AnnotationSchemaCard from './AnnotationSchemaCard';
import { SchemePreview } from './schemaCreation/SchemePreview';

// Interface for export dialog state
interface ExportDialogState {
  open: boolean;
  schemasToExport: AnnotationSchemaRead[];
  defaultFilename: string;
  currentFilename: string;
}

const AnnotationSchemaManager: React.FC = () => {
    const {
        schemas,
        loadSchemas,
        createSchema,
        archiveSchema,
        restoreSchema,
        isLoadingSchemas,
        error: schemasError
    } = useAnnotationSystem();
    const { toast } = useToast();
    const isMobile = useIsMobile();

    const [searchTerm, setSearchTerm] = useState('');
    const [showArchived, setShowArchived] = useState(false);
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [editorMode, setEditorMode] = useState<'create' | 'edit' | 'watch'>('create');
    const [selectedSchema, setSelectedSchema] = useState<AnnotationSchemaRead | null>(null);
    const [schemaToDelete, setSchemaToDelete] = useState<AnnotationSchemaRead | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [viewMode, setViewMode] = useState<'list' | 'grid'>(isMobile ? 'grid' : 'list');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [selectedSchemaIds, setSelectedSchemaIds] = useState<Set<number>>(new Set());
    const [exportDialogState, setExportDialogState] = useState<ExportDialogState>({
      open: false,
      schemasToExport: [],
      defaultFilename: '',
      currentFilename: ''
    });
    const [isBulkArchiveDialogOpen, setIsBulkArchiveDialogOpen] = useState(false);
    const [viewingSchema, setViewingSchema] = useState<AnnotationSchemaRead | null>(null);

    useEffect(() => {
      setSelectedSchemaIds(new Set());
    }, [schemas]);

    useEffect(() => {
        loadSchemas({ includeArchived: showArchived });
    }, [loadSchemas, showArchived]);

    // Automatically switch to grid view on mobile, list view on desktop
    useEffect(() => {
        setViewMode(isMobile ? 'grid' : 'list');
    }, [isMobile]);



    const handleOpenEditor = (mode: 'create' | 'edit' | 'watch', schema?: AnnotationSchemaRead) => {
        setEditorMode(mode);
        setSelectedSchema(schema || null);
        setIsEditorOpen(true);
    };

    const handleCloseEditor = () => {
        setIsEditorOpen(false);
        setSelectedSchema(null);
    };

    const handleSaveSuccess = (savedSchema: AnnotationSchemaRead) => {
        handleCloseEditor();
        loadSchemas({ force: true });
    };

    const handleDeleteClick = (schema: AnnotationSchemaRead) => {
        setSchemaToDelete(schema);
    };

    const confirmDelete = async () => {
        if (!schemaToDelete) return;
        setIsDeleting(true);
        try {
            await archiveSchema(schemaToDelete.id);
            setSchemaToDelete(null);
            // The optimistic update in the hook handles the UI change
        } catch (error: any) {
            const errorMsg = error.body?.detail || "Could not archive schema.";
            toast({ title: "Archive Failed", description: errorMsg, variant: "destructive" });
        } finally {
            setIsDeleting(false);
        }
    };

    const handleBulkArchive = async () => {
        const idsToArchive = Array.from(selectedSchemaIds);
        if (idsToArchive.length === 0) return;

        toast({
            title: "Archiving Schemas",
            description: `Attempting to archive ${idsToArchive.length} schemas...`,
        });

        const results = await Promise.allSettled(
            idsToArchive.map(id => archiveSchema(id))
        );

        const successfulArchives = results.filter(r => r.status === 'fulfilled').length;
        const failedArchives = results.length - successfulArchives;

        if (failedArchives > 0) {
            toast({
                title: "Bulk Archive Partially Failed",
                description: `${successfulArchives} schemas archived. ${failedArchives} failed. See console for details.`,
                variant: "destructive",
            });
            results.forEach(result => {
                if (result.status === 'rejected') {
                }
            });
        } else {
            toast({
                title: "Bulk Archive Successful",
                description: `${successfulArchives} schemas have been archived.`,
            });
        }

        setSelectedSchemaIds(new Set()); // Clear selection after operation
        setIsBulkArchiveDialogOpen(false); // Close dialog
    };

    const handleRestoreClick = async (schema: AnnotationSchemaRead) => {
        try {
            await restoreSchema(schema.id);
        } catch (error: any) {
            const errorMsg = error.body?.detail || "Could not restore schema.";
            toast({ title: "Restore Failed", description: errorMsg, variant: "destructive" });
        }
    };

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsImporting(true);
        const reader = new FileReader();

        reader.onload = async (e) => {
          const text = e.target?.result;
          if (typeof text !== 'string') {
            toast({ title: 'Error reading file', description: 'Could not read file content.', variant: 'destructive' });
            setIsImporting(false);
            return;
          }

          try {
            const importedData = JSON.parse(text);
            const importedSchemas = Array.isArray(importedData) ? importedData : [importedData];

            if (!Array.isArray(importedSchemas)) {
              throw new Error('Imported file must contain a JSON object or array of schemas.');
            }

            let successCount = 0;
            let errorCount = 0;

            for (const importedSchema of importedSchemas) {
              try {
                if (!importedSchema.name || !importedSchema.output_contract) {
                  throw new Error(`Invalid schema structure for item: ${JSON.stringify(importedSchema).substring(0, 50)}...`);
                }
                const schemaFormData = transformApiToFormData(importedSchema as any);
                const created = await createSchema(schemaFormData);
                if (created) {
                    successCount++;
                } else {
                    throw new Error(`Creation via hook failed for schema '${importedSchema.name || 'Unnamed'}'`);
                }
              } catch (individualError: any) {
                errorCount++;
                toast({ title: 'Import Error (Individual)', description: `Failed to import schema '${importedSchema.name || 'Unnamed'}': ${individualError.message}`, variant: 'destructive' });
              }
            }

            toast({
              title: 'Import Complete',
              description: `${successCount} schemas imported successfully, ${errorCount} failed.`,
              variant: errorCount > 0 ? 'default' : 'default'
            });

          } catch (error: any) {
            toast({ title: 'Import Failed', description: `Error parsing or processing file: ${error.message}`, variant: 'destructive' });
          } finally {
            setIsImporting(false);
            if (event.target) {
              event.target.value = '';
            }
            loadSchemas();
          }
        };

        reader.onerror = () => {
          toast({ title: 'Error reading file', description: 'Failed to read the selected file.', variant: 'destructive' });
          setIsImporting(false);
        };

        reader.readAsText(file);
    };

    const openExportDialog = (schemasToExport: AnnotationSchemaRead[], defaultFilename: string) => {
        if (schemasToExport.length === 0) {
             toast({ title: 'No Schemas Selected', description: 'Please select schemas to export.', variant: 'default' });
             return;
         }
         setExportDialogState({
            open: true,
            schemasToExport: schemasToExport,
            defaultFilename,
            currentFilename: defaultFilename
         });
    };

    const handleExportAll = () => {
        openExportDialog(schemas, 'all_schemas.json');
    };

    const handleExportSelected = () => {
        const selected = schemas.filter(schema => selectedSchemaIds.has(schema.id));
        const defaultFilename = `selected_schemas_${selected.length}.json`;
        openExportDialog(selected, defaultFilename);
    };

    const confirmExport = () => {
        const { schemasToExport, currentFilename } = exportDialogState;
        const filename = currentFilename.trim() || exportDialogState.defaultFilename;
        const finalFilename = filename.endsWith('.json') ? filename : `${filename}.json`;

        if (schemasToExport.length === 0) {
            toast({ title: 'Export Error', description: 'No schemas available for export.', variant: 'destructive' });
            closeExportDialog();
            return;
        }

        try {
            const jsonString = JSON.stringify(schemasToExport, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = finalFilename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            toast({ title: 'Export Successful', description: `${schemasToExport.length} schemas exported to ${finalFilename}.`, variant: 'default' });
            closeExportDialog();
            setSelectedSchemaIds(new Set());
        } catch (error) {
            toast({ title: 'Export Failed', description: 'Could not generate export file.', variant: 'destructive' });
        }
    };

    const closeExportDialog = () => {
        setExportDialogState(prev => ({ ...prev, open: false }));
    };

    const handleSelectAll = (checked: boolean | 'indeterminate') => {
      if (checked === true) {
        const allIds = new Set(filteredSchemas.map(s => s.id));
        setSelectedSchemaIds(allIds);
      } else {
        setSelectedSchemaIds(new Set());
      }
    };

    const handleRowSelect = (schemaId: number, checked: boolean) => {
      setSelectedSchemaIds(prev => {
        const newSet = new Set(prev);
        if (checked) {
          newSet.add(schemaId);
        } else {
          newSet.delete(schemaId);
        }
        return newSet;
      });
    };

    const filteredSchemas = schemas.filter(schema =>
        schema.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        schema.description?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const numSelected = selectedSchemaIds.size;
    const numFiltered = filteredSchemas.length;
    const isAllSelected = numFiltered > 0 && numSelected === numFiltered;
    const isIndeterminate = numSelected > 0 && numSelected < numFiltered;

    return (
        <div className="flex flex-col h-full p-4 ">
            {/* Header with title and primary action */}
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 flex items-center gap-2 rounded-xl bg-sky-50/20 dark:bg-sky-950/10 border border-sky-200 dark:border-sky-800 shadow-sm">
                            <Microscope className="h-6 w-6 text-sky-700 dark:text-sky-400" />
                            <Blocks className="h-6 w-6 text-sky-700 dark:text-sky-400" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Annotation Schemas</h2>
                            <p className="text-gray-600 dark:text-gray-400 text-sm">
                                Manage your classification schemes and analysis templates
                            </p>
                        </div>
                    </div>
                    {!isMobile && (
                        <ToggleGroup type="single" value={viewMode} onValueChange={(value) => value && setViewMode(value as any)} size="sm">
                            <ToggleGroupItem value="list" aria-label="List view"><List className="h-4 w-4" /></ToggleGroupItem>
                            <ToggleGroupItem value="grid" aria-label="Grid view"><LayoutGrid className="h-4 w-4" /></ToggleGroupItem>
                        </ToggleGroup>
                    )}
                </div>
            </div>

            {/* Search and Filter Controls */}
            <div className="flex flex-col sm:flex-row gap-4 mb-4">
                <div className="flex-1 relative min-w-0">
                   <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                   <Input
                       type="text"
                       placeholder="Search schemas by name or description..."
                       value={searchTerm}
                       onChange={(e) => setSearchTerm(e.target.value)}
                       className="pl-10 h-10"
                   />
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <Checkbox
                        id="show-archived"
                        checked={showArchived}
                        onCheckedChange={(checked) => setShowArchived(!!checked)}
                    />
                    <Label htmlFor="show-archived" className="text-sm font-medium whitespace-nowrap">
                        Show Archived
                    </Label>
                </div>
            </div>

            {/* Action Bar - Secondary Actions */}
            <div className="flex flex-col sm:flex-row gap-3 mb-6 p-3 rounded-lg border backdrop-blur-sm">
                {/* File Operations Group */}
                <div className="flex items-center gap-2">          
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">File Operations</span>
                    <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={handleImportClick} disabled={isImporting} className="h-8">
                            {isImporting ? (
                               <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                            ) : (
                               <Download className="h-3 w-3 mr-1.5" />
                            )}
                            Import
                        </Button>
                        <Button size="sm" variant="outline" onClick={handleExportAll} disabled={schemas.length === 0 || isLoadingSchemas} className="h-8">
                           <Upload className="h-3 w-3 mr-1.5" />
                           Export All ({schemas.length})
                        </Button>
                    </div>
                </div>

                {/* Selection-Based Actions Group */}
                {numSelected > 0 && (
                    <div className="flex items-center gap-2 border-l border-border pl-3 ml-3">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            {numSelected} Selected
                        </span>
                        <div className="flex gap-1">
                            <Button size="sm" variant="outline" onClick={handleExportSelected} className="h-8">
                               <Download className="h-3 w-3 mr-1.5" />
                               Export
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => setIsBulkArchiveDialogOpen(true)} className="h-8">
                                <Trash2 className="h-3 w-3 mr-1.5" />
                                Archive
                            </Button>
                        </div>
                    </div>
                )}
            </div>

             {isLoadingSchemas && !schemasError && (
                 <div className="flex-grow flex items-center justify-center">
                     <Loader2 className="h-8 w-8 animate-spin text-primary" />
                     <span className="ml-2 text-muted-foreground">Loading schemas...</span>
                 </div>
             )}

            {schemasError && !isLoadingSchemas && (
                <div className="flex-grow flex flex-col items-center justify-center p-4 border border-destructive/50 bg-destructive/10 rounded-lg">
                    <XCircle className="h-10 w-10 text-destructive mb-2"/>
                    <p className="text-destructive font-medium">Error loading schemas</p>
                    <p className="text-xs text-destructive/80 text-center mt-1">{schemasError}</p>
                    <Button variant="outline" size="sm" onClick={() => loadSchemas({ includeArchived: showArchived })} className="mt-4">Retry</Button>
                </div>
            )}

            {!isLoadingSchemas && !schemasError && viewMode === 'list' && (
                 <div className="flex-grow overflow-hidden border rounded-lg">
                    <ScrollArea className="h-full backdrop-blur-sm overflow-x-auto">
                       <Table className="backdrop-blur-sm">
                          <TableHeader className="sticky top-0 z-10 backdrop-blur-xl shadow-sm">
                              <TableRow>
                                  <TableHead className="w-[50px] px-2">
                                     <Checkbox
                                         checked={isAllSelected ? true : (isIndeterminate ? 'indeterminate' : false)}
                                         onCheckedChange={handleSelectAll}
                                         aria-label="Select all"
                                         disabled={numFiltered === 0}
                                      />
                                  </TableHead>
                                  <TableHead className="w-[250px]">Name</TableHead>
                                  <TableHead>Description</TableHead>
                                  <TableHead className="w-[100px] text-center">Fields</TableHead>
                                  <TableHead className="w-[120px] text-center">Annotations</TableHead>
                                  <TableHead className="w-[150px]">Last Updated</TableHead>
                                  <TableHead className="w-[150px] text-right pr-4">Actions</TableHead>
                              </TableRow>
                          </TableHeader>
                          <TableBody className="">
                            <TableRow>
                                {/* Clickable row for creating a new schema */}
                                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                                    <Button onClick={() => handleOpenEditor('create')} className="h-8 px-3 text-xs font-medium">
                                        <PlusCircle className="h-4 w-4 mr-1.5" />
                                        Create Schema
                                    </Button>
                                </TableCell>
                            </TableRow>
                              {filteredSchemas.length > 0 ? (
                                  filteredSchemas.map((schema) => (
                                      <TableRow 
                                          key={schema.id}
                                          data-state={selectedSchemaIds.has(schema.id) ? "selected" : ""}
                                          className={cn(!schema.is_active && " text-muted-foreground cursor-pointer")}
                                          onClick={() => setViewingSchema(schema)}
                                      >
                                          <TableCell className="px-2">
                                            <div className="flex items-center h-full" onClick={(e) => e.stopPropagation()}>
                                              <Checkbox
                                                  checked={selectedSchemaIds.has(schema.id)}
                                                  onCheckedChange={(checked) => handleRowSelect(schema.id, !!checked)}
                                                  aria-label="Select row"
                                              />
                                            </div>
                                          </TableCell>
                                          <TableCell className="font-medium truncate" title={schema.name}>
                                            {schema.name}
                                            {!schema.is_active && <Badge variant="outline" className="ml-2">Archived</Badge>}
                                          </TableCell>
                                          <TableCell className="text-muted-foreground text-sm max-w-sm truncate" title={schema.description || undefined}>{schema.description || '-'}</TableCell>
                                          <TableCell className="text-center text-sm">{Object.keys((schema.output_contract as any)?.properties || {}).length}</TableCell>
                                          <TableCell className="text-center text-sm">{(schema as any).annotation_count ?? '-'}</TableCell>
                                          <TableCell className="text-muted-foreground text-xs">
                                              {schema.updated_at ? formatDistanceToNow(new Date(schema.updated_at), { addSuffix: true }) : '-'}
                                          </TableCell>
                                          <TableCell className="text-right pr-4">
                                              <div className="flex justify-end items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                                  {/* Primary actions group */}
                                                  <div className="flex gap-0.5">
                                                      <Button 
                                                          variant="ghost" 
                                                          size="icon" 
                                                          className="h-8 w-8 text-muted-foreground hover:text-foreground" 
                                                          onClick={() => handleOpenEditor('watch', schema)} 
                                                          title="View Schema"
                                                      >
                                                          <Eye className="h-4 w-4" />
                                                      </Button>
                                                      {schema.is_active && (
                                                          <Button 
                                                              variant="ghost" 
                                                              size="icon" 
                                                              className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-primary/10" 
                                                              onClick={() => handleOpenEditor('edit', schema)} 
                                                              title="Edit Schema"
                                                          >
                                                              <Edit className="h-4 w-4" />
                                                          </Button>
                                                      )}
                                                  </div>
                                                  
                                                  {/* Secondary actions - separated */}
                                                  <div className="flex gap-0.5 ml-1 border-l border-border pl-1">
                                                      {schema.is_active ? (
                                                          <AlertDialogTrigger asChild>
                                                              <Button 
                                                                  variant="ghost" 
                                                                  size="icon" 
                                                                  className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10" 
                                                                  onClick={() => handleDeleteClick(schema)} 
                                                                  title="Archive Schema"
                                                              >
                                                                  <Trash2 className="h-4 w-4" />
                                                              </Button>
                                                          </AlertDialogTrigger>
                                                      ) : (
                                                          <Button 
                                                              variant="outline" 
                                                              size="sm" 
                                                              className="h-8 px-3 text-xs font-medium"
                                                              onClick={() => handleRestoreClick(schema)}
                                                              title="Restore Schema"
                                                          >
                                                              Restore
                                                          </Button>
                                                      )}
                                                  </div>
                                              </div>
                                          </TableCell>
                                      </TableRow>
                                  ))
                              ) : (
                                  <TableRow>
                                      <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                                          {schemas.length === 0 ? "No annotation schemas created yet." : "No schemas match your search."} 
                                      </TableCell>
                                  </TableRow>
                              )}
                          </TableBody>
                       </Table>
                    </ScrollArea>
                 </div>
            )}
            
            {!isLoadingSchemas && !schemasError && viewMode === 'grid' && (
                <ScrollArea className="flex-grow backdrop-blur-sm">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        <Card 
                            className="flex flex-col transition-all border border-dashed border-primary/50 bg-background/70 hover:border-primary hover:shadow-md cursor-pointer group"
                            onClick={() => handleOpenEditor('create')}
                        >
                            <CardHeader className="flex flex-row items-center justify-center gap-4 pb-2">
                                <div className="flex flex-col items-center text-center space-y-2">
                                    <PlusCircle className="h-8 w-8 text-primary/50 group-hover:text-primary transition-colors" />
                                    <CardTitle className="text-base">Create New Schema</CardTitle>
                                    <CardDescription className="text-sm">
                                        Set up a new annotation schema for your documents
                                    </CardDescription>
                                </div>
                            </CardHeader>
                        </Card>
                        {filteredSchemas.map(schema => (
                            <SchemaCard
                                key={schema.id}
                                schema={schema}
                                isSelected={selectedSchemaIds.has(schema.id)}
                                onSelect={handleRowSelect}
                                onOpenEditor={handleOpenEditor}
                                onDeleteClick={handleDeleteClick}
                                onRestoreClick={handleRestoreClick}
                                onViewSchema={setViewingSchema}
                            />
                        ))}
                    </div>
                     {filteredSchemas.length === 0 && (
                        <div className="col-span-full h-48 flex items-center justify-center text-muted-foreground">
                             {schemas.length === 0 ? "No annotation schemas created yet." : "No schemas match your search."}
                        </div>
                     )}
                </ScrollArea>
            )}

            <AnnotationSchemaEditor
                key={selectedSchema?.id || 'create'}
                show={isEditorOpen}
                mode={editorMode}
                schemeId={selectedSchema?.id}
                onClose={handleCloseEditor}
                defaultValues={selectedSchema}
            />

            <AlertDialog open={!!schemaToDelete} onOpenChange={(open) => !open && setSchemaToDelete(null)}>
              <AlertDialogContent>
                  <AlertDialogHeader>
                      <AlertDialogTitle>Are you sure you want to archive this schema?</AlertDialogTitle>
                      <AlertDialogDescription>
                          This will hide the schema from the default list and prevent it from being used in new runs.
                          You can restore it later. It will NOT delete existing annotations.
                           <span className="font-semibold block mt-2"> "{schemaToDelete?.name}"</span>
                      </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                      <AlertDialogCancel onClick={() => setSchemaToDelete(null)} disabled={isDeleting}>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                          onClick={confirmDelete}
                          disabled={isDeleting}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                          {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4"/>}
                           Archive Schema
                      </AlertDialogAction>
                  </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={isBulkArchiveDialogOpen} onOpenChange={setIsBulkArchiveDialogOpen}>
              <AlertDialogContent>
                  <AlertDialogHeader>
                      <AlertDialogTitle>Archive Multiple Schemas?</AlertDialogTitle>
                      <AlertDialogDescription>
                          You are about to archive {selectedSchemaIds.size} selected schema(s). This will hide them from the default list and prevent them from being used in new runs.
                          <br /><br />
                          This action can be reversed by viewing archived schemas and restoring them individually.
                      </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                          onClick={handleBulkArchive}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                           <Trash2 className="mr-2 h-4 w-4"/>
                           Archive Schemas
                      </AlertDialogAction>
                  </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={exportDialogState.open} onOpenChange={(open) => !open && closeExportDialog()}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Export Schemas</AlertDialogTitle>
                        <AlertDialogDescription>
                            Enter a filename for the export. The file will contain {exportDialogState.schemasToExport.length} schema(s).
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <Input
                        type="text"
                        value={exportDialogState.currentFilename}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setExportDialogState(prev => ({...prev, currentFilename: e.target.value }))}
                        placeholder={exportDialogState.defaultFilename}
                        className="mt-2"
                    />
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={closeExportDialog}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmExport}>
                            <Download className="mr-2 h-4 w-4"/> Export
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

           <input 
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".json"
                style={{ display: 'none' }}
           />

           <AnnotationSchemaCard
               show={!!viewingSchema}
               onClose={() => setViewingSchema(null)}
               title={`Schema: ${viewingSchema?.name}`}
               mode="watch"
           >
               {viewingSchema && <SchemePreview scheme={viewingSchema} />}
               <div className="flex flex-row gap-2"> 
               <Button variant="outline" onClick={() => setViewingSchema(null)}>Close</Button>
               <Button variant="default" onClick={() => {
                   if (viewingSchema) {
                       setViewingSchema(null);
                       handleOpenEditor('edit', viewingSchema);
                   }
               }}>Edit</Button>
               </div>
           </AnnotationSchemaCard>
         </div>
     );
 };

 const AnnotationSchemaManagerWrapper = () => (
     <AlertDialog>
         <AnnotationSchemaManager />
     </AlertDialog>
 );
 
interface SchemaCardProps {
    schema: AnnotationSchemaRead;
    isSelected: boolean;
    isSkeleton?: boolean;
    onSelect: (id: number, checked: boolean) => void;
    onOpenEditor: (mode: 'create' | 'edit' | 'watch', schema?: AnnotationSchemaRead) => void;
    onDeleteClick: (schema: AnnotationSchemaRead) => void;
    onRestoreClick: (schema: AnnotationSchemaRead) => void;
    onViewSchema: (schema: AnnotationSchemaRead) => void;
}

const SchemaCard: React.FC<SchemaCardProps> = ({
    schema,
    isSelected,
    isSkeleton,
    onSelect,
    onOpenEditor,
    onDeleteClick,
    onRestoreClick,
    onViewSchema,
}) => {
    return (
        <>
        {isSkeleton ? (
            <Card className="flex flex-col transition-all border border-border bg-background/70">   
                <CardHeader className="flex flex-row items-start justify-between gap-4 pb-2 cursor-pointer">
                    <div className="flex-1 space-y-1">
                        <CardTitle className="text-base truncate">Create a new schema...</CardTitle>
                    </div>
                </CardHeader>
            </Card>
        ) : (
        <Card className={cn(
            "flex flex-col transition-all border border-border bg-background/70", 
            !schema.is_active && "text-muted-foreground",
            isSelected && "border-primary ring-1 ring-primary"
        )}>
            <CardHeader className="flex flex-row items-start justify-between gap-4 pb-2 cursor-pointer" onClick={() => onViewSchema(schema)}>
                <div className="flex-1 space-y-1">
                    <CardTitle className="text-base truncate" title={schema.name}>
                        {schema.name}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground h-8 overflow-hidden">
                        {schema.description || "No description."}
                    </p>
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) => onSelect(schema.id, !!checked)}
                        aria-label="Select schema"
                        disabled={isSkeleton}
                    />
                </div>
            </CardHeader>
            <CardContent className="flex-grow space-y-2 text-xs">
                 {!schema.is_active && <Badge variant="outline">Archived</Badge>}
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Fields:</span>
                    <span>{Object.keys((schema.output_contract as any)?.properties || {}).length}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Annotations:</span>
                    <span>{(schema as any).annotation_count?? 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Updated:</span>
                    <span>{schema.updated_at ? formatDistanceToNow(new Date(schema.updated_at), { addSuffix: true }) : '-'}</span>
                </div>
            </CardContent>
            <CardFooter className="flex justify-between items-center p-3 pt-0">
                {/* Primary actions - left side */}
                <div className="flex gap-1">
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-muted-foreground hover:text-foreground" 
                        onClick={() => onOpenEditor('watch', schema)} 
                        title="View Schema"
                    >
                        <Eye className="h-4 w-4" />
                    </Button>
                    {schema.is_active && (
                        <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-primary/10" 
                            onClick={() => onOpenEditor('edit', schema)} 
                            title="Edit Schema"
                        >
                            <Edit className="h-4 w-4" />
                        </Button>
                    )}
                </div>
                
                {/* Secondary actions - right side */}
                <div className="flex gap-1">
                    {schema.is_active ? (
                        <AlertDialogTrigger asChild>
                            <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10" 
                                onClick={() => onDeleteClick(schema)} 
                                title="Archive Schema"
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </AlertDialogTrigger>
                    ) : (
                        <Button 
                            variant="outline" 
                            size="sm" 
                            className="h-8 px-3 text-xs font-medium"
                            onClick={() => onRestoreClick(schema)}
                            title="Restore Schema"
                        >
                            Restore
                        </Button>
                    )}
                </div>
            </CardFooter>
        </Card>
        )}
        </>
    );
};

 export default AnnotationSchemaManagerWrapper;

