'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, FileText, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface PublicAuthenticatedPDFProps {
  token: string;
  assetId: number;
  title: string;
  className?: string;
}

export const PublicAuthenticatedPDF: React.FC<PublicAuthenticatedPDFProps> = ({ token, assetId, title, className }) => {
  const [pdfSrc, setPdfSrc] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const fetchMediaBlob = async (token: string, assetId: number): Promise<string | null> => {
    try {
      const response = await fetch(`/api/v1/shareables/stream/${token}/${assetId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch media: ${response.status} ${response.statusText}`);
      }
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    } catch (error) {
      console.error('Error fetching media blob:', error);
      toast.error(`Failed to load media: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  };

  useEffect(() => {
    const loadPDF = async () => {
      setIsLoading(true);
      setHasError(false);
      setErrorMessage('');
      try {
        const blobUrl = await fetchMediaBlob(token, assetId);
        if (blobUrl) {
          setPdfSrc(blobUrl);
        } else {
          setHasError(true);
          setErrorMessage('Failed to load PDF content');
        }
      } catch (error) {
        setHasError(true);
        setErrorMessage(error instanceof Error ? error.message : 'Unknown error loading PDF');
      } finally {
        setIsLoading(false);
      }
    };
    loadPDF();
    return () => {
      if (pdfSrc) {
        URL.revokeObjectURL(pdfSrc);
      }
    };
  }, [token, assetId]);

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
        {errorMessage && <p className="text-xs text-red-600 text-center">{errorMessage}</p>}
        <p className="text-xs text-center opacity-70 mt-2">File: {title}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("relative w-full h-full", className)}>
      <iframe src={pdfSrc} title={title} className="w-full h-full border-0" style={{ minHeight: '400px' }} />
      <div className="absolute top-2 right-2">
        <Button variant="outline" size="sm" asChild className="bg-background/80 hover:bg-background">
          <a href={`/api/v1/shareables/download/${token}/${assetId}`} target="_blank" rel="noopener noreferrer">
            <Download className="h-4 w-4 mr-2" />
            Download PDF
          </a>
        </Button>
      </div>
    </div>
  );
};

export default PublicAuthenticatedPDF; 