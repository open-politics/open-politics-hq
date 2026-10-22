'use client';

import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useProvidersStore, ProviderMetadata, ProviderSelection } from '@/zustand_stores/storeProviders';

// provider::model — a model name alone is not unique across providers.
const SEP = '::';
const encode = (providerId: string, modelId: string) => `${providerId}${SEP}${modelId}`;

interface ModelSelectProps {
  /** Whose models to offer. One renders a flat list, several group by provider. */
  providers: ProviderMetadata[];
  value?: ProviderSelection | null;
  onChange: (selection: { providerId: string; modelId: string }) => void;
  placeholder?: string;
  /** Shown when no provider reports a model. */
  empty?: string;
  id?: string;
  className?: string;
}

/** The one model picker. Every model surface — the provider cards, the
 *  infospace embedding pin, the chat selector — reads the catalog through it. */
export default function ModelSelect({
  providers, value, onChange, placeholder = 'Select a model',
  empty = 'No models reported yet.', id, className,
}: ModelSelectProps) {
  const { catalogLoading, needsApiKey, hasApiKey } = useProvidersStore();
  const offering = providers.filter((p) => (p.models?.length ?? 0) > 0);
  const grouped = providers.length > 1;
  const current = value?.providerId && value.modelId ? encode(value.providerId, value.modelId) : '';

  const handleChange = (v: string) => {
    const at = v.indexOf(SEP);
    if (at > 0) onChange({ providerId: v.slice(0, at), modelId: v.slice(at + SEP.length) });
  };

  const items = (p: ProviderMetadata) => p.models!.map((m) => (
    <SelectItem key={encode(p.id, m.name)} value={encode(p.id, m.name)} className="text-xs">
      <span className="flex w-full items-center gap-2">
        <span className="truncate">{m.name}</span>
        {m.dimension ? <span className="ml-auto text-muted-foreground">{m.dimension}d</span> : null}
      </span>
    </SelectItem>
  ));

  return (
    <Select value={current} onValueChange={handleChange}>
      <SelectTrigger id={id} className={className ?? 'h-7 text-xs'}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {offering.length === 0 ? (
          <div className="flex items-center justify-center gap-2 p-3 text-xs text-muted-foreground">
            {catalogLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : empty}
          </div>
        ) : grouped ? (
          offering.map((p) => (
            <SelectGroup key={p.id}>
              <SelectLabel className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {p.name}
                {p.is_local && <Badge variant="outline" className="h-4 px-1 text-[10px]">Local</Badge>}
                {needsApiKey(p.id) && !hasApiKey(p.id) && (
                  <Badge variant="destructive" className="h-4 px-1 text-[10px]">Needs key</Badge>
                )}
              </SelectLabel>
              {items(p)}
            </SelectGroup>
          ))
        ) : (
          items(offering[0])
        )}
      </SelectContent>
    </Select>
  );
}
