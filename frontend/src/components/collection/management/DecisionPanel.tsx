'use client';

/**
 * DecisionPanel — set a decision up, run it, see what came back.
 *
 * A scratchpad, not a feature. You write some evidence, add questions in the
 * three shapes the domain takes, and get probabilities back straight away. Keep
 * one if it was any good; it saves as a name, a description and one JSON blob,
 * because what a decision *is* is exactly what this panel exists to find out.
 *
 * Nothing here links to anything. Deleting a saved decision is a delete.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Save, Scale, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import { LogicService } from '@/client';
import type { AnswerOut, DecisionOut, QuestionIn } from '@/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

type QuestionKind = 'noul' | 'choice' | 'score';

/** One question as the form holds it. `criteria` is shaped per kind at send time. */
interface DraftQuestion {
  key: string;
  type: QuestionKind;
  instructions: string;
  /** choice: option key + description. */
  options: { key: string; description: string }[];
  /** score: ordered levels, lowest first. */
  levels: string[];
  /** noul: optional wording for each side. */
  yes: string;
  no: string;
}

const BLANK: DraftQuestion = {
  key: 'question',
  type: 'noul',
  instructions: '',
  options: [{ key: 'a', description: '' }, { key: 'b', description: '' }],
  levels: ['low', 'medium', 'high'],
  yes: '',
  no: '',
};

const EXAMPLE = {
  state: 'Shoes arrived two weeks late and in the wrong size. I also see two charges on my card.',
  questions: [
    { ...BLANK, key: 'urgent', type: 'noul' as QuestionKind, instructions: 'Does this need urgent human attention?' },
    {
      ...BLANK, key: 'team', type: 'choice' as QuestionKind,
      instructions: 'Which team should handle this?',
      options: [
        { key: 'returns', description: 'Exchanges, refunds, wrong or damaged items' },
        { key: 'shipping', description: 'Delivery status, delays, lost packages' },
        { key: 'billing', description: 'Charges, invoices, payment problems' },
      ],
    },
    {
      ...BLANK, key: 'mood', type: 'score' as QuestionKind,
      instructions: 'How frustrated is the customer?',
      levels: ['Calm', 'Frustrated', 'Very angry'],
    },
  ],
};

/** Draft → the criteria shape each question type takes on the wire. */
function toCriteria(q: DraftQuestion): QuestionIn['criteria'] {
  if (q.type === 'choice') {
    return Object.fromEntries(
      q.options.filter(o => o.key.trim()).map(o => [o.key.trim(), o.description.trim() || null]),
    );
  }
  if (q.type === 'score') return q.levels.map(l => l.trim()).filter(Boolean);
  const sides: Record<string, string> = {};
  if (q.yes.trim()) sides.true = q.yes.trim();
  if (q.no.trim()) sides.false = q.no.trim();
  return Object.keys(sides).length ? sides : null;
}

/** What the answer says, in one line, before any of the numbers. */
function headline(a: AnswerOut): string {
  if (a.kind === 'noul') return `${Math.round(Number(a.value) * 100)}% yes`;
  if (a.kind === 'score') {
    const level = a.legend?.[a.pick];
    return `${Number(a.value).toFixed(2)}${level ? ` · ${level}` : ''}`;
  }
  return String(a.value);
}

function label(a: AnswerOut, key: string): string {
  return a.kind === 'score' ? (a.legend?.[key] ?? key) : key;
}

