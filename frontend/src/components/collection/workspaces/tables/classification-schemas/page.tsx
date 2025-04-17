'use client';

import { useState } from 'react';
import { DataTable } from '@/components/collection/workspaces/tables/data-table';
import { columns } from './columns';
import { ClassificationSchemeRead } from "@/client/models";
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import ClassificationSchemeEditor from '@/components/collection/workspaces/classifications/ClassificationSchemeEditor';
import { transformApiToFormData } from '@/lib/classification/service';
import { Button } from "@/components/ui/button";
import { SchemePreview } from '../../schemaCreation/SchemePreview';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { flexRender, Row } from '@tanstack/react-table';
import { useClassificationSystem } from '@/hooks/useClassificationSystem';
import { FormattedClassificationResult } from '@/lib/classification/types';
import { ScrollArea } from "@/components/ui/scroll-area";
import ClassificationResultDisplay from '../../classifications/ClassificationResultDisplay';
import DocumentLink from '../../documents/DocumentLink';
import { Loader2 } from 'lucide-react';
import { schemesToSchemeReads } from '@/lib/classification/adapters';
import { resultToResultRead } from '@/lib/classification/adapters';
import { Checkbox } from "@/components/ui/checkbox";
import { TableCell } from "@/components/ui/table";

interface ClassificationSchemesTablePageProps {
  schemes: ClassificationSchemeRead[];
  onCreateClick: () => void;
  onDelete: (schemeId: number) => Promise<void>;
}

