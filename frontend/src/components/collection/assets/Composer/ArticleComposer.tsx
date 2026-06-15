'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Save, Loader2, HelpCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { AssetRead, AssetKind } from '@/client';
import { useAssetStore } from '@/zustand_stores/storeAssets';
import { useDock } from '@/zustand_stores/storeDock';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import ComposedArticleRenderer from '../Views/Articles/ComposedArticleRenderer';
import { DockBack, DockClose } from '@/components/collection/intake/DockNav';
import type { SurfaceContentProps } from '@/components/collection/intake/types';

interface EmbeddedAsset {
  id: string;
  assetId: number;
  asset: AssetRead;
  position: number;
  mode: 'inline' | 'card' | 'reference' | 'attachment';
  size: 'small' | 'medium' | 'large' | 'full';
  caption?: string;
}

type ComposerInit = { assetId?: number; mode?: 'create' | 'edit' };

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

export default function ArticleComposer({ init, close, back, mode: surfaceMode }: SurfaceContentProps<ComposerInit>) {
  const mode: 'create' | 'edit' = init?.mode ?? (init?.assetId ? 'edit' : 'create');
  const existingAssetId = init?.assetId;
  const docked = surfaceMode === 'panel';
  const { updateAsset, getAssetById, fetchAssets } = useAssetStore();
  const openAsset = useDock((s) => s.openAsset);
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
  const [dragOver, setDragOver] = useState(false);

  // Refs
  const contentEditorRef = useRef<HTMLTextAreaElement>(null);

  // Load existing article when editing; reset for a fresh draft.
  useEffect(() => {
    if (mode === 'edit' && existingAssetId) {
      loadExistingArticle(existingAssetId);
    } else {
      resetForm();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, existingAssetId]);

  useEffect(() => {
    if (activeInfospace?.id) fetchBundles(activeInfospace.id);
  }, [activeInfospace?.id, fetchBundles]);

  const loadExistingArticle = async (assetId: number) => {
    try {
      setIsLoading(true);
      const asset = await getAssetById(assetId);
      if (asset) {
        setTitle(asset.title);
        setContent(asset.text_content || '');
        setSummary(((asset.facets?.summary ?? asset.file_info?.summary) as string | undefined) || '');
        
        // Parse embedded assets from file_info
        const embeddedFromMetadata = (asset.file_info?.embedded_assets as any[]) || [];
        
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
        
        // Parse referenced bundles from file_info
        const referencedFromMetadata = (asset.file_info?.referenced_bundles as number[]) || [];
        setReferencedBundles(referencedFromMetadata);
        
        // Parse metadata from file_info
        const articleMetadata = (asset.file_info?.metadata as any) || {};
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

  // Bundles embed like assets: a {{bundle:ID}} marker in the content + an entry in
  // referenced_bundles. Remove a link by deleting its marker in the editor.
  const handleBundleEmbed = (bundleId: number) => {
    if (referencedBundles.includes(bundleId)) {
      toast.info('Bundle already linked');
      return;
    }
    setReferencedBundles(prev => [...prev, bundleId]);
    const marker = `\n\n{{bundle:${bundleId}}}\n\n`;
    const textarea = contentEditorRef.current;
    if (textarea) {
      const pos = textarea.selectionStart;
      setContent(content.slice(0, pos) + marker + content.slice(pos));
      setTimeout(() => { textarea.selectionStart = textarea.selectionEnd = pos + marker.length; textarea.focus(); }, 0);
    } else {
      setContent(prev => prev + marker);
    }
    toast.success(`Linked bundle: ${bundles.find(b => b.id === bundleId)?.name ?? bundleId}`);
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
      const articleFileInfo = {
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
      };

      const articleData = {
        title: title.trim(),
        kind: 'article' as AssetKind,
        text_content: content,
        file_info: articleFileInfo,
        facets: summary ? { summary } : undefined,
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
          // Land on the rendered article (read mode) — completes the read⇄edit loop.
          close();
          if (docked && createdAsset?.id) openAsset(createdAsset.id);
        } catch (error) {
          throw error; // Re-throw to be caught by outer try-catch
        }
      } else if (mode === 'edit' && existingAssetId) {
        // Update existing article
        const updateData = {
          title: articleData.title,
          text_content: articleData.text_content,
          file_info: articleData.file_info,
          facets: articleData.facets,
        };
        
        const updatedAsset = await updateAsset(existingAssetId, updateData);
        if (updatedAsset) {
          toast.success(`Article "${title}" updated successfully`);
          // Back to the rendered article (read mode), freshly refetched.
          close();
          if (docked) openAsset(existingAssetId);
        }
      }
    } catch (error) {
      console.error('Error saving article:', error);
      toast.error(`Failed to ${mode === 'create' ? 'create' : 'update'} article`);
    } finally {
      setIsLoading(false);
    }
  };

  // The preview is the real article rendering (same component the saved article
  // uses), so embeds show actual previews, not "card/medium" placeholders.
  const renderPreview = () => (
    <div className="p-4">
      <h1 className="mb-1 text-2xl font-bold">{title || 'Untitled article'}</h1>
      {metadata.author && <p className="mb-2 text-sm text-muted-foreground">by {metadata.author}</p>}
      {summary && (
        <p className="mb-4 border-l-4 border-primary bg-muted/30 p-3 text-sm italic">{summary}</p>
      )}
      <ComposedArticleRenderer
        asset={{ id: existingAssetId ?? 0, title, kind: 'article' } as AssetRead}
        content={content}
        embeddedAssets={embeddedAssets.map(e => ({ asset_id: e.assetId, caption: e.caption, mode: e.mode, size: e.size }))}
      />
    </div>
  );

  if (!activeInfospace) {
    return null;
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Title (with dock nav) + author + summary */}
      <div className="flex-none space-y-2 border-b bg-muted/10 p-3 pt-0 pr-2">
        <div className="flex items-center gap-2">
          {docked && back && <DockBack onClick={back} />}
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Article title…"
            className="flex-1 text-base font-medium !ring-none !ring-offset-0 !ring-0"
            disabled={isLoading}
          />
          {docked && <DockClose onClick={close} />}
        </div>
        <Input
          value={metadata.author}
          onChange={(e) => setMetadata((m) => ({ ...m, author: e.target.value }))}
          placeholder="Author (optional)"
          className="h-8 text-sm !ring-none !ring-offset-0 !ring-0"
          disabled={isLoading}
        />
        <Textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Summary (optional)…"
          rows={2}
          className="resize-none text-sm !ring-none !ring-offset-0 !ring-0"
          disabled={isLoading}
        />
      </div>

      {/* Editor / preview */}
      <div className="min-h-0 flex-1">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'edit' | 'preview')} className="flex h-full flex-col">
          <div className="mx-3 mt-2 flex shrink-0 items-center gap-2">
            <TabsList className="grid flex-1 grid-cols-2">
              <TabsTrigger value="edit">Edit</TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
            </TabsList>
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground" title="Embed syntax">
                    <HelpCircle className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="end" className="max-w-xs space-y-1 text-xs">
                  <p className="font-medium">Embed syntax</p>
                  <p><code>{'{{asset:ID:mode:size}}'}</code> — e.g. <code>{'{{asset:42:card:medium}}'}</code></p>
                  <p><span className="text-muted-foreground">modes:</span> inline · card · reference · attachment</p>
                  <p><span className="text-muted-foreground">sizes:</span> small · medium · large · full</p>
                  <p><code>{'{{bundle:ID}}'}</code> — link a bundle</p>
                  <p className="text-muted-foreground">Tip: drag from the tree to insert these for you.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <TabsContent value="edit" className="m-3 mr-2 mt-2 min-h-0 flex-1">
            <div
              className={cn('relative h-full rounded-md border transition-colors', dragOver && 'border-primary')}
              onDrop={async (e) => {
                e.preventDefault();
                setDragOver(false);
                const raw = e.dataTransfer.getData('application/json');
                if (!raw) return;
                let parsed: any;
                try { parsed = JSON.parse(raw); } catch { return; }

                // The tree emits id-only refs ({type:'assets'|'mixed'} or a bare {id}).
                const assetIds: number[] = [];
                const bundleIds: number[] = [];
                if (parsed.type === 'assets' && Array.isArray(parsed.items)) {
                  parsed.items.forEach((it: any) => { if (it?.id != null) assetIds.push(it.id); });
                } else if (parsed.type === 'mixed' && Array.isArray(parsed.items)) {
                  parsed.items.forEach((it: any) => {
                    if (it.type === 'bundle' && it.item?.id != null) bundleIds.push(it.item.id);
                    else if (it.item?.id != null) assetIds.push(it.item.id);
                  });
                } else if (parsed.id != null) {
                  assetIds.push(parsed.id);
                }

                bundleIds.forEach((id) => handleBundleEmbed(id));
                let embedded = 0;
                for (const id of assetIds) {
                  try {
                    const asset = await getAssetById(id);
                    if (asset) { handleAssetEmbed(asset, 'card', 'medium', false); embedded++; }
                  } catch { /* skip unresolved */ }
                }
                if (embedded) toast.success(`Embedded ${embedded} asset${embedded !== 1 ? 's' : ''}`);
              }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
            >
              <Textarea
                ref={contentEditorRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={'# Write your article…\n\nMarkdown supported. Drag assets from the tree to embed, or type {{asset:ID:card:medium}}.'}
                className="h-full w-full resize-none border-0 font-mono text-sm leading-relaxed focus-visible:ring-0"
                disabled={isLoading}
              />
              {dragOver && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md border-2 border-dashed border-primary bg-primary/5">
                  <span className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">Drop to embed</span>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="preview" className="m-3 mt-2 min-h-0 flex-1">
            <ScrollArea className="h-full rounded-md border bg-background">{renderPreview()}</ScrollArea>
          </TabsContent>
        </Tabs>
      </div>

      {/* Footer */}
      <div className="flex flex-none items-center justify-end gap-2 p-1 pb-0">
        <Button variant="ghost" size="sm" onClick={close} disabled={isLoading}>Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={isLoading || !title.trim()}>
          {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          {mode === 'create' ? 'Create article' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
