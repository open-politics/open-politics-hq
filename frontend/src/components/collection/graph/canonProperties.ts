/**
 * Canon property value-types — the small, fixed vocabulary a canon declares per
 * entity type (`Canon.type_schemas`) and the helpers that move a stored JSON
 * value in and out of a typed form control.
 *
 * Deliberately a flat scalar+list set (no nested objects): the typed editor
 * covers the common case, and the raw-JSON escape hatch in `EntityProperties`
 * handles anything richer without losing data. Mirrors the backend
 * `CanonPropertyDef.type` union.
 */
import type { ElementType } from 'react';
import { Type, Hash, Calendar, ToggleLeft, Link as LinkIcon, List, Sigma } from 'lucide-react';

export type CanonPropType = 'text' | 'number' | 'integer' | 'boolean' | 'date' | 'url' | 'list';

export interface CanonPropTypeOption {
  value: CanonPropType;
  label: string;
  icon: ElementType;
  description: string;
}

export const CANON_PROP_TYPES: CanonPropTypeOption[] = [
  { value: 'text',    label: 'Text',     icon: Type,       description: 'Free text — names, codes, notes.' },
  { value: 'number',  label: 'Number',   icon: Sigma,      description: 'Decimal number (e.g. 51.16).' },
  { value: 'integer', label: 'Integer',  icon: Hash,       description: 'Whole number (e.g. a year, a count).' },
  { value: 'boolean', label: 'Yes / no', icon: ToggleLeft, description: 'A true / false flag.' },
  { value: 'date',    label: 'Date',     icon: Calendar,   description: 'A calendar date (YYYY-MM-DD).' },
  { value: 'url',     label: 'URL',      icon: LinkIcon,   description: 'A web link, rendered clickable.' },
  { value: 'list',    label: 'List',     icon: List,       description: 'A list of text values (tags).' },
];

export const CANON_PROP_TYPE_MAP: Record<string, CanonPropTypeOption> =
  Object.fromEntries(CANON_PROP_TYPES.map(o => [o.value, o]));

/** Best-effort value-type for an undeclared/extra property already on an entry. */
export function inferPropType(value: unknown): CanonPropType {
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return 'url';
  return 'text';
}

/**
 * A value the flat typed editor can't represent inline (a nested object, or a
 * list holding non-strings). It stays untouched and is only editable via the
 * raw-JSON escape hatch — so the editor never silently drops structured data.
 */
export function isComplexValue(value: unknown): boolean {
  if (value === null) return false;
  if (Array.isArray(value)) return value.some(v => typeof v !== 'string');
  return typeof value === 'object';
}

/** Render a stored value as the string an `<input>` should show. */
export function toInputString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return '';
}

/**
 * Parse an `<input>` string back to the stored value for a given type. Returns
 * `undefined` for an empty entry so the caller can drop the key (keep the bag
 * tidy) rather than persist `""`.
 */
export function parseInputValue(type: CanonPropType, raw: string): any {
  const s = raw.trim();
  if (s === '') return undefined;
  if (type === 'number') { const n = Number(s); return Number.isNaN(n) ? raw : n; }
  if (type === 'integer') { const n = parseInt(s, 10); return Number.isNaN(n) ? raw : n; }
  return raw; // text | url | date keep the raw string
}

/** The value to seed a freshly-added slot of a given type with. */
export function emptyValueForType(type: CanonPropType): any {
  if (type === 'list') return [];
  if (type === 'boolean') return false;
  return undefined;
}

/** Whether a value should be treated as "absent" (so its key is dropped). */
export function isEmptyValue(value: unknown): boolean {
  if (value == null) return true;
  if (value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}
