'use client';

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAssetStore } from '@/zustand_stores/storeAssets';
import { AssetKind } from '@/client/';
import {
    Loader2, FileText, X, FileSpreadsheet,
    Type, Image as ImageIcon, Video, Music, Mail,
    FileUp, Plus, Globe, CheckCircle, Clock,
    Folder, FolderOpen, FileArchive, FileType, AlertTriangle,
    ChevronRight, ChevronDown
} from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { AssetRead } from '@/client/';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { useTreeStore } from '@/zustand_stores/storeTree';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useIsMobile } from '@/hooks/use-mobile';
import { fromEvent, FileWithPath } from 'file-selector';


interface CreateAssetDialogProps {
  open: boolean;
  onClose: () => void;
  mode: 'individual' | 'bundle';
  initialFocus?: 'file' | 'url' | 'text';
  existingBundleId?: number;
  existingBundleName?: string;
}

interface BundleItem {
  id: string;
  type: 'file' | 'url' | 'text' | 'archive';
  kind: AssetKind;
  title: string;
  file?: File;
  /** Relative path within the dropped folder/zip — defaults to file.name for flat drops. */
  relativePath?: string;
  url?: string;
  textContent?: string;
  status?: 'pending' | 'uploading' | 'processing' | 'complete' | 'error';
  progress?: number;
  error?: string;
}

/** Pair produced by readEntry / folder picker — File + its relative path within the drop. */
interface FilePair { file: File; relativePath: string; }

interface UploadProgress {
  phase: 'preparing' | 'uploading' | 'processing' | 'complete' | 'error';
  message: string;
  progress: number;
  currentItem?: string;
  totalItems: number;
  completedItems: number;
  errors?: { item: string; error: string }[];
}

// ── Asset kind metadata ──────────────────────────────────────────────────────

const assetKinds: { value: AssetKind; label: string; icon: React.ElementType; accept: string }[] = [
  { value: 'pdf',   label: 'PDF',   icon: FileText,       accept: '.pdf' },
  { value: 'csv',   label: 'CSV',   icon: FileSpreadsheet, accept: '.csv,text/csv' },
  { value: 'image', label: 'Image', icon: ImageIcon,       accept: 'image/*' },
  { value: 'video', label: 'Video', icon: Video,           accept: 'video/*' },
  { value: 'audio', label: 'Audio', icon: Music,           accept: 'audio/*' },
  { value: 'mbox',  label: 'MBOX',  icon: Mail,            accept: '.mbox' },
];

const ARCHIVE_EXTENSIONS = ['.zip', '.tar', '.gz', '.tgz', '.tar.gz', '.tar.bz2', '.tbz2'];

/** True if `url` ends (ignoring query/fragment) in an archive extension. */
const isArchiveUrl = (url: string): boolean => {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return ARCHIVE_EXTENSIONS.some(ext => path.endsWith(ext));
  } catch {
    return false;
  }
};

const isArchiveFile = (file: File): boolean => {
  const name = file.name.toLowerCase();
  return ARCHIVE_EXTENSIONS.some(ext => name.endsWith(ext));
};

const getKindFromFile = (file: File): AssetKind => {
  const mime = file.type.toLowerCase();
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (mime.includes('pdf') || ext === 'pdf') return 'pdf';
  if (mime.includes('csv') || ext === 'csv') return 'csv';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (ext === 'mbox') return 'mbox';
  return 'text';
};

const getItemIcon = (item: BundleItem): React.ElementType => {
  if (item.type === 'archive') return FileArchive;
  if (item.type === 'url') return Globe;
  if (item.type === 'text') return Type;
  const found = assetKinds.find(k => k.value === item.kind);
  return found?.icon || FileText;
};

const statusIndicator = (status?: string) => {
  switch (status) {
    case 'complete':    return <CheckCircle className="h-3.5 w-3.5 text-green-600" />;
    case 'uploading':
    case 'processing':  return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />;
    case 'error':       return <AlertTriangle className="h-3.5 w-3.5 text-red-600" />;
    default:            return <Clock className="h-3.5 w-3.5 text-muted-foreground/50" />;
  }
};

// ── URL extraction ───────────────────────────────────────────────────────────

