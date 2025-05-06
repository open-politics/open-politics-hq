'use client';

import React, { useState, useEffect, useCallback, useRef, ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlusCircle, Edit, Trash2, Eye, Search, XCircle, Loader2, AlertTriangle, Upload, Download } from 'lucide-react';
import { ClassificationSchemeRead } from '@/client';
import ClassificationSchemeEditor from './ClassificationSchemeEditor';
import { useClassificationSystem } from '@/hooks/useClassificationSystem';
import { useToast } from "@/components/ui/use-toast"
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { transformApiToFormData } from '@/lib/classification/service';

// Interface for export dialog state
interface ExportDialogState {
  open: boolean;
  schemesToExport: ClassificationSchemeRead[];
  defaultFilename: string;
  currentFilename: string;
}

const ClassificationSchemeManager: React.FC = () => {
    const {
        schemes,
        loadSchemes,
        createScheme,
        deleteScheme,
        isLoadingSchemes,
        error: schemesError
    } = useClassificationSystem();
    const { toast } = useToast();

    const [searchTerm, setSearchTerm] = useState('');
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [editorMode, setEditorMode] = useState<'create' | 'edit' | 'watch'>('create');
    const [selectedScheme, setSelectedScheme] = useState<ClassificationSchemeRead | null>(null);
    const [schemeToDelete, setSchemeToDelete] = useState<ClassificationSchemeRead | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [selectedSchemeIds, setSelectedSchemeIds] = useState<Set<number>>(new Set());
    const [exportDialogState, setExportDialogState] = useState<ExportDialogState>({
      open: false,
      schemesToExport: [],
      defaultFilename: '',
      currentFilename: ''
    });

    useEffect(() => {
      setSelectedSchemeIds(new Set());
    }, [schemes]);

    useEffect(() => {
        loadSchemes();
    }, [loadSchemes]);

    const handleOpenEditor = (mode: 'create' | 'edit' | 'watch', scheme?: ClassificationSchemeRead) => {
        setEditorMode(mode);
        setSelectedScheme(scheme || null);
        setIsEditorOpen(true);
    };

    const handleCloseEditor = () => {
        setIsEditorOpen(false);
        setSelectedScheme(null);
    };

    const handleSaveSuccess = (savedScheme: ClassificationSchemeRead) => {
        handleCloseEditor();
    };

    const handleDeleteClick = (scheme: ClassificationSchemeRead) => {
        setSchemeToDelete(scheme);
    };

    const confirmDelete = async () => {
        if (!schemeToDelete) return;
        setIsDeleting(true);
        try {
            await deleteScheme(schemeToDelete.id);
            toast({ title: "Scheme Deleted", description: `Scheme "${schemeToDelete.name}" deleted successfully.`, variant: "default" });
            setSelectedSchemeIds(prev => {
                const newSet = new Set(prev);
                newSet.delete(schemeToDelete.id);
                return newSet;
            });
            setSchemeToDelete(null);
        } catch (error: any) {
            console.error("Error deleting scheme:", error);
            const errorMsg = error.body?.detail || "Could not delete scheme.";
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
            const importedSchemes = Array.isArray(importedData) ? importedData : [importedData];

            if (!Array.isArray(importedSchemes)) {
              throw new Error('Imported file must contain a JSON object or array of schemes.');
            }

            let successCount = 0;
            let errorCount = 0;

            for (const importedScheme of importedSchemes) {
              try {
                if (!importedScheme.name || !Array.isArray(importedScheme.fields)) {
                  throw new Error(`Invalid scheme structure for item: ${JSON.stringify(importedScheme).substring(0, 50)}...`);
                }
                const schemeFormData = transformApiToFormData(importedScheme as any);
                const created = await createScheme(schemeFormData);
                if (created) {
                    successCount++;
                } else {
                    throw new Error(`Creation via hook failed for scheme '${importedScheme.name || 'Unnamed'}'`);
                }
              } catch (individualError: any) {
                console.error('Error importing individual scheme:', individualError);
                errorCount++;
                toast({ title: 'Import Error (Individual)', description: `Failed to import scheme '${importedScheme.name || 'Unnamed'}': ${individualError.message}`, variant: 'destructive' });
              }
            }

            toast({
              title: 'Import Complete',
              description: `${successCount} schemes imported successfully, ${errorCount} failed.`,
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
            loadSchemes(true);
          }
        };

        reader.onerror = () => {
          toast({ title: 'Error reading file', description: 'Failed to read the selected file.', variant: 'destructive' });
          setIsImporting(false);
        };

        reader.readAsText(file);
    };

    const openExportDialog = (schemesToExport: ClassificationSchemeRead[], defaultFilename: string) => {
        if (schemesToExport.length === 0) {
             toast({ title: 'No Schemes Selected', description: 'Please select schemes to export.', variant: 'default' });
             return;
         }
         setExportDialogState({
            open: true,
            schemesToExport,
            defaultFilename,
            currentFilename: defaultFilename
         });
    };

    const handleExportAll = () => {
        openExportDialog(schemes, 'all_schemes.json');
    };

    const handleExportSelected = () => {
        const selected = schemes.filter(scheme => selectedSchemeIds.has(scheme.id));
        const defaultFilename = `selected_schemes_${selected.length}.json`;
        openExportDialog(selected, defaultFilename);
    };

    const confirmExport = () => {
        const { schemesToExport, currentFilename } = exportDialogState;
        const filename = currentFilename.trim() || exportDialogState.defaultFilename;
        const finalFilename = filename.endsWith('.json') ? filename : `${filename}.json`;

        if (schemesToExport.length === 0) {
            toast({ title: 'Export Error', description: 'No schemes available for export.', variant: 'destructive' });
            closeExportDialog();
            return;
        }

        try {
            const jsonString = JSON.stringify(schemesToExport, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = finalFilename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            toast({ title: 'Export Successful', description: `${schemesToExport.length} schemes exported to ${finalFilename}.`, variant: 'default' });
            closeExportDialog();
            setSelectedSchemeIds(new Set());
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
        const allIds = new Set(filteredSchemes.map(s => s.id));
        setSelectedSchemeIds(allIds);
      } else {
        setSelectedSchemeIds(new Set());
      }
    };

    const handleRowSelect = (schemeId: number, checked: boolean) => {
      setSelectedSchemeIds(prev => {
        const newSet = new Set(prev);
        if (checked) {
          newSet.add(schemeId);
        } else {
          newSet.delete(schemeId);
        }
        return newSet;
      });
    };

    const filteredSchemes = schemes.filter(scheme =>
        scheme.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        scheme.description?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const numSelected = selectedSchemeIds.size;
    const numFiltered = filteredSchemes.length;
    const isAllSelected = numFiltered > 0 && numSelected === numFiltered;
    const isIndeterminate = numSelected > 0 && numSelected < numFiltered;

    return (
        <div className="flex flex-col h-full p-4 bg-muted/10">
            <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
                <h2 className="text-xl font-semibold">Manage Classification Schemes</h2>
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative w-48 sm:w-64">
                       <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                       <Input
                           type="text"
                           placeholder="Search schemes..."
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
                    <Button size="sm" variant="outline" onClick={handleExportSelected} disabled={numSelected === 0 || isLoadingSchemes}>
                       <Download className="h-4 w-4 mr-2" />
                       Export Selected ({numSelected})
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleExportAll} disabled={schemes.length === 0 || isLoadingSchemes}>
                       <Download className="h-4 w-4 mr-2" />
                       Export All ({schemes.length})
                    </Button>
                    <Button size="sm" onClick={() => handleOpenEditor('create')}>
                        <PlusCircle className="h-4 w-4 mr-2" />
                        Create Scheme
                    </Button>
                </div>
            </div>

             {isLoadingSchemes && !schemesError && (
                 <div className="flex-grow flex items-center justify-center">
                     <Loader2 className="h-8 w-8 animate-spin text-primary" />
                     <span className="ml-2 text-muted-foreground">Loading schemes...</span>
                 </div>
             )}

            {schemesError && !isLoadingSchemes && (
                <div className="flex-grow flex flex-col items-center justify-center p-4 border border-destructive/50 bg-destructive/10 rounded-lg">
                    <XCircle className="h-10 w-10 text-destructive mb-2"/>
                    <p className="text-destructive font-medium">Error loading schemes</p>
                    <p className="text-xs text-destructive/80 text-center mt-1">{schemesError}</p>
                    <Button variant="outline" size="sm" onClick={() => loadSchemes()} className="mt-4">Retry</Button>
                </div>
            )}

            {!isLoadingSchemes && !schemesError && (
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
                                  <TableHead className="w-[120px] text-center">Jobs</TableHead>
                                  <TableHead className="w-[150px]">Last Updated</TableHead>
                                  <TableHead className="w-[150px] text-right pr-4">Actions</TableHead>
                              </TableRow>
                          </TableHeader>
                          <TableBody>
                              {filteredSchemes.length > 0 ? (
                                  filteredSchemes.map((scheme) => (
                                      <TableRow 
                                          key={scheme.id}
                                          data-state={selectedSchemeIds.has(scheme.id) ? "selected" : ""}
                                      >
                                          <TableCell className="px-2">
                                              <Checkbox
                                                  checked={selectedSchemeIds.has(scheme.id)}
                                                  onCheckedChange={(checked) => handleRowSelect(scheme.id, !!checked)}
                                                  aria-label="Select row"
                                              />
                                          </TableCell>
                                          <TableCell className="font-medium truncate" title={scheme.name}>{scheme.name}</TableCell>
                                          <TableCell className="text-muted-foreground text-sm max-w-sm truncate" title={scheme.description || undefined}>{scheme.description || '-'}</TableCell>
                                          <TableCell className="text-center text-sm">{scheme.fields?.length || 0}</TableCell>
                                          <TableCell className="text-center text-sm">{scheme.job_count ?? '-'}</TableCell>
                                          <TableCell className="text-muted-foreground text-xs">
                                              {scheme.updated_at ? formatDistanceToNow(new Date(scheme.updated_at), { addSuffix: true }) : '-'}
                                          </TableCell>
                                          <TableCell className="text-right pr-4">
                                              <div className="flex justify-end gap-1">
                                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleOpenEditor('watch', scheme)} title="View">
                                                      <Eye className="h-4 w-4" />
                                                  </Button>
                                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleOpenEditor('edit', scheme)} title="Edit">
                                                      <Edit className="h-4 w-4" />
                                                  </Button>
                                                   <AlertDialogTrigger asChild>
                                                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDeleteClick(scheme)} title="Delete">
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
                                          {schemes.length === 0 ? "No classification schemes created yet." : "No schemes match your search."} 
                                      </TableCell>
                                  </TableRow>
                              )}
                          </TableBody>
                       </Table>
                    </ScrollArea>
                 </div>
            )}

            <ClassificationSchemeEditor
                key={selectedScheme?.id || 'create'}
                show={isEditorOpen}
                mode={editorMode}
                schemeId={selectedScheme?.id}
                defaultValues={selectedScheme}
                onClose={handleCloseEditor}
            />

            <AlertDialog open={!!schemeToDelete} onOpenChange={(open) => !open && setSchemeToDelete(null)}>
              <AlertDialogContent>
                  <AlertDialogHeader>
                      <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                      <AlertDialogDescription>
                          This action cannot be undone. This will permanently delete the classification scheme
                           <span className="font-semibold"> "{schemeToDelete?.name}"</span> and potentially associated results (depending on backend cascade behavior).
                      </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                      <AlertDialogCancel onClick={() => setSchemeToDelete(null)} disabled={isDeleting}>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                          onClick={confirmDelete}
                          disabled={isDeleting}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                          {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4"/>}
                           Delete Scheme
                      </AlertDialogAction>
                  </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={exportDialogState.open} onOpenChange={(open) => !open && closeExportDialog()}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Export Schemes</AlertDialogTitle>
                        <AlertDialogDescription>
                            Enter a filename for the export. The file will contain {exportDialogState.schemesToExport.length} scheme(s).
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

 const ClassificationSchemeManagerWrapper = () => (
     <AlertDialog>
         <ClassificationSchemeManager />
     </AlertDialog>
 );
 
 export default ClassificationSchemeManagerWrapper;

