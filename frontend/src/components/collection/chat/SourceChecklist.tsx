'use client'

/**
 * Batch source confirmation — the many-sources arm of the inline confirm card.
 *
 * The model stages several recurring sources at once (sources_hub with a `sources`
 * list). Rather than one card per source, they land here as a single checklist:
 * check the ones you want, optionally tweak a name/locator, set one shared schedule
 * and output bundle, and send them all off with `Create N`. Creation seeds each
 * bundle immediately (triggerSourceProcessing) so a paired live run isn't watching
 * an empty bundle until the first scheduled poll.
 */

import * as React from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ChevronDown, ChevronRight, FileText, Globe, Loader2, Radio, Rss, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { sourceConfigurationRegistry, type ConfigurableSourceKind, type FieldSchema } from '@/lib/sourceConfigurationRegistry'
import type { SourceKind } from '@/lib/annotations/types'
import { BundlePicker } from '@/components/collection/assets/BundlePicker'
import { useSourceStore } from '@/zustand_stores/storeSources'
import { useInfospaceStore } from '@/zustand_stores/storeInfospace'
import { useBundleStore } from '@/zustand_stores/storeBundles'

const KIND_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  rss: Rss, web_search: Search, web: Globe, crawl: Globe,
}

const SCHEDULE_OPTIONS = [
  { label: 'One-time', value: 0 },
  { label: 'Every 5 min', value: 300 },
  { label: 'Every 15 min', value: 900 },
  { label: 'Hourly', value: 3600 },
  { label: 'Every 6 hours', value: 21600 },
  { label: 'Daily', value: 86400 },
]

export interface StagedSourceInit {
  kind: SourceKind
  name: string
  config?: any
  pollInterval?: number
  bundleId?: number
  streamEnabled?: boolean
}

export interface CreatedSource {
  id: number
  name: string
  bundleId?: number | null
}

type Draft = { checked: boolean; name: string; config: any; kind: SourceKind }

/** One schema-driven locator input (only the required fields are shown per row). */
function LocatorInput({ field, value, onChange }: { field: FieldSchema; value: any; onChange: (v: any) => void }) {
  if (field.type === 'textarea' || field.type === 'multiselect') {
    return (
      <Textarea
        rows={2}
        className="text-sm"
        placeholder={field.placeholder}
        value={Array.isArray(value) ? value.join(', ') : value || ''}
        onChange={(e) => onChange(field.type === 'multiselect' ? e.target.value.split(',').map((v) => v.trim()).filter(Boolean) : e.target.value)}
      />
    )
  }
  if (field.type === 'number') {
    return <Input type="number" className="text-sm" placeholder={field.placeholder} value={value || ''} onChange={(e) => onChange(parseInt(e.target.value) || 0)} />
  }
  return <Input type={field.type === 'url' ? 'url' : 'text'} className="text-sm" placeholder={field.placeholder} value={value || ''} onChange={(e) => onChange(e.target.value)} />
}

