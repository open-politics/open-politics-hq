'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Check, ChevronRight, FileText, FolderInput, FolderOpen, Globe, Loader2, Pause, Pencil, Play, Plus, RadioTower, Rss, Search,
  Settings2, Spline, Trash2, RefreshCcw, Ungroup,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { useLocalStorage } from '@/lib/hooks/use-local-storage';
import { cn } from '@/lib/utils';
import { formatDistanceToNowStrict } from 'date-fns';
import type { SourceRead } from '@/client';
import { sourceFormInit } from '@/lib/sources/sourceForm';
import { useSourceStore } from '@/zustand_stores/storeSources';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useDock } from '@/zustand_stores/storeDock';
import type { SurfaceContentProps } from '../types';

export const KIND_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  rss: Rss, web_search: Search, web: Globe, crawl: Globe, upload: FileText, directory: FolderOpen,
};

export type Health = 'active' | 'paused' | 'error' | 'warning';
export function healthOf(s: SourceRead): Health {
  // WARNING (e.g. output bundle deleted) is attention-needed but not a poll failure.
  if (s.status?.toLowerCase() === 'warning') return 'warning';
  if ((s.consecutive_failures ?? 0) > 0 || s.error_message) return 'error';
  return s.is_active ? 'active' : 'paused';
}
export const DOT: Record<Health, string> = {
  active: 'bg-emerald-500',
  paused: 'bg-muted-foreground/40',
  error: 'bg-red-500',
  warning: 'bg-amber-500',
};

/**
 * Controls for the source→bundle streams overlay. Supplied by AssetManager (which
 * owns the rail, the tree and the SVG overlay); absent everywhere else, so the
 * stream UI simply doesn't render outside that surface.
 */
export interface SourceStreamControls {
  /** True when every source's stream is shown at once. */
  allOn: boolean;
  /** Toggle the global "show all streams" state. */
  onToggleAll: () => void;
  /** Source ids whose stream is currently drawn (all-on union, or the pinned set). */
  activeSourceIds: Set<number>;
  /** Toggle a set of streams together (one source, a group): lit = all drawn. */
  onToggle: (sourceIds: number[]) => void;
}

// ─── Groups ───
// A group is a shared label on the source (`source.group`); it exists iff some
// source carries it. Named groups sort alphabetically, ungrouped last. Both this
// list and AssetManager's stream overlay order through `groupSources`, so the
// overlay's lane ranks line up with what the rail renders.

export interface SourceSection { group: string | null; sources: SourceRead[] }

