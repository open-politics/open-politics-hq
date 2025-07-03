'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { AssetRead } from '@/client/models';
import { cn } from '@/lib/utils';
import { Loader2, ImageIcon, FileSpreadsheet, FileText, AlertCircle, Globe } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useAssetStore } from '@/zustand_stores/storeAssets';
import { toast } from 'sonner';

// Helper function to check if an image URL is a .gif file
const isGifImage = (url: string): boolean => {
  return url.toLowerCase().includes('.gif');
};

// Compact web/article preview showing featured image
interface CompactWebPreviewProps {
  asset: AssetRead;
  className?: string;
}

export const CompactWebPreview: React.FC<CompactWebPreviewProps> = ({ asset, className }) => {
  const [childAssets, setChildAssets] = useState<AssetRead[]>([]);
  const [featuredImageSrc, setFeaturedImageSrc] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const { activeInfospace } = useInfospaceStore();
  const { fetchChildAssets } = useAssetStore();

  const fetchMediaBlob = useCallback(async (blobPath: string): Promise<string | null> => {
    if (!blobPath || !activeInfospace?.id) return null;

    try {
      const response = await fetch(`/api/v1/files/stream/${encodeURIComponent(blobPath)}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
        },
      });

      if (!response.ok) {
        console.warn(`Failed to fetch media: ${response.status} ${response.statusText}`);
        return null;
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      return blobUrl;
    } catch (error) {
      console.error('Error fetching media blob:', error);
      return null;
    }
  }, [activeInfospace?.id]);

  useEffect(() => {
    const loadWebPreview = async () => {
      setIsLoading(true);
      setHasError(false);

      try {
        // Fetch child assets to find images
        const children = await fetchChildAssets(asset.id);
        if (children && children.length > 0) {
          setChildAssets(children);

          // Find featured image (part_index 0) or first non-gif image
          const imageAssets = children.filter(child => {
            if (child.kind !== 'image') return false;
            
            // Filter out .gif files from both source_identifier and blob_path
            if (child.source_identifier && isGifImage(child.source_identifier)) return false;
            if (child.blob_path && isGifImage(child.blob_path)) return false;
            
            // Must have either source_identifier or blob_path
            return child.source_identifier || child.blob_path;
          });

          let featuredImage = imageAssets.find(img => 
            img.part_index === 0 && 
            img.source_metadata?.image_role === 'featured'
          );

          if (!featuredImage) {
            featuredImage = imageAssets[0]; // Use first available non-gif image
          }

          if (featuredImage) {
            if (featuredImage.source_identifier) {
              // External image URL
              setFeaturedImageSrc(featuredImage.source_identifier);
            } else if (featuredImage.blob_path) {
              // Internal blob path
              const blobUrl = await fetchMediaBlob(featuredImage.blob_path);
              if (blobUrl) {
                setFeaturedImageSrc(blobUrl);
              } else {
                setHasError(true);
              }
            } else {
              setHasError(true);
            }
          } else {
            setHasError(true);
          }
        } else {
          setHasError(true);
        }
      } catch (error) {
        console.error('Error loading web preview:', error);
        setHasError(true);
      } finally {
        setIsLoading(false);
      }
    };

    loadWebPreview();
  }, [asset.id, fetchChildAssets, fetchMediaBlob]);

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center h-16 bg-muted/50 rounded ", className)}>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mr-1" />
        <span className="text-xs text-muted-foreground">Loading...</span>
      </div>
    );
  }

  if (hasError || !featuredImageSrc) {
    return (
      <div className={cn("h-16 bg-muted/30 rounded  p-2 overflow-hidden flex items-center", className)}>
        <Globe className="h-4 w-4 text-sky-600 mr-2" />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-muted-foreground truncate">
            {asset.title || 'Article'}
          </div>
          <div className="text-xs text-muted-foreground/70 mt-1">
            {childAssets.length > 0 ? `${childAssets.filter(child => child.kind === 'image').length} images` : 'No images'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("h-16 rounded overflow-hidden bg-muted/30 relative", className)}>
      <img 
        src={featuredImageSrc} 
        alt={asset.title || 'Article preview'} 
        className="h-full w-full object-cover"
        onError={(e) => {
          setHasError(true);
          setFeaturedImageSrc(null);
        }}
      />
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-1">
        <div className="flex items-center gap-1">
          <Globe className="h-3 w-3 text-white" />
          <span className="text-xs text-white truncate font-medium">
            {asset.title || 'Article'}
          </span>
        </div>
      </div>
    </div>
  );
};

// Compact image preview
interface CompactImagePreviewProps {
  asset: AssetRead;
  className?: string;
}

export const CompactImagePreview: React.FC<CompactImagePreviewProps> = ({ asset, className }) => {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const { activeInfospace } = useInfospaceStore();

  const fetchMediaBlob = useCallback(async (blobPath: string): Promise<string | null> => {
    if (!blobPath || !activeInfospace?.id) return null;

    try {
      const response = await fetch(`/api/v1/files/stream/${encodeURIComponent(blobPath)}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
        },
      });

      if (!response.ok) {
        console.warn(`Failed to fetch media: ${response.status} ${response.statusText}`);
        return null;
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      return blobUrl;
    } catch (error) {
      console.error('Error fetching media blob:', error);
      return null;
    }
  }, [activeInfospace?.id]);

  useEffect(() => {
    const loadImage = async () => {
      // Check if this is a .gif file and skip it
      if (asset.source_identifier && isGifImage(asset.source_identifier)) {
        setHasError(true);
        setIsLoading(false);
        return;
      }

      if (asset.blob_path && isGifImage(asset.blob_path)) {
        setHasError(true);
        setIsLoading(false);
        return;
      }

      if (!asset.blob_path && !asset.source_identifier) {
        setHasError(true);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setHasError(false);
      
      try {
        if (asset.source_identifier) {
          // External image URL
          setImageSrc(asset.source_identifier);
        } else if (asset.blob_path) {
          // Internal blob path
          const blobUrl = await fetchMediaBlob(asset.blob_path);
          if (blobUrl) {
            setImageSrc(blobUrl);
          } else {
            setHasError(true);
          }
        } else {
          setHasError(true);
        }
      } catch (error) {
        setHasError(true);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadImage();
  }, [asset.blob_path, asset.source_identifier, fetchMediaBlob]);

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center h-16 w-16 bg-muted/50 rounded ", className)}>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (hasError || !imageSrc) {
    return (
      <div className={cn("flex items-center justify-center h-16 w-16 bg-muted/50 rounded ", className)}>
        <ImageIcon className="h-6 w-6 text-muted-foreground opacity-50" />
      </div>
    );
  }

  return (
    <div className={cn("h-16 w-16 rounded overflow-hidden bg-muted/30", className)}>
      <img 
        src={imageSrc} 
        alt={asset.title || 'Image preview'} 
        className="h-full w-full object-cover"
        onError={(e) => {
          setHasError(true);
          setImageSrc(null);
        }}
      />
    </div>
  );
};

// Compact CSV preview showing column headers
interface CompactCSVPreviewProps {
  asset: AssetRead;
  className?: string;
}

export const CompactCSVPreview: React.FC<CompactCSVPreviewProps> = ({ asset, className }) => {
  const [columns, setColumns] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const { activeInfospace } = useInfospaceStore();

  const fetchCSVColumns = useCallback(async (blobPath: string): Promise<string[]> => {
    if (!blobPath || !activeInfospace?.id) return [];

    try {
      const response = await fetch(`/api/v1/files/stream/${encodeURIComponent(blobPath)}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch CSV: ${response.status} ${response.statusText}`);
      }

      const csvText = await response.text();
      
      // Parse the first line to get headers
      const lines = csvText.split('\n').filter(line => line.trim());
      if (lines.length === 0) return [];
      
      // Simple CSV parsing for headers only
      const firstLine = lines[0];
      const parseCSVLine = (line: string): string[] => {
        const result: string[] = [];
        let currentField = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          const nextChar = line[i + 1];
          
          if (char === '"') {
            if (inQuotes && nextChar === '"') {
              currentField += '"';
              i++;
            } else {
              inQuotes = !inQuotes;
            }
          } else if (char === ',' && !inQuotes) {
            result.push(currentField.trim());
            currentField = '';
          } else {
            currentField += char;
          }
        }
        
        result.push(currentField.trim());
        return result;
      };

      return parseCSVLine(firstLine);
    } catch (error) {
      console.error('Error fetching CSV content:', error);
      return [];
    }
  }, [activeInfospace?.id]);

  useEffect(() => {
    const loadColumns = async () => {
      if (!asset.blob_path) {
        setHasError(true);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setHasError(false);
      try {
        const cols = await fetchCSVColumns(asset.blob_path);
        setColumns(cols);
        if (cols.length === 0) {
          setHasError(true);
        }
      } catch (error) {
        setHasError(true);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadColumns();
  }, [asset.blob_path, fetchCSVColumns]);

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center h-16 bg-muted/50 rounded  p-2", className)}>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mr-1" />
        <span className="text-xs text-muted-foreground">Loading...</span>
      </div>
    );
  }

  if (hasError || columns.length === 0) {
    return (
      <div className={cn("h-16 bg-muted/30 rounded  p-1.5 overflow-hidden flex items-center justify-center", className)}>
        <div className="flex flex-col items-center gap-1">
          <FileSpreadsheet className="h-6 w-6 text-green-600" />
          <span className="text-xs text-muted-foreground font-medium">CSV</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("h-16 bg-muted/30 rounded  p-1.5 overflow-hidden flex flex-col", className)}>
      <div className="flex items-center gap-1 mb-1">
        <FileSpreadsheet className="h-3 w-3 text-green-600" />
        <span className="text-xs font-semibold">{columns.length} columns</span>
      </div>
      <div className="text-xs text-muted-foreground">
        <div className="flex items-center gap-1 mt-0.5">
            {columns.slice(0, 3).map((col, i) => (
              <React.Fragment key={i}>
                <span className="truncate max-w-[60px]">{col}</span>
                {i < columns.slice(0, 3).length - 1 && <span className="text-muted-foreground/70 mx-0.5">·</span>}
              </React.Fragment>
            ))}
            {columns.length > 3 && (
              <span className="text-muted-foreground/70 ml-1">
                +{columns.length - 3} more
              </span>
            )}
        </div>
      </div>
    </div>
  );
};

