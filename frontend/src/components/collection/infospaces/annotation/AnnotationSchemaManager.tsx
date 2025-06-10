'use client';

import React, { useState, useEffect, useCallback, useRef, ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlusCircle, Edit, Trash2, Eye, Search, XCircle, Loader2, AlertTriangle, Upload, Download } from 'lucide-react';
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
import { transformApiToFormData } from '@/lib/annotations/service';

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
        deleteSchema,
        isLoadingSchemas,
        error: schemasError
    } = useAnnotationSystem();
    const { toast } = useToast();

    const [searchTerm, setSearchTerm] = useState('');
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [editorMode, setEditorMode] = useState<'create' | 'edit' | 'watch'>('create');
    const [selectedSchema, setSelectedSchema] = useState<AnnotationSchemaRead | null>(null);
    const [schemaToDelete, setSchemaToDelete] = useState<AnnotationSchemaRead | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [selectedSchemaIds, setSelectedSchemaIds] = useState<Set<number>>(new Set());
    const [exportDialogState, setExportDialogState] = useState<ExportDialogState>({
      open: false,
      schemasToExport: [],
      defaultFilename: '',
      currentFilename: ''
    });

    useEffect(() => {
      setSelectedSchemaIds(new Set());
    }, [schemas]);

    useEffect(() => {
        loadSchemas();
    }, [loadSchemas]);

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
    };

    const handleDeleteClick = (schema: AnnotationSchemaRead) => {
        setSchemaToDelete(schema);
    };

    const confirmDelete = async () => {
        if (!schemaToDelete) return;
        setIsDeleting(true);
        try {
            await deleteSchema(schemaToDelete.id);
            toast({ title: "Schema Deleted", description: `Schema "${schemaToDelete.name}" deleted successfully.`, variant: "default" });
            setSelectedSchemaIds(prev => {
                const newSet = new Set(prev);
                newSet.delete(schemaToDelete.id);
                return newSet;
            });
            setSchemaToDelete(null);
        } catch (error: any) {
            console.error("Error deleting schema:", error);
            const errorMsg = error.body?.detail || "Could not delete schema.";
            toast({ title: "Delete Failed", description: errorMsg, variant: "destructive" });
        } finally {
            setIsDeleting(false);
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
                console.error('Error importing individual schema:', individualError);
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
            console.error('Error processing imported file:', error);
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
            console.error("Export failed:", error);
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
        <div className="flex flex-col h-full p-4 bg-muted/10">
            <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
                <h2 className="text-xl font-semibold">Manage Annotation Schemas</h2>
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative w-48 sm:w-64">
                       <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                       <Input
                           type="text"
                           placeholder="Search schemas..."
                           value={searchTerm}
                           onChange={(e) => setSearchTerm(e.target.value)}
                           className="pl-8 h-9"
                       />
                    </div>
                    <Button size="sm" variant="outline" onClick={handleImportClick} disabled={isImporting}>
                        {isImporting ? (
                           <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                           <Upload className="h-4 w-4 mr-2" />
                        )}
                        Import
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleExportSelected} disabled={numSelected === 0 || isLoadingSchemas}>
                       <Download className="h-4 w-4 mr-2" />
                       Export Selected ({numSelected})
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleExportAll} disabled={schemas.length === 0 || isLoadingSchemas}>
                       <Download className="h-4 w-4 mr-2" />
                       Export All ({schemas.length})
                    </Button>
                    <Button size="sm" onClick={() => handleOpenEditor('create')}>
                        <PlusCircle className="h-4 w-4 mr-2" />
                        Create Schema
                    </Button>
                </div>
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
                    <Button variant="outline" size="sm" onClick={() => loadSchemas()} className="mt-4">Retry</Button>
                </div>
            )}

            {!isLoadingSchemas && !schemasError && (
                 <div className="flex-grow overflow-hidden border rounded-lg bg-card">
                    <ScrollArea className="h-full">
                       <Table>
                          <TableHeader className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm shadow-sm">
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
                          <TableBody>
                              {filteredSchemas.length > 0 ? (
                                  filteredSchemas.map((schema) => (
                                      <TableRow 
                                          key={schema.id}
                                          data-state={selectedSchemaIds.has(schema.id) ? "selected" : ""}
                                      >
                                          <TableCell className="px-2">
                                              <Checkbox
                                                  checked={selectedSchemaIds.has(schema.id)}
                                                  onCheckedChange={(checked) => handleRowSelect(schema.id, !!checked)}
                                                  aria-label="Select row"
                                              />
                                          </TableCell>
                                          <TableCell className="font-medium truncate" title={schema.name}>{schema.name}</TableCell>
                                          <TableCell className="text-muted-foreground text-sm max-w-sm truncate" title={schema.description || undefined}>{schema.description || '-'}</TableCell>
                                          <TableCell className="text-center text-sm">{Object.keys((schema.output_contract as any)?.properties || {}).length}</TableCell>
                                          <TableCell className="text-center text-sm">{(schema as any).annotation_count ?? '-'}</TableCell>
                                          <TableCell className="text-muted-foreground text-xs">
                                              {schema.updated_at ? formatDistanceToNow(new Date(schema.updated_at), { addSuffix: true }) : '-'}
                                          </TableCell>
                                          <TableCell className="text-right pr-4">
                                              <div className="flex justify-end gap-1">
                                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleOpenEditor('watch', schema)} title="View">
                                                      <Eye className="h-4 w-4" />
                                                  </Button>
                                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleOpenEditor('edit', schema)} title="Edit">
                                                      <Edit className="h-4 w-4" />
                                                  </Button>
                                                   <AlertDialogTrigger asChild>
                                                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDeleteClick(schema)} title="Delete">
                                                          <Trash2 className="h-4 w-4" />
                                                      </Button>
                                                   </AlertDialogTrigger>
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

            <AnnotationSchemaEditor
                key={selectedSchema?.id || 'create'}
                show={isEditorOpen}
                mode={editorMode}
                schemeId={selectedSchema?.id}
                onSave={handleSaveSuccess}
                onClose={handleCloseEditor}
                defaultValues={selectedSchema ? transformApiToFormData(selectedSchema) : undefined}
            />

            <AlertDialog open={!!schemaToDelete} onOpenChange={(open) => !open && setSchemaToDelete(null)}>
              <AlertDialogContent>
                  <AlertDialogHeader>
                      <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                      <AlertDialogDescription>
                          This action cannot be undone. This will permanently delete the annotation schema
                           <span className="font-semibold"> "{schemaToDelete?.name}"</span> and potentially associated results (depending on backend cascade behavior).
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
                           Delete Schema
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
         </div>
     );
 };

 const AnnotationSchemaManagerWrapper = () => (
     <AlertDialog>
         <AnnotationSchemaManager />
     </AlertDialog>
 );
 
 export default AnnotationSchemaManagerWrapper;

