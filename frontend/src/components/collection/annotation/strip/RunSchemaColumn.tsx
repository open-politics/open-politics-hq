'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, Eye, FlaskConical, Loader2, Network, PencilLine, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  RunsService,
  type AnnotationRunRead,
  type AnnotationSchemaRead,
  type FieldChange,
  type RunLedgerAsset,
  type RunSchemaState,
  type SchemaChanges,
} from '@/client';
import AnnotationSchemaEditor from '@/components/collection/annotation/AnnotationSchemaEditor';
import { getAssetIconComponent } from '@/components/collection/assets/assetKindConfig';
import { HudButton, HudChip, HudOverline, HUD_LABEL, HUD_NUM, HUD_PROSE } from '@/components/ui/chrome';
import { type RunSchemasHandle } from '@/lib/annotations/runSchemas';
import { cn } from '@/lib/utils';
import { useAnnotationRunStore } from '@/zustand_stores/useAnnotationRunStore';

const fmt = (n: number) => n.toLocaleString();
const detail = (e: any) => e?.body?.detail ?? e?.message ?? 'Something went wrong';

/** A path as the schema's own author would say it: no section, no markers. */
const fieldName = (c: FieldChange) =>
  c.label || c.path.replace(/^[a-z_]+\./, '').replace(/\[\*\]/g, '') || 'Instructions';

/** What each kind of change is, and what it costs the reads already made. */
const KIND: Record<FieldChange['kind'], { glyph: string; tone: string; cost: (c: FieldChange) => string }> = {
  added: { glyph: '+', tone: 'text-emerald-600 dark:text-emerald-400', cost: (c) => `${fmt(c.affected ?? 0)} without it · fill` },
  removed: { glyph: '−', tone: 'text-hud-dim', cost: (c) => `${fmt(c.affected ?? 0)} values kept, unread` },
  retyped: { glyph: '≠', tone: 'text-rose-600 dark:text-rose-400', cost: (c) => `${c.before} → ${c.after} · ${fmt(c.affected ?? 0)} no longer fit` },
  narrowed: { glyph: '⊂', tone: 'text-amber-600 dark:text-amber-400', cost: (c) => `drops ${c.before} · ${fmt(c.affected ?? 0)} no longer fit` },
  widened: { glyph: '⊃', tone: 'text-hud-dim', cost: (c) => `adds ${c.after}` },
  reworded: { glyph: '✎', tone: 'text-hud-dim', cost: () => 'reworded' },
  instructions: { glyph: '✎', tone: 'text-hud-dim', cost: () => 'reworded' },
};

const VERDICT: Record<SchemaChanges['verdict'], { label: string; hint: string; tone: string }> = {
  same: { label: 'No change', hint: 'The draft reads as this run does.', tone: 'text-hud-dimmer' },
  additive: { label: 'Additive', hint: 'What the run has read still fits. New fields can be filled in.', tone: 'text-emerald-600 dark:text-emerald-400' },
  breaking: { label: 'Breaking', hint: 'Some values the run holds no longer fit. Re-reading them is worth it.', tone: 'text-amber-600 dark:text-amber-400' },
};

function ChangeRow({ change }: { change: FieldChange }) {
  const k = KIND[change.kind];
  return (
    <li className="grid grid-cols-[0.75rem_minmax(0,1fr)] gap-x-2">
      <span className={cn('text-center text-xs leading-5', k.tone)}>{k.glyph}</span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] leading-5 text-hud-fg" title={change.path || undefined}>{fieldName(change)}</span>
        <span className="block truncate text-xs text-hud-dimmer" title={k.cost(change)}>{k.cost(change)}</span>
        {(change.read_by?.length ?? 0) > 0 && (
          <span className="block truncate text-xs text-amber-600 dark:text-amber-400">read by {change.read_by!.join(', ')}</span>
        )}
      </span>
    </li>
  );
}