// Compact PDF preview showing starting text
interface CompactPDFPreviewProps {
  asset: AssetRead;
  className?: string;
}

export const CompactPDFPreview: React.FC<CompactPDFPreviewProps> = ({ asset, className }) => {
  const [previewText, setPreviewText] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const loadPreviewText = () => {
      setIsLoading(true);
      setHasError(false);
      
      try {
        // Try to get preview text from asset's text_content or metadata
        let text = '';
        
        if (asset.text_content) {
          text = asset.text_content.substring(0, 120);
        } else if (asset.source_metadata?.first_page_text) {
          text = String(asset.source_metadata.first_page_text).substring(0, 120);
        } else if (asset.source_metadata?.extracted_text) {
          text = String(asset.source_metadata.extracted_text).substring(0, 120);
        }

        if (text.trim()) {
          setPreviewText(text);
        } else {
          setHasError(true);
        }
      } catch (error) {
        setHasError(true);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadPreviewText();
  }, [asset]);

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center h-16 bg-muted/50 rounded  p-2", className)}>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mr-1" />
        <span className="text-xs text-muted-foreground">Loading...</span>
      </div>
    );
  }

  if (hasError || !previewText.trim()) {
    return (
      <div className={cn("flex items-center justify-center h-16 bg-muted/50 rounded  p-2", className)}>
        <FileText className="h-4 w-4 text-red-600 mr-1" />
        <span className="text-xs text-muted-foreground">No preview</span>
      </div>
    );
  }

  const pageCount = asset.source_metadata?.page_count as number | undefined;

  return (
    <div className={cn("h-16 bg-muted/30 rounded  p-2 overflow-hidden", className)}>
      <div className="flex items-center gap-1 mb-1">
        <FileText className="h-3 w-3 text-red-600" />
        {pageCount && (
          <Badge variant="outline" className="text-xs px-1 py-0">
            {pageCount} pages
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground line-clamp-2 leading-tight">
        {previewText.trim()}...
      </p>
    </div>
  );
};

// Main preview component that renders the appropriate preview based on asset kind
interface AssetPreviewProps {
  asset: AssetRead;
  className?: string;
}

export const AssetPreview: React.FC<AssetPreviewProps> = ({ asset, className }) => {
  switch (asset.kind) {
    case 'image':
      return <CompactImagePreview asset={asset} className={className} />;
    case 'web':
    case 'article':
      return <CompactWebPreview asset={asset} className={className} />;
    case 'csv':
      return <CompactCSVPreview asset={asset} className={className} />;
    case 'pdf':
      return <CompactPDFPreview asset={asset} className={className} />;
    default:
      // For other asset types, show a simple text preview if available
      return (
        <div className={cn("h-16 bg-muted/30 rounded  p-2 overflow-hidden", className)}>
          <div className="flex items-center gap-1 mb-1">
            <FileText className="h-3 w-3 text-muted-foreground" />
            <Badge variant="outline" className="text-xs px-1 py-0 capitalize">
              {asset.kind}
            </Badge>
          </div>
          {asset.text_content ? (
            <p className="text-xs text-muted-foreground line-clamp-2 leading-tight">
              {asset.text_content.substring(0, 100).trim()}...
            </p>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              No preview available
            </p>
          )}
        </div>
      );
  }
}; 