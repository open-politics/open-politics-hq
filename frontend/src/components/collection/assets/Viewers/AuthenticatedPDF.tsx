'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, FileText, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMediaBlobStore } from '@/zustand_stores/storeMediaBlobs';

interface AuthenticatedPDFProps {
  blobPath: string;
  title: string;
  className?: string;
  pageNumber?: number;
}

export const AuthenticatedPDF: React.FC<AuthenticatedPDFProps> = React.memo(
  ({ blobPath, title, className, pageNumber }) => {
    const [pdfSrc, setPdfSrc] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);
    const loadedBlobPathRef = React.useRef<string | null>(null);
    
    // Use store directly - don't subscribe to avoid re-renders
    const getBlobUrl = useMediaBlobStore.getState().getBlobUrl;

    useEffect(() => {
      let isMounted = true;

      // Check cache synchronously first
      const state = useMediaBlobStore.getState();
      const cachedUrl = state.blobCache.get(blobPath);
      
      if (cachedUrl) {
        // Blob is cached, use it immediately
        const pdfUrlWithPage = pageNumber ? `${cachedUrl}#page=${pageNumber}` : cachedUrl;
        setPdfSrc(pdfUrlWithPage);
        setIsLoading(false);
        loadedBlobPathRef.current = blobPath;
        return;
      }

      const loadPDF = async () => {
        setIsLoading(true);
        setHasError(false);
        loadedBlobPathRef.current = blobPath;

        try {
          const blobUrl = await getBlobUrl(blobPath);
          
          if (!isMounted) return;
          
          if (blobUrl) {
            const pdfUrlWithPage = pageNumber 
              ? `${blobUrl}#page=${pageNumber}` 
              : blobUrl;
            setPdfSrc(pdfUrlWithPage);
            setIsLoading(false);
          } else {
            setHasError(true);
            setIsLoading(false);
            loadedBlobPathRef.current = null; // Reset on error
          }
        } catch (error) {
          if (!isMounted) return;
          setHasError(true);
          setIsLoading(false);
          loadedBlobPathRef.current = null; // Reset on error
        }
      };

      loadPDF();

      return () => {
        isMounted = false;
      };
    }, [blobPath]); // Only reload when blobPath changes

    // Handle page number changes without reloading
    useEffect(() => {
      if (pdfSrc) {
        const baseUrl = pdfSrc.split('#')[0];
        const newUrl = pageNumber ? `${baseUrl}#page=${pageNumber}` : baseUrl;
        if (newUrl !== pdfSrc) {
          setPdfSrc(newUrl);
        }
      }
    }, [pageNumber, pdfSrc]); // Update when pageNumber or pdfSrc changes

    if (isLoading) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
          <Loader2 className="h-8 w-8 animate-spin mb-4" />
          <span className="text-sm">Loading PDF...</span>
          <span className="text-xs mt-1 opacity-70">{title}</span>
        </div>
      );
    }

    if (hasError || !pdfSrc) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
          <FileText className="h-16 w-16 opacity-50 mb-4" />
          <p className="text-center mb-2">PDF could not be loaded</p>
          <p className="text-xs text-center opacity-70 mt-2">File: {title}</p>
        </div>
      );
    }

    return (
      <div className={cn("relative w-full h-full", className)}>
        <iframe
          key={`pdf-${blobPath}-${pageNumber || 'default'}`}
          src={pdfSrc}
          title={title}
          className="w-full h-full border-0"
          style={{ minHeight: '400px' }}
        />
        <div className="absolute -top-10 left-0">
          <Button variant="outline" size="sm" asChild className="bg-background/80 hover:bg-background">
            <a href={pdfSrc.split('#')[0]} target="_blank" rel="noopener noreferrer" download>
              <Download className="h-4 w-4 mr-2" />
              Download PDF
            </a>
          </Button>
        </div>
      </div>
    );
  },
  // Custom comparison - only re-render if blobPath or pageNumber changes
  (prevProps, nextProps) => 
    prevProps.blobPath === nextProps.blobPath && 
    prevProps.pageNumber === nextProps.pageNumber
);

AuthenticatedPDF.displayName = 'AuthenticatedPDF';
