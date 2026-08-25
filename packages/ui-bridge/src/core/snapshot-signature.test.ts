/**
 * Snapshot Signature Tests — the cross-repo golden-vector contract.
 *
 * `__fixtures__/snapshot-signature-golden.json` is NOT a convenience fixture:
 * it is the pinned agreement between this fold and the Rust one in
 * `qontinui-runner/.../mcp/ui_bridge/helpers.rs`. Both implementations assert
 * against the same file, which is the only thing that keeps two independently
 * written hashes comparable. A prose "keep these in sync" comment is exactly
 * the drift this plan exists to prevent.
 *
 * If a vector here fails, do not "fix" the fixture. Either the fold changed
 * (which is a spec-v1 break and needs a new `ubs2_` prefix) or one side has a
 * bug.
 */

import { describe, it, expect } from 'vitest';
import {
  computeSnapshotSignature,
  computeSnapshotIdentity,
  computeMountFold,
  formatSnapshotId,
  parseSnapshotId,
  snapshotUnchangedFrom,
  snapshotRemountedFrom,
  SNAPSHOT_ID_PREFIX,
  type SignatureElementLike,
} from './snapshot-signature';
import golden from './__fixtures__/snapshot-signature-golden.json';

interface GoldenCase {
  elements: SignatureElementLike[];
  count: number;
  content: string;
  generation: string;
  snapshotId: string;
}

const CASES = golden as unknown as Record<string, GoldenCase>;

describe('snapshot signature — spec v1 golden vectors', () => {
  for (const [name, expected] of Object.entries(CASES)) {
    it(`reproduces the '${name}' vector exactly`, () => {
      const signature = computeSnapshotSignature(expected.elements);
      expect(signature.count).toBe(expected.count);
      expect(signature.content).toBe(expected.content);
      expect(signature.generation).toBe(expected.generation);
      expect(formatSnapshotId(signature)).toBe(expected.snapshotId);
      expect(computeSnapshotIdentity(expected.elements).snapshotId).toBe(expected.snapshotId);
    });
  }

  it('covers every vector in the fixture', () => {
    // Guards against a vector being added to the fixture (e.g. by the Rust
    // side) and silently not being asserted here.
    expect(Object.keys(CASES).sort()).toEqual([
      'empty',
      'missing_registeredAt',
      'remount_of_two_elements',
      'single_full',
      'single_minimal',
      'two_elements',
      'wrong_types_ignored',
    ]);
  });

  it('an empty snapshot folds to the bare FNV-1a-64 offset basis', () => {
    const signature = computeSnapshotSignature([]);
    expect(signature.content).toBe('cbf29ce484222325');
    expect(signature.generation).toBe('cbf29ce484222325');
    expect(signature.count).toBe(0);
  });

  it('renders 16 lowercase hex chars for both folds', () => {
    for (const expected of Object.values(CASES)) {
      expect(expected.content).toMatch(/^[0-9a-f]{16}$/);
      expect(expected.generation).toMatch(/^[0-9a-f]{16}$/);
    }
  });
});

describe('snapshot signature — the remount case this plan exists for', () => {
  // The whole point: two snapshots whose elements are the same and show the
  // same thing, but which belong to DIFFERENT mounts. `content` is identical,
  // `generation` is not. An "is this element still there?" check cannot see
  // this, because the element is still there — it is simply a different one.
  const before = CASES.two_elements;
  const after = CASES.remount_of_two_elements;

  it('keeps `content` identical across a remount', () => {
    expect(after.content).toBe(before.content);
    expect(computeSnapshotSignature(after.elements).content).toBe(
      computeSnapshotSignature(before.elements).content
    );
  });

  it('moves `generation` across a remount', () => {
    expect(after.generation).not.toBe(before.generation);
    expect(computeSnapshotSignature(after.elements).generation).not.toBe(
      computeSnapshotSignature(before.elements).generation
    );
  });

  it('keeps `count` identical across a remount', () => {
    expect(after.count).toBe(before.count);
  });

  it('reports it as a remount, not as unchanged', () => {
    expect(snapshotRemountedFrom(after.snapshotId, before.snapshotId)).toBe(true);
    expect(snapshotUnchangedFrom(after.snapshotId, before.snapshotId)).toBe(false);
  });
});

