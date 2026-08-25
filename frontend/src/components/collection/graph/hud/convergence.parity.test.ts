/// <reference types="bun-types" />
/**
 * The TypeScript half of the convergence parity contract.
 *
 * `backend/app/tests/fixtures/profile_parity.json` is the shared claim; the
 * Python half is `backend/app/tests/test_profile_parity.py`. Both read the
 * same file, so changing either implementation without changing the fixture
 * fails on one side or the other.
 *
 * Written because the two had already drifted under a docstring asserting they
 * could not — see the fixture's own header.
 *
 * The fixture is deliberately read from the backend tree rather than copied
 * here. A copy is not a parity test; it is the same bug with two homes. If the
 * file cannot be read this suite FAILS rather than skipping, because a parity
 * test that quietly does nothing is exactly how the drift survived.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cosine, profileOf } from './convergence';
import type { GraphNode } from '../graphTypes';

const FIXTURE = resolve(
  import.meta.dir, '../../../../../../backend/app/tests/fixtures/profile_parity.json',
);

interface Cases {
  profiles: Array<{ name: string; raw: unknown; profile: Record<string, number> | null }>;
  cosines: Array<{ name: string; a: Record<string, number>; b: Record<string, number>; cosine: number }>;
}

const cases: Cases = JSON.parse(readFileSync(FIXTURE, 'utf8'));

const withProfile = (profile: unknown): GraphNode =>
  ({ id: 'n', label: 'n', type: 'Person', kind: 'entity', profile } as GraphNode);

describe('convergence parity — the profile is read the same way', () => {
  for (const c of cases.profiles) {
    test(c.name, () => {
      expect(profileOf(withProfile(c.raw))).toEqual(c.profile);
    });
  }

  test('a non-dict profile is not a profile', () => {
    for (const v of [null, undefined, 'Person', ['a', 'b'], 3]) {
      expect(profileOf(withProfile(v))).toBeNull();
    }
  });

  test('groupValue is NOT read — a role histogram is not an affinity vector', () => {
    const roleHistogram = { via: 340, employer: 12 };
    expect(profileOf({
      id: 'n', label: 'n', type: 'Person', kind: 'entity',
      groupValue: roleHistogram,
    } as GraphNode)).toBeNull();
  });
});

describe('convergence parity — the cosine is the same number', () => {
  for (const c of cases.cosines) {
    test(c.name, () => {
      expect(cosine(c.a, c.b)).toBeCloseTo(c.cosine, 12);
    });
  }
});

// The distance penalty used to be the third parity block. It is gone from both
// implementations: multiplying affinity by distance capped `converge>` at 0.5
// forever, because sharing an interest puts two actors at exactly two hops.
// Affinity and contact are two separate tests over the same pair now, so there
// is no combined number left for the two sides to disagree about.