export function groupSources(sources: SourceRead[]): SourceSection[] {
  const named = new Map<string, SourceRead[]>();
  const ungrouped: SourceRead[] = [];
  for (const s of sources) {
    if (!s.group) ungrouped.push(s);
    else if (named.has(s.group)) named.get(s.group)!.push(s);
    else named.set(s.group, [s]);
  }
  const sections: SourceSection[] = [...named.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((group) => ({ group, sources: named.get(group)! }));
  if (ungrouped.length > 0) sections.push({ group: null, sources: ungrouped });
  return sections;
}

/** The anchor a collapsed group's streams leave from (read by SourceStreams). */
export const groupAnchorKey = (group: string | null | undefined) => group ?? '';

const SOURCES_DRAG_MIME = 'application/x-hq-sources';

/** Streamable members of a set of sources — the ids a stream toggle acts on. */
const streamableIds = (sources: SourceRead[]) => sources.filter((s) => s.output_bundle_id != null).map((s) => s.id);

/** "Move to group…": pick an existing group, Ungrouped, or type a new name. */
function MoveToGroupMenu({ ids, current, groups, onOpenChange }: {
  ids: number[]; current: string | null; groups: string[]; onOpenChange: (open: boolean) => void;
}) {
  const assignGroup = useSourceStore((s) => s.assignGroup);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const setOpenBoth = (o: boolean) => { setOpen(o); onOpenChange(o); if (!o) setQuery(''); };
  const move = (group: string | null) => { setOpenBoth(false); assignGroup(ids, group); };
  const typed = query.trim();

  return (
    <Popover open={open} onOpenChange={setOpenBoth}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="size-6" title={ids.length > 1 ? `Move ${ids.length} sources to group` : 'Move to group'}>
          <FolderInput className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0">
        <Command>
          <CommandInput placeholder="Group name…" value={query} onValueChange={setQuery} className="h-8 text-xs" />
          <CommandList>
            <CommandEmpty className="py-2 text-center text-xs text-muted-foreground">No groups yet</CommandEmpty>
            <CommandGroup>
              {typed && !groups.includes(typed) && (
                <CommandItem value={`create:${typed}`} onSelect={() => move(typed)} className="text-xs">
                  <Plus className="mr-1.5 size-3.5" /> Create “{typed}”
                </CommandItem>
              )}
              {groups.map((g) => (
                <CommandItem key={g} value={g} onSelect={() => move(g)} className="text-xs">
                  <Check className={cn('mr-1.5 size-3.5', g === current ? 'opacity-100' : 'opacity-0')} /> {g}
                </CommandItem>
              ))}
              {current !== null && (
                <CommandItem value="__ungrouped" onSelect={() => move(null)} className="text-xs text-muted-foreground">
                  <Ungroup className="mr-1.5 size-3.5" /> Ungrouped
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function SourceGroupHeader({ section, collapsed, onToggleCollapsed, streams }: {
  section: SourceSection; collapsed: boolean; onToggleCollapsed: () => void; streams?: SourceStreamControls;
}) {
  const assignGroup = useSourceStore((s) => s.assignGroup);
  const [editing, setEditing] = React.useState(false);
  const [dropping, setDropping] = React.useState(false);
  const { group, sources } = section;
  const memberIds = sources.map((s) => s.id);
  const streamIds = streamableIds(sources);
  const isLit = !!streams && streamIds.length > 0 && streamIds.every((id) => streams.activeSourceIds.has(id));

  const rename = (name: string) => {
    setEditing(false);
    const next = name.trim();
    if (next && next !== group) assignGroup(memberIds, next);
  };

  return (
    <div
      data-source-group={groupAnchorKey(group)}
      className={cn(
        'group/header flex h-7 items-center gap-1 rounded px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground hover:bg-muted/50',
        dropping && 'bg-blue-500/10 ring-1 ring-blue-500/40',
      )}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(SOURCES_DRAG_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        setDropping(false);
        const ids: number[] = JSON.parse(e.dataTransfer.getData(SOURCES_DRAG_MIME) || '[]');
        if (ids.length > 0) { e.preventDefault(); assignGroup(ids, group); }
      }}
    >
      {editing && group !== null ? (
        <input
          autoFocus
          defaultValue={group}
          className="ml-[18px] min-w-0 flex-1 rounded border bg-background px-1 text-[11px] normal-case tracking-normal text-foreground outline-none"
          onBlur={(e) => rename(e.currentTarget.value)}
          // Blur is the one commit path; Escape restores the name first, so it no-ops.
          onKeyDown={(e) => {
            if (e.key === 'Escape') e.currentTarget.value = group;
            if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
          }}
        />
      ) : (
        <button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left" onClick={onToggleCollapsed}>
          <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', !collapsed && 'rotate-90')} />
          <span className={cn('truncate', group === null && 'italic')}>{group ?? 'Ungrouped'}</span>
          <span className="shrink-0 tabular-nums opacity-60">{sources.length}</span>
        </button>
      )}

      {group !== null && !editing && (
        <div className="hidden shrink-0 items-center gap-0.5 group-hover/header:flex">
          <Button variant="ghost" size="icon" className="size-6" title="Rename group" onClick={() => setEditing(true)}>
            <Pencil className="size-3" />
          </Button>
          <Button variant="ghost" size="icon" className="size-6" title="Dissolve group (sources become ungrouped)" onClick={() => assignGroup(memberIds, null)}>
            <Ungroup className="size-3.5" />
          </Button>
        </div>
      )}
      {streams && streamIds.length > 0 && (
        <Button
          variant="ghost" size="icon"
          className={cn('size-6 shrink-0', isLit ? 'text-blue-500' : 'hidden text-muted-foreground/60 group-hover/header:inline-flex')}
          title={isLit ? 'Hide this group’s streams' : 'Show this group’s streams'}
          onClick={() => streams.onToggle(streamIds)}
        >
          <Spline className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

interface SourceRowProps {
  source: SourceRead;
  bundleName?: string;
  streams?: SourceStreamControls;
  /** Part of the current multi-selection. */
  selected: boolean;
  /** What a drag or "Move to group" from this row carries: the selection if this row is in it, else just the row. */
  moveIds: number[];
  groups: string[];
  onSelect: (e: React.MouseEvent) => void;
}

export function SourceRow({ source, bundleName, streams, selected, moveIds, groups, onSelect }: SourceRowProps) {
  const { updateSource, deleteSource, triggerSourceProcessing } = useSourceStore();
  const openSourceForm = useDock((s) => s.openSourceForm);
  const [busy, setBusy] = React.useState(false);
  // Keep the hover actions mounted while the move menu is open (it anchors to its trigger).
  const [menuOpen, setMenuOpen] = React.useState(false);
  const Icon = KIND_ICONS[source.kind] ?? RadioTower;
  const health = healthOf(source);
  const isLit = !!streams && streams.activeSourceIds.has(source.id);

  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  return (
    <div
      data-source-id={source.id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(SOURCES_DRAG_MIME, JSON.stringify(moveIds));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={onSelect}
      className={cn('group flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/50', selected && 'bg-blue-500/10 hover:bg-blue-500/15')}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', DOT[health])} title={health} />
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium leading-tight">{source.name}</div>
        <div className="flex items-center gap-1.5 overflow-hidden text-[11px] leading-tight text-muted-foreground">
          <span className="shrink-0 capitalize">{source.kind.replace('_', ' ')}</span>
          {bundleName && <><FolderOpen className="size-3 shrink-0" /><span className="truncate">{bundleName}</span></>}
          {source.last_poll_at && <span className="shrink-0">· {formatDistanceToNowStrict(new Date(source.last_poll_at))} ago</span>}
          {typeof source.total_items_ingested === 'number' && source.total_items_ingested > 0 && (
            <span className="shrink-0">· {source.total_items_ingested.toLocaleString()} items</span>
          )}
        </div>
      </div>

      {/* Stream toggle: a lit blue indicator while traced (always visible);
          otherwise it joins the hover actions so it reserves no width at rest. */}
      {streams && source.output_bundle_id != null && (
        <Button
          variant="ghost" size="icon"
          className={cn('size-6 shrink-0', isLit ? 'text-blue-500' : 'hidden text-muted-foreground/60 group-hover:inline-flex')}
          title={isLit ? 'Hide stream to output bundle' : 'Show stream to output bundle'}
          onClick={() => streams.onToggle([source.id])}
        >
          <Spline className="size-3.5" />
        </Button>
      )}

      {/* Row actions reserve no space at rest — revealed on hover so the name
          and meta get the full width of the narrow rail. A running action keeps
          its spinner visible regardless of hover. */}
      {busy ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <div className={cn('hidden shrink-0 items-center gap-0.5 group-hover:flex', menuOpen && 'flex')}>
          <MoveToGroupMenu ids={moveIds} current={source.group ?? null} groups={groups} onOpenChange={setMenuOpen} />
          <Button variant="ghost" size="icon" className="size-6" title="Run now" onClick={() => act(() => triggerSourceProcessing(source.id))}>
            <RefreshCcw className="size-3.5" />
          </Button>
          <Button
            variant="ghost" size="icon" className="size-6"
            title={source.is_active ? 'Pause' : 'Activate'}
            onClick={() => act(() => updateSource(source.id, { is_active: !source.is_active }))}
          >
            {source.is_active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </Button>
          <Button
            variant="ghost" size="icon" className="size-6"
            title="Manage — config, schedule, output bundle"
            onClick={() => openSourceForm({ init: sourceFormInit(source) })}
          >
            <Settings2 className="size-3.5" />
          </Button>
          <Button
            variant="ghost" size="icon" className="size-6 text-red-600 hover:text-red-700"
            title="Delete"
            onClick={() => { if (confirm(`Delete source "${source.name}"?`)) act(() => deleteSource(source.id)); }}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

export function SourceList({ mode, streams }: SurfaceContentProps & { streams?: SourceStreamControls }) {
  const { sources, fetchSources, isLoading } = useSourceStore();
  const { bundles } = useBundleStore();
  const { activeInfospace } = useInfospaceStore();
  const openSourceForm = useDock((s) => s.openSourceForm);

  React.useEffect(() => { if (activeInfospace?.id) fetchSources(); }, [activeInfospace?.id, fetchSources]);

  const bundleName = (id?: number | null) => (id ? bundles.find((b) => b.id === id)?.name : undefined);

  const sections = React.useMemo(() => groupSources(sources), [sources]);
  const groups = React.useMemo(() => sections.flatMap((s) => (s.group === null ? [] : [s.group])), [sections]);
  const ordered = React.useMemo(() => sections.flatMap((s) => s.sources.map((src) => src.id)), [sections]);

  // Collapse is a per-viewer convenience; the groups themselves are shared.
  const [collapsed, setCollapsed] = useLocalStorage<string[]>('sources.collapsedGroups', []);
  const toggleCollapsed = (key: string) =>
    setCollapsed((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  // Multi-selection for moving several sources at once: Cmd/Ctrl-click toggles,
  // Shift-click extends from the last pick (in rendered order), a plain click or
  // Esc clears. Clicks on the row's own buttons (or its portalled menu) don't count.
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const anchorRef = React.useRef<number | null>(null);
  const select = (id: number) => (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!e.currentTarget.contains(target) || target.closest('button')) return;
    if (e.metaKey || e.ctrlKey) {
      setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
      anchorRef.current = id;
    } else if (e.shiftKey && anchorRef.current !== null) {
      const [a, b] = [ordered.indexOf(anchorRef.current), ordered.indexOf(id)].sort((x, y) => x - y);
      setSelected(new Set(ordered.slice(a, b + 1)));
    } else {
      setSelected(new Set());
      anchorRef.current = id;
    }
  };
  React.useEffect(() => {
    if (selected.size === 0) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(new Set()); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected.size]);
  // A move lands the selection in its new group — clear it once the groups settle.
  React.useEffect(() => setSelected(new Set()), [sources]);

  const renderRow = (s: SourceRead) => (
    <SourceRow
      key={s.id}
      source={s}
      bundleName={bundleName(s.output_bundle_id)}
      streams={streams}
      selected={selected.has(s.id)}
      moveIds={selected.has(s.id) ? [...selected] : [s.id]}
      groups={groups}
      onSelect={select(s.id)}
    />
  );

  return (
    <div className={cn('flex flex-col', mode === 'panel' ? 'h-full' : mode === 'overlay' ? 'max-h-[80vh]' : 'max-h-[30rem]')}>
      <div className="flex items-center justify-between gap-2 border-b px-2.5 py-1.5">

        <div className="flex items-center gap-1">
          {streams && (
            <Button
              size="icon" variant="ghost"
              className={cn('size-6', streams.allOn && 'bg-blue-500/15 text-blue-600 hover:text-blue-600 dark:text-blue-400')}
              title="Trace every source to the bundle it streams into"
              onClick={streams.onToggleAll}
            >
              <Spline className="size-3.5" />
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" onClick={() => openSourceForm({})}>
            <Plus className="mr-0.5 size-3.5" /> New
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1 scrollbar-hide">
        {isLoading && sources.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : sources.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center text-sm text-muted-foreground">
            <RadioTower className="size-8 opacity-40" />
            No live sources yet. Create one to ingest content on a schedule.
          </div>
        ) : groups.length === 0 ? (
          // No groups yet: the flat list, exactly as before. "Move to group" starts one.
          sources.map(renderRow)
        ) : (
          sections.map((section) => {
            const key = groupAnchorKey(section.group);
            const isCollapsed = collapsed.includes(key);
            return (
              <div key={key} className="space-y-0.5">
                <SourceGroupHeader
                  section={section}
                  collapsed={isCollapsed}
                  onToggleCollapsed={() => toggleCollapsed(key)}
                  streams={streams}
                />
                {!isCollapsed && <div className="space-y-0.5 pl-2">{section.sources.map(renderRow)}</div>}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