export default function DecisionPanel({ infospaceId }: { infospaceId: number }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(EXAMPLE.state);
  const [questions, setQuestions] = useState<DraftQuestion[]>(EXAMPLE.questions);
  const [answers, setAnswers] = useState<Record<string, AnswerOut> | null>(null);
  const [providerKey, setProviderKey] = useState<string>('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<DecisionOut[]>([]);
  const [name, setName] = useState('');

  const loadSaved = useCallback(async () => {
    try {
      setSaved(await LogicService.listDecisions({ infospaceId }));
    } catch {
      /* an empty list is the same as none for this panel */
    }
  }, [infospaceId]);

  useEffect(() => { if (open) loadSaved(); }, [open, loadSaved]);

  const patch = (i: number, next: Partial<DraftQuestion>) =>
    setQuestions(qs => qs.map((q, j) => (j === i ? { ...q, ...next } : q)));

  const run = async () => {
    setRunning(true); setError(null); setAnswers(null);
    try {
      const body = {
        state,
        questions: Object.fromEntries(questions.map(q => [
          q.key.trim() || 'question',
          { type: q.type, instructions: q.instructions, criteria: toCriteria(q) },
        ])),
      };
      const res = await LogicService.judge({ infospaceId, requestBody: body });
      setAnswers(res.answers as Record<string, AnswerOut>);
      setProviderKey(res.provider_key);
    } catch (e: any) {
      // The backend's message is the useful one: an unconfigured provider says
      // so, and a malformed question says which.
      setError(e?.body?.detail ?? e?.message ?? 'The decision could not be run.');
    } finally {
      setRunning(false);
    }
  };

  const save = async () => {
    if (!name.trim()) { toast.error('Give it a name first'); return; }
    try {
      await LogicService.saveDecision({
        infospaceId,
        requestBody: { name: name.trim(), description: null, config: { state, questions } },
      });
      setName('');
      await loadSaved();
      toast.success('Decision saved');
    } catch (e: any) {
      toast.error(e?.body?.detail ?? 'Could not save');
    }
  };

  const load = (d: DecisionOut) => {
    const cfg = d.config as { state?: string; questions?: DraftQuestion[] };
    setState(cfg.state ?? '');
    setQuestions(cfg.questions?.length ? cfg.questions : [BLANK]);
    setAnswers(null);
  };

  const remove = async (d: DecisionOut) => {
    try {
      await LogicService.deleteDecision({ infospaceId, decisionId: d.id });
      await loadSaved();
    } catch (e: any) {
      toast.error(e?.body?.detail ?? 'Could not delete');
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Scale className="w-4 h-4" />
          Test a decision
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="w-4 h-4" /> Decision
          </DialogTitle>
          <DialogDescription>
            Evidence in, probabilities out. Nothing is stored unless you save it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* ── evidence ─────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label className="text-xs">Evidence</Label>
            <Textarea
              value={state}
              onChange={e => setState(e.target.value)}
              rows={4}
              placeholder="The text, record or ticket to decide about…"
              className="text-sm"
            />
          </div>

          {/* ── questions ────────────────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Questions</Label>
              <Button
                variant="ghost" size="sm" className="h-7 gap-1 text-xs"
                onClick={() => setQuestions(qs => [...qs, { ...BLANK, key: `question_${qs.length + 1}` }])}
              >
                <Plus className="w-3 h-3" /> Add
              </Button>
            </div>

            {questions.map((q, i) => (
              <div key={i} className="rounded-lg border p-3 space-y-2 bg-muted/30">
                <div className="flex gap-2">
                  <Input
                    value={q.key}
                    onChange={e => patch(i, { key: e.target.value })}
                    className="h-8 w-40 text-xs font-mono"
                    placeholder="key"
                  />
                  <Select value={q.type} onValueChange={v => patch(i, { type: v as QuestionKind })}>
                    <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="noul">Yes / no</SelectItem>
                      <SelectItem value="choice">Choice</SelectItem>
                      <SelectItem value="score">Rating</SelectItem>
                    </SelectContent>
                  </Select>
                  {questions.length > 1 && (
                    <Button
                      variant="ghost" size="icon" className="h-8 w-8 ml-auto"
                      onClick={() => setQuestions(qs => qs.filter((_, j) => j !== i))}
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>

                <Input
                  value={q.instructions}
                  onChange={e => patch(i, { instructions: e.target.value })}
                  className="h-8 text-sm"
                  placeholder="What are you asking?"
                />

                {q.type === 'noul' && (
                  <div className="flex gap-2">
                    <Input value={q.yes} onChange={e => patch(i, { yes: e.target.value })}
                      className="h-8 text-xs" placeholder="what yes means (optional)" />
                    <Input value={q.no} onChange={e => patch(i, { no: e.target.value })}
                      className="h-8 text-xs" placeholder="what no means (optional)" />
                  </div>
                )}

                {q.type === 'choice' && (
                  <div className="space-y-1.5">
                    {q.options.map((o, oi) => (
                      <div key={oi} className="flex gap-2">
                        <Input
                          value={o.key} className="h-8 w-40 text-xs font-mono" placeholder="key"
                          onChange={e => patch(i, {
                            options: q.options.map((x, j) => (j === oi ? { ...x, key: e.target.value } : x)),
                          })}
                        />
                        <Input
                          value={o.description} className="h-8 text-xs flex-1" placeholder="what this option means"
                          onChange={e => patch(i, {
                            options: q.options.map((x, j) => (j === oi ? { ...x, description: e.target.value } : x)),
                          })}
                        />
                        {q.options.length > 2 && (
                          <Button variant="ghost" size="icon" className="h-8 w-8"
                            onClick={() => patch(i, { options: q.options.filter((_, j) => j !== oi) })}>
                            <X className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    ))}
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1"
                      onClick={() => patch(i, { options: [...q.options, { key: '', description: '' }] })}>
                      <Plus className="w-3 h-3" /> Option
                    </Button>
                  </div>
                )}

                {q.type === 'score' && (
                  <div className="space-y-1.5">
                    <div className="text-[11px] text-muted-foreground">Levels, lowest first.</div>
                    {q.levels.map((l, li) => (
                      <div key={li} className="flex gap-2">
                        <span className="text-[11px] text-muted-foreground w-4 pt-2">{li}</span>
                        <Input value={l} className="h-8 text-xs flex-1"
                          onChange={e => patch(i, {
                            levels: q.levels.map((x, j) => (j === li ? e.target.value : x)),
                          })} />
                        {q.levels.length > 2 && (
                          <Button variant="ghost" size="icon" className="h-8 w-8"
                            onClick={() => patch(i, { levels: q.levels.filter((_, j) => j !== li) })}>
                            <X className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    ))}
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1"
                      onClick={() => patch(i, { levels: [...q.levels, ''] })}>
                      <Plus className="w-3 h-3" /> Level
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <Button onClick={run} disabled={running || !state.trim()} className="w-full gap-2">
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scale className="w-4 h-4" />}
            {running ? 'Deciding…' : 'Run'}
          </Button>

          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {/* ── answers ──────────────────────────────────────────────── */}
          {answers && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-xs">Answer</Label>
                <Badge variant="secondary" className="text-[10px]">{providerKey}</Badge>
              </div>
              {Object.entries(answers).map(([key, a]) => {
                const ranked = Object.entries(a.probabilities).sort((x, y) => y[1] - x[1]);
                return (
                  <div key={key} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-mono text-muted-foreground">{key}</span>
                      <span className="text-lg font-semibold">{headline(a)}</span>
                    </div>
                    <div className="space-y-1">
                      {ranked.map(([k, p]) => (
                        <div key={k} className="flex items-center gap-2">
                          <span className={`text-xs w-40 truncate ${k === a.pick ? 'font-medium' : 'text-muted-foreground'}`}>
                            {label(a, k)}
                          </span>
                          <div className="flex-1 h-2 rounded bg-muted overflow-hidden">
                            <div
                              className={k === a.pick ? 'h-full bg-primary' : 'h-full bg-muted-foreground/30'}
                              style={{ width: `${Math.max(1, p * 100)}%` }}
                            />
                          </div>
                          <span className="text-xs tabular-nums w-12 text-right">{(p * 100).toFixed(1)}%</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                      <span>confidence {a.confidence.toFixed(2)}</span>
                      <span>· margin {a.margin.toFixed(2)}</span>
                      {a.mass != null && <span>· answer mass {a.mass.toFixed(3)}</span>}
                      {a.model && <span>· {a.model}</span>}
                      {a.temperature != null && <span>· calibrated T={a.temperature}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── keep it ──────────────────────────────────────────────── */}
          <div className="flex gap-2 pt-1">
            <Input
              value={name} onChange={e => setName(e.target.value)}
              className="h-8 text-sm" placeholder="Name this decision to keep it"
            />
            <Button variant="outline" size="sm" className="h-8 gap-1.5 shrink-0" onClick={save}>
              <Save className="w-3.5 h-3.5" /> Save
            </Button>
          </div>

          {saved.length > 0 && (
            <div className="space-y-1 border-t pt-3">
              <Label className="text-xs">Saved</Label>
              {saved.map(d => (
                <div key={d.id} className="flex items-center gap-2 text-sm">
                  <button className="flex-1 text-left truncate hover:underline" onClick={() => load(d)}>
                    {d.name}
                  </button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(d)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