/** What the draft would change, scored against what the run has read. */
function Changes({ changes }: { changes: SchemaChanges | null }) {
  if (!changes) {
    return (
      <p className={cn(HUD_PROSE, 'flex items-center gap-2 text-hud-dimmer')}>
        <Loader2 className="h-3 w-3 animate-spin" /> Reading the run against the draft…
      </p>
    );
  }
  const v = VERDICT[changes.verdict];
  return (
    <div className="space-y-2">
      <p className={cn(HUD_PROSE, 'text-hud-dim')}>
        <span className={cn('font-medium', v.tone)}>{v.label}.</span> {v.hint}
      </p>
      {changes.changes.length > 0 && (
        <ul className="space-y-1.5">
          {changes.changes.map((c) => <ChangeRow key={`${c.kind}:${c.path}`} change={c} />)}
        </ul>
      )}
      {changes.dropped_types.length > 0 && (
        <p className={cn(HUD_PROSE, 'text-hud-dimmer')}>
          Types it no longer offers:{' '}
          {changes.dropped_types.map((t) => `${t.type}${t.decisions ? ` (${fmt(t.decisions)} decisions)` : ''}`).join(', ')}
        </p>
      )}
      {changes.looked_at < changes.annotations && (
        <p className={cn(HUD_PROSE, 'text-hud-dimmer')}>
          Counted over the latest {fmt(changes.looked_at)} of {fmt(changes.annotations)} annotations.
        </p>
      )}
    </div>
  );
}

