'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import useAuth from "@/hooks/useAuth";
import { Separator } from "@/components/ui/separator";
import { Search, Plus, FileText, Upload, LinkIcon } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatDistanceToNow } from "date-fns"
import { cn } from "@/lib/utils"
import { Switch } from "@/components/ui/switch"
import { TooltipProvider } from "@/components/ui/tooltip"
import { FileRead } from '@/client/models';
import CreateDocumentDialog from './CreateDocumentsDialog';
import DocumentsTable from '@/components/collection/workspaces/tables/documents/page';
import DocumentDetailView from './DocumentsDetailView';
import Image from 'next/image';
import {
  Tabs,
  TabsContent,
} from "@/components/ui/tabs"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { Badge } from "@/components/ui/badge"
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { useDocumentStore } from '@/zustand_stores/storeDocuments';
import EditDocumentOverlay from './EditDocumentOverlay';
import { DocumentRead, WorkspaceRead } from '@/client/models';
import { useClassificationSystem } from '@/hooks/useClassificationSystem';
import DocumentDetailProvider from './DocumentDetailProvider';
import DocumentDetailWrapper from './DocumentDetailWrapper';
import { schemesToSchemeReads } from '@/lib/classification/adapters';
interface DocumentListProps {
  items: DocumentRead[];
  onDocumentSelect: (documentId: number) => void;
  selectedDocumentId: number | null;
}

