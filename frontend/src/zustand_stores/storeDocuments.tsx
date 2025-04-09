import { create } from 'zustand';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { DocumentsService } from '@/client/services';
import { DocumentRead, FileRead, DocumentUpdate, Body_documents_create_document } from '@/client/models';


interface DocumentState {
  documents: DocumentRead[];
  error: string | null;
  selectedDocumentId: number | null;
  isDetailOpen: boolean;
  newlyInsertedDocumentIds: number[];
  extractingPdfIds: Set<number>;
  extractedPdfIds: Set<number>;
  documentIdToSelect: number | null;
  fetchDocuments: () => Promise<void>;
  createDocument: (data: Body_documents_create_document) => Promise<void>;
  updateDocument: (documentId: number, data: DocumentUpdate) => Promise<void>;
  deleteDocument: (documentId: number) => Promise<void>;
  setSelectedDocumentId: (documentId: number | null) => void;
  extractPdfContent: (documentId: number, fileId: number) => Promise<void>;
  isExtractingPdf: (fileId: number) => boolean;
  isExtractedPdf: (fileId: number) => boolean;
  openDocumentDetail: (id: number) => void;
  closeDocumentDetail: () => void;
  setDocumentIdToSelect: (id: number | null) => void;
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  documents: [],
  error: null,
  selectedDocumentId: null,
  isDetailOpen: false,
  newlyInsertedDocumentIds: [],
  extractingPdfIds: new Set<number>(),
  extractedPdfIds: new Set<number>(),
  documentIdToSelect: null,
  
  isExtractingPdf: (fileId: number) => {
    return get().extractingPdfIds.has(fileId);
  },

  isExtractedPdf: (fileId: number) => {
    return get().extractedPdfIds.has(fileId);
  },

  fetchDocuments: async () => {
    const activeWorkspace = useWorkspaceStore.getState().activeWorkspace; // Access activeWorkspace from the workspace store
    if (!activeWorkspace) return;
    try {
      const response = await DocumentsService.readDocuments({
        workspaceId: activeWorkspace.uid,
        skip: 0,
        limit: 100,
      });
      set({ documents: response, error: null });
    } catch (err: any) {
      set({ error: "Error fetching documents", documents: [] });
      console.error(err);
    }
  },

  createDocument: async (data: Body_documents_create_document) => {
    const activeWorkspace = useWorkspaceStore.getState().activeWorkspace;
    if (!activeWorkspace) return;
    try {
      await DocumentsService.createDocument1({
        workspaceId: activeWorkspace.uid,
        formData: data
      });
      await get().fetchDocuments();
    } catch (err: any) {
      set({ error: "Error creating document" });
      console.error(err);
    }
  },

  updateDocument: async (documentId: number, data: DocumentUpdate) => {
    const activeWorkspace = useWorkspaceStore.getState().activeWorkspace;
    if (!activeWorkspace) return;
    try {
      await DocumentsService.updateDocument({
        workspaceId: activeWorkspace.uid,
        documentId,
        requestBody: data,
      });
      await get().fetchDocuments();
    } catch (err: any) {
      set({ error: "Error updating document" });
      console.error(err);
    }
  },

  deleteDocument: async (documentId: number) => {
    const activeWorkspace = useWorkspaceStore.getState().activeWorkspace;
    if (!activeWorkspace) return;
    try {
      await DocumentsService.deleteDocument({
        workspaceId: activeWorkspace.uid,
        documentId,
      });
      await get().fetchDocuments();
    } catch (err: any) {
      set({ error: "Error deleting document" });
      console.error(err);
    }
  },

  setSelectedDocumentId: (documentId: number | null) => {
    set({ selectedDocumentId: documentId });
  },

  extractPdfContent: async (documentId: number, fileId: number) => {
    const activeWorkspace = useWorkspaceStore.getState().activeWorkspace;
    if (!activeWorkspace) return;
    
    set(state => ({
      extractingPdfIds: new Set(state.extractingPdfIds).add(fileId)
    }));
    
    try {
      await DocumentsService.extractPdfContent({
        workspaceId: activeWorkspace.uid,
        documentId,
        fileId,
      });
      
      await get().fetchDocuments();
      
      set(state => ({
        extractedPdfIds: new Set(state.extractedPdfIds).add(fileId)
      }));
    } catch (err: any) {
      set({ error: "Error extracting PDF content" });
      console.error(err);
    } finally {
      set(state => {
        const newSet = new Set(state.extractingPdfIds);
        newSet.delete(fileId);
        return { extractingPdfIds: newSet };
      });
    }
  },

  openDocumentDetail: (id: number) => {
    set({ selectedDocumentId: id, isDetailOpen: true });
  },
  
  closeDocumentDetail: () => {
    set({ isDetailOpen: false, documentIdToSelect: null });
  },

  setDocumentIdToSelect: (id: number | null) => {
    set({ documentIdToSelect: id });
  },
})); 