/** The trial's assets: what it is reading, and what it read. */
function useTrialAssets(trial: AnnotationRunRead | null | undefined) {
  const [items, setItems] = useState<RunLedgerAsset[]>([]);
  const stamp = trial ? `${trial.id}:${trial.status}:${trial.progress_current}:${trial.annotation_count}` : null;
  useEffect(() => {
    if (!trial) {
      setItems([]);
      return;
    }
    let current = true;
    const page = (state: 'queued' | 'annotated') =>
      RunsService.listRunAssets({ infospaceId: trial.infospace_id, runId: trial.id, state, skip: 0, limit: 50 })
        .then((p) => p.items)
        .catch(() => [] as RunLedgerAsset[]);
    Promise.all([page('queued'), page('annotated')]).then(([queued, read]) => current && setItems([...queued, ...read]));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);
  return items;
}

const TONE: Record<RunLedgerAsset['status'], string> = {
  queued: 'text-hud-dimmer',
  success: 'text-emerald-600 dark:text-emerald-400',
  failed: 'text-rose-600 dark:text-rose-400',
};

/**
 * The draft tried on a few assets: which, how far along, and the way to see
 * the result — beside what the run made of the same asset (Asset), or alone
 * on the network panels.
 */
function Trial({
  run,
  trial,
  trying,
  detailAssetId,
  onDetailAsset,
  onTry,
}: {
  run: AnnotationRunRead;
  trial: AnnotationRunRead | null | undefined;
  trying: boolean;
  detailAssetId: number | null;
  onDetailAsset: (assetId: number) => void;
  onTry: (assetIds: number[]) => Promise<void>;
}) {
  const items = useTrialAssets(trial);
  const trialView = useAnnotationRunStore((s) => s.trialView);
  const setTrialView = useAnnotationRunStore((s) => s.setTrialView);
  const [asking, setAsking] = useState(false);
  const tried = new Set(items.map((a) => a.id));
  const read = items.filter((a) => a.status === 'success').length;

  const tryLatest = async (n: number) => {
    setAsking(true);
    try {
      const page = await RunsService.listRunAssets({ infospaceId: run.infospace_id, runId: run.id, state: 'annotated', skip: 0, limit: n });
      if (page.items.length === 0) {
        toast.info('The run has read nothing yet to try the draft on. Open an asset and try that.');
        return;
      }
      await onTry(page.items.map((a) => a.id));
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {detailAssetId != null && !tried.has(detailAssetId) && (
          <HudChip disabled={trying || asking} onClick={() => void onTry([detailAssetId])} title="Read the asset open beside the run through the draft">
            Open asset
          </HudChip>
        )}
        <HudChip disabled={trying || asking} onClick={() => void tryLatest(3)} title="Read the run's three latest reads again, through the draft">
          Latest 3
        </HudChip>
        <HudChip disabled={trying || asking} onClick={() => void tryLatest(10)} title="Read the run's ten latest reads again, through the draft">
          Latest 10
        </HudChip>
        {trial && (trying || asking) && <Loader2 className="h-3 w-3 animate-spin text-hud-dimmer" />}
      </div>

      {items.length > 0 && (
        <>
          <ul className="-mx-2 space-y-px">
            {items.map((a) => {
              const Icon = getAssetIconComponent(a.kind);
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => onDetailAsset(a.id)}
                    title="Open it beside the run: what the run read, and what the draft reads"
                    className={cn(
                      'flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-1 text-left outline-none transition-colors hover:bg-hud-sunken focus-visible:bg-hud-sunken',
                      a.id === detailAssetId && 'bg-hud-sunken',
                    )}
                  >
                    <Icon className={cn('h-3.5 w-3.5 shrink-0 stroke-[1.5]', TONE[a.status])} />
                    <span className={cn('min-w-0 flex-1 truncate text-[13px]', a.status === 'queued' ? 'text-hud-dim' : 'text-hud-fg')}>
                      {a.title || `Asset ${a.id}`}
                    </span>
                    <span className={cn(HUD_NUM, 'shrink-0 text-hud-dimmer')}>
                      {a.status === 'queued' ? 'reading' : a.status === 'failed' ? 'failed' : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <HudButton
            size="sm"
            icon={Network}
            active={trialView === trial?.id}
            disabled={!trial || read === 0}
            onClick={() => setTrialView(trialView === trial?.id ? null : trial!.id)}
            title="The network panels show only what the draft read, until you go back"
          >
            {trialView === trial?.id ? 'Showing on the network' : 'Show on the network'}
          </HudButton>
        </>
      )}
    </div>
  );
}

/**
 * Revising what the run reads, without touching what it has read: the
 * revision the run reads through, and its draft — what the draft would
 * change, scored against the run's own annotations; the draft tried on a few
 * assets; and adopting it, which moves this run alone onto the new revision
 * (`annotation/drafts.py`). Opened from the run column's Schema step, left of
 * everything the material passes through.
 */
export function RunSchemaColumn({
  run,
  schemas,
  handle,
  detailAssetId,
  onDetailAsset,
  onView,
  onAdopted,
  onClose,
}: {
  run: AnnotationRunRead;
  /** The run's schemas, as the schema list serves them. */
  schemas: AnnotationSchemaRead[];
  handle: RunSchemasHandle;
  detailAssetId: number | null;
  onDetailAsset: (assetId: number) => void;
  onView: (schema: AnnotationSchemaRead) => void;
  /** The run's annotations, and its schema, changed. */
  onAdopted: () => void;
  onClose: () => void;
}) {
  const { data, trying, refresh } = handle;
  const states = data?.schemas ?? [];
  const [picked, setPicked] = useState<number | null>(null);
  const state: RunSchemaState | undefined = states.find((s) => s.schema_id === picked) ?? states[0];
  const schema = schemas.find((s) => s.id === state?.schema_id);
  const draft = state?.draft ?? null;
  const ids = { infospaceId: run.infospace_id, runId: run.id };

  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<null | 'open' | 'discard' | 'adopt' | 'follow'>(null);
  const [confirming, setConfirming] = useState<null | 'adopt' | 'discard'>(null);
  const setTrialView = useAnnotationRunStore((s) => s.setTrialView);

  // What the draft would change — asked again whenever the draft is.
  const [changes, setChanges] = useState<SchemaChanges | null>(null);
  const draftKey = draft ? `${draft.id}:${draft.updated_at}` : null;
  // An edited draft drops what its trial read: nothing is left to show alone.
  const draftWas = useRef(draftKey);
  useEffect(() => {
    const was = draftWas.current?.split(':')[0];
    if (draftKey && draftWas.current !== draftKey && was === draftKey.split(':')[0]) setTrialView(null);
    draftWas.current = draftKey;
  }, [draftKey, setTrialView]);
  useEffect(() => {
    setChanges(null);
    setConfirming(null);
    if (!state || !draftKey) return;
    let current = true;
    RunsService.schemaChanges({ ...ids, schemaId: state.schema_id, to: 'draft' })
      .then((c) => current && setChanges(c))
      .catch(() => {});
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, state?.schema_id]);

  // Pinned behind the head: what moving onto it would change.
  const [ahead, setAhead] = useState<SchemaChanges | null>(null);
  const behind = state ? state.reads < state.head : false;
  useEffect(() => {
    setAhead(null);
    if (!state || !behind) return;
    let current = true;
    RunsService.schemaChanges({ ...ids, schemaId: state.schema_id, to: 'head' })
      .then((c) => current && setAhead(c))
      .catch(() => {});
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.schema_id, state?.reads, state?.head]);

  const act = async (what: NonNullable<typeof busy>, call: () => Promise<unknown>, done?: string) => {
    setBusy(what);
    try {
      await call();
      if (done) toast.success(done);
      await refresh();
      return true;
    } catch (e) {
      toast.error(detail(e));
      return false;
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  };

  const openDraft = async () => {
    if (!state) return;
    if (await act('open', () => RunsService.openDraft({ ...ids, schemaId: state.schema_id }))) setEditing(true);
  };
  const discard = () => state && act('discard', async () => {
    await RunsService.discardDraft({ ...ids, schemaId: state.schema_id });
    setTrialView(null);
  }, 'Draft discarded');
  const adopt = () => state && act('adopt', async () => {
    const out = await RunsService.adoptDraft({ ...ids, schemaId: state.schema_id });
    setTrialView(null);
    onAdopted();
    toast.success(`This run reads revision ${out.rev} now`, {
      description: [
        out.annotations > 0 && `${fmt(out.annotations)} trial ${out.annotations === 1 ? 'read is' : 'reads are'} the run's now.`,
        out.pinned > 0 && `${fmt(out.pinned)} other ${out.pinned === 1 ? 'run stays' : 'runs stay'} on the revision they read.`,
      ].filter(Boolean).join(' ') || undefined,
    });
  });
  const follow = () => state && act('follow', async () => {
    await RunsService.followHead({ ...ids, schemaId: state.schema_id });
    onAdopted();
  }, `This run reads revision ${state.head} now`);
  const tryOn = async (assetIds: number[]) => {
    try {
      await RunsService.tryDrafts({ ...ids, requestBody: { asset_ids: assetIds } });
      await refresh();
    } catch (e) {
      toast.error(detail(e));
    }
  };

  return (
    <section
      aria-label="Schema"
      data-run-column="schema"
      className="flex h-full w-full shrink-0 snap-start flex-col border-b border-hud-line bg-background @3xl/page:w-80 @3xl/page:border-b-0 @3xl/page:border-r"
    >
      <header className="shrink-0 space-y-1 px-4 pb-2 pt-4">
        <div className="-mx-1 flex h-[22px] items-center gap-1">
          <span className={cn(HUD_LABEL, 'px-1 text-hud-dimmer')}>Schema</span>
          <HudButton size="sm" icon={X} onClick={onClose} title="Close" aria-label="Close the schema" className="ml-auto border-transparent" />
        </div>
        {states.length > 1 && (
          <div className="flex flex-wrap gap-1 pb-1">
            {states.map((s) => (
              <HudChip key={s.schema_id} active={s.schema_id === state?.schema_id} onClick={() => setPicked(s.schema_id)} title={s.name}>
                <span className="max-w-[9rem] truncate normal-case tracking-normal">{s.name}</span>
                {s.draft && <PencilLine className="h-2.5 w-2.5" />}
              </HudChip>
            ))}
          </div>
        )}
        <h2 className="truncate text-[15px] font-semibold leading-snug tracking-tight text-hud-fg" title={state?.name}>
          {state?.name ?? (data ? 'No schema' : '')}
        </h2>
      </header>

      <div className="scroll-edges min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
        {!state ? (
          <p className={cn(HUD_PROSE, 'flex items-center gap-2 text-hud-dimmer')}>
            {data ? 'This run reads no schema.' : <><Loader2 className="h-3 w-3 animate-spin" /> Reading the run's schemas…</>}
          </p>
        ) : (
          <>
            {/* ── What the run reads ─────────────────────────────────── */}
            <section className="space-y-1.5">
              <div className="flex items-baseline gap-2">
                <span className="text-[13px] text-hud-fg">Revision {state.reads}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-hud-dimmer">
                  {behind ? `kept · the schema is at ${state.head}` : state.pinned ? 'kept' : 'follows the schema'}
                </span>
                {schema && (
                  <HudButton size="sm" icon={Eye} onClick={() => onView(schema)} title="The schema as the run reads it" className="border-transparent" />
                )}
              </div>
              {state.outdated > 0 && (
                <p className={cn(HUD_PROSE, 'text-hud-dimmer')}>
                  {fmt(state.outdated)} {state.outdated === 1 ? 'annotation was' : 'annotations were'} made under an earlier revision and {state.outdated === 1 ? 'stands' : 'stand'} as made.
                </p>
              )}
              {behind && (
                <div className="space-y-2 rounded-md border border-hud-line p-2.5">
                  <p className={cn(HUD_PROSE, 'text-hud-dim')}>
                    Revision {state.head} was adopted elsewhere. Moving onto it changes:
                  </p>
                  <Changes changes={ahead} />
                  <HudButton size="sm" disabled={busy != null || !ahead} onClick={() => void follow()}>
                    {busy === 'follow' ? 'Moving…' : `Read revision ${state.head}`}
                  </HudButton>
                </div>
              )}
            </section>

            {/* ── The draft ──────────────────────────────────────────── */}
            <section className="space-y-3">
              <HudOverline
                trailing={draft && (
                  <span className="flex items-center gap-1">
                    <HudButton size="sm" icon={PencilLine} onClick={() => setEditing(true)} disabled={busy != null || trying}
                      title={trying ? 'The trial is reading through the draft' : 'Edit the draft'}>
                      Edit
                    </HudButton>
                    <HudButton size="sm" icon={Trash2} tone="danger" disabled={busy != null}
                      onClick={() => setConfirming('discard')} title="Discard the draft and what it read" aria-label="Discard the draft" />
                  </span>
                )}
              >
                Draft
              </HudOverline>

              {!draft ? (
                <div className="space-y-2">
                  <p className={cn(HUD_PROSE, 'text-hud-dim')}>
                    Revise what this run reads. A draft touches nothing the run has made: see what it would change,
                    try it on a few assets, then adopt it or let it go.
                  </p>
                  <HudButton size="sm" icon={PencilLine} disabled={busy != null} onClick={() => void openDraft()}>
                    {busy === 'open' ? 'Opening…' : 'Draft a revision'}
                  </HudButton>
                </div>
              ) : (
                <>
                  {confirming === 'discard' && (
                    <div className="flex items-center gap-2">
                      <p className={cn(HUD_PROSE, 'flex-1 text-hud-dim')}>Discard the draft, and what its trial read?</p>
                      <HudButton size="sm" tone="danger" onClick={() => void discard()}>Discard</HudButton>
                      <HudButton size="sm" onClick={() => setConfirming(null)}>Keep</HudButton>
                    </div>
                  )}
                  <Changes changes={changes} />

                  <div className="space-y-2">
                    <HudOverline rule={false}>
                      <span className="flex items-center gap-1"><FlaskConical className="h-3 w-3 stroke-[1.5]" /> Try it</span>
                    </HudOverline>
                    <Trial
                      run={run}
                      trial={data?.trial}
                      trying={trying}
                      detailAssetId={detailAssetId}
                      onDetailAsset={onDetailAsset}
                      onTry={tryOn}
                    />
                  </div>

                  <div className="space-y-2 border-t border-hud-line pt-3">
                    {confirming === 'adopt' ? (
                      <>
                        <p className={cn(HUD_PROSE, 'text-hud-dim')}>
                          This run reads revision {state.head + 1} from now on, and everything it reads next is read through it.
                          The trial's reads become the run's. Other runs of the schema stay on the revision they read.
                          {(changes?.annotations ?? 0) > 0 && ' What it read before stands as it was made.'}
                        </p>
                        <div className="flex gap-1.5">
                          <HudButton size="sm" active icon={Check} disabled={busy != null} onClick={() => void adopt()}>
                            {busy === 'adopt' ? 'Adopting…' : 'Adopt'}
                          </HudButton>
                          <HudButton size="sm" onClick={() => setConfirming(null)}>Not yet</HudButton>
                        </div>
                      </>
                    ) : (
                      <HudButton
                        size="sm"
                        icon={Check}
                        disabled={busy != null || trying || changes?.verdict === 'same'}
                        onClick={() => setConfirming('adopt')}
                        title={trying ? 'The trial is reading through the draft' : changes?.verdict === 'same' ? 'The draft changes nothing yet' : undefined}
                      >
                        Adopt as revision {state.head + 1}
                      </HudButton>
                    )}
                  </div>
                </>
              )}
            </section>
          </>
        )}
      </div>

      {draft && (
        <AnnotationSchemaEditor
          show={editing}
          onClose={() => {
            setEditing(false);
            void refresh();
          }}
          schemeId={draft.id}
          mode="edit"
          defaultValues={draft}
          draft
        />
      )}
    </section>
  );
}
