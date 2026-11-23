// @vitest-environment node
/**
 * capture-from-snapshot.ts over synthetic snapshots. Every expected value is a
 * literal; each case names the rule of Phase 1 it pins.
 */
import { describe, expect, it } from 'vitest';
import { captureDensityFromSnapshot } from '../capture-from-snapshot';
import { sha256DensityHex } from '../hash';
import {
  parseDensityCapture,
  parseDensityTargets,
  type DensityCapture,
  type DensityTargets,
} from '../schema';
import { densityMatcherKey, resolveDensityMatcher } from '../match';
import {
  DENSITY_TEST_PRODUCER,
  densityTestEnvelope,
  densityTestSnapshot,
  type DensityTestElementSpec,
} from './fixtures/snapshot-builder';

const EVALUATED_AT = '2026-11-23T10:00:00.000Z';

function capture(input: unknown, extra: { role?: string; targets?: DensityTargets } = {}) {
  return captureDensityFromSnapshot(input, {
    producer: DENSITY_TEST_PRODUCER,
    evaluatedAt: EVALUATED_AT,
    ...extra,
  });
}

function measured(
  input: unknown,
  extra: { role?: string; targets?: DensityTargets } = {}
): DensityCapture {
  const obs = capture(input, extra);
  if (obs.status !== 'measured') throw new Error(`expected measured, got ${JSON.stringify(obs)}`);
  return obs.value;
}

function one(
  spec: DensityTestElementSpec,
  viewport?: Parameters<typeof densityTestSnapshot>[0]['viewport']
) {
  return measured(densityTestSnapshot({ elements: [spec], viewport })).items[0];
}

