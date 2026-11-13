/**
 * The in-tab evaluator IS vision-core's: every case of vision-core's own
 * conformance fixture comes out of the TypeScript port with vision-core's
 * outcome and code.
 *
 * The fixture is owned by qontinui-schemas
 * (`rust-vision-core/tests/fixtures/vision_assertions_conformance.json`, run by
 * `cargo test` there) and vendored byte-for-byte by
 * `scripts/sync-vision-conformance.mjs`. Each case is read the way the tab's
 * answer is produced: the assertion through the same validator the routes use
 * (`parseVisionAssertion`), the snapshot through the vision-core adapter, then
 * the pure `evaluateVisionAssertion`. Plan
 * 2026-11-09-ui-bridge-relay-evaluates-vision-assertions-in-the-tab, Phase 1.
 *
 * A failing case is a defect in the PORT — vision-core is the reference model.
 * The vendored file is never edited to make a case pass: the first test below
 * fails on any hand edit.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseVisionAssertion } from './assertion-request';
import {
  IN_TAB_ASSERTION_KINDS,
  evalInputFromVisionCoreSnapshot,
  evaluateVisionAssertion,
} from './assertion-eval';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, 'conformance/vision-assertions.json');
const SIDECAR = resolve(here, 'conformance/vision-assertions.source.json');

interface ConformanceCase {
  id: string;
  kind: string;
  snapshot: unknown;
  assertion: unknown;
  expected: { outcome: 'passed' | 'failed' | 'unknown'; code: string | null };
}

const text = readFileSync(FIXTURE, 'utf8');
const fixture = JSON.parse(text) as {
  version: number;
  generated_from: string;
  cases: ConformanceCase[];
};
const sidecar = JSON.parse(readFileSync(SIDECAR, 'utf8')) as { sha256: string; cases: number };

describe('vision-core conformance fixture (vendored)', () => {
  it('is the fixture its sidecar records — never edited by hand', () => {
    const digest = createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
    expect(digest).toBe(sidecar.sha256);
    expect(fixture.cases).toHaveLength(sidecar.cases);
    expect(fixture.version).toBe(1);
    expect(fixture.generated_from).toBe('qontinui-vision-core');
  });

  it('covers each in-tab kind with a passed, a failed and an unknown case', () => {
    for (const kind of IN_TAB_ASSERTION_KINDS) {
      const outcomes = new Set(
        fixture.cases.filter((c) => c.kind === kind).map((c) => c.expected.outcome)
      );
      expect({ kind, outcomes: [...outcomes].sort() }).toEqual({
        kind,
        outcomes: ['failed', 'passed', 'unknown'],
      });
    }
  });
});

describe('the TypeScript port reproduces every vision-core conformance case', () => {
  it.each(fixture.cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const assertion = parseVisionAssertion(c.assertion, c.id);
    const result = evaluateVisionAssertion(assertion, evalInputFromVisionCoreSnapshot(c.snapshot));

    expect({ outcome: result.outcome, code: result.code ?? null }).toEqual(c.expected);
    // The rest of vision-core's result contract.
    expect(result.passed).toBe(c.expected.outcome === 'passed');
    expect(result.confidence).toBeNull();
    expect(result.assertion).toEqual(assertion);
    if (result.outcome !== 'passed') expect(result.detail).toEqual(expect.any(String));
  });
});
