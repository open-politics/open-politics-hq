'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Search, Sparkles, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The home's single entry point — two ways into your data from one surface.
 *   - Find → deep-links to Explore (`?q=`); the SSE search auto-streams on land.
 *   - Ask  → deep-links to Chat (`?prompt=`); the prompt auto-sends on land.
 * Collapsing search + chat into one toggle is the product thesis in miniature:
 * search your data, or talk to it.
 */
type Mode = 'find' | 'ask';

const FIND_CHIPS = ['kind:pdf', 'kind:image', 'entity:', 'after:2026-01-01'];
const ASK_CHIPS = ['Summarize what’s new', 'What are the key themes?', 'Find contradictions across sources'];

export function HomeInquiryBar() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('find');
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const go = () => {
    const v = value.trim();
    if (!v) { inputRef.current?.focus(); return; }
    if (mode === 'find') router.push(`/hq/infospaces/explore?q=${encodeURIComponent(v)}`);
    else router.push(`/hq/chat?prompt=${encodeURIComponent(v)}`);
  };

  const applyChip = (chip: string) => {
    setValue((prev) => (mode === 'find' ? (prev.trim() ? `${prev.trim()} ${chip}` : chip) : chip));
    inputRef.current?.focus();
  };

  const chips = mode === 'find' ? FIND_CHIPS : ASK_CHIPS;
  const Icon = mode === 'find' ? Search : Sparkles;

  return (
    <div className="rounded-lg border bg-card/40 p-2.5">
      <div className="flex items-center gap-2">
        <div className="flex shrink-0 items-center rounded-md border bg-muted/40 p-0.5">
          <ModeButton active={mode === 'find'} onClick={() => setMode('find')} icon={Search} label="Find" />
          <ModeButton active={mode === 'ask'} onClick={() => setMode('ask')} icon={Sparkles} label="Ask" />
        </div>

        <div className="flex flex-1 items-center gap-2 rounded-md border bg-background px-3 focus-within:ring-1 focus-within:ring-ring/40">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } }}
            placeholder={mode === 'find' ? 'Search assets, entities & annotations…' : 'Ask anything about your data…'}
            className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={go}
            disabled={!value.trim()}
            aria-label={mode === 'find' ? 'Search' : 'Ask'}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-1">
        {chips.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => applyChip(chip)}
            className="rounded-md border bg-background/60 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
          >
            {chip}
          </button>
        ))}
      </div>
    </div>
  );
}

function ModeButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: LucideIcon; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors',
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