function targets(doc: Record<string, unknown>): DensityTargets {
  const parsed = parseDensityTargets({
    schema: 'ui-bridge/density-targets@1',
    surface: '/',
    profile: 'audience_profile/synthetic@1',
    ...doc,
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
  return parsed.value;
}

const BUYER_TARGETS = () =>
  targets({
    roles: [
      {
        role: 'buyer',
        probe: { id: 'app.header.role', includes: 'Buyer' },
        asks: [
          {
            id: 'B1',
            rank: 1,
            weight: 5,
            kind: 'state',
            question: 'What is my order total?',
            source: { doc: 'audience_profile/synthetic@1', quote: 'Buyers check totals.' },
            answer: { text: 'Total due' },
          },
        ],
      },
    ],
  });

const TEXT_ONLY_TARGETS = () =>
  targets({
    roles: [
      {
        role: 'buyer',
        asks: [
          {
            id: 'B1',
            rank: 1,
            weight: 1,
            kind: 'lookup',
            question: 'Where is x?',
            source: { doc: 'audience_profile/synthetic@1', quote: 'Buyers look for x.' },
            answer: { text: 'x' },
          },
        ],
      },
    ],
  });

describe('captureDensityFromSnapshot', () => {
  it('runs with no DOM', () => {
    expect(typeof document).toBe('undefined');
  });

  it('reads the bare snapshot and the relay envelope alike', () => {
    const snapshot = densityTestSnapshot({ elements: [{ id: 'app.a', text: 'Hello' }] });
    const bare = measured(snapshot);
    const enveloped = measured(densityTestEnvelope(snapshot, { stale: false, cacheAgeMs: 10 }));
    expect(enveloped).toEqual(bare);
    expect(bare.schema).toBe('ui-bridge/density-capture@1');
    expect(bare.scope).toBe('registered');
    expect(bare.cell).toEqual({
      role: null,
      viewport: { width: 1280, height: 800 },
      fixture: null,
    });
    expect(bare.observedAt).toBe('2026-11-23T09:00:00.000Z');
    expect(bare.snapshotId).toBe('snap-synthetic-1');
    expect(bare.capturedBy).toEqual({ package: '@qontinui/ui-bridge', version: '0.0.0-test' });
    expect(bare.structureResolved).toBe(false);
  });

  it('answers in an Observation from the producer it was given, with the host package in source', () => {
    const obs = capture(densityTestSnapshot({ elements: [{ id: 'app.a', text: 'Hello' }] }));
    expect(obs.status).toBe('measured');
    expect(obs.provenance.producer).toEqual({ id: 'sdk/density', version: '0.0.0-test' });
    expect(obs.provenance.evaluatedAt).toBe(EVALUATED_AT);
    expect(obs.provenance.observedAt).toBe('2026-11-23T09:00:00.000Z');
    expect(obs.provenance.source).toEqual({
      package: '@qontinui/ui-bridge',
      schema: 'ui-bridge/density-capture@1',
      snapshotId: 'snap-synthetic-1',
      targetsHash: null,
    });
    expect(obs.provenance.coverage).toEqual({ considered: 1, measured: 1, unmeasured: [] });
  });

  it('an unscrolled snapshot: document y equals viewport y, foldBasis measured', () => {
    const c = measured(
      densityTestSnapshot({ elements: [{ id: 'app.a', rect: [10, 300, 200, 24] }] })
    );
    expect(c.items[0].rect).toEqual({ x: 10, y: 300, w: 200, h: 24 });
    expect(c.bases.foldBasis).toBe('measured');
  });

  it('a scrolled snapshot: rect is reprojected into document space', () => {
    const c = measured(
      densityTestSnapshot({
        elements: [{ id: 'app.a', rect: [10, -100, 200, 24] }],
        viewport: { scrollY: 600, scrollX: 5 },
      })
    );
    expect(c.items[0].rect).toEqual({ x: 15, y: 500, w: 200, h: 24 });
    expect(c.bases.foldBasis).toBe('reprojected');
    expect(c.viewport.scrollY).toBe(600);
  });

  it("container 'body' is measured like the viewport, not taken for an inner scroller", () => {
    const c = measured(
      densityTestSnapshot({
        elements: [{ id: 'app.a', rect: [0, 100, 100, 20] }],
        viewport: { container: 'body', scrollY: 200 },
      })
    );
    expect(c.viewport.container).toBe('body');
    expect(c.items[0].rect).toEqual({ x: 0, y: 300, w: 100, h: 20 });
    expect(c.bases.scrollBasis).toBe('page');
    expect(c.bases.scroller).toBeNull();
  });

  it('a nested scroller, first sign: a registered scrollInfo over half the viewport area', () => {
    const c = measured(
      densityTestSnapshot({
        elements: [
          {
            id: 'app.pane',
            rect: [0, 0, 1280, 800],
            scrollInfo: {
              scrollTop: 0,
              scrollLeft: 0,
              scrollHeight: 3000,
              scrollWidth: 1280,
              clientHeight: 700,
              clientWidth: 1280,
              canScrollUp: false,
              canScrollDown: true,
              canScrollLeft: false,
              canScrollRight: false,
            },
          },
        ],
      })
    );
    expect(c.bases.scrollBasis).toBe('inner-scroller');
    expect(c.bases.scroller).toEqual({ by: 'scroll-info', id: 'app.pane' });
  });

  it('a scrollInfo under half the viewport area is not an inner page scroller', () => {
    const c = measured(
      densityTestSnapshot({
        elements: [
          {
            id: 'app.list',
            scrollInfo: {
              scrollTop: 0,
              scrollLeft: 0,
              scrollHeight: 900,
              scrollWidth: 400,
              clientHeight: 300,
              clientWidth: 400,
              canScrollUp: false,
              canScrollDown: true,
              canScrollLeft: false,
              canScrollRight: false,
            },
          },
        ],
      })
    );
    expect(c.bases.scrollBasis).toBe('page');
  });

  it('a nested scroller, second sign: the page cannot scroll while items lie below the document', () => {
    const c = measured(
      densityTestSnapshot({
        elements: [
          { id: 'app.top', rect: [0, 100, 100, 20] },
          { id: 'app.deep', rect: [0, 1500, 100, 20] },
        ],
        viewport: { documentHeight: 800, viewportHeight: 800, canScrollDown: false },
      })
    );
    expect(c.bases.scrollBasis).toBe('inner-scroller');
    expect(c.bases.scroller).toEqual({ by: 'overflowing-items', count: 1 });
  });

  it.each([
    ['uiBridgeId on the row', { uiBridgeId: 'app.total' }],
    ['dataset.uiBridgeId', { dataset: { uiBridgeId: 'app.total' } }],
    ['dataset.uiBridgeContent', { dataset: { uiBridgeContent: 'app.total' } }],
  ] as const)('an author id carried as %s sets authorId', (_label, extra) => {
    expect(one({ id: 'app.total', ...extra }).authorId).toBe(true);
  });

  it('an auto-registered element is not author-identified by the stamp the registrar writes', () => {
    expect(one({ id: 'button-save', origin: 'auto', uiBridgeId: 'button-save' }).authorId).toBe(
      false
    );
    expect(one({ id: 'x', origin: 'auto', dataset: { uiBridgeId: 'x' } }).authorId).toBe(false);
  });

  it('an auto-registered element with an author-only attribute is author-identified', () => {
    expect(
      one({ id: 'app.total', origin: 'auto', dataset: { uiBridgeContent: 'app.total' } }).authorId
    ).toBe(true);
    expect(
      one({ id: 'app.t', origin: 'auto', dataset: { uiBridgeTestId: 'app.t' } }).authorId
    ).toBe(true);
  });

  it('a hook registration is author-identified by construction', () => {
    expect(one({ id: 'app.orders', origin: 'hook' }).authorId).toBe(true);
  });

  it('a stamp with no origin falls back to the stamp, and the coverage says so', () => {
    const obs = capture(densityTestSnapshot({ elements: [{ id: 'app.a', uiBridgeId: 'app.a' }] }));
    if (obs.status !== 'measured') throw new Error(obs.status);
    expect(obs.value.items[0].authorId).toBe(true);
    expect(obs.provenance.coverage.unmeasured).toEqual([
      { dimension: 'origin', count: 1, code: 'input_missing' },
    ]);
  });

  it('an element with no state: its text is unknown, never empty', () => {
    const snapshot = densityTestSnapshot({ elements: [{ id: 'app.a', text: 'x' }] });
    delete (snapshot.elements[0] as { state?: unknown }).state;
    const obs = capture(snapshot, { role: 'buyer', targets: TEXT_ONLY_TARGETS() });
    if (obs.status !== 'measured') throw new Error(obs.status);
    expect(obs.value.items[0].chars).toBeNull();
    expect(obs.provenance.coverage.unmeasured).toContainEqual({
      dimension: 'text',
      count: 1,
      code: 'input_missing',
    });
    expect(Object.values(obs.value.textMatches)).toEqual([{ ids: [], unevaluated: 1 }]);
  });

  it('a timestamp outside the Date range is no sample time, not a throw', () => {
    const obs = capture(densityTestSnapshot({ elements: [{ id: 'app.a' }], takenAtMs: 1e20 }));
    expect(obs.status).toBe('measured');
    if (obs.status !== 'measured') return;
    expect(obs.value.observedAt).toBeNull();
    expect(obs.provenance.observedAt).toBeNull();
  });

  it('an adapter that throws answers unknown{producer_failed}, never an exception', () => {
    // A hand-built targets value the parser would refuse: a lone surrogate has no hash.
    const bad = { ...TEXT_ONLY_TARGETS(), surface: String.fromCharCode(0xd800) };
    const obs = capture(densityTestSnapshot({ elements: [{ id: 'app.a' }] }), { targets: bad });
    expect(obs.status).toBe('unknown');
    if (obs.status !== 'unknown') return;
    expect(obs.unknown.code).toBe('producer_failed');
    expect(obs.provenance.observedAt).toBeNull();
  });

  it('a throw after the sample time was read still answers producer_failed, with no sample time', () => {
    const snapshot = densityTestSnapshot({ elements: [{ id: 'app.a' }] });
    Object.defineProperty(snapshot.elements[0], 'state', {
      get: () => {
        throw new Error('synthetic getter failure');
      },
    });
    const obs = capture(snapshot);
    expect(obs.status).toBe('unknown');
    if (obs.status !== 'unknown') return;
    expect(obs.unknown.code).toBe('producer_failed');
    expect(obs.unknown.detail).toContain('synthetic getter failure');
    expect(obs.provenance.observedAt).toBeNull();
  });

  it('a role probe whose item is redacted: unknown{input_missing}', () => {
    const obs = capture(
      densityTestSnapshot({ elements: [{ id: 'app.header.role', text: 'Buyer', redacted: true }] }),
      { role: 'buyer', targets: BUYER_TARGETS() }
    );
    expect(obs.status).toBe('unknown');
    if (obs.status !== 'unknown') return;
    expect(obs.unknown.code).toBe('input_missing');
    expect(obs.unknown.detail).toContain('redacted');
  });

  it('a duplicate element id becomes one item, and the duplicate is counted', () => {
    const obs = capture(densityTestSnapshot({ elements: [{ id: 'app.a' }, { id: 'app.a' }] }));
    if (obs.status !== 'measured') throw new Error(obs.status);
    expect(obs.value.items.map((i) => i.id)).toEqual(['app.a']);
    expect(obs.provenance.coverage).toEqual({
      considered: 2,
      measured: 1,
      unmeasured: [{ dimension: 'id', count: 1, code: 'input_missing' }],
    });
  });

  it('an element with no author-id carrier has authorId false', () => {
    expect(one({ id: 'auto-17', dataset: { testid: 'x' } }).authorId).toBe(false);
  });

  it('visible:false with no visibilityReason is null visibility, counted under coverage', () => {
    const obs = capture(densityTestSnapshot({ elements: [{ id: 'app.a', visible: false }] }));
    if (obs.status !== 'measured') throw new Error(obs.status);
    expect(obs.value.items[0].visibility).toBeNull();
    expect(obs.provenance.coverage).toEqual({
      considered: 1,
      measured: 0,
      unmeasured: [{ dimension: 'visibility', count: 1, code: 'input_missing' }],
    });
  });

  it.each([
    [true, undefined, 'rendered'],
    [false, 'off-screen', 'rendered'],
    [false, 'occluded', 'occluded'],
    [false, 'hidden', 'hidden'],
    [false, 'no-layout', 'no-layout'],
  ] as const)('visible %s with reason %s is %s', (visible, reason, expected) => {
    expect(one({ id: 'app.a', visible, visibilityReason: reason }).visibility).toBe(expected);
  });

  it('a redacted element keeps no text: chars, textHash and shape are null', () => {
    const obs = capture(
      densityTestSnapshot({ elements: [{ id: 'app.secret', text: 'IBAN 1234', redacted: true }] })
    );
    if (obs.status !== 'measured') throw new Error(obs.status);
    const item = obs.value.items[0];
    expect([item.chars, item.textHash, item.shape]).toEqual([null, null, null]);
    expect(obs.provenance.coverage.unmeasured).toEqual([
      { dimension: 'text', count: 1, code: 'not_attempted_by_policy' },
    ]);
  });

  it('text becomes a code-point length, a hash and a shape, and never leaves the adapter', () => {
    const item = one({ id: 'app.total', text: '  € 12,50\n' });
    expect(item.chars).toBe(7);
    expect(item.textHash).toBe(sha256DensityHex('€ 12,50'));
    expect(item.shape).toBe('currency');
    const astral = one({ id: 'app.emoji', text: 'ok 😀' });
    expect(astral.chars).toBe(4);
  });

  it('a capture holds no page text', () => {
    const c = measured(
      densityTestSnapshot({
        elements: [
          { id: 'app.a', text: 'Synthetic Secretword 77', href: 'https://example.test/private' },
        ],
      })
    );
    const json = JSON.stringify(c);
    expect(json).not.toContain('Secretword');
    expect(json).not.toContain('example.test');
    expect(c.items[0].href).toBe(sha256DensityHex('https://example.test/private'));
  });

  it('fontPx, lineHeightPx and position from computed styles', () => {
    const item = one({
      id: 'app.a',
      styles: { fontSize: '13px', lineHeight: '18.5px', position: 'sticky' },
    });
    expect([item.fontPx, item.lineHeightPx, item.position]).toEqual([13, 18.5, 'sticky']);
  });

  it('a normal line height is null, and counted', () => {
    const obs = capture(
      densityTestSnapshot({ elements: [{ id: 'app.a', styles: { lineHeight: 'normal' } }] })
    );
    if (obs.status !== 'measured') throw new Error(obs.status);
    expect(obs.value.items[0].lineHeightPx).toBeNull();
    expect(obs.value.items[0].fontPx).toBe(14);
    expect(obs.provenance.coverage.unmeasured).toEqual([
      { dimension: 'lineHeight', count: 1, code: 'input_missing' },
    ]);
  });

  it('no computed styles: the style fields are null and coverage names computedStyles', () => {
    const obs = capture(densityTestSnapshot({ elements: [{ id: 'app.a', styles: false }] }));
    if (obs.status !== 'measured') throw new Error(obs.status);
    const item = obs.value.items[0];
    expect([item.fontPx, item.lineHeightPx, item.position, item.truncated]).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(obs.provenance.coverage.unmeasured).toEqual([
      { dimension: 'computedStyles', count: 1, code: 'input_missing' },
      { dimension: 'truncation', count: 1, code: 'input_missing' },
    ]);
  });

  it('no rect: rect is null and coverage names rect', () => {
    const obs = capture(densityTestSnapshot({ elements: [{ id: 'app.a', rect: null }] }));
    if (obs.status !== 'measured') throw new Error(obs.status);
    expect(obs.value.items[0].rect).toBeNull();
    expect(obs.provenance.coverage.unmeasured).toEqual([
      { dimension: 'rect', count: 1, code: 'input_missing' },
    ]);
  });

  it('a truncated leaf without a title has no recoverable form', () => {
    const item = one({
      id: 'app.label',
      scrollWidth: 240,
      clientWidth: 120,
      styles: { overflow: 'hidden' },
    });
    expect(item.truncated).toBe(true);
    expect(item.recoverable).toBeNull();
  });

  it('a truncated leaf named by its title is recoverable', () => {
    const item = one({
      id: 'app.label',
      scrollWidth: 240,
      clientWidth: 120,
      styles: { overflow: 'hidden' },
      nameSource: 'title',
    });
    expect(item.truncated).toBe(true);
    expect(item.recoverable).toBe(true);
  });

  it('one pixel of overflow is rounding, not truncation', () => {
    expect(
      one({ id: 'app.a', scrollWidth: 121, clientWidth: 120, styles: { overflow: 'hidden' } })
        .truncated
    ).toBe(false);
    expect(
      one({ id: 'app.a', scrollWidth: 122, clientWidth: 120, styles: { overflow: 'hidden' } })
        .truncated
    ).toBe(true);
  });

  it('a blank computed overflow is unmeasurable truncation, not a verdict', () => {
    expect(
      one({ id: 'app.a', scrollWidth: 400, clientWidth: 120, styles: { overflow: '' } }).truncated
    ).toBeNull();
  });

  it('overflow visible is never truncation, however wide the content', () => {
    expect(
      one({ id: 'app.a', scrollWidth: 400, clientWidth: 120, styles: { overflow: 'visible' } })
        .truncated
    ).toBe(false);
  });

  it('expanded from ariaExpanded, controls from a controls or toggles edge', () => {
    const c = measured(
      densityTestSnapshot({
        elements: [
          { id: 'app.toggle', category: 'interactive', ariaExpanded: false },
          { id: 'app.panel' },
          { id: 'app.menu-button', category: 'interactive' },
          { id: 'app.menu' },
        ],
        relationships: [
          { source: 'app.toggle', target: 'app.panel', type: 'controls' },
          { source: 'app.menu-button', target: 'app.menu', type: 'toggles' },
          { source: 'app.panel', target: 'app.toggle', type: 'labels' },
        ],
      })
    );
    const by = Object.fromEntries(c.items.map((i) => [i.id, i]));
    expect(by['app.toggle'].expanded).toBe(false);
    expect(by['app.toggle'].controls).toBe('app.panel');
    expect(by['app.toggle'].interactive).toBe(true);
    expect(by['app.menu-button'].controls).toBe('app.menu');
    expect(by['app.panel'].controls).toBeNull();
    expect(by['app.panel'].expanded).toBeNull();
    expect(by['app.panel'].interactive).toBe(false);
  });

  it('structureBy is xpath when the item has an xpath chain, structure left unresolved', () => {
    const item = one({ id: 'app.a', xpath: '//*[@id="main"]/div[2]/span[1]' });
    expect(item.structureBy).toBe('xpath');
    expect([item.parent, item.path, item.landmark, item.ownChars]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it('contentCap reads registration.contentDropped when the snapshot carries it', () => {
    const c = measured(densityTestSnapshot({ elements: [{ id: 'app.a' }], contentDropped: 12 }));
    expect(c.bases.contentCap).toEqual({ status: 'reported', dropped: 12 });
  });

  it('contentCap is unreported, never "nothing dropped", when the snapshot carries no count', () => {
    const c = measured(
      densityTestSnapshot({
        elements: [{ id: 'app.a' }, { id: 'app.b' }, { id: 'app.c', category: 'interactive' }],
      })
    );
    expect(c.bases.contentCap).toEqual({ status: 'unreported', contentRows: 2 });
    expect(c.bases.pinBasis).toBe('registered-only');
  });

  it('no viewport block: unknown{input_missing}', () => {
    const obs = capture(densityTestSnapshot({ elements: [{ id: 'app.a' }], viewport: null }));
    expect(obs.status).toBe('unknown');
    if (obs.status !== 'unknown') return;
    expect(obs.unknown.code).toBe('input_missing');
    expect(obs.provenance.observedAt).toBe('2026-11-23T09:00:00.000Z');
  });

  it('no elements array: unknown{input_missing}, never an empty page', () => {
    const snapshot = densityTestSnapshot({ elements: [] }) as unknown as Record<string, unknown>;
    delete snapshot.elements;
    const obs = capture(snapshot);
    expect(obs.status).toBe('unknown');
    if (obs.status === 'unknown') expect(obs.unknown.code).toBe('input_missing');
  });

  it('zero elements and zero components: unknown{producer_not_run}', () => {
    const obs = capture(densityTestSnapshot({ elements: [], components: 0 }));
    expect(obs.status).toBe('unknown');
    if (obs.status === 'unknown') expect(obs.unknown.code).toBe('producer_not_run');
  });

  it('zero elements beside a registered component is a measured, empty capture', () => {
    const obs = capture(densityTestSnapshot({ elements: [], components: 1 }));
    expect(obs.status).toBe('measured');
    if (obs.status === 'measured') expect(obs.value.items).toEqual([]);
  });

  it('a stale relay answer: unknown{stale_input}', () => {
    const snapshot = densityTestSnapshot({ elements: [{ id: 'app.a' }] });
    const obs = capture(densityTestEnvelope(snapshot, { stale: true, cacheAgeMs: 90_000 }));
    expect(obs.status).toBe('unknown');
    if (obs.status === 'unknown') expect(obs.unknown.code).toBe('stale_input');
  });

  it('an error envelope: unknown{producer_failed}', () => {
    const obs = capture({ success: false, error: 'no tab connected' });
    expect(obs.status).toBe('unknown');
    if (obs.status === 'unknown') {
      expect(obs.unknown.code).toBe('producer_failed');
      expect(obs.unknown.detail).toContain('no tab connected');
    }
  });

  it('a non-object input: unknown{input_missing}', () => {
    for (const input of [null, 'snapshot', 7, []]) {
      const obs = capture(input);
      expect(obs.status).toBe('unknown');
      if (obs.status === 'unknown') expect(obs.unknown.code).toBe('input_missing');
    }
  });

  it('a role probe that matches: the capture records it', () => {
    const c = measured(
      densityTestSnapshot({
        elements: [
          { id: 'app.header.role', text: 'Signed in as Buyer' },
          { id: 'app.total', text: 'Total due € 12,50' },
        ],
      }),
      { role: 'buyer', targets: BUYER_TARGETS() }
    );
    expect(c.probe).toEqual({ role: 'buyer', id: 'app.header.role', matched: true });
    expect(c.cell.role).toBe('buyer');
  });

  it('a role probe that does not match: unknown{input_missing}', () => {
    const obs = capture(
      densityTestSnapshot({ elements: [{ id: 'app.header.role', text: 'Signed in as Seller' }] }),
      { role: 'buyer', targets: BUYER_TARGETS() }
    );
    expect(obs.status).toBe('unknown');
    if (obs.status === 'unknown') {
      expect(obs.unknown.code).toBe('input_missing');
      expect(obs.unknown.detail).toContain('not taken as this role');
    }
  });

  it('a role probe whose item is absent: unknown{input_missing}', () => {
    const obs = capture(densityTestSnapshot({ elements: [{ id: 'app.other', text: 'Buyer' }] }), {
      role: 'buyer',
      targets: BUYER_TARGETS(),
    });
    expect(obs.status).toBe('unknown');
    if (obs.status === 'unknown') expect(obs.unknown.code).toBe('input_missing');
  });

  it('a text matcher is evaluated at capture time and keyed by its hash', () => {
    const t = BUYER_TARGETS();
    const c = measured(
      densityTestSnapshot({
        elements: [
          { id: 'app.header.role', text: 'Buyer' },
          { id: 'app.total', text: 'Total   due € 12,50' },
          { id: 'app.note', text: 'Nothing here' },
          { id: 'app.secret', text: 'Total due', redacted: true },
        ],
      }),
      { role: 'buyer', targets: t }
    );
    const matcher = { text: 'Total due' };
    expect(c.textMatches).toEqual({
      [densityMatcherKey(matcher)]: { ids: ['app.total'], unevaluated: 1 },
    });
    expect(resolveDensityMatcher(c, matcher)).toEqual({
      status: 'resolved',
      ids: ['app.total'],
      textUnevaluated: 1,
    });
    expect(c.targetsHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a capture taken without the targets leaves their text matchers unresolved', () => {
    const c = measured(densityTestSnapshot({ elements: [{ id: 'app.total', text: 'Total due' }] }));
    expect(resolveDensityMatcher(c, { text: 'Total due' })).toEqual({
      status: 'unresolved',
      reason: 'text-not-captured',
      textUnevaluated: 0,
    });
  });

  it('an element with no id is not an item, and is counted', () => {
    const snapshot = densityTestSnapshot({ elements: [{ id: 'app.a' }, { id: 'app.b' }] });
    (snapshot.elements[1] as { id: unknown }).id = undefined;
    const obs = capture(snapshot);
    if (obs.status !== 'measured') throw new Error(obs.status);
    expect(obs.value.items.map((i) => i.id)).toEqual(['app.a']);
    expect(obs.provenance.coverage).toEqual({
      considered: 2,
      measured: 1,
      unmeasured: [{ dimension: 'id', count: 1, code: 'input_missing' }],
    });
  });

  it('the capture parser refuses an impossible observedAt', () => {
    const c = measured(densityTestSnapshot({ elements: [{ id: 'app.a' }] }));
    const r = parseDensityCapture({
      ...JSON.parse(JSON.stringify(c)),
      observedAt: '2026-02-30T09:00:00Z',
    });
    expect(r).toEqual({
      ok: false,
      problems: [{ path: '$.observedAt', message: 'must be an RFC 3339 date-time or null' }],
    });
  });

  it('what the adapter writes, the capture parser reads back unchanged', () => {
    const c = measured(
      densityTestSnapshot({
        elements: [
          {
            id: 'app.header.role',
            text: 'Buyer',
            category: 'interactive',
            tag: 'BUTTON',
            role: 'button',
          },
          { id: 'app.total', text: 'Total due € 12,50', href: '/orders/1', ariaExpanded: true },
          { id: 'app.secret', text: 'x', redacted: true, visible: false },
        ],
        viewport: { scrollY: 40 },
        contentDropped: 0,
      }),
      { role: 'buyer', targets: BUYER_TARGETS() }
    );
    const round = parseDensityCapture(JSON.parse(JSON.stringify(c)));
    expect(round).toEqual({ ok: true, value: c });
    expect(c.items[0].tag).toBe('button');
    expect(c.items[0].role).toBe('button');
  });
});