const DocumentCardComponent: React.FC<DocumentListProps> = React.memo(({ items, onDocumentSelect, selectedDocumentId }) => {
  return (
    <ScrollArea className="h-full">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-2">
        {items.map((item) => (
          <Card
            key={item.id}
            className={cn(
              "flex flex-col border border-gray-900 items-start gap-1 rounded-lg p-1 text-left text-sm transition-all hover:bg-accent",
              selectedDocumentId === item.id && "bg-muted"
            )}
            onClick={() => onDocumentSelect(item.id)}
          >
            <CardHeader className="w-full p-2">
              <div className="grid grid-cols-[1fr,auto] gap-2">
                <div className="flex flex-col">
                  <CardTitle className="text-base">{item.title}</CardTitle>
                  <div className="text-xs text-muted-foreground">{item.content_type}</div>
                </div>
                {item.top_image && (
                  <div className="w-16 h-16 relative">
                    <Image 
                      src={item.top_image} 
                      alt={item.title || 'Document'} 
                      fill 
                      className="object-cover rounded"
                    />
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="w-full p-2">
              <div className="line-clamp-2 text-xs text-muted-foreground mb-2">
                {item.text_content?.substring(0, 150)}
              </div>
              <div className="flex flex-wrap gap-1">
                {(item.files || [])?.slice(0, 2).map((file: FileRead) => (
                  <Badge key={file.id} variant="outline" className="text-xs">
                    {file.name}
                  </Badge>
                ))}
                {(item.files?.length || 0) > 2 && (
                  <Badge variant="outline" className="text-xs">
                    +{(item.files?.length || 0) - 2} more
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </ScrollArea>
  );
});

interface DocumentManagerProps {
  onLoadIntoRunner?: (runId: number, runName: string) => void;
}

export default function DocumentManager({ onLoadIntoRunner }: DocumentManagerProps) {
  const { documents, fetchDocuments, documentIdToSelect, setDocumentIdToSelect } = useDocumentStore();
  const { activeWorkspace } = useWorkspaceStore();
  const { schemes, loadSchemes } = useClassificationSystem({
    autoLoadSchemes: true
  });

  const { isLoggedIn } = useAuth();

  const [isCreateDocumentOpen, setIsCreateDocumentOpen] = useState(false);
  const [createDocumentMode, setCreateDocumentMode] = useState<'single' | 'bulk' | 'scrape'>('single');
  const [isCardView, setIsCardView] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null);
  const [newlyInsertedDocumentIds, setNewlyInsertedDocumentIds] = useState<number[]>([]);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [documentToEdit, setDocumentToEdit] = useState<DocumentRead | null>(null);

  const fetchingRef = useRef(false);

  const handleDocumentSelect = (documentId: number) => {
    setSelectedDocumentId(documentId);
  };

  const handleEdit = (document: DocumentRead) => {
    setDocumentToEdit(document);
    setIsEditOpen(true);
  };

  const openCreateDocument = (mode: 'single' | 'bulk' | 'scrape') => {
    setCreateDocumentMode(mode);
    setIsCreateDocumentOpen(true);
  };

  useEffect(() => {
    console.log('[DocumentManager] useEffect for selection triggered. documentIdToSelect:', documentIdToSelect);
    if (documentIdToSelect !== null) {
      console.log('[DocumentManager] Checking if document exists in list:', documents.map(d => d.id));
      if (documents.some(doc => doc.id === documentIdToSelect)) {
          console.log('[DocumentManager] Document found! Selecting ID:', documentIdToSelect);
          setSelectedDocumentId(documentIdToSelect);
          setDocumentIdToSelect(null); 
      } else {
          console.log('[DocumentManager] Document ID', documentIdToSelect, 'not found in current documents list.');
      }
    }
  }, [documentIdToSelect, setDocumentIdToSelect, documents]);

  const memoizedDocumentToEditProps = useMemo(() => ({
    open: isEditOpen,
    onClose: () => setIsEditOpen(false),
    documentId: documentToEdit?.id || 0,
    defaultTitle: documentToEdit?.title || '',
    defaultTopImage: documentToEdit?.top_image || '',
    defaultContentType: documentToEdit?.content_type || 'article',
    defaultSource: documentToEdit?.source || '',
    defaultTextContent: documentToEdit?.text_content || '',
    defaultSummary: documentToEdit?.summary || '',
    defaultInsertionDate: documentToEdit?.insertion_date || new Date().toISOString(),
  }), [isEditOpen, documentToEdit]);

  useEffect(() => {
    // Fetch data when workspace changes
    if (activeWorkspace && !fetchingRef.current) {
      console.log("[DocumentManager] Workspace changed, fetching data for:", activeWorkspace.uid);
      fetchingRef.current = true;
      setSelectedDocumentId(null); // Reset local selection on workspace change
      fetchDocuments();
      loadSchemes();
    }
    // Reset fetchingRef if workspace changes or component unmounts
    return () => { 
      console.log("[DocumentManager] Cleanup effect for workspace change.");
      fetchingRef.current = false; 
    };
    // Only depend on the workspace UID. fetchDocuments/loadSchemes implicitly use it.
  }, [activeWorkspace?.uid]);

  if (!activeWorkspace) {
    return (
      <p className="text-center text-red-400">
        Please select a workspace to manage documents.
      </p>
    );
  }

  return (
    <DocumentDetailProvider>
      <DocumentDetailWrapper onLoadIntoRunner={onLoadIntoRunner}>
        <TooltipProvider delayDuration={0}>
          <div className="flex flex-col h-full w-full max-w-screen-2xl max-h-[80%] mx-auto px-2 sm:px-4">
            <div className="flex-none p-2 sm:p-4">
              <div className="flex items-center justify-between">
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => openCreateDocument('single')} className="h-9 flex items-center">
                    <FileText className="h-4 w-4 mr-2" />
                    <span className="sr-only sm:not-sr-only">New Document</span>
                  </Button>
                  <Button variant="outline" onClick={() => openCreateDocument('bulk')} className="h-9 flex items-center">
                    <Upload className="h-4 w-4 mr-2" />
                    <span className="sr-only sm:not-sr-only">Bulk Upload</span>
                  </Button>
                  <Button variant="outline" onClick={() => openCreateDocument('scrape')} className="h-9 flex items-center">
                    <LinkIcon className="h-4 w-4 mr-2" />
                    <span className="sr-only sm:not-sr-only">Scrape URL</span>
                  </Button>
                </div>
              </div>
              <Separator className="my-2" />
            </div>

            <div className="flex-1 min-h-0 flex flex-col">
              <ResizablePanelGroup
                direction="horizontal"
                className="h-full w-full border rounded-lg"
              >
                <ResizablePanel 
                  defaultSize={50} 
                  minSize={30}
                  className="min-w-[300px] bg-background  "
                >
                  <div className="flex flex-col h-full">
                    <div className="flex-none p-2 sm:p-4">
                      <div className="flex items-center justify-between">
                        <h1 className="text-lg sm:text-xl font-bold">Documents</h1>
                      </div>
                      <div className="mt-2">
                        <div className="relative">
                          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input placeholder="Search" className="pl-8 h-9" />
                        </div>
                      </div>
                      <div className="flex items-center space-x-2 mt-2">
                        <Switch id="card-view" checked={isCardView} onCheckedChange={setIsCardView} />
                        <label htmlFor="card-view" className="text-sm font-medium">
                          Card View
                        </label>
                      </div>
                    </div>

                    <div className="flex-1 min-h-0 overflow-hidden">
                      <Tabs defaultValue="all" className="h-full">
                        <TabsContent value="all" className="h-full m-0">
                          {isCardView ? (
                            <DocumentCardComponent
                              items={documents as DocumentRead[]}
                              onDocumentSelect={handleDocumentSelect}
                              selectedDocumentId={selectedDocumentId}
                            />
                          ) : (
                            <div className="h-full overflow-x-auto">
                              <DocumentsTable 
                                onDocumentSelect={handleDocumentSelect} 
                              />
                            </div>
                          )}
                        </TabsContent>
                      </Tabs>
                    </div>
                  </div>
                </ResizablePanel>

                <ResizableHandle withHandle className="hidden sm:flex bg-border" />

                <ResizablePanel 
                  defaultSize={50} 
                  minSize={30}
                  className="min-w-[300px] bg-background border-l  "
                >
                  <div className="h-full overflow-hidden">
                    <DocumentDetailView 
                      selectedDocumentId={selectedDocumentId} 
                      documents={documents as DocumentRead[]} 
                      newlyInsertedDocumentIds={newlyInsertedDocumentIds}
                      onEdit={handleEdit}
                      schemes={schemesToSchemeReads(schemes)}
                      onLoadIntoRunner={onLoadIntoRunner}
                    />
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>

            <CreateDocumentDialog
              open={isCreateDocumentOpen}
              onClose={() => setIsCreateDocumentOpen(false)}
              initialMode={createDocumentMode}
            />
            <EditDocumentOverlay
              {...memoizedDocumentToEditProps}
            />
          </div>
        </TooltipProvider>
      </DocumentDetailWrapper>
    </DocumentDetailProvider>
  );
}