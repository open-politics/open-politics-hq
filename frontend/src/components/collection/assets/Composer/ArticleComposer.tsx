'use client';

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  FileText,
  Save, 
  X, 
  Eye,
  Plus, 
  Trash2, 
  GripVertical, 
  Image as ImageIcon,
  FileSpreadsheet,
  Globe,
  Video,
  Music,
  File,
  Loader2,
  Search,
  ArrowRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { AssetRead, AssetKind, BundleRead } from '@/client';
import { useAssetStore } from '@/zustand_stores/storeAssets';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { AssetPreview } from '../Views/AssetPreviewComponents';
import AssetSelector from '../AssetSelector';
import ReactMarkdown from 'react-markdown';

interface EmbeddedAsset {
  id: string;
  assetId: number;
  asset: AssetRead;
  position: number;
  mode: 'inline' | 'card' | 'reference' | 'attachment';
  size: 'small' | 'medium' | 'large' | 'full';
  caption?: string;
}

interface ArticleComposerProps {
  open: boolean;
  onClose: () => void;
  existingAssetId?: number;
  mode: 'create' | 'edit';
}

const EMBED_MODES = [
  { value: 'inline', label: 'Inline', description: 'Embedded directly in text flow' },
  { value: 'card', label: 'Card', description: 'Displayed as a card with preview' },
  { value: 'reference', label: 'Reference', description: 'Link to asset with title only' },
  { value: 'attachment', label: 'Attachment', description: 'Listed as downloadable attachment' }
] as const;

const EMBED_SIZES = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
  { value: 'full', label: 'Full Width' }
] as const;