describe('snapshot signature — comparison helpers', () => {
  it('reports an identical snapshot as unchanged and not remounted', () => {
    const id = CASES.two_elements.snapshotId;
    expect(snapshotUnchangedFrom(id, id)).toBe(true);
    expect(snapshotRemountedFrom(id, id)).toBe(false);
  });

  it('reports a content change as neither unchanged nor a remount', () => {
    // Different content is a different world, not a remount of the same one.
    expect(
      snapshotUnchangedFrom(CASES.single_full.snapshotId, CASES.missing_registeredAt.snapshotId)
    ).toBe(false);
    expect(
      snapshotRemountedFrom(CASES.single_full.snapshotId, CASES.missing_registeredAt.snapshotId)
    ).toBe(false);
  });

  it('accepts structured signatures as well as id strings', () => {
    const a = computeSnapshotSignature(CASES.two_elements.elements);
    const b = computeSnapshotSignature(CASES.remount_of_two_elements.elements);
    expect(snapshotRemountedFrom(b, a)).toBe(true);
    expect(snapshotUnchangedFrom(a, a)).toBe(true);
  });

  it('treats an unparseable id as unknown, never as unchanged', () => {
    expect(snapshotUnchangedFrom('not-a-snapshot-id', CASES.empty.snapshotId)).toBe(false);
    expect(snapshotRemountedFrom('not-a-snapshot-id', CASES.empty.snapshotId)).toBe(false);
  });
});

describe('snapshot signature — id format', () => {
  it('round-trips through parse', () => {
    for (const expected of Object.values(CASES)) {
      const parsed = parseSnapshotId(expected.snapshotId);
      expect(parsed).toEqual({
        count: expected.count,
        content: expected.content,
        generation: expected.generation,
      });
    }
  });

  it('encodes count in base 36', () => {
    const elements: SignatureElementLike[] = Array.from({ length: 40 }, (_, i) => ({
      id: `el_${i}`,
    }));
    const id = computeSnapshotIdentity(elements).snapshotId;
    expect(id.split('_')[1]).toBe((40).toString(36));
    expect(parseSnapshotId(id)!.count).toBe(40);
  });

  it('rejects malformed ids rather than throwing', () => {
    expect(parseSnapshotId('')).toBeNull();
    expect(parseSnapshotId('ubs1_0_short_cbf29ce484222325')).toBeNull();
    expect(parseSnapshotId('ubs2_0_cbf29ce484222325_cbf29ce484222325')).toBeNull();
    expect(parseSnapshotId('ubs1_0_cbf29ce484222325')).toBeNull();
    expect(parseSnapshotId('ubs1_0_CBF29CE484222325_cbf29ce484222325')).toBeNull();
    expect(parseSnapshotId('ubs1_-1_cbf29ce484222325_cbf29ce484222325')).toBeNull();
  });

  it('uses the spec-v1 prefix', () => {
    expect(SNAPSHOT_ID_PREFIX).toBe('ubs1');
    expect(CASES.empty.snapshotId.startsWith('ubs1_')).toBe(true);
  });
});