const URL_RE = /https?:\/\/[^\s,;"'<>()]+/gi;

function extractUrls(text: string): string[] {
  // First try line-by-line (one URL per line)
  const lines = text.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);
  const lineUrls = lines.filter(l => /^https?:\/\//i.test(l));
  if (lineUrls.length > 0) return [...new Set(lineUrls)];
  // Fall back to regex extraction
  const matches = text.match(URL_RE);
  return matches ? [...new Set(matches)] : [];
}

// ── Component ────────────────────────────────────────────────────────────────

export default function CreateAssetDialog({ open, onClose, mode, initialFocus, existingBundleId, existingBundleName }: CreateAssetDialogProps) {
  const { isLoading: storeIsLoading, fetchAssets } = useAssetStore();
  const { activeInfospace } = useInfospaceStore();
  const { bundles, fetchBundles: fetchBundlesFromStore } = useBundleStore();

  const [bundleTitle, setBundleTitle] = useState('');
  const [items, setItems] = useState<BundleItem[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);

  // Destination
  const [destination, setDestination] = useState<'individual' | 'new_bundle' | 'existing_bundle'>(
    mode === 'individual' ? 'individual' : (existingBundleId ? 'existing_bundle' : 'new_bundle')
  );
  const [selectedBundleId, setSelectedBundleId] = useState<number | string | undefined>(existingBundleId);

  // Input state
  const [bulkUrlText, setBulkUrlText] = useState('');
  const [newTextContent, setNewTextContent] = useState('');
  const [newTextTitle, setNewTextTitle] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  // Tree expansion state — set of folder paths that are open.
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const isMobile = useIsMobile();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const urlFileInputRef = useRef<HTMLInputElement>(null);

  // ── Effects ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (open && activeInfospace?.id) fetchBundlesFromStore(activeInfospace.id);
  }, [open, activeInfospace?.id, fetchBundlesFromStore]);

  useEffect(() => {
    if (open) {
      setDestination(mode === 'individual' ? 'individual' : (existingBundleId ? 'existing_bundle' : 'new_bundle'));
      setSelectedBundleId(existingBundleId);
      setBundleTitle(mode === 'bundle' && existingBundleId ? (existingBundleName || '') : '');
    }
  }, [mode, existingBundleId, existingBundleName, open]);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const genId = () => `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const resetForm = useCallback(() => {
    setBundleTitle('');
    setItems([]);
    setBulkUrlText('');
    setNewTextContent('');
    setNewTextTitle('');
    setFormError(null);
    setUploadProgress(null);
    setDestination(mode === 'individual' ? 'individual' : (existingBundleId ? 'existing_bundle' : 'new_bundle'));
    setSelectedBundleId(existingBundleId);
  }, [mode, existingBundleId]);

  const handleClose = () => {
    if (uploadProgress && uploadProgress.phase !== 'complete' && uploadProgress.phase !== 'error') return;
    resetForm();
    onClose();
  };

  const updateItemStatus = (id: string, status: BundleItem['status'], error?: string, progress?: number) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, status, error, progress } : i));
  };

  const updateItemTitle = (id: string, title: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, title } : i));
  };

  const removeItem = (id: string) => setItems(prev => prev.filter(i => i.id !== id));

  // ── File handling ────────────────────────────────────────────────────────

  const addFiles = (input: FileList | File[] | FilePair[] | null) => {
    if (!input) return;
    // Normalize: accept FileList, File[] (possibly FileWithPath), or FilePair[].
    const pairs: FilePair[] = Array.from(input as any).map((entry: any): FilePair => {
      if (entry && (entry as FilePair).file instanceof File) return entry as FilePair;
      const f = entry as FileWithPath;
      // Priority: file-selector's `.path` (populated for DnD folders + directory picker)
      // → webkitRelativePath (directory picker fallback) → file.name (plain flat drop).
      const rel = (f.path || (f as any).webkitRelativePath || f.name || '').replace(/^\/+/, '');
      return { file: f, relativePath: rel };
    });
    // Diagnostic — remove once confirmed working. Shows whether paths came through.
    const withSlash = pairs.filter(p => p.relativePath.includes('/')).length;
    // eslint-disable-next-line no-console
    console.log(
      `[upload] addFiles: ${pairs.length} items, ${withSlash} with folder paths.`,
      pairs.slice(0, 5).map(p => ({ name: p.file.name, path: p.relativePath })),
    );
    const realPairs = pairs.filter(({ file: f }) => {
      if (f.name.startsWith('.')) return false;
      if (f.size === 0 && !f.type && !f.name.includes('.')) return false;
      return true;
    });
    if (realPairs.length === 0) return;

    // Sort by relative path so the list reads like a folder tree: items in the
    // same directory group together, directories appear in alphabetical order.
    // `localeCompare` with numeric:true so "file2" < "file10".
    realPairs.sort((a, b) =>
      a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true, sensitivity: 'base' })
    );

    const newItems: BundleItem[] = realPairs.map(({ file, relativePath }) => {
      const archive = isArchiveFile(file);
      return {
        id: genId(),
        type: archive ? 'archive' as const : 'file' as const,
        kind: archive ? ('text' as AssetKind) : getKindFromFile(file),
        title: file.name.replace(/\.[^/.]+$/, ''),
        file,
        relativePath,
        status: 'pending' as const,
      };
    });
    setItems(prev => [...prev, ...newItems]);
    setFormError(null);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = (await fromEvent(e.nativeEvent)) as FileWithPath[];
    addFiles(files);
    e.target.value = '';
  };

  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = (await fromEvent(e.nativeEvent)) as FileWithPath[];
    addFiles(files);
    e.target.value = '';
  };

  const handleKindSelect = (kind: typeof assetKinds[number]) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = kind.accept;
    input.multiple = true;
    input.onchange = async (e) => {
      const files = (await fromEvent(e)) as FileWithPath[];
      addFiles(files);
    };
    input.click();
  };

  // ── Drag & drop ──────────────────────────────────────────────────────────

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(false); };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (uploadProgress) return;

    // file-selector handles DnD folder recursion (incl. the readEntries 100-item
    // chunking quirk) and returns FileWithPath objects whose `.path` is the
    // relative path within the dropped tree.
    const files = (await fromEvent(e.nativeEvent)) as FileWithPath[];
    if (files.length > 0) addFiles(files);
  };

  // ── URL handling ─────────────────────────────────────────────────────────

  const handleBulkUrlAdd = () => {
    const urls = extractUrls(bulkUrlText);
    if (urls.length === 0) {
      toast.error('No valid URLs found in the text.');
      return;
    }
    const newItems: BundleItem[] = urls.map(url => {
      let host = url;
      try { host = new URL(url).hostname; } catch {}
      return {
        id: genId(),
        type: 'url' as const,
        kind: 'web' as AssetKind,
        title: host,
        url,
        status: 'pending' as const,
      };
    });
    setItems(prev => [...prev, ...newItems]);
    setBulkUrlText('');
    setFormError(null);
    toast.success(`Added ${urls.length} URL${urls.length > 1 ? 's' : ''}`);
  };

  const handleUrlFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (!text) return;
      const urls = extractUrls(text);
      if (urls.length === 0) {
        toast.error('No valid URLs found in the file.');
        return;
      }
      const newItems: BundleItem[] = urls.map(url => {
        let host = url;
        try { host = new URL(url).hostname; } catch {}
        return {
          id: genId(),
          type: 'url' as const,
          kind: 'web' as AssetKind,
          title: host,
          url,
          status: 'pending' as const,
        };
      });
      setItems(prev => [...prev, ...newItems]);
      toast.success(`Imported ${urls.length} URL${urls.length > 1 ? 's' : ''} from file`);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // ── Text handling ────────────────────────────────────────────────────────

  const handleAddText = () => {
    if (!newTextContent.trim()) return;
    setItems(prev => [...prev, {
      id: genId(),
      type: 'text',
      kind: 'text',
      title: newTextTitle.trim() || `Text: ${newTextContent.substring(0, 40)}...`,
      textContent: newTextContent.trim(),
      status: 'pending',
    }]);
    setNewTextContent('');
    setNewTextTitle('');
    setFormError(null);
  };

  // ── Auto bundle title ──────────────────────────────────────────────────

  const generateBundleTitle = useCallback((items: BundleItem[]) => {
    if (items.length === 0) return '';
    const files = items.filter(i => i.type === 'file');
    const archives = items.filter(i => i.type === 'archive');
    const urls = items.filter(i => i.type === 'url');
    if (archives.length === items.length) return archives.length === 1 ? archives[0].title : `Archive Collection (${archives.length})`;
    if (files.length === items.length) {
      if (items.length === 1) return items[0].title;
      const kinds = [...new Set(items.map(i => i.kind))];
      if (kinds.length === 1) {
        const label = assetKinds.find(k => k.value === kinds[0])?.label || kinds[0];
        return `${label} Collection (${items.length} files)`;
      }
      return `Mixed Files (${items.length} files)`;
    }
    if (urls.length === items.length) return urls.length === 1 ? urls[0].title : `Web Collection (${urls.length} URLs)`;
    return `Mixed Collection (${items.length} items)`;
  }, []);

  useEffect(() => {
    if (destination === 'new_bundle' && items.length > 0 && !bundleTitle.trim()) {
      setBundleTitle(generateBundleTitle(items));
    }
  }, [items, destination, bundleTitle, generateBundleTitle]);

  // ── Validation ──────────────────────────────────────────────────────────

  const validateForm = (): boolean => {
    setFormError(null);
    if (destination === 'new_bundle' && !bundleTitle.trim() && items.length > 0) {
      setBundleTitle(generateBundleTitle(items));
    }
    if (destination === 'new_bundle' && !bundleTitle.trim()) { setFormError('Please provide a bundle title.'); return false; }
    if (destination === 'existing_bundle' && !selectedBundleId) { setFormError('Please select a bundle.'); return false; }
    if (items.length === 0) { setFormError('Please add at least one item.'); return false; }
    return true;
  };

  // ── Submit ──────────────────────────────────────────────────────────────

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validateForm() || !activeInfospace?.id) {
      if (!activeInfospace?.id) toast.error('No active infospace selected');
      return;
    }

    setFormError(null);
    setUploadProgress({ phase: 'preparing', message: 'Preparing upload...', progress: 0, totalItems: items.length, completedItems: 0 });
    setItems(prev => prev.map(i => ({ ...i, status: 'uploading' as const })));

    try {
      await processUpload();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Upload failed';
      setItems(prev => prev.map(i => ({ ...i, status: i.status === 'complete' ? 'complete' : 'error' as const, error: i.status === 'complete' ? undefined : msg })));
      setUploadProgress({ phase: 'error', message: msg, progress: 0, totalItems: items.length, completedItems: 0 });
      setFormError(msg);
      toast.error(msg);
    }
  };

  /**
   * Single upload orchestrator.
   *
   * - File/archive items → one POST to bulk-upload-background with
   *   relative_paths + bundle_name OR parent_bundle_id. Backend builds the
   *   Bundle tree and dissolves any zips into it.
   * - URL items → bulkIngestUrls (if >1) or createAsset (single).
   * - Text items → createAsset each.
   *
   * For "new_bundle" destination with URL/text items, we still drop them at
   * the top level — URL/text aren't tree-building, they're peers of the file
   * bundle. That matches the existing behavior.
   */
  const processUpload = async () => {
    if (!activeInfospace?.id) return;
    const { AssetsService, IngestionJobsService } = await import('@/client/');
    const total = items.length;

    setUploadProgress(prev => prev ? { ...prev, phase: 'uploading', message: 'Uploading...', progress: 10 } : null);

    // Partition into local (bytes we already have → sync call 1) and remote
    // (fetch-required → async call 2). Text rides call 1.
    const fileItems   = items.filter(i => (i.type === 'file' || i.type === 'archive') && i.file);
    const urlItems    = items.filter(i => i.type === 'url');
    const textItems   = items.filter(i => i.type === 'text');
    const hasLocal    = fileItems.length > 0 || textItems.length > 0;
    const hasRemote   = urlItems.length > 0;

    // Destination resolution — identical contract for both calls.
    const existingBundleId =
      destination === 'existing_bundle' && selectedBundleId
        ? (typeof selectedBundleId === 'string' ? parseInt(selectedBundleId, 10) : selectedBundleId)
        : undefined;
    const newBundleName = destination === 'new_bundle' ? bundleTitle : undefined;

    let resolvedBundleId: number | undefined = existingBundleId;
    let call1Succeeded = false;

    try {
      // ── Call 1: sync bulk-upload (files + text + folder tree + archives-as-files) ──
      if (hasLocal) {
        [...fileItems, ...textItems].forEach(i => updateItemStatus(i.id, 'uploading', undefined, 40));

        const formData: Record<string, any> = {
          files: fileItems.map(i => i.file!),
          relative_paths: fileItems.map(i => i.relativePath || i.file!.name),
        };
        if (existingBundleId) formData.parent_bundle_id = existingBundleId;
        else if (newBundleName) formData.bundle_name = newBundleName;
        if (textItems.length > 0) {
          formData.text_items = JSON.stringify(
            textItems.map(t => ({ title: t.title, content: t.textContent || '' })),
          );
        }

        const resp: any = await AssetsService.createAssetsBackgroundBulk({
          infospaceId: activeInfospace.id,
          formData: formData as any,
        });
        call1Succeeded = true;
        if (resp?.root_bundle_id) resolvedBundleId = resp.root_bundle_id;

        const tasks: Array<{ asset_id: number | null; filename: string; relative_path: string; status: string; error?: string }> = resp?.tasks ?? [];
        for (const item of fileItems) {
          const match = tasks.find(t => t.relative_path === (item.relativePath || item.file!.name));
          if (match?.status === 'failed') updateItemStatus(item.id, 'error', match.error || 'Upload failed');
          else updateItemStatus(item.id, 'complete', undefined, 100);
        }
        for (const item of textItems) {
          const match = tasks.find(t => t.relative_path === (item.title || 'Text'));
          if (match?.status === 'failed') updateItemStatus(item.id, 'error', match.error || 'Failed');
          else updateItemStatus(item.id, 'complete', undefined, 100);
        }
      }

      // ── Call 2: fire-and-forget batch ingestion for remote items ──
      let queuedRemote = 0;
      if (hasRemote) {
        const batchItems = urlItems.map(i => ({
          kind: (i.url && isArchiveUrl(i.url) ? 'archive_url' : 'web_url') as 'web_url' | 'archive_url',
          locator: i.url!,
          title: i.title,
        }));
        // Prefer a concrete bundle id (from call 1 or existing), else create by name.
        const requestBody: any = { items: batchItems };
        if (resolvedBundleId) requestBody.bundle_id = resolvedBundleId;
        else if (newBundleName) requestBody.bundle_name = newBundleName;

        try {
          await IngestionJobsService.createBatchIngestionJob({
            infospaceId: activeInfospace.id,
            requestBody,
          });
          urlItems.forEach(i => updateItemStatus(i.id, 'complete', undefined, 100));
          queuedRemote = urlItems.length;
        } catch (err: any) {
          const detail = err?.body?.detail || err?.message || 'Could not queue batch ingestion';
          const msg = typeof detail === 'string' ? detail : JSON.stringify(detail);
          urlItems.forEach(i => updateItemStatus(i.id, 'error', msg));
          if (!hasLocal) throw err;  // nothing else landed — bubble up
        }
      }

      // ── Close immediately after the kick ─────────────────────────────────
      setUploadProgress({
        phase: 'complete',
        message: queuedRemote > 0
          ? `${queuedRemote} item${queuedRemote > 1 ? 's' : ''} queued — track in Ingestion Jobs.`
          : 'Upload complete.',
        progress: 100, totalItems: total, completedItems: total,
      });
      // Refresh stores so the newly-created bundle appears in the tree.
      // The inline ingestion-job progress indicator in AssetSelector attaches
      // to the destination bundle's tree node — without a tree refresh the
      // user has no visible surface to watch progress on.
      const { fetchBundles } = useBundleStore.getState();
      const { clearCache, fetchRootTree } = useTreeStore.getState();
      clearCache();
      Promise.allSettled([fetchAssets(), fetchBundles(activeInfospace.id), fetchRootTree()]);
      if (queuedRemote > 0) {
        toast.success(`${queuedRemote} remote item${queuedRemote > 1 ? 's' : ''} queued. Track progress in Ingestion Jobs.`);
      } else {
        const successCount = fileItems.length + textItems.length;
        toast.success(`${successCount} item${successCount !== 1 ? 's' : ''} uploaded.`);
      }
      handleClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      if (!call1Succeeded) {
        fileItems.forEach(i => updateItemStatus(i.id, 'error', msg));
        textItems.forEach(i => updateItemStatus(i.id, 'error', msg));
      }
      throw err;
    }
  };

  // ── Derived state ────────────────────────────────────────────────────────

  // ── Tree view ────────────────────────────────────────────────────────────
  // Build a tree from items' relative paths. File-typed items group under their
  // directory prefix; URL/text items are "loose leaves" at the root.

  type TreeFile = { kind: 'file'; item: BundleItem };
  type TreeFolder = { kind: 'folder'; name: string; path: string; children: TreeNode[] };
  type TreeNode = TreeFile | TreeFolder;

  const tree: TreeNode[] = useMemo(() => {
    type DirNode = { children: Map<string, DirNode | { item: BundleItem }> };
    const root: DirNode = { children: new Map() };

    const looseItems: BundleItem[] = [];
    for (const item of items) {
      const isFile = item.type === 'file' || item.type === 'archive';
      const path = isFile ? (item.relativePath || item.file?.name || item.title) : '';
      const parts = path.split('/').filter(Boolean);
      if (!isFile || parts.length === 0) { looseItems.push(item); continue; }

      let cursor: DirNode = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const dir = parts[i];
        const existing = cursor.children.get(dir);
        if (existing && 'children' in existing) {
          cursor = existing;
        } else {
          const next: DirNode = { children: new Map() };
          cursor.children.set(dir, next);
          cursor = next;
        }
      }
      cursor.children.set(parts[parts.length - 1], { item });
    }

    const convert = (dir: DirNode, prefix: string): TreeNode[] => {
      const entries = Array.from(dir.children.entries()).sort(([an, av], [bn, bv]) => {
        const aFolder = 'children' in av;
        const bFolder = 'children' in bv;
        if (aFolder !== bFolder) return aFolder ? -1 : 1;          // folders first
        return an.localeCompare(bn, undefined, { numeric: true, sensitivity: 'base' });
      });
      return entries.map(([name, node]) => {
        const path = prefix ? `${prefix}/${name}` : name;
        if ('children' in node) {
          return { kind: 'folder' as const, name, path, children: convert(node, path) };
        }
        return { kind: 'file' as const, item: node.item };
      });
    };

    return [
      ...looseItems.map(item => ({ kind: 'file' as const, item })),
      ...convert(root, ''),
    ];
  }, [items]);

  const toggleFolder = (path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const collectFolderItemIds = (node: TreeFolder): string[] => {
    const ids: string[] = [];
    const walk = (n: TreeNode) => {
      if (n.kind === 'file') ids.push(n.item.id);
      else n.children.forEach(walk);
    };
    node.children.forEach(walk);
    return ids;
  };

  const removeFolder = (node: TreeFolder) => {
    const ids = new Set(collectFolderItemIds(node));
    setItems(prev => prev.filter(i => !ids.has(i.id)));
  };

  const renderTreeNode = (node: TreeNode, depth: number): React.ReactNode => {
    if (node.kind === 'folder') {
      const isOpen = expandedFolders.has(node.path);
      const leafCount = collectFolderItemIds(node).length;
      return (
        <React.Fragment key={`folder:${node.path}`}>
          <div
            className="flex items-center gap-1 px-3 py-1.5 hover:bg-muted/40 cursor-pointer select-none"
            style={{ paddingLeft: `${12 + depth * 16}px` }}
            onClick={() => toggleFolder(node.path)}
          >
            {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
            {isOpen ? <FolderOpen className="h-3.5 w-3.5 text-amber-600" /> : <Folder className="h-3.5 w-3.5 text-amber-600" />}
            <span className="text-sm font-medium truncate flex-1">{node.name}</span>
            <span className="text-[10px] text-muted-foreground shrink-0">{leafCount}</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeFolder(node); }}
              disabled={disabled}
              className="text-muted-foreground hover:text-destructive transition-colors shrink-0 p-0.5"
              title="Remove folder and all contents"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {isOpen && node.children.map(c => renderTreeNode(c, depth + 1))}
        </React.Fragment>
      );
    }

    const item = node.item;
    const Icon = getItemIcon(item);
    return (
      <div
        key={`item:${item.id}`}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 transition-colors",
          item.status === 'complete' && "bg-green-500/5",
          item.status === 'error' && "bg-red-500/5",
          (item.status === 'uploading' || item.status === 'processing') && "bg-blue-500/5"
        )}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        {statusIndicator(item.status)}
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <input
          value={item.title}
          onChange={(e) => updateItemTitle(item.id, e.target.value)}
          disabled={disabled}
          className="bg-transparent text-sm truncate flex-1 min-w-0 outline-none focus:underline"
        />
        {item.type === 'archive' && (
          <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 shrink-0 border-amber-300 text-amber-700">archive</Badge>
        )}
        {item.type === 'file' && item.file && (
          <span className="text-[10px] text-muted-foreground shrink-0">{(item.file.size / 1024 / 1024).toFixed(1)} MB</span>
        )}
        {item.type === 'url' && item.url && isArchiveUrl(item.url) && (
          <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 shrink-0 border-amber-300 text-amber-700">archive</Badge>
        )}
        {item.type === 'url' && !isMobile && (
          <span className="text-[10px] text-muted-foreground truncate max-w-[200px] shrink-0">{item.url}</span>
        )}
        {item.progress !== undefined && item.progress > 0 && item.progress < 100 && (
          <div className="w-12"><Progress value={item.progress} className="h-1" /></div>
        )}
        <button
          type="button"
          onClick={() => removeItem(item.id)}
          disabled={disabled}
          className="text-muted-foreground hover:text-destructive transition-colors shrink-0 p-0.5"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  };

  const itemTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach(i => {
      const key = i.type === 'archive' ? 'archive' : i.kind;
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts);
  }, [items]);

  const isUploading = !!uploadProgress && uploadProgress.phase !== 'complete' && uploadProgress.phase !== 'error';
  const disabled = storeIsLoading || !!uploadProgress;

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className={cn(
        "flex flex-col gap-0",
        isMobile ? "w-[95vw] max-w-[95vw] h-[90vh] max-h-[90vh] p-4" : "sm:max-w-4xl max-h-[85vh] p-0"
      )}>
        {/* ── Header ───────────────────────────────────────────────── */}
        <div className={cn("px-6 pt-5 pb-3", isMobile && "px-4 pt-4 pb-2")}>
          <DialogHeader>
            <DialogTitle className="text-base font-medium">
              {destination === 'existing_bundle'
                ? `Add to: ${bundles.find(b => b.id === (typeof selectedBundleId === 'string' ? parseInt(selectedBundleId) : selectedBundleId))?.name || '...'}`
                : destination === 'new_bundle' ? 'Create Bundle' : 'Upload'}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-0.5">
              Files, folders, archives, URLs, or text — add anything and choose where it goes.
            </DialogDescription>
          </DialogHeader>
        </div>

        <Separator />

        {/* ── Body ─────────────────────────────────────────────────── */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto flex flex-col min-h-0">
          <div className={cn("space-y-5 flex-1 overflow-y-auto", isMobile ? "px-4 py-3" : "px-6 py-4")}>

            {/* Upload progress */}
            {uploadProgress && (
              <div className="rounded-md border px-4 py-3 space-y-2">
                <div className="flex items-center gap-2">
                  {uploadProgress.phase === 'error' ? <AlertTriangle className="h-4 w-4 text-red-600" />
                    : uploadProgress.phase === 'complete' ? <CheckCircle className="h-4 w-4 text-green-600" />
                    : <Loader2 className="h-4 w-4 animate-spin text-blue-600" />}
                  <span className="text-sm">{uploadProgress.message}</span>
                </div>
                <Progress value={uploadProgress.progress} className="h-1.5" />
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>{uploadProgress.completedItems} / {uploadProgress.totalItems}</span>
                  <span>{Math.round(uploadProgress.progress)}%</span>
                </div>
              </div>
            )}

            {/* ── Input sections ────────────────────────────────────── */}
            {!uploadProgress && (
              <>
                {/* Drop zone */}
                <section>
                  <div
                    className={cn(
                      "relative rounded-lg border-2 border-dashed transition-colors cursor-pointer",
                      isMobile ? "p-6" : "p-8",
                      isDragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/40",
                      disabled && "pointer-events-none opacity-50"
                    )}
                    onClick={() => !disabled && fileInputRef.current?.click()}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <div className="flex flex-col items-center gap-2 text-center">
                      <div className="rounded-full bg-muted p-3">
                        <FileUp className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">Drop files, folders, or archives here</p>
                        <p className="text-xs text-muted-foreground mt-0.5">or click to browse — ZIP and TAR archives will be extracted automatically</p>
                      </div>
                    </div>
                    <input ref={fileInputRef} type="file" multiple onChange={handleFileSelect} className="sr-only" />
                    <input ref={folderInputRef} type="file" multiple onChange={handleFolderSelect} className="sr-only" {...{ webkitdirectory: '', directory: '' } as any} />
                  </div>

                  {/* Action buttons */}
                  <div className={cn("flex items-center gap-2 mt-3 flex-wrap", isMobile && "gap-1.5")}>
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs px-2.5" onClick={() => fileInputRef.current?.click()} disabled={disabled}>
                      <FileUp className="h-3 w-3 mr-1.5" /> Files
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs px-2.5" onClick={() => folderInputRef.current?.click()} disabled={disabled}>
                      <FolderOpen className="h-3 w-3 mr-1.5" /> Folder
                    </Button>

                    <Separator orientation="vertical" className="h-4 mx-1" />

                    {assetKinds.map(k => {
                      const Icon = k.icon;
                      return (
                        <Button key={k.value} type="button" variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => handleKindSelect(k)} disabled={disabled}>
                          <Icon className="h-3 w-3 mr-1" /> {k.label}
                        </Button>
                      );
                    })}
                  </div>
                </section>

                <Separator />

                {/* URL input */}
                <section className="space-y-2">
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <Globe className="h-3.5 w-3.5" /> URLs
                  </h3>
                  <Textarea
                    placeholder={"Paste one or more URLs, one per line\nhttps://example.com/article-1\nhttps://example.com/article-2"}
                    value={bulkUrlText}
                    onChange={(e) => setBulkUrlText(e.target.value)}
                    disabled={disabled}
                    rows={3}
                    className="text-sm resize-none font-mono"
                  />
                  <div className="flex items-center gap-2">
                    <Button type="button" size="sm" className="h-7 text-xs" onClick={handleBulkUrlAdd} disabled={disabled || !bulkUrlText.trim()}>
                      <Plus className="h-3 w-3 mr-1" /> Add URLs
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => urlFileInputRef.current?.click()} disabled={disabled}>
                      <FileType className="h-3 w-3 mr-1" /> Load from .txt
                    </Button>
                    <input ref={urlFileInputRef} type="file" accept=".txt,.csv,.text,text/plain" onChange={handleUrlFileImport} className="sr-only" />
                    {bulkUrlText.trim() && (
                      <span className="text-[11px] text-muted-foreground ml-auto">
                        {extractUrls(bulkUrlText).length} URL{extractUrls(bulkUrlText).length !== 1 ? 's' : ''} detected
                      </span>
                    )}
                  </div>
                </section>

                <Separator />

                {/* Text input */}
                <section className="space-y-2">
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <Type className="h-3.5 w-3.5" /> Text Block
                  </h3>
                  <div className={cn("flex gap-2", isMobile ? "flex-col" : "flex-row")}>
                    <Input
                      placeholder="Title (optional)"
                      value={newTextTitle}
                      onChange={(e) => setNewTextTitle(e.target.value)}
                      disabled={disabled}
                      className={cn("text-sm h-8", isMobile ? "w-full" : "w-48")}
                    />
                    <div className="flex-1 flex gap-2">
                      <Input
                        placeholder="Paste text content..."
                        value={newTextContent}
                        onChange={(e) => setNewTextContent(e.target.value)}
                        disabled={disabled}
                        className="text-sm h-8 flex-1"
                        onKeyDown={(e) => e.key === 'Enter' && !disabled && newTextContent.trim() && (e.preventDefault(), handleAddText())}
                      />
                      <Button type="button" size="sm" className="h-8 text-xs px-3" onClick={handleAddText} disabled={disabled || !newTextContent.trim()}>
                        <Plus className="h-3 w-3 mr-1" /> Add
                      </Button>
                    </div>
                  </div>
                </section>
              </>
            )}

            {/* ── Items list ───────────────────────────────────────── */}
            {items.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{items.length} item{items.length !== 1 ? 's' : ''}</span>
                    {(() => {
                      const withPath = items.filter(i => (i.type === 'file' || i.type === 'archive') && i.relativePath?.includes('/')).length;
                      return withPath > 0 ? (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 font-normal border-amber-300 text-amber-700">
                          {withPath} with folder path
                        </Badge>
                      ) : null;
                    })()}
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {itemTypeCounts.map(([key, count]) => (
                      <Badge key={key} variant="secondary" className="text-[10px] px-1.5 py-0 h-5 font-normal">
                        {count} {key}
                      </Badge>
                    ))}
                  </div>
                </div>

                <ScrollArea className={cn("rounded-md border", isMobile ? "h-40" : "h-52")}>
                  <div className="divide-y">
                    {tree.map(node => renderTreeNode(node, 0))}
                  </div>
                </ScrollArea>

              </section>
            )}

            {items.length === 0 && !uploadProgress && (
              <div className="text-center py-6 text-muted-foreground">
                <p className="text-sm">No items added yet</p>
              </div>
            )}

            {/* ── Destination ──────────────────────────────────────── */}
            {!uploadProgress && items.length > 0 && (
              <section className="space-y-2 pt-1">
                <Separator />
                <h3 className="text-sm font-medium pt-2">Destination</h3>
                <RadioGroup value={destination} onValueChange={(v) => setDestination(v as any)} className="space-y-1">
                  <label className="flex items-start gap-2.5 py-1.5 cursor-pointer">
                    <RadioGroupItem value="individual" id="d-ind" className="mt-0.5" />
                    <div>
                      <span className="text-sm">Individual assets</span>
                      <p className="text-[11px] text-muted-foreground">Each item becomes a separate asset.</p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 py-1.5 cursor-pointer">
                    <RadioGroupItem value="new_bundle" id="d-new" className="mt-0.5" />
                    <div className="flex-1">
                      <span className="text-sm">New bundle</span>
                      <p className="text-[11px] text-muted-foreground">Group everything into a new bundle.</p>
                      {destination === 'new_bundle' && (
                        <Input
                          value={bundleTitle}
                          onChange={(e) => setBundleTitle(e.target.value)}
                          placeholder={generateBundleTitle(items) || 'Bundle name...'}
                          disabled={disabled}
                          className="mt-1.5 h-7 text-sm"
                        />
                      )}
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 py-1.5 cursor-pointer">
                    <RadioGroupItem value="existing_bundle" id="d-exist" className="mt-0.5" disabled={!bundles?.length} />
                    <div className="flex-1">
                      <span className={cn("text-sm", !bundles?.length && "text-muted-foreground")}>Existing bundle</span>
                      <p className="text-[11px] text-muted-foreground">Add to a bundle that already exists.</p>
                      {destination === 'existing_bundle' && (
                        <Select value={selectedBundleId?.toString()} onValueChange={(v) => setSelectedBundleId(parseInt(v))}>
                          <SelectTrigger className="mt-1.5 h-7 text-sm">
                            <SelectValue placeholder="Select bundle..." />
                          </SelectTrigger>
                          <SelectContent>
                            {bundles.map(b => <SelectItem key={b.id} value={b.id.toString()}>{b.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </label>
                </RadioGroup>
              </section>
            )}

            {/* Errors */}
            {formError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
          </div>

          {/* ── Footer ─────────────────────────────────────────────── */}
          <Separator />
          <div className={cn("flex items-center justify-end gap-2 px-6 py-3", isMobile && "px-4 flex-col-reverse")}>
            <Button type="button" variant="ghost" size="sm" onClick={handleClose} disabled={isUploading} className={cn("h-8 text-xs", isMobile && "w-full")}>
              {isUploading ? 'Uploading...' : 'Cancel'}
            </Button>
            <Button type="submit" size="sm" disabled={storeIsLoading || items.length === 0 || isUploading} className={cn("h-8 text-xs", isMobile && "w-full")}>
              {isUploading ? (
                <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> Processing...</>
              ) : destination === 'individual' ? (
                `Upload ${items.length} item${items.length !== 1 ? 's' : ''}`
              ) : destination === 'existing_bundle' ? (
                `Add ${items.length} to bundle`
              ) : (
                `Create bundle (${items.length})`
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