export default function ArticleComposer({ open, onClose, existingAssetId, mode }: ArticleComposerProps) {
  const { createAsset, updateAsset, getAssetById, fetchAssets } = useAssetStore();
  const { bundles, fetchBundles } = useBundleStore();
  const { activeInfospace } = useInfospaceStore();

  // Article content state
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [content, setContent] = useState('');
  const [embeddedAssets, setEmbeddedAssets] = useState<EmbeddedAsset[]>([]);
  const [referencedBundles, setReferencedBundles] = useState<number[]>([]);
  const [metadata, setMetadata] = useState({
    author: '',
    category: '',
    tags: [] as string[]
  });

  // UI state
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedAssets, setSelectedAssets] = useState<Set<string>>(new Set());
  const [draggedAsset, setDraggedAsset] = useState<AssetRead | null>(null);

  // Refs
  const contentEditorRef = useRef<HTMLTextAreaElement>(null);

  // Load existing article if editing
  useEffect(() => {
    if (mode === 'edit' && existingAssetId && open) {
      loadExistingArticle(existingAssetId);
    } else if (mode === 'create' && open) {
      resetForm();
    }
  }, [mode, existingAssetId, open]);

  // Fetch bundles when dialog opens
  useEffect(() => {
    if (open && activeInfospace?.id) {
      fetchBundles(activeInfospace.id);
    }
  }, [open, activeInfospace?.id, fetchBundles]);

  const loadExistingArticle = async (assetId: number) => {
    try {
      setIsLoading(true);
      const asset = await getAssetById(assetId);
      if (asset) {
        setTitle(asset.title);
        setContent(asset.text_content || '');
        setSummary((asset.source_metadata?.summary as string) || '');
        
        // Parse embedded assets from metadata
        const embeddedFromMetadata = (asset.source_metadata?.embedded_assets as any[]) || [];
        
        // Load full asset data for embedded assets
        const convertedEmbeds: EmbeddedAsset[] = [];
        for (const [index, embed] of embeddedFromMetadata.entries()) {
          try {
            const fullAsset = await getAssetById(embed.asset_id);
            if (fullAsset) {
              convertedEmbeds.push({
                id: `existing_${embed.asset_id}_${index}`,
                assetId: embed.asset_id,
                asset: fullAsset,
                position: embed.position || index,
                mode: embed.mode || 'card',
                size: embed.size || 'medium',
                caption: embed.caption
              });
            }
          } catch (error) {
            console.error(`Failed to load embedded asset ${embed.asset_id}:`, error);
            // Add placeholder for failed loads
            convertedEmbeds.push({
              id: `existing_${embed.asset_id}_${index}`,
              assetId: embed.asset_id,
              asset: { 
                id: embed.asset_id, 
                title: 'Asset not found', 
                kind: 'text' as AssetKind,
                uuid: '',
                infospace_id: 0,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                processing_status: 'ready' as any,
                is_container: false
              } as AssetRead,
              position: embed.position || index,
              mode: embed.mode || 'card',
              size: embed.size || 'medium',
              caption: embed.caption
            });
          }
        }
        setEmbeddedAssets(convertedEmbeds);
        
        // Parse referenced bundles
        const referencedFromMetadata = (asset.source_metadata?.referenced_bundles as number[]) || [];
        setReferencedBundles(referencedFromMetadata);
        
        // Parse metadata
        const articleMetadata = (asset.source_metadata?.metadata as any) || {};
        setMetadata({
          author: articleMetadata.author || '',
          category: articleMetadata.category || '',
          tags: articleMetadata.tags || []
        });
      }
    } catch (error) {
      console.error('Error loading article:', error);
      toast.error('Failed to load article for editing');
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setTitle('');
    setSummary('');
    setContent('');
    setEmbeddedAssets([]);
    setReferencedBundles([]);
    setMetadata({ author: '', category: '', tags: [] });
    setActiveTab('edit');
  };

  const generateEmbedId = () => `embed_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const handleAssetEmbed = useCallback((asset: AssetRead, mode: EmbeddedAsset['mode'] = 'card', size: EmbeddedAsset['size'] = 'medium', showToast: boolean = true) => {
    // Check if asset is already embedded
    const alreadyEmbedded = embeddedAssets.some(embed => embed.assetId === asset.id);
    if (alreadyEmbedded && showToast) {
      toast.info(`${asset.title} is already embedded in this article`);
      return;
    }
    
    const newEmbed: EmbeddedAsset = {
      id: generateEmbedId(),
      assetId: asset.id,
      asset,
      position: embeddedAssets.length,
      mode,
      size,
      caption: asset.title
    };
    
    setEmbeddedAssets(prev => [...prev, newEmbed]);
    
    // Insert embed marker in content at cursor position
    const embedMarker = `\n\n{{asset:${asset.id}:${mode}:${size}}}\n\n`;
    const textarea = contentEditorRef.current;
    if (textarea) {
      const cursorPos = textarea.selectionStart;
      const newContent = content.slice(0, cursorPos) + embedMarker + content.slice(cursorPos);
      setContent(newContent);
      
      // Update cursor position
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = cursorPos + embedMarker.length;
        textarea.focus();
      }, 0);
    } else {
      setContent(prev => prev + embedMarker);
    }
    
    if (showToast) {
      toast.success(`Embedded ${asset.title} as ${mode}`);
    }
  }, [embeddedAssets, content]);

  const handleRemoveEmbed = (embedId: string) => {
    const embed = embeddedAssets.find(e => e.id === embedId);
    if (embed) {
      // Remove from embedded assets
      setEmbeddedAssets(prev => prev.filter(e => e.id !== embedId));
      
      // Remove embed marker from content
      const embedMarker = `{{asset:${embed.assetId}:${embed.mode}:${embed.size}}}`;
      setContent(prev => prev.replace(new RegExp(embedMarker, 'g'), ''));
      
      toast.success('Removed embedded asset');
    }
  };

  const handleBundleReference = (bundleId: number) => {
    const bundle = bundles.find(b => b.id === bundleId);
    const isAlreadyReferenced = referencedBundles.includes(bundleId);
    
    if (isAlreadyReferenced) {
      // Remove reference
      setReferencedBundles(prev => prev.filter(id => id !== bundleId));
      toast.success(`Removed reference to: ${bundle?.name}`);
    } else {
      // Add reference
      setReferencedBundles(prev => [...prev, bundleId]);
      toast.success(`Referenced bundle: ${bundle?.name}`);
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error('Please provide a title for the article');
      return;
    }

    if (!activeInfospace?.id) {
      toast.error('No active infospace selected');
      return;
    }

    setIsLoading(true);

    try {
      const articleData = {
        title: title.trim(),
        kind: 'article' as AssetKind,
        text_content: content,
        source_metadata: {
          composition_type: 'free_form_article',
          summary: summary || undefined,
          embedded_assets: embeddedAssets.map(embed => ({
            asset_id: embed.assetId,
            mode: embed.mode,
            size: embed.size,
            caption: embed.caption,
            position: embed.position
          })),
          referenced_bundles: referencedBundles,
          metadata: {
            ...metadata,
            composed_at: new Date().toISOString(),
            embed_count: embeddedAssets.length,
            bundle_references: referencedBundles.length
          }
        }
      };

      if (mode === 'create') {
        // Create new article using the compose-article endpoint
        const compositionData = {
          title: articleData.title,
          content: articleData.text_content,
          summary: summary || undefined,
          embedded_assets: embeddedAssets.map(embed => ({
            asset_id: embed.assetId,
            mode: embed.mode,
            size: embed.size,
            caption: embed.caption,
            position: embed.position
          })),
          referenced_bundles: referencedBundles,
          metadata: {
            ...metadata,
            composed_at: new Date().toISOString(),
            embed_count: embeddedAssets.length,
            bundle_references: referencedBundles.length
          }
        };

        try {
          const response = await fetch(`/api/v1/infospaces/${activeInfospace.id}/assets/compose-article`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
            },
            body: JSON.stringify(compositionData)
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Failed to create article');
          }

          const createdAsset = await response.json();
          toast.success(`Article "${title}" created successfully`);
          await fetchAssets(); // Refresh asset list
          onClose();
        } catch (error) {
          throw error; // Re-throw to be caught by outer try-catch
        }
      } else if (mode === 'edit' && existingAssetId) {
        // Update existing article
        const updateData = {
          title: articleData.title,
          text_content: articleData.text_content,
          source_metadata: articleData.source_metadata
        };
        
        const updatedAsset = await updateAsset(existingAssetId, updateData);
        if (updatedAsset) {
          toast.success(`Article "${title}" updated successfully`);
          onClose();
        }
      }
    } catch (error) {
      console.error('Error saving article:', error);
      toast.error(`Failed to ${mode === 'create' ? 'create' : 'update'} article`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAssetDoubleClick = (item: any) => {
    if (item.asset) {
      handleAssetEmbed(item.asset);
    }
  };

  const renderEmbeddedAssetPreview = (embed: EmbeddedAsset) => {
    const { asset, mode, size, caption } = embed;
    
    return (
      <div className="border rounded-lg p-3 bg-muted/20">
        <div className="flex items-center gap-2 mb-2">
          <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
          <Badge variant="outline" className="text-xs">{mode}</Badge>
          <Badge variant="secondary" className="text-xs">{size}</Badge>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 ml-auto text-destructive"
            onClick={() => handleRemoveEmbed(embed.id)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
        
        <div className="flex items-center gap-3">
          <AssetPreview asset={asset} className="w-12 h-12 rounded" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{asset.title}</p>
            <p className="text-xs text-muted-foreground capitalize">{asset.kind}</p>
            {caption && caption !== asset.title && (
              <p className="text-xs text-muted-foreground italic mt-1">{caption}</p>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderPreview = () => {
    // Process content to show embedded assets as placeholders in preview
    const contentParts = content.split(/(\{\{asset:\d+:\w+:\w+\}\})/g);
    
    return (
      <div className="prose prose-sm max-w-none p-4">
        <h1 className="text-2xl font-bold mb-2">{title || 'Untitled Article'}</h1>
        {summary && (
          <div className="bg-muted/30 p-3 rounded-lg border-l-4 border-primary mb-4">
            <p className="text-sm italic">{summary}</p>
          </div>
        )}
        
        <div className="text-sm leading-relaxed">
          {contentParts.map((part, index) => {
            const embedMatch = part.match(/\{\{asset:(\d+):(\w+):(\w+)\}\}/);
            if (embedMatch) {
              const [, assetId, mode, size] = embedMatch;
              const embed = embeddedAssets.find(e => e.assetId === parseInt(assetId));
              if (embed) {
                return (
                  <div key={index} className="my-4 p-3 border rounded-lg border-blue-200">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">📎 Embedded Asset:</span>
                      <span className="text-blue-700">{embed.asset.title}</span>
                      <Badge variant="outline" className="text-xs">{mode}</Badge>
                      <Badge variant="secondary" className="text-xs">{size}</Badge>
                    </div>
                    {embed.caption && embed.caption !== embed.asset.title && (
                      <p className="text-xs text-muted-foreground mt-1 italic">{embed.caption}</p>
                    )}
                  </div>
                );
              }
              return (
                <div key={index} className="my-4 p-3 border border-dashed border-red-200 bg-red-50 rounded-lg">
                  <span className="text-sm text-red-600">Invalid embed: {part}</span>
                </div>
              );
            }
            
            // Regular content - render as markdown
            if (part.trim()) {
              return <ReactMarkdown key={index} >{part}</ReactMarkdown>;
            }
            return null;
          })}
        </div>
        
        {/* Show embedded assets */}
        {embeddedAssets.length > 0 && (
          <div className="mt-6 pt-4 border-t">
            <h3 className="text-lg font-semibold mb-3">Embedded Assets</h3>
            <div className="grid gap-3">
              {embeddedAssets.map(embed => (
                <div key={embed.id} className="border rounded-lg p-3">
                  <div className="flex items-center gap-3">
                    <AssetPreview asset={embed.asset} className="w-16 h-16 rounded" />
                    <div className="flex-1">
                      <h4 className="font-medium">{embed.asset.title}</h4>
                      <div className="flex gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">{embed.mode}</Badge>
                        <Badge variant="secondary" className="text-xs">{embed.size}</Badge>
                        <Badge variant="outline" className="text-xs capitalize">{embed.asset.kind}</Badge>
                      </div>
                      {embed.caption && embed.caption !== embed.asset.title && (
                        <p className="text-xs text-muted-foreground mt-1 italic">{embed.caption}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Show referenced bundles */}
        {referencedBundles.length > 0 && (
          <div className="mt-6 pt-4 border-t">
            <h3 className="text-lg font-semibold mb-3">Referenced Bundles</h3>
            <div className="space-y-2">
              {referencedBundles.map(bundleId => {
                const bundle = bundles.find(b => b.id === bundleId);
                return bundle ? (
                  <div key={bundleId} className="flex items-center gap-2 p-2 bg-muted/20 rounded">
                    <FileText className="h-4 w-4 text-primary" />
                    <span className="font-medium">{bundle.name}</span>
                    <Badge variant="outline" className="text-xs">{bundle.asset_count} assets</Badge>
                  </div>
                ) : null;
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  if (!activeInfospace) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-7xl h-full w-full flex flex-col p-0">
        <DialogHeader className="flex-none p-6 border-b">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            {mode === 'create' ? 'Create Article' : 'Edit Article'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden">
          <div className="h-full grid grid-cols-12 gap-0">
            {/* Main Content Area */}
            <div className="col-span-8 border-r flex flex-col">
              {/* Article Metadata */}
              <div className="flex-none p-4 border-b bg-muted/10 space-y-3">
                <div>
                  <Label htmlFor="article-title">Title</Label>
                  <Input
                    id="article-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Enter article title..."
                    className="mt-1"
                    disabled={isLoading}
                  />
                </div>
                <div>
                  <Label htmlFor="article-summary">Summary (Optional)</Label>
                  <Textarea
                    id="article-summary"
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    placeholder="Brief summary or description..."
                    rows={2}
                    className="mt-1"
                    disabled={isLoading}
                  />
                </div>
              </div>

              {/* Content Editor */}
              <div className="flex-1 min-h-0">
                <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'edit' | 'preview')} className="h-full flex flex-col">
                  <TabsList className="flex-none mx-4 mt-2 grid w-full grid-cols-2">
                    <TabsTrigger value="edit">Edit</TabsTrigger>
                    <TabsTrigger value="preview">Preview</TabsTrigger>
                  </TabsList>

                  <TabsContent value="edit" className="flex-1 min-h-0 m-4 mt-2">
                    <div className="h-full flex flex-col">
                      <div className="flex items-center justify-between mb-2">
                        <Label className="text-sm font-medium">Content</Label>
                        {embeddedAssets.length > 0 && (
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-xs">
                              {embeddedAssets.length} embedded
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setActiveTab('preview')}
                              className="h-6 text-xs"
                            >
                              <Eye className="h-3 w-3 mr-1" />
                              Preview
                            </Button>
                          </div>
                        )}
                      </div>
                      <div 
                        className="flex-1 border rounded-md relative"
                        onDrop={(e) => {
                          e.preventDefault();
                          const container = e.currentTarget;
                          const overlay = container.querySelector('.drag-overlay') as HTMLElement;
                          const overlayContent = overlay?.querySelector('div') as HTMLElement;
                          
                          // Reset visual state
                          container.classList.remove('border-primary');
                          if (overlay) overlay.classList.remove('border-primary', 'border-dashed');
                          if (overlayContent) overlayContent.classList.remove('opacity-100');
                          
                          const dragData = e.dataTransfer.getData('application/json');
                          if (dragData) {
                            try {
                              const parsed = JSON.parse(dragData);
                              
                              if (parsed.type === 'assets' && Array.isArray(parsed.items)) {
                                // Handle multiple assets from AssetSelector
                                let embedCount = 0;
                                parsed.items.forEach((asset: AssetRead) => {
                                  handleAssetEmbed(asset, 'card', 'medium', false); // Don't show individual toasts
                                  embedCount++;
                                });
                                toast.success(`Embedded ${embedCount} asset${embedCount !== 1 ? 's' : ''}`);
                              } else if (parsed.id) {
                                // Handle single asset
                                handleAssetEmbed(parsed as AssetRead);
                              }
                            } catch (error) {
                              console.error('Error parsing dropped asset:', error);
                              toast.error('Failed to embed dropped asset');
                            }
                          }
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          const container = e.currentTarget;
                          const overlay = container.querySelector('.drag-overlay') as HTMLElement;
                          const overlayContent = overlay?.querySelector('div') as HTMLElement;
                          
                          container.classList.add('border-primary');
                          if (overlay) overlay.classList.add('border-primary', 'border-dashed');
                          if (overlayContent) overlayContent.classList.add('opacity-100');
                        }}
                        onDragLeave={(e) => {
                          e.preventDefault();
                          const container = e.currentTarget;
                          const overlay = container.querySelector('.drag-overlay') as HTMLElement;
                          const overlayContent = overlay?.querySelector('div') as HTMLElement;
                          
                          container.classList.remove('border-primary');
                          if (overlay) overlay.classList.remove('border-primary', 'border-dashed');
                          if (overlayContent) overlayContent.classList.remove('opacity-100');
                        }}
                      >
                        <Textarea
                          ref={contentEditorRef}
                          value={content}
                          onChange={(e) => setContent(e.target.value)}
                          placeholder={`# Write your article content here...

You can use Markdown formatting:
- **bold text**
- *italic text*  
- ## Headings
- [links](url)

Embed assets by dragging from the library or using:
{{asset:123:card:medium}}

Double-click assets in the library to quickly embed them.`}
                          className="w-full h-full font-mono text-sm leading-relaxed resize-none border-0 focus:ring-0 focus:outline-none"
                          disabled={isLoading}
                        />
                        <div className="absolute top-2 right-2 text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded opacity-60 hover:opacity-100 transition-opacity">
                          Drop assets here to embed
                        </div>
                        
                        {/* Drag overlay */}
                        <div className="absolute inset-0 border-2 border-dashed border-transparent transition-all pointer-events-none drag-overlay">
                          <div className="absolute inset-0 bg-primary/5 opacity-0 transition-opacity flex items-center justify-center">
                            <div className="bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium">
                              Drop assets to embed them
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex-none mt-3 space-y-2">
                        <div className="text-xs text-muted-foreground space-y-1">
                          <p>💡 <strong>Embedding Tips:</strong></p>
                          <p>• Drag assets from library → Drop in editor</p>
                          <p>• Double-click assets → Auto-embed as cards</p>
                          <p>• Use + button → Embed as card, → button for inline</p>
                          <p>• Manual syntax: {`{{asset:ID:mode:size}}`}</p>
                        </div>
                        
                        <div className="text-xs">
                          <details className="cursor-pointer">
                            <summary className="text-muted-foreground hover:text-foreground">
                              Embed modes & sizes
                            </summary>
                            <div className="mt-1 space-y-1 text-muted-foreground">
                              <p><strong>Modes:</strong> inline, card, reference, attachment</p>
                              <p><strong>Sizes:</strong> small, medium, large, full</p>
                            </div>
                          </details>
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="preview" className="flex-1 min-h-0 m-4 mt-2">
                    <ScrollArea className="h-full border rounded-lg bg-background">
                      {renderPreview()}
                    </ScrollArea>
                  </TabsContent>
                </Tabs>
              </div>
            </div>

            {/* Asset Library Sidebar */}
            <div className="col-span-4 flex flex-col bg-muted/5">
              <div className="flex-none p-4 border-b">
                <h3 className="font-semibold text-sm mb-3">Asset Library</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Double-click assets to embed them, or drag into the content editor
                </p>
              </div>

              <div className="flex-1 min-h-0">
                <Tabs defaultValue="assets" className="h-full flex flex-col">
                  <TabsList className="grid w-full grid-cols-2 mx-4 mt-2">
                    <TabsTrigger value="assets">Assets</TabsTrigger>
                    <TabsTrigger value="bundles">Bundles</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="assets" className="flex-1 min-h-0 m-0">
                    <div className="h-full flex flex-col">
                      {embeddedAssets.length > 0 && (
                        <div className="flex-none p-3 border-b bg-muted/10">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{embeddedAssets.length} asset{embeddedAssets.length !== 1 ? 's' : ''} embedded</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setActiveTab('preview')}
                              className="h-6 text-xs"
                            >
                              <Eye className="h-3 w-3 mr-1" />
                              Preview
                            </Button>
                          </div>
                        </div>
                      )}
                      <div className="flex-1 min-h-0">
                        <AssetSelector
                          selectedItems={selectedAssets}
                          onSelectionChange={setSelectedAssets}
                          onItemDoubleClick={handleAssetDoubleClick}
                          renderItemActions={(item) => {
                            const isEmbedded = item.asset && embeddedAssets.some(embed => embed.assetId === item.asset!.id);
                            
                            return (
                              <div className="flex gap-1">
                                {isEmbedded ? (
                                  <Badge variant="secondary" className="text-xs h-6 px-2">
                                    Embedded
                                  </Badge>
                                ) : (
                                  <>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 w-6 p-0"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (item.asset) {
                                          handleAssetEmbed(item.asset, 'card', 'medium');
                                        } else if (item.bundle) {
                                          handleBundleReference(item.bundle.id);
                                        }
                                      }}
                                      title={item.asset ? "Embed as Card" : "Reference Bundle"}
                                    >
                                      <Plus className="h-3 w-3" />
                                    </Button>
                                    {item.asset && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 w-6 p-0"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleAssetEmbed(item.asset!, 'inline', 'small');
                                        }}
                                        title="Embed Inline"
                                      >
                                        <ArrowRight className="h-3 w-3" />
                                      </Button>
                                    )}
                                  </>
                                )}
                              </div>
                            );
                          }}
                        />
                      </div>
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="bundles" className="flex-1 min-h-0 m-0 p-4">
                    <div className="space-y-2">
                      <h4 className="font-medium text-sm">Available Bundles</h4>
                      <ScrollArea className="h-full">
                        <div className="space-y-2">
                          {bundles.map(bundle => (
                            <div
                              key={bundle.id}
                              className={cn(
                                "p-3 border rounded-lg cursor-pointer transition-colors",
                                referencedBundles.includes(bundle.id) 
                                  ? "bg-primary/10 border-primary" 
                                  : "hover:bg-muted/50"
                              )}
                              onClick={() => handleBundleReference(bundle.id)}
                            >
                              <div className="flex items-center gap-2">
                                <FileText className="h-4 w-4 text-primary" />
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-sm truncate">{bundle.name}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {bundle.asset_count} assets
                                  </p>
                                </div>
                                {referencedBundles.includes(bundle.id) && (
                                  <Badge variant="default" className="text-xs">Referenced</Badge>
                                )}
                              </div>
                              {bundle.description && (
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                  {bundle.description}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </div>
        </div>

        {/* Embedded Assets Management */}
        {embeddedAssets.length > 0 && (
          <div className="flex-none border-t bg-muted/5 p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-sm">Embedded Assets ({embeddedAssets.length})</h4>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEmbeddedAssets([])}
                className="text-xs h-7"
              >
                Clear All
              </Button>
            </div>
            <ScrollArea className="max-h-32">
              <div className="grid grid-cols-2 gap-2">
                {embeddedAssets.map(embed => (
                  <div key={embed.id}>
                    {renderEmbeddedAssetPreview(embed)}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        <DialogFooter className="flex-none p-6 border-t">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {embeddedAssets.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {embeddedAssets.length} embedded assets
                </Badge>
              )}
              {referencedBundles.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {referencedBundles.length} referenced bundles
                </Badge>
              )}
            </div>
            
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose} disabled={isLoading}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isLoading || !title.trim()}>
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    {mode === 'create' ? 'Creating...' : 'Updating...'}
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    {mode === 'create' ? 'Create Article' : 'Update Article'}
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