export function SourceChecklist({
  sources,
  onDismiss,
  onCreate,
}: {
  sources: StagedSourceInit[]
  onDismiss: () => void
  onCreate: (created: CreatedSource[]) => void
}) {
  const { createSource, triggerSourceProcessing } = useSourceStore()
  const { activeInfospace } = useInfospaceStore()
  const { bundles, fetchBundles } = useBundleStore()

  const [drafts, setDrafts] = React.useState<Draft[]>(() =>
    sources.map((s) => ({ checked: true, name: s.name ?? '', config: s.config ?? {}, kind: s.kind })),
  )
  // One shared cadence + bundle for the whole batch (seeded from the first source).
  const [pollInterval, setPollInterval] = React.useState<number>(sources[0]?.pollInterval ?? 3600)
  const [streamEnabled, setStreamEnabled] = React.useState<boolean>(sources.some((s) => s.streamEnabled ?? true))
  const [bundleId, setBundleId] = React.useState<number | undefined>(sources[0]?.bundleId)
  const [bundleName, setBundleName] = React.useState('')
  const [expanded, setExpanded] = React.useState<number | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (activeInfospace?.id) fetchBundles(activeInfospace.id)
  }, [activeInfospace?.id, fetchBundles])

  const setDraft = (i: number, patch: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)))
  const setConfigField = (i: number, fieldName: string, value: any) =>
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, config: { ...d.config, [fieldName]: value } } : d)))

  const checkedCount = drafts.filter((d) => d.checked).length
  const allChecked = checkedCount === drafts.length

  const scheduleValue = streamEnabled ? String(pollInterval) : '0'
  const onScheduleChange = (v: string) => {
    const n = Number(v)
    if (n === 0) { setStreamEnabled(false); return }
    setStreamEnabled(true)
    setPollInterval(n)
  }

  const requiredFieldsFor = (kind: SourceKind): FieldSchema[] =>
    sourceConfigurationRegistry.getSchema(kind as ConfigurableSourceKind)?.uiSchema.fields.filter((f) => f.required) ?? []

  const locatorSummary = (d: Draft): string =>
    requiredFieldsFor(d.kind)
      .map((f) => { const v = d.config?.[f.name]; return Array.isArray(v) ? v.join(', ') : v })
      .filter(Boolean)
      .join(' · ')

  const create = async () => {
    if (!activeInfospace || checkedCount === 0) return
    setSubmitting(true)
    const created: CreatedSource[] = []
    for (const d of drafts) {
      if (!d.checked) continue
      const res = await createSource({
        name: d.name,
        kind: d.kind,
        details: d.config,
        target_bundle_id: bundleId,
        target_bundle_name: bundleName || undefined,
        is_active: streamEnabled,
        poll_interval_seconds: streamEnabled ? pollInterval : 300,
        output_bundle_id: bundleId,
      } as any)
      if (res?.id) {
        void triggerSourceProcessing(res.id)
        created.push({ id: res.id, name: res.name, bundleId: (res as any).output_bundle_id })
      }
    }
    setSubmitting(false)
    onCreate(created)
  }

  return (
    <div className="overflow-hidden rounded-lg border border-primary/30 bg-primary/[0.03] text-sm">
      {/* Header + select-all/none */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Radio className="size-4 shrink-0 text-primary/80" />
        <div className="min-w-0 flex-1 font-medium">Create {drafts.length} recurring sources</div>
        <button
          onClick={() => setDrafts((prev) => prev.map((d) => ({ ...d, checked: !allChecked })))}
          className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
        >
          {allChecked ? 'None' : 'All'}
        </button>
      </div>

      {/* Rows */}
      <div className="max-h-72 divide-y overflow-y-auto">
        {drafts.map((d, i) => {
          const Icon = KIND_ICONS[d.kind] ?? FileText
          const open = expanded === i
          const loc = locatorSummary(d)
          return (
            <div key={i} className={cn('px-3 py-2', !d.checked && 'opacity-55')}>
              <div className="flex items-center gap-2">
                <Checkbox checked={d.checked} onCheckedChange={(v) => setDraft(i, { checked: !!v })} className="shrink-0" />
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{d.name || <span className="text-muted-foreground">Untitled</span>}</div>
                  {loc && <div className="truncate text-xs text-muted-foreground">{loc}</div>}
                </div>
                <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">
                  {d.kind.replace('_', ' ')}
                </span>
                <button onClick={() => setExpanded(open ? null : i)} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Edit source">
                  {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                </button>
              </div>
              {open && (
                <div className="mt-2 space-y-2 pl-6">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Name</Label>
                    <Input value={d.name} onChange={(e) => setDraft(i, { name: e.target.value })} className="text-sm" />
                  </div>
                  {requiredFieldsFor(d.kind).map((f) => (
                    <div key={f.name} className="space-y-1">
                      <Label className="text-xs text-muted-foreground">{f.label}</Label>
                      <LocatorInput field={f} value={d.config?.[f.name]} onChange={(val) => setConfigField(i, f.name, val)} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* One schedule + bundle for the whole batch */}
      <div className="space-y-2 border-t px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 text-xs text-muted-foreground">
            {streamEnabled ? 'Poll all selected on a schedule' : 'Fetch once, no monitoring'}
          </div>
          <Select value={scheduleValue} onValueChange={onScheduleChange}>
            <SelectTrigger className="h-8 w-[130px] shrink-0 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SCHEDULE_OPTIONS.map((o) => <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <BundlePicker
          bundles={bundles}
          value={bundleId}
          onChange={(id) => setBundleId(id)}
          newName={bundleName}
          onNewNameChange={setBundleName}
        />
        <p className="text-[11px] leading-tight text-muted-foreground">One output bundle for all selected sources.</p>
      </div>

      {/* Send off */}
      <div className="flex items-center justify-end gap-2 border-t px-3 py-2.5">
        <Button variant="ghost" size="sm" onClick={onDismiss} className="text-sm">Dismiss</Button>
        <Button size="sm" onClick={create} disabled={checkedCount === 0 || submitting} className="min-w-28 text-sm">
          {submitting ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
          Create {checkedCount}
        </Button>
      </div>
    </div>
  )
}