export default function ClassificationSchemesTablePage({ schemes: adaptedSchemes, onCreateClick, onDelete }: ClassificationSchemesTablePageProps) {
  const { activeWorkspace } = useWorkspaceStore();
  const { loadResultsByScheme, isLoadingResults, schemes: fullSchemes } = useClassificationSystem();

  const [selectedSchemeIds, setSelectedSchemeIds] = useState<number[]>([]);

  const [editorState, setEditorState] = useState<{
    isOpen: boolean;
    mode: 'create' | 'edit' | 'watch';
    schemeId?: number;
    defaultValues?: any;
  }>({
    isOpen: false,
    mode: 'create'
  });

  const [selectedScheme, setSelectedScheme] = useState<ClassificationSchemeRead | null>(null);

  const [popoverSchemeResults, setPopoverSchemeResults] = useState<FormattedClassificationResult[]>([]);
  const [isPopoverResultsLoading, setIsPopoverResultsLoading] = useState(false);
  const [selectedPopoverSchemeId, setSelectedPopoverSchemeId] = useState<number | null>(null);

  const handleRowSelect = (rowId: number) => {
    const newSelection = selectedSchemeIds.includes(rowId)
      ? selectedSchemeIds.filter(id => id !== rowId)
      : [...selectedSchemeIds, rowId];
    setSelectedSchemeIds(newSelection);
  };

  const handleEdit = (scheme: ClassificationSchemeRead) => {
    setEditorState({
      isOpen: true,
      mode: 'edit',
      schemeId: scheme.id,
      defaultValues: transformApiToFormData(scheme)
    });
    setPopoverSchemeResults([]);
    setSelectedPopoverSchemeId(null);
  };

  const handleViewInPopover = (scheme: ClassificationSchemeRead) => {
    setSelectedPopoverSchemeId(scheme.id);
    setPopoverSchemeResults([]);
    console.log("Popover triggered for scheme:", scheme.id);
  };

  const handleLoadSchemeResults = async (schemeId: number) => {
    if (!schemeId) return;
    console.log("Loading results for scheme in popover:", schemeId);
    setIsPopoverResultsLoading(true);
    try {
      const results = await loadResultsByScheme(schemeId);
      setPopoverSchemeResults(results);
      console.log("Loaded results:", results);
    } catch (error) {
      console.error("Error loading scheme results in popover:", error);
      setPopoverSchemeResults([]);
    } finally {
      setIsPopoverResultsLoading(false);
    }
  };

  const handleDelete = async (scheme: ClassificationSchemeRead) => {
    if (confirm('Are you sure you want to delete this classification scheme?')) {
      try {
        await onDelete(scheme.id);
      } catch (error) {
        console.error('Error deleting classification scheme via prop:', error);
      }
    }
  };

  const handleViewDocuments = (scheme: ClassificationSchemeRead) => {
    console.log("View documents for scheme:", scheme.id, scheme.name);
    // TODO: Implement dialog opening logic
  };

  const handleViewRuns = (scheme: ClassificationSchemeRead) => {
    console.log("View runs for scheme:", scheme.id, scheme.name);
    // TODO: Implement dialog opening logic
  };

  const closeEditor = () => {
    setEditorState(prev => ({ ...prev, isOpen: false }));
  };

  const tableColumns = columns({
    onEdit: handleEdit,
    onDelete: handleDelete,
    onViewDocuments: handleViewDocuments,
    onViewRuns: handleViewRuns
  });

  const getFullScheme = (schemeId: number | null): ClassificationSchemeRead | undefined => {
    if (!schemeId) return undefined;
    const adapted = adaptedSchemes.find(s => s.id === schemeId);
    if (adapted) return adapted;
    const fullSchemeFromHook = fullSchemes.find(s => s.id === schemeId);
    if (fullSchemeFromHook) return schemesToSchemeReads([fullSchemeFromHook])[0];
    return undefined;
  };

  const handleExportSelected = () => {
    const selectedSchemesData = adaptedSchemes.filter(scheme => selectedSchemeIds.includes(scheme.id));
    
    if (selectedSchemesData.length === 0) {
      alert('No schemes selected for export.');
      return;
    }
    
    const jsonString = JSON.stringify(selectedSchemesData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'classification_schemes.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setSelectedSchemeIds([]); // Clear selection after export
  };

  return (
    <div>
      <div className="flex justify-end mb-4 gap-2">
        <Button 
          variant="outline" 
          onClick={handleExportSelected} 
          disabled={selectedSchemeIds.length === 0}
        >
          Export Selected ({selectedSchemeIds.length})
        </Button>
        <Button onClick={onCreateClick}>
          Create New Scheme
        </Button>
      </div>

      <div className="w-full">
        <DataTable<ClassificationSchemeRead, any>
          columns={tableColumns}
          data={adaptedSchemes}
          enableRowSelection={true}
          selectedRows={selectedSchemeIds}
          onRowSelectionChange={setSelectedSchemeIds}
          renderRow={(row) => (
            <Popover onOpenChange={(open) => { if (!open) { setPopoverSchemeResults([]); setSelectedPopoverSchemeId(null); } }}>
              <PopoverTrigger asChild>
                <tr 
                  key={row.id} 
                  className={`cursor-pointer hover:bg-muted/50 ${selectedSchemeIds.includes(row.original.id) ? 'bg-muted/30' : ''}`}
                >
                  <TableCell className="w-12" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedSchemeIds.includes((row.original as any).id)}
                      onCheckedChange={() => handleRowSelect((row.original as any).id)}
                      aria-label="Select row"
                    />
                  </TableCell>
                  {row.getVisibleCells().map((cell) => (
                    <td 
                      key={cell.id} 
                      className="p-2 border-b" 
                      onClick={() => handleViewInPopover(row.original)}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </td>
                  ))}
                </tr>
              </PopoverTrigger>
              <PopoverContent 
                className="w-[600px] p-0"
                align="start"
                side="bottom"
                sideOffset={5}
              >
                <ScrollArea className="h-full">
                  <div className="p-4 space-y-4">
                    <h4 className="font-medium text-lg">Scheme Preview: {row.original.name}</h4>
                    <SchemePreview 
                      scheme={transformApiToFormData(row.original)} 
                    />
                    <hr />
                    <div className="space-y-2">
                      <h5 className="font-medium">Recent Classifications (Max 50)</h5>
                      {selectedPopoverSchemeId === row.original.id && (
                        <>
                          {!isPopoverResultsLoading && popoverSchemeResults.length === 0 && (
                            <Button 
                              variant="outline" 
                              size="sm" 
                              onClick={() => handleLoadSchemeResults(row.original.id)}
                            >
                              Load Results
                            </Button>
                          )}
                          
                          {isPopoverResultsLoading && (
                            <div className="flex items-center text-muted-foreground">
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading results...
                            </div>
                          )}
                          
                          {!isPopoverResultsLoading && popoverSchemeResults.length > 0 && (
                            <ScrollArea className="h-[300px] border rounded-md p-2">
                              <div className="space-y-3">
                                {popoverSchemeResults.map(result => {
                                  const fullSchemeForDisplay = getFullScheme(result.scheme_id);
                                  const docTitle = result.document?.title || `Document ${result.document_id}`;
                                  const docId = result.document_id;
                                  
                                  return (
                                    <div key={result.id} className="border-b pb-2 last:border-b-0">
                                      <div className="text-sm font-medium mb-1">
                                        <DocumentLink documentId={docId}>
                                          {docTitle}
                                        </DocumentLink>
                                      </div>
                                      {fullSchemeForDisplay ? (
                                        <ClassificationResultDisplay 
                                          result={resultToResultRead(result)}
                                          scheme={fullSchemeForDisplay}
                                          compact={true}
                                        />
                                      ) : (
                                        <span className="text-xs text-red-500 italic">Scheme info missing</span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </ScrollArea>
                          )}
                           {!isPopoverResultsLoading && popoverSchemeResults.length === 0 && selectedPopoverSchemeId === row.original.id && !isPopoverResultsLoading && (
                             <p className="text-xs text-muted-foreground italic pt-2">No results loaded yet or none found.</p>
                           )}
                        </>
                      )}
                    </div>
                  </div>
                </ScrollArea>
              </PopoverContent>
            </Popover>
          )}
        />
      </div>

      <ClassificationSchemeEditor
        show={editorState.isOpen}
        onClose={closeEditor}
        schemeId={editorState.schemeId}
        mode={editorState.mode}
        defaultValues={editorState.defaultValues}
      />
    </div>
  );
}