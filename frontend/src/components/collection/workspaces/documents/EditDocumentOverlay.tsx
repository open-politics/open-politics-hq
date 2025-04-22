'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';


// Interface might need update based on DataRecord/DataSource fields
interface EditDocumentOverlayProps {
  open: boolean;
  onClose: () => void;
  documentId: number; // Should likely be dataRecordId
  // Defaults likely need update for DataRecord
  defaultTitle: string;
  defaultContentType: string;
  defaultSource?: string | null;
  defaultTextContent?: string;
  defaultSummary?: string;
  defaultInsertionDate: string;
  defaultTopImage?: string | null;
  // defaultFiles?: FileRead[];
  defaultFiles?: any[]; // Placeholder for files if needed (likely from DataSource)
}

export default function EditDocumentOverlay({ 
  open, 
  onClose, 
  documentId, // Rename later if needed
  defaultTitle: initialTitle,
  defaultContentType: initialContentType,
  defaultSource: initialSource,
  defaultTextContent: initialTextContent,
  defaultSummary: initialSummary,
  defaultInsertionDate,
  defaultTopImage: initialTopImage,
  defaultFiles: initialFiles, // Keep for now
}: EditDocumentOverlayProps) {
  // Removed obsolete store hook
  // const { documents, updateDocument } = useDocumentStore();
  const [title, setTitle] = useState(initialTitle);
  const [url, setUrl] = useState(''); // Is URL relevant for DataRecord?
  const [contentType, setContentType] = useState(initialContentType);
  const [source, setSource] = useState(initialSource); // Might be source_metadata?
  const [textContent, setTextContent] = useState(initialTextContent);
  const [summary, setSummary] = useState(initialSummary);
  // const [files, setFiles] = useState<FileRead[]>(initialFiles || []);
  const [files, setFiles] = useState<any[]>(initialFiles || []); // Use placeholder type
  const [topImage, setTopImage] = useState(initialTopImage || '');

  useEffect(() => {
    // TODO: Rework this to fetch and use DataRecord data based on documentId/dataRecordId
    /*
    if (documentId > 0) {
      const document = documents.find(doc => doc.id === documentId);
      if (document) {
        setTitle(document.title);
        setUrl(document.url || '');
        setContentType(document.content_type || 'article');
        setSource(document.source || '');
        setTextContent(document.text_content || '');
        setSummary(document.summary || '');
        setTopImage(document.top_image || '');
        // setFiles(document.files || []);
      }
    }
    */
  // }, [documentId, documents]);
  }, [documentId]); // Remove documents dependency

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Rework this to update DataRecord/DataSource via API
    /*
    try {
      await updateDocument(documentId, {
        title,
        url,
        content_type: contentType,
        source,
        text_content: textContent,
        summary,
      });
      onClose();
    } catch (error) {
      console.error('Error updating document:', error);
    }
    */
   console.warn("handleSubmit needs implementation for DataRecords/DataSources.");
   onClose(); // Close for now
  };

  const handleDeleteFile = async (fileId: number) => {
    // TODO: Rework this to delete files associated with the DataSource via API
    /*
    if (confirm('Are you sure you want to delete this file?')) {
      try {
        // await deleteDocumentFile(documentId, fileId); // Assuming you have a deleteDocumentFile function in your store
        setFiles(files.filter((file: any) => file.id !== fileId)); // Update the local state
      } catch (error) {
        console.error('Error deleting file:', error);
      }
    }
    */
   console.warn("handleDeleteFile needs implementation for DataSources.");
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Item</DialogTitle> {/* Generic title */}
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Title / Name</Label> {/* Generic label */}
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          {/* Remove URL or adapt if relevant */}
          {/* 
          <div>
            <Label>URL</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          */}
          <div>
            <Label>Content Type</Label>
            {/* Consider fetching types dynamically or using DataSource types */}
            <select
              value={contentType}
              onChange={(e) => setContentType(e.target.value)}
              className="w-full p-2 border rounded"
            >
              <option value="article">Article</option>
              <option value="blog">Blog</option>
              <option value="report">Report</option>
              <option value="text_block">Text Block</option> {/* Added */}
              <option value="csv_row">CSV Row</option> {/* Added */}
              <option value="pdf_page">PDF Page</option> {/* Added */}
            </select>
          </div>
          <div>
            <Label>Source Context (Readonly)</Label> {/* Update label */}
            <Input value={source || ""} readOnly disabled className="bg-muted/50" /> {/* Make readonly */}
          </div>
          <div>
            <Label>Text Content</Label>
            <textarea
              value={textContent}
              onChange={(e) => setTextContent(e.target.value)}
              className="w-full p-2 border rounded"
              rows={4}
            />
          </div>
          {/* Image might not be directly editable on DataRecord */}
          {/* 
          <div>
            <Label>Image</Label>
            <Input value={topImage} onChange={(e) => setTopImage(e.target.value)} />
          </div>
          */}
          {/* Summary might not be directly editable on DataRecord */}
          {/* 
          <div>
            <Label>Summary</Label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="w-full p-2 border rounded"
              rows={2}
            />
          </div>
          */}
          {/* File list likely belongs to DataSource edit view */}
          {/* 
          <div>
            <Label>Files</Label>
            <ul>
              {files.map((file: any) => (
                <li key={file.id} className="flex items-center justify-between">
                  <a
                    href={`/api/v1/documents/files/${file.id}/download`} // Obsolete endpoint
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {file.name}
                  </a>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleDeleteFile(file.id)}
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          </div>
          */}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save Changes</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}