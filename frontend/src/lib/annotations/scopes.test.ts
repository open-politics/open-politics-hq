/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test';
import {
  createCooccursScope,
  entityPathsFromSchema,
  focusedEntityNamesFromFilter,
} from './scopes';
import type { FilterSet } from '@/client';
import type { AnnotationSchemaRead } from '@/client';

// =============================================================================
// entityPathsFromSchema — derive entity-typed paths from output_contract
// =============================================================================

const buildSchema = (outputContract: any): AnnotationSchemaRead => ({
  id: 1,
  uuid: 'u',
  name: 'Test',
  description: '',
  output_contract: outputContract,
  instructions: null,
  field_specific_justification_configs: {},
  is_active: true,
  version: '1.0',
  tags: [],
  infospace_id: 1,
  user_id: 1,
  created_at: '',
  updated_at: '',
} as any);

describe('entityPathsFromSchema', () => {
  test('returns [] for null/empty schema', () => {
    expect(entityPathsFromSchema(null)).toEqual([]);
    expect(entityPathsFromSchema(undefined)).toEqual([]);
  });

  test('returns [] for schema with no entity-typed fields', () => {
    const schema = buildSchema({
      type: 'object',
      properties: {
        document: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    });
    expect(entityPathsFromSchema(schema)).toEqual([]);
  });

  test('finds top-level array-of-entity field', () => {
    const schema = buildSchema({
      type: 'object',
      properties: {
        document: {
          type: 'object',
          properties: {
            actors: {
              type: 'array',
              items: {
                type: 'object',
                'x-entityField': true,
                'x-entityType': 'Politician',
                properties: { name: { type: 'string' }, type: { type: 'string' } },
              },
            },
          },
        },
      },
    });
    const paths = entityPathsFromSchema(schema);
    // The picker emits explosion-marked paths for arrays.
    expect(paths.some(p => p.startsWith('document.actors'))).toBe(true);
  });

  test('finds singular entity field', () => {
    const schema = buildSchema({
      type: 'object',
      properties: {
        document: {
          type: 'object',
          properties: {
            author: {
              type: 'object',
              'x-entityField': true,
              'x-entityType': 'Person',
              properties: { name: { type: 'string' } },
            },
          },
        },
      },
    });
    expect(entityPathsFromSchema(schema)).toContain('document.author');
  });

  test('finds entity fields nested in array-of-objects (e.g. mails[*].sender)', () => {
    const schema = buildSchema({
      type: 'object',
      properties: {
        document: {
          type: 'object',
          properties: {
            mails: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  subject: { type: 'string' },
                  sender: {
                    type: 'object',
                    'x-entityField': true,
                    'x-entityType': 'Person',
                    properties: { name: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    });
    const paths = entityPathsFromSchema(schema);
    expect(paths.some(p => p.includes('mails') && p.includes('sender'))).toBe(true);
  });
});

// =============================================================================
// createCooccursScope — builds a relational.cooccurs scope
// =============================================================================

describe('createCooccursScope', () => {
  test('throws if fewer than 2 entities', () => {
    expect(() => createCooccursScope({
      entities: ['Merkel'],
      paths: ['actors[*]'],
      sourcePanelId: 's1',
    })).toThrow('at least 2 entities');
  });

  test('throws if no entity-typed paths in schema and none provided', () => {
    const schema = buildSchema({
      type: 'object',
      properties: { document: { type: 'object', properties: { summary: { type: 'string' } } } },
    });
    expect(() => createCooccursScope({
      entities: ['A', 'B'],
      schema,
      sourcePanelId: 's1',
    })).toThrow('no entity-typed paths');
  });

  test('builds a Scope with one relational.cooccurs FieldCondition', () => {
    const scope = createCooccursScope({
      entities: ['Merkel', 'Macron'],
      paths: ['document.actors[*]'],
      sourcePanelId: 'graph-view:42',
    });
    expect(scope.source_panel_id).toBe('graph-view:42');
    expect(scope.mode).toBe('push');
    expect(scope.filter.logic).toBe('and');
    expect(scope.filter.conditions).toHaveLength(1);
    const c = scope.filter.conditions![0];
    expect(c.path).toBe('$');
    expect((c as any).operator).toBe('relational.cooccurs');
    expect((c.value as any).entities).toEqual(['Merkel', 'Macron']);
    expect((c.value as any).reach).toBe('annotation');
    expect((c.value as any).paths).toEqual(['document.actors[*]']);
  });

  test('default reach is annotation, label uses pair notation', () => {
    const scope = createCooccursScope({
      entities: ['A', 'B'],
      paths: ['actors[*]'],
      sourcePanelId: 's1',
    });
    expect((scope.filter.conditions![0].value as any).reach).toBe('annotation');
    expect(scope.label).toBe('A ↔ B');
  });

  test('honors explicit reach + label overrides', () => {
    const scope = createCooccursScope({
      entities: ['A', 'B'],
      paths: ['actors[*]'],
      reach: 'asset',
      label: 'Custom label',
      mode: 'link',
      sourcePanelId: 's1',
    });
    expect((scope.filter.conditions![0].value as any).reach).toBe('asset');
    expect(scope.label).toBe('Custom label');
    expect(scope.mode).toBe('link');
  });

  test('derives paths from schema when not explicitly provided', () => {
    const schema = buildSchema({
      type: 'object',
      properties: {
        document: {
          type: 'object',
          properties: {
            actors: {
              type: 'array',
              items: {
                type: 'object',
                'x-entityField': true,
                'x-entityType': 'Person',
                properties: { name: { type: 'string' } },
              },
            },
          },
        },
      },
    });
    const scope = createCooccursScope({
      entities: ['A', 'B'],
      schema,
      sourcePanelId: 's1',
    });
    const paths = (scope.filter.conditions![0].value as any).paths;
    expect(Array.isArray(paths)).toBe(true);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]).toContain('actors');
  });
});

// =============================================================================
// focusedEntityNamesFromFilter — drives the dim_unmatched dim cascade
// =============================================================================

describe('focusedEntityNamesFromFilter', () => {
  test('returns [] for null/empty filters', () => {
    expect(focusedEntityNamesFromFilter(null)).toEqual([]);
    expect(focusedEntityNamesFromFilter(undefined)).toEqual([]);
    expect(focusedEntityNamesFromFilter({ logic: 'and', conditions: [] })).toEqual([]);
  });

  test('extracts entities from a single cooccurs condition', () => {
    const filter: FilterSet = {
      logic: 'and',
      conditions: [
        {
          path: '$',
          operator: 'relational.cooccurs' as any,
          value: { entities: ['Alice', 'Bob'], reach: 'annotation', paths: ['actors[*]'] } as any,
        },
      ],
    };
    expect(focusedEntityNamesFromFilter(filter)).toEqual(['Alice', 'Bob']);
  });

  test('ignores non-cooccurs conditions', () => {
    const filter: FilterSet = {
      logic: 'and',
      conditions: [
        { path: 'sentiment', operator: 'eq', value: 'positive' } as any,
        {
          path: '$',
          operator: 'relational.cooccurs' as any,
          value: { entities: ['Carol'], paths: ['actors[*]'] } as any,
        },
      ],
    };
    expect(focusedEntityNamesFromFilter(filter)).toEqual(['Carol']);
  });

  test('deduplicates across multiple cooccurs conditions (case-insensitive)', () => {
    const filter: FilterSet = {
      logic: 'and',
      conditions: [
        {
          path: '$',
          operator: 'relational.cooccurs' as any,
          value: { entities: ['Alice', 'Bob'], paths: ['p[*]'] } as any,
        },
        {
          path: '$',
          operator: 'relational.cooccurs' as any,
          // alice already covered (case-insensitive); Carol is new
          value: { entities: ['alice', 'Carol'], paths: ['p[*]'] } as any,
        },
      ],
    };
    // Preserves the first-seen casing; second cooccurs only contributes Carol.
    expect(focusedEntityNamesFromFilter(filter)).toEqual(['Alice', 'Bob', 'Carol']);
  });

  test('skips malformed cooccurs values (no entities, wrong shape)', () => {
    const filter: FilterSet = {
      logic: 'and',
      conditions: [
        { path: '$', operator: 'relational.cooccurs' as any, value: null as any },
        { path: '$', operator: 'relational.cooccurs' as any, value: 'garbage' as any },
        { path: '$', operator: 'relational.cooccurs' as any, value: { entities: [] } as any },
        {
          path: '$',
          operator: 'relational.cooccurs' as any,
          // mixed types — only the strings survive
          value: { entities: ['OK', 42, null, '', '   '] as any } as any,
        },
      ],
    };
    expect(focusedEntityNamesFromFilter(filter)).toEqual(['OK']);
  });
});
