'use client';

import { useMemo, useState } from 'react';
import { nanoid } from 'nanoid';
import { toast } from 'sonner';
import type { AdvancedSchemeField, AnnotationSchemaFormData } from '@/lib/annotations/types';
import { useAnnotationSystem } from '@/hooks/useAnnotationSystem';

/**
 * Headless logic for co-authoring an annotation schema in the chat. The operator
 * stages a seed of fields; the user shapes them inline and confirms. Draft state
 * lives here so the surface can re-host freely (same pattern as `useSourceForm`).
 *
 * Deliberately lean: only the simple field kinds a journalist reaches for — text,
 * number, yes/no, a fixed choice, or a list. Graph/entity/canon/ref/justification
 * are omitted (the adapter drops them); nothing here authors a formula.
 */

/** The friendly field kinds the lean editor exposes. */
export type LeanFieldType = 'text' | 'number' | 'boolean' | 'choice' | 'list' | 'list_choice';

export const LEAN_FIELD_TYPES: { value: LeanFieldType; label: string; hint: string }[] = [
  { value: 'text', label: 'Text', hint: 'free text' },
  { value: 'number', label: 'Number', hint: 'a numeric value' },
  { value: 'boolean', label: 'Yes / No', hint: 'true or false' },
  { value: 'choice', label: 'Choice', hint: 'one of a fixed set' },
  { value: 'list', label: 'List', hint: 'many free-text values' },
  { value: 'list_choice', label: 'List of choices', hint: 'many from a fixed set' },
];

/** A field seed the operator stages (mirrors the backend `schema_fields` vocabulary).
 *
 * These types describe what a *well-formed* seed looks like, not what arrives:
 * a seed is model-authored JSON off the wire, so every reader below coerces
 * rather than trusts. `seedToField` is that boundary and is total by design.
 */
export interface SchemaFieldSeed {
  name: string;
  type?: string; // text|string|number|integer|boolean|enum|select, optionally array / suffixed []
  description?: string;
  options?: string[];
  enum?: string[];
  required?: boolean;
  array?: boolean;
}

export interface SchemaFormInit {
  name?: string;
  description?: string;
  instructions?: string;
  fields?: SchemaFieldSeed[];
}

// ── Field ↔ friendly-type mapping ────────────────────────────────────────────

/** Derive the friendly picker value from a real `AdvancedSchemeField`. */
export function leanTypeOf(f: AdvancedSchemeField): LeanFieldType {
  if (f.type === 'array') return f.items?.enum?.length ? 'list_choice' : 'list';
  if (f.type === 'string' && f.enum?.length) return 'choice';
  if (f.type === 'number' || f.type === 'integer') return 'number';
  if (f.type === 'boolean') return 'boolean';
  return 'text';
}

/** The enum options a field carries, wherever they live (string enum vs array items). */
export function optionsOf(f: AdvancedSchemeField): string[] {
  if (f.type === 'array') return f.items?.enum ?? [];
  return f.enum ?? [];
}

/** Rewrite a field to a friendly type, preserving name/description/required + options. */
function applyLeanType(f: AdvancedSchemeField, ui: LeanFieldType): AdvancedSchemeField {
  const keep = { id: f.id, name: f.name, description: f.description, required: f.required };
  const opts = optionsOf(f);
  switch (ui) {
    case 'text': return { ...keep, type: 'string' };
    case 'number': return { ...keep, type: 'number' };
    case 'boolean': return { ...keep, type: 'boolean' };
    case 'choice': return { ...keep, type: 'string', enum: opts };
    case 'list': return { ...keep, type: 'array', items: { type: 'string' } };
    case 'list_choice': return { ...keep, type: 'array', items: { type: 'string', enum: opts } };
  }
}

/** Set the enum options on a field (routes to enum or array.items.enum by kind). */
function setFieldOptions(f: AdvancedSchemeField, options: string[]): AdvancedSchemeField {
  if (f.type === 'array') return { ...f, items: { ...(f.items ?? { type: 'string' }), type: 'string', enum: options } };
  return { ...f, enum: options };
}

/** The seed's choice list, however it arrived — array, comma string, or absent. */
function seedOptions(seed: SchemaFieldSeed): string[] {
  const raw: unknown = seed?.options ?? seed?.enum;   // declared string[], but it is JSON
  if (Array.isArray(raw)) return raw.map((o) => String(o));
  if (typeof raw === 'string') return raw.split(',').map((o) => o.trim()).filter(Boolean);
  return [];
}