describe('snapshot signature — typing rules', () => {
  it('ignores fields of the wrong type entirely', () => {
    // Not "folds them as something else" — contributes NO bytes, so the result
    // is identical to the element with those fields absent.
    const idOnly = computeSnapshotSignature([{ id: 'btn_save' }]);
    expect(computeSnapshotSignature(CASES.wrong_types_ignored.elements)).toEqual(idOnly);
  });

  it("treats ariaPressed: 'mixed' as not-a-boolean", () => {
    // `ElementState.ariaPressed` is `boolean | 'mixed'`; the spec says "is a
    // boolean", so the tri-state contributes nothing.
    const mixed = computeSnapshotSignature([{ id: 'x', state: { ariaPressed: 'mixed' } }]);
    const absent = computeSnapshotSignature([{ id: 'x', state: {} }]);
    expect(mixed).toEqual(absent);
  });

  it('distinguishes ariaPressed true from false from absent', () => {
    const t = computeSnapshotSignature([{ id: 'x', state: { ariaPressed: true } }]).content;
    const f = computeSnapshotSignature([{ id: 'x', state: { ariaPressed: false } }]).content;
    const absent = computeSnapshotSignature([{ id: 'x' }]).content;
    expect(new Set([t, f, absent]).size).toBe(3);
  });

  it('ignores a negative or fractional registeredAt', () => {
    const idOnly = computeSnapshotSignature([{ id: 'x' }]).generation;
    expect(computeSnapshotSignature([{ id: 'x', registeredAt: -1 }]).generation).toBe(idOnly);
    expect(computeSnapshotSignature([{ id: 'x', registeredAt: 1.5 }]).generation).toBe(idOnly);
    expect(computeSnapshotSignature([{ id: 'x', registeredAt: NaN }]).generation).toBe(idOnly);
    // Zero IS a valid integer >= 0 and must contribute bytes.
    expect(computeSnapshotSignature([{ id: 'x', registeredAt: 0 }]).generation).not.toBe(idOnly);
  });

  it('is order-sensitive across elements', () => {
    const a = computeSnapshotSignature([{ id: 'a' }, { id: 'b' }]);
    const b = computeSnapshotSignature([{ id: 'b' }, { id: 'a' }]);
    expect(a.content).not.toBe(b.content);
    expect(a.count).toBe(b.count);
  });

  it('cannot be confused by field-boundary sliding', () => {
    // The 0xFF terminator is not a legal UTF-8 byte, so "ab" + "c" can never
    // collide with "a" + "bc" the way a naive concatenation would.
    const split = computeSnapshotSignature([{ id: 'ab', category: 'c' }]);
    const slid = computeSnapshotSignature([{ id: 'a', category: 'bc' }]);
    expect(split.content).not.toBe(slid.content);
  });

  it('folds non-ASCII text as UTF-8', () => {
    const ascii = computeSnapshotSignature([{ id: 'x', state: { textContent: 'ae' } }]);
    const accented = computeSnapshotSignature([{ id: 'x', state: { textContent: 'æ' } }]);
    const astral = computeSnapshotSignature([{ id: 'x', state: { textContent: '😀' } }]);
    expect(new Set([ascii.content, accented.content, astral.content]).size).toBe(3);
  });

  it('folds a lone surrogate as U+FFFD, matching TextEncoder', () => {
    const lone = computeSnapshotSignature([{ id: 'x', state: { textContent: '\ud800' } }]);
    const replacement = computeSnapshotSignature([{ id: 'x', state: { textContent: '�' } }]);
    expect(lone.content).toBe(replacement.content);
  });
});

describe('computeMountFold', () => {
  it('reproduces the full fold`s count and generation exactly', () => {
    // The cheap arm is a PROJECTION of the same spec, not a second definition.
    // If this ever diverges, the action path's freshness check starts lying.
    for (const expected of Object.values(CASES)) {
      const mount = computeMountFold(expected.elements);
      expect(mount.count).toBe(expected.count);
      expect(mount.generation).toBe(expected.generation);
    }
  });

  it('is blind to content changes, by design', () => {
    const a = computeMountFold([{ id: 'x', registeredAt: 1, state: { textContent: 'before' } }]);
    const b = computeMountFold([{ id: 'x', registeredAt: 1, state: { textContent: 'after' } }]);
    expect(a.generation).toBe(b.generation);
  });
});

describe('snapshot signature — cost', () => {
  // Phase 1's falsification check: snapshots are taken constantly, so a fold
  // that is expensive regresses every inspection. This is a floor, not a
  // benchmark — the real numbers are in the phase report. It exists so a
  // future change that reintroduces BigInt or a per-byte allocation fails
  // here rather than silently costing every snapshot.
  function syntheticElements(n: number): SignatureElementLike[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `el_${i}_button_primary`,
      category: i % 3 === 0 ? 'interactive' : 'content',
      state: {
        textContent: `Some element label number ${i} with a realistic amount of text`,
        ariaPressed: i % 2 === 0,
      },
      registeredAt: 1724500000000 + i,
    }));
  }

  it('folds a 200-element snapshot in well under a millisecond', () => {
    const elements = syntheticElements(200);
    for (let i = 0; i < 50; i++) computeSnapshotSignature(elements);
    const runs = 200;
    const start = performance.now();
    for (let i = 0; i < runs; i++) computeSnapshotSignature(elements);
    const perSnapshot = (performance.now() - start) / runs;
    // Generous ceiling: measured ~0.2 ms, and CI machines are noisy. The
    // assertion is "not pathological", not "fast".
    expect(perSnapshot).toBeLessThan(5);
  });

  it('scales roughly linearly to 1000 elements', () => {
    const elements = syntheticElements(1000);
    for (let i = 0; i < 20; i++) computeSnapshotSignature(elements);
    const runs = 50;
    const start = performance.now();
    for (let i = 0; i < runs; i++) computeSnapshotSignature(elements);
    const perSnapshot = (performance.now() - start) / runs;
    expect(perSnapshot).toBeLessThan(25);
  });
});
