import { describe, expect, test } from 'bun:test';
import { EDGE_TREATMENT, isKind, treatmentFor } from './edgeKinds';
import { edgeEpistemics, epistemicStance } from '../graphTypes';

const e = (kind?: string) => ({ kind } as any);

describe('four kinds, four weights', () => {
  test('an act\'s cast recedes; a relation does not', () => {
    // 136 of run 15010's 192 edges are the cast of an act. Drawing them at the
    // weight of a finding is most of why the canvas read as noise.
    expect(treatmentFor(e('role')).alpha).toBeLessThan(
      treatmentFor(e('relation')).alpha,
    );
    expect(treatmentFor(e('role')).width).toBeLessThan(
      treatmentFor(e('relation')).width,
    );
  });

  test('only a sequence and a relation get an arrowhead', () => {
    // An arrow on an act's cast asserts a direction between two entities that
    // the row never claimed; on a containment it says B is a journey into A.
    expect(treatmentFor(e('role')).arrow).toBe(0);
    expect(treatmentFor(e('contains')).arrow).toBe(0);
    expect(treatmentFor(e('follows')).arrow).toBeGreaterThan(0);
    expect(treatmentFor(e('relation')).arrow).toBeGreaterThan(0);
  });

  test('a sequence has the biggest head, because direction IS its content', () => {
    expect(treatmentFor(e('follows')).arrow)
      .toBeGreaterThan(treatmentFor(e('relation')).arrow);
  });

  test('a chain never bows — a curved chain reads as two chains', () => {
    expect(treatmentFor(e('follows')).curvature).toBe(0);
  });

  test('containment is the only kind that moves the layout', () => {
    // Nesting that is only painted is decoration. Everything else leaves the
    // link force alone.
    for (const k of ['role', 'relation', 'follows'] as const) {
      expect(EDGE_TREATMENT[k].nest).toBe(0);
    }
    expect(EDGE_TREATMENT.contains.nest).toBeGreaterThan(0.5);
  });

  test('an unknown or missing kind reads as a relation', () => {
    // Which is what every edge looked like before this existed, and the kind
    // that asserts least about how to draw it.
    expect(treatmentFor(e())).toBe(EDGE_TREATMENT.relation);
    expect(treatmentFor(e('nonsense'))).toBe(EDGE_TREATMENT.relation);
    expect(treatmentFor(null)).toBe(EDGE_TREATMENT.relation);
    expect(isKind(e(), 'relation')).toBe(true);
  });
});

describe('a modality enum reads the same as a transcript verb', () => {
  test('an allegation is never an assertion', () => {
    // The stance table was written in the verb voice a transcript uses
    // ("the witness alleges"); a schema states the same fact as a state
    // ("modality: alleged"). `alleged` therefore fell through to the default,
    // which is ASSERTED — the exact failure the court-records schema exists to
    // prevent, and it would have happened silently.
    expect(epistemicStance('alleged')).toBe('unresolved');
    expect(epistemicStance('alleges')).toBe('unresolved');
  });

  test('refusing to answer is neither a denial nor an admission', () => {
    expect(epistemicStance('declined')).toBe('unresolved');
    expect(epistemicStance('denied')).toBe('negated');
  });

  test('the record itself, sworn testimony and a ruling all assert', () => {
    for (const t of ['recorded', 'testified', 'corroborated', 'adjudicated']) {
      expect(epistemicStance(t)).toBe('asserted');
    }
  });

  test('secondhand is still a claim — its weight lives in source_kind', () => {
    // A different axis from how the claim was made. Mapping `reported` to
    // unresolved would conflate "nobody answered" with "a journalist said so".
    expect(epistemicStance('reported')).toBe('asserted');
  });

  test('and it reaches the edge, which is where it has to land', () => {
    // Edge properties were EMPTY without a panel config — measured 0 of 192 —
    // so `edgeEpistemics` had nothing to read and every denial painted exactly
    // like an assertion.
    expect(edgeEpistemics({ properties: { modality: 'alleged' } } as any).stance)
      .toBe('unresolved');
    expect(edgeEpistemics({ properties: { modality: 'denied' } } as any).dash)
      .not.toBeNull();
  });
});