/** Map an operator-staged seed into a real `AdvancedSchemeField`. Total: any JSON in. */
function seedToField(seed: SchemaFieldSeed): AdvancedSchemeField {
  const id = nanoid();
  const name = String(seed?.name ?? '').trim();
  const description = String(seed?.description ?? '');
  const required = seed?.required ?? true;
  const options = seedOptions(seed);
  let type = String(seed?.type ?? 'text').toLowerCase();
  const isArray = !!(seed?.array) || type.endsWith('[]');
  if (type.endsWith('[]')) type = type.slice(0, -2);

  let leaf: LeanFieldType;
  if (type === 'enum' || type === 'select' || options.length) leaf = 'choice';
  else if (type === 'number' || type === 'float' || type === 'integer' || type === 'int') leaf = 'number';
  else if (type === 'boolean' || type === 'bool') leaf = 'boolean';
  else leaf = 'text'; // text / string / entity fallback (lean omits entities)

  if (isArray) leaf = options.length ? 'list_choice' : 'list';

  const base: AdvancedSchemeField = { id, name, type: 'string', description, required };
  return options.length
    ? setFieldOptions(applyLeanType(base, leaf), options)
    : applyLeanType(base, leaf);
}

function newField(): AdvancedSchemeField {
  return { id: nanoid(), name: '', type: 'string', description: '', required: true };
}

// ── The hook ─────────────────────────────────────────────────────────────────

export function useSchemaForm(init?: SchemaFormInit, onSuccess?: (result: any) => void) {
  const { createSchema } = useAnnotationSystem();
  const [sectionId] = useState(() => nanoid());

  const [name, setName] = useState(init?.name ?? '');
  const [description, setDescription] = useState(init?.description ?? '');
  const [fields, setFields] = useState<AdvancedSchemeField[]>(() => {
    // `??` only catches null/undefined. A section-keyed object sailed through it
    // into `.map` and threw inside this initializer, which unmounts the tree the
    // chat is rendered in — the page died, not the card.
    const seeds = Array.isArray(init?.fields) ? init.fields : [];
    const seeded = seeds.map(seedToField);
    return seeded.length ? seeded : [newField()];
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const updateField = (id: string, patch: Partial<AdvancedSchemeField>) =>
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const setFieldType = (id: string, ui: LeanFieldType) =>
    setFields((prev) => prev.map((f) => (f.id === id ? applyLeanType(f, ui) : f)));
  const setFieldOpts = (id: string, options: string[]) =>
    setFields((prev) => prev.map((f) => (f.id === id ? setFieldOptions(f, options) : f)));
  const addField = () => setFields((prev) => [...prev, newField()]);
  const removeField = (id: string) => setFields((prev) => prev.filter((f) => f.id !== id));

  // Live form data — feeds SchemePreview and the create call, single `document` section.
  const formData = useMemo<AnnotationSchemaFormData>(
    () => ({
      name: name.trim(),
      description: description.trim(),
      ...(init?.instructions ? { instructions: init.instructions } : {}),
      structure: [{ id: sectionId, name: 'document', fields }],
    }),
    [name, description, fields, sectionId, init?.instructions],
  );

  const validate = (): boolean => {
    const errs: string[] = [];
    if (!name.trim()) errs.push('Schema name is required');
    const named = fields.filter((f) => f.name.trim());
    if (named.length === 0) errs.push('Add at least one field');
    for (const f of named) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(f.name.trim())) {
        errs.push(`"${f.name}" — field names must start with a letter and use only letters, numbers, or _`);
      }
      const ui = leanTypeOf(f);
      if ((ui === 'choice' || ui === 'list_choice') && optionsOf(f).length === 0) {
        errs.push(`"${f.name}" — add at least one choice`);
      }
    }
    setErrors(errs);
    return errs.length === 0;
  };

  const submit = async (): Promise<boolean> => {
    if (!validate()) return false;
    setIsSubmitting(true);
    try {
      // Drop unnamed scratch rows before create.
      const clean: AnnotationSchemaFormData = {
        ...formData,
        structure: [{ id: sectionId, name: 'document', fields: fields.filter((f) => f.name.trim()) }],
      };
      const result = await createSchema(clean);
      if (result) {
        onSuccess?.(result);
        return true;
      }
      return false;
    } catch (e) {
      toast.error(`Failed to create schema: ${e instanceof Error ? e.message : 'Unknown error'}`);
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    name, setName,
    description, setDescription,
    fields, addField, removeField, updateField, setFieldType, setFieldOpts,
    formData,
    errors, isSubmitting, submit,
  };
}
