/**
 * jsdom unit tests for the forced pseudo-state primitive: the selector
 * rewrite grammar and the hold bookkeeping (in-place selector rewrite and
 * restore, chain marking, one-hold-at-a-time, TTL, `releaseAfter`).
 *
 * jsdom has no `:hover`, no CSS nesting, no `@layer` and no transitions, so
 * whether the rewritten selectors make a real browser DRAW the hovered state is proven in
 * `forced-hover.smoke.test.ts` (real Chromium). jsdom does cascade plain
 * top-level rules in `getComputedStyle`, which is enough to check the
 * bookkeeping against computed style here.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  forcePseudoState,
  getForcedPseudoState,
  releaseAfter,
  releaseForcedPseudoState,
  releaseForcedPseudoStateIfOwner,
  releasesForcedPseudoState,
  reapplyIfIdle,
  snapshotForcedPseudoState,
  FORCED_PSEUDO_STATE_VERSION,
  rewritePseudoSelector,
  selectorHasPseudo,
  composedAncestry,
  revealSourceOf,
  RESCAN_TIMEOUT_MS,
  __resetForcedPseudoStateForTest,
  type ForcedPseudoElementSource,
} from './forced-hover';

const ATTR = 'data-ui-bridge-pseudo-hover';
/** What every forceable `:hover` becomes. */
const H = `:is(:hover,[${ATTR}])`;

describe('rewritePseudoSelector — the rewrite grammar', () => {
  const table: Array<[string, string | null]> = [
    ['.a:hover', `.a${H}`],
    ['.a:hover .b', `.a${H} .b`],
    ['.x:is(:where(.group):hover *)', `.x:is(:where(.group)${H} *)`],
    ['&:hover', `&${H}`],
    ['.c:not(:hover)', `.c:not(${H})`],
    ['.a:has(.b:hover)', `.a:has(.b${H})`],
    [':host(:hover) .x', `:host(${H}) .x`],
    ['.a:hover, .b:hover::after', `.a${H}, .b${H}::after`],
    // Escaped colons are class-name characters, never the pseudo-class.
    [String.raw`.hover\:bg-x:hover`, String.raw`.hover\:bg-x` + H],
    [String.raw`.\[\&\:hover\]\:underline:hover`, String.raw`.\[\&\:hover\]\:underline` + H],
    [String.raw`.hover\:only-a-name`, String.raw`.hover\:only-a-name`],
    // Not the pseudo-class at all.
    ['.a:hover-intent', '.a:hover-intent'],
    ['.a:hovered', '.a:hovered'],
    ['.a:focus', '.a:focus'],
    // Scoped to a pseudo-element: cannot take an :is(), nothing to force.
    ['::-webkit-scrollbar-thumb:hover', null],
    ['.x::part(thumb):hover', null],
    ['::slotted(.y):hover', null],
    // ...but a sibling compound in the same selector list still is forceable.
    ['.a:hover, ::-webkit-scrollbar-thumb:hover', `.a${H}, ::-webkit-scrollbar-thumb:hover`],
    ['.a:hover::-webkit-scrollbar-thumb', `.a${H}::-webkit-scrollbar-thumb`],
  ];
  for (const [input, output] of table) {
    it(`${input} -> ${output}`, () => {
      expect(rewritePseudoSelector(input, 'hover')).toBe(output);
      expect(selectorHasPseudo(input, 'hover')).toBe(input !== output);
    });
  }

  it(':active rewrites to its own attribute and leaves :hover alone', () => {
    expect(rewritePseudoSelector('.a:active:hover', 'active')).toBe(
      '.a:is(:active,[data-ui-bridge-pseudo-active]):hover'
    );
  });

  it('is stateless across calls (a global regex lastIndex never leaks)', () => {
    for (let i = 0; i < 3; i++) expect(selectorHasPseudo('.a:hover', 'hover')).toBe(true);
  });
});

describe('releasesForcedPseudoState — the effect class decides', () => {
  it('write-class verbs release; read-class and unknown verbs keep the hold', () => {
    for (const a of ['click', 'type', 'hoverClick', 'sendKeys', 'drag', 'submit']) {
      expect(releasesForcedPseudoState(a)).toBe(true);
    }
    for (const a of [
      'hover',
      'unhover',
      'scroll',
      'scrollIntoView',
      'focus',
      'blur',
      'rightClick',
      'myCustomVerb',
    ]) {
      expect(releasesForcedPseudoState(a)).toBe(false);
    }
  });
});

describe('forcePseudoState — bookkeeping (jsdom)', () => {
  let style: HTMLStyleElement | null = null;
  let root: HTMLDivElement | null = null;

  function setup(css: string): { group: HTMLElement; header: HTMLElement; tool: HTMLElement } {
    style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    root = document.createElement('div');
    root.innerHTML = `<div class="group" id="g"><span id="header">h</span><button id="tool" class="tool">t</button></div>`;
    document.body.appendChild(root);
    return {
      group: document.getElementById('g')!,
      header: document.getElementById('header')!,
      tool: document.getElementById('tool')!,
    };
  }

  const registry = {
    getAllElements: () =>
      ['header', 'tool'].map((id) => ({ id, element: document.getElementById(id) })),
  };

  afterEach(async () => {
    vi.useRealTimers();
    await __resetForcedPseudoStateForTest();
    style?.remove();
    root?.remove();
    style = null;
    root = null;
  });

  const sheetText = (): string =>
    Array.from((style!.sheet as CSSStyleSheet).cssRules)
      .map((r) => r.cssText)
      .join('\n');

  it('rewrites the :hover rule in place, marks the target and every ancestor, and reveals the group-hover child', async () => {
    const { group, header, tool } = setup(
      `.tool { pointer-events: none; } .group:hover .tool { pointer-events: auto; } .other { color: red; }`
    );
    expect(getComputedStyle(tool).pointerEvents).toBe('none');

    const report = await forcePseudoState(header, 'hover', { registry });

    expect(report.rulesRewritten).toBe(1);
    expect(report.unreadableSheets).toBe(0);
    expect(report.settled).toBe('frame-only');
    expect(report.complete).toBe(true);
    const rules = Array.from((style!.sheet as CSSStyleSheet).cssRules).map(
      (r) => (r as CSSStyleRule).selectorText
    );
    // In place: no rule inserted, nothing shifted.
    expect(rules).toEqual(['.tool', `.group${H} .tool`, '.other']);
    // Ancestor marking is what makes the group rule fire.
    for (const el of [header, group, document.body, document.documentElement]) {
      expect(el.hasAttribute(ATTR)).toBe(true);
    }
    expect(report.markedElements).toBe(composedAncestry(header).length);
    expect(getComputedStyle(tool).pointerEvents).toBe('auto');
    expect(report.revealed).toEqual([
      expect.objectContaining({
        id: 'tool',
        appeared: false,
        changes: [{ property: 'pointer-events', before: 'none', after: 'auto' }],
      }),
    ]);
    expect(getForcedPseudoState()).toMatchObject({ state: 'hover', target: 'span#header' });

    const release = await releaseForcedPseudoState('explicit');
    expect(release).toMatchObject({
      released: true,
      reason: 'explicit',
      rulesRestored: 1,
      rulesAlreadyGone: 0,
      restore: 'verified',
      drift: [],
    });
    expect(sheetText()).not.toContain(ATTR);
    expect(((style!.sheet as CSSStyleSheet).cssRules[1] as CSSStyleRule).selectorText).toBe(
      '.group:hover .tool'
    );
    expect(document.querySelectorAll(`[${ATTR}]`)).toHaveLength(0);
    expect(getComputedStyle(tool).pointerEvents).toBe('none');
    expect(getForcedPseudoState()).toBeNull();
  });

  it('never changes a sheet rule count or indices: an app inserting by index during the hold is unaffected', async () => {
    const { header } = setup(`.a { color: red; } .group:hover .tool { color: blue; }`);
    const sheet = style!.sheet as CSSStyleSheet;
    await forcePseudoState(header, 'hover');
    expect(sheet.cssRules).toHaveLength(2);
    sheet.insertRule('.inserted-first { color: green; }', 0);
    const release = await releaseForcedPseudoState();
    expect(release.rulesRestored).toBe(1);
    expect(sheetText()).not.toContain(ATTR);
    expect(Array.from(sheet.cssRules).map((r) => (r as CSSStyleRule).selectorText)).toEqual([
      '.inserted-first',
      '.a',
      '.group:hover .tool',
    ]);
  });

  it('a rewritten rule the app deleted during the hold is counted as already gone, not as an error', async () => {
    const { header } = setup(`.group:hover .tool { color: blue; }`);
    await forcePseudoState(header, 'hover');
    (style!.sheet as CSSStyleSheet).deleteRule(0);
    const release = await releaseForcedPseudoState();
    expect(release).toMatchObject({ released: true, rulesRestored: 0, rulesAlreadyGone: 1 });
  });

  it('a selector the app changed during the hold is left as the app set it and reported as drift', async () => {
    const { header } = setup(`.group:hover .tool { color: blue; }`);
    await forcePseudoState(header, 'hover');
    const rule = (style!.sheet as CSSStyleSheet).cssRules[0] as CSSStyleRule;
    rule.selectorText = '.app-changed';
    const release = await releaseForcedPseudoState();
    expect(release.restore).toBe('restored_with_drift');
    expect(release.selectorDrift).toEqual([
      { selector: '.app-changed', original: '.group:hover .tool' },
    ]);
    expect(rule.selectorText).toBe('.app-changed');
  });

  it('a pseudo-element-scoped :hover is not applicable, and does not make the reveal incomplete', async () => {
    const { header } = setup(
      `::-webkit-scrollbar-thumb:hover { color: red; } .group:hover .tool { color: blue; }`
    );
    const report = await forcePseudoState(header, 'hover');
    expect(report).toMatchObject({
      rulesRewritten: 1,
      rulesNotApplicable: 1,
      rulesFailed: 0,
      complete: true,
    });
  });

  it('a scan that throws part-way restores every selector it already rewrote', async () => {
    const { header } = setup(`.group:hover .tool { color: blue; } .b:hover { color: red; }`);
    const rules = (style!.sheet as CSSStyleSheet).cssRules;
    const second = rules[1] as CSSStyleRule;
    Object.defineProperty(second, 'selectorText', {
      configurable: true,
      get: () => '.b:hover',
      set: () => {
        throw new Error('setter blew up');
      },
    });
    await expect(forcePseudoState(header, 'hover')).rejects.toThrow('setter blew up');
    expect((rules[0] as CSSStyleRule).selectorText).toBe('.group:hover .tool');
    expect(getForcedPseudoState()).toBeNull();
  });

  it('sends the leave events a real pointer would on release', async () => {
    const { group, header } = setup(`.group:hover .tool { color: blue; }`);
    const seen: string[] = [];
    group.addEventListener('mouseleave', () => seen.push('group:mouseleave'));
    group.addEventListener('pointerleave', () => seen.push('group:pointerleave'));
    group.addEventListener('mouseout', () => seen.push('group:mouseout(bubbled)'));
    await forcePseudoState(header, 'hover');
    expect(seen).toEqual([]);
    await releaseForcedPseudoState();
    expect(seen).toEqual(['group:mouseout(bubbled)', 'group:pointerleave', 'group:mouseleave']);
  });

  it('one hold at a time: a second apply releases the first and reports it', async () => {
    const { header, tool } = setup(`.group:hover .tool { color: blue; }`);
    await forcePseudoState(header, 'hover');
    const second = await forcePseudoState(tool, 'hover');
    expect(second.replaced).toMatchObject({ released: true, reason: 'replaced', rulesRestored: 1 });
    expect(second.rulesRewritten).toBe(1);
    expect(header.hasAttribute(ATTR)).toBe(false);
    expect(tool.hasAttribute(ATTR)).toBe(true);
    // Rewritten once, never twice.
    expect(sheetText().split(ATTR).length - 1).toBe(1);
  });

  it('release with nothing held is a safe no-op, every time', async () => {
    for (let i = 0; i < 2; i++) {
      expect(await releaseForcedPseudoState()).toEqual({
        released: false,
        reason: 'explicit',
        rulesRestored: 0,
        rulesAlreadyGone: 0,
        selectorDrift: [],
        unmarkedElements: 0,
        restore: 'nothing_held',
        drift: [],
        checked: [],
      });
    }
  });

  it('the TTL releases the hold by itself; holdMs is clamped to the ceiling', async () => {
    const { header } = setup(`.group:hover .tool { color: blue; }`);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const applying = forcePseudoState(header, 'hover', { holdMs: 1_000 });
    await vi.advanceTimersByTimeAsync(10);
    const report = await applying;
    expect(report.holdMs).toBe(1_000);
    expect(getForcedPseudoState()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1_100);
    expect(getForcedPseudoState()).toBeNull();
    expect(document.querySelectorAll(`[${ATTR}]`)).toHaveLength(0);
    vi.useRealTimers();

    const clamped = await forcePseudoState(header, 'hover', { holdMs: 10_000_000 });
    expect(clamped.holdMs).toBe(300_000);
    const defaulted = await forcePseudoState(header, 'hover', { holdMs: -5 });
    expect(defaulted.holdMs).toBe(30_000);
  });

  it('a stale TTL from a replaced hold never releases its successor', async () => {
    const { header, tool } = setup(`.group:hover .tool { color: blue; }`);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const first = forcePseudoState(header, 'hover', { holdMs: 500 });
    await vi.advanceTimersByTimeAsync(10);
    await first;
    const second = forcePseudoState(tool, 'hover', { holdMs: 60_000 });
    await vi.advanceTimersByTimeAsync(10);
    await second;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(getForcedPseudoState()).toMatchObject({ target: 'button#tool' });
  });

  it('a restore whose page changed during the hold is restored_with_drift, naming the element', async () => {
    const { header, tool } = setup(
      `.tool { pointer-events: none; } .group:hover .tool { pointer-events: auto; }`
    );
    await forcePseudoState(header, 'hover', { registry });
    tool.style.pointerEvents = 'auto';
    const release = await releaseForcedPseudoState();
    expect(release.restore).toBe('restored_with_drift');
    expect(release.drift).toEqual([
      { id: 'tool', property: 'pointer-events', before: 'none', after: 'auto' },
    ]);
  });

  it('a :hover rule nested in @media is rewritten inside the @media block', async () => {
    const { header, tool } = setup(
      `.tool { pointer-events: none; } @media screen { .group:hover .tool { pointer-events: auto; } }`
    );
    const report = await forcePseudoState(header, 'hover');
    expect(report.rulesRewritten).toBe(1);
    const media = (style!.sheet as CSSStyleSheet).cssRules[1] as CSSMediaRule;
    expect(Array.from(media.cssRules).map((r) => (r as CSSStyleRule).selectorText)).toEqual([
      `.group${H} .tool`,
    ]);
    expect(getComputedStyle(tool).pointerEvents).toBe('auto');
  });
});

describe('the hold is one per page, not one per bundle', () => {
  afterEach(async () => {
    await __resetForcedPseudoStateForTest();
  });

  const KEY = Symbol.for(`ui-bridge.forcedPseudo@v${FORCED_PSEUDO_STATE_VERSION}`);

  it('lives on globalThis under the versioned Symbol.for key, so a second copy of the module shares it', async () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    try {
      await forcePseudoState(el, 'hover');
      const shared = (globalThis as unknown as Record<symbol, { hold: unknown }>)[KEY];
      expect(shared.hold).not.toBeNull();
      // A separately bundled entry point is a second evaluation of this module.
      vi.resetModules();
      const second = await import('./forced-hover');
      expect(second.getForcedPseudoState()).toMatchObject({ target: 'span' });
      const released = await second.releaseForcedPseudoState();
      expect(released.released).toBe(true);
      expect(getForcedPseudoState()).toBeNull();
    } finally {
      el.remove();
    }
  });

  it('an older copy of the SDK on the page never sees this state, nor this copy its', async () => {
    const host = globalThis as unknown as Record<symbol, unknown>;
    const olderKeys = [
      Symbol.for('ui-bridge.forcedPseudo'),
      Symbol.for('ui-bridge.forcedPseudo@v3'),
      Symbol.for('ui-bridge.forcedPseudo@v4'),
    ];
    const saved = olderKeys.map((k) => host[k]);
    const older = olderKeys.map(() => ({ version: 3, hold: 'older-shape' }));
    olderKeys.forEach((k, i) => (host[k] = older[i]));
    const el = document.createElement('span');
    document.body.appendChild(el);
    try {
      await forcePseudoState(el, 'hover');
      expect(older.map((o) => o.hold)).toEqual(['older-shape', 'older-shape', 'older-shape']);
      expect((host[KEY] as { hold: unknown }).hold).not.toBeNull();
      expect((await releaseForcedPseudoState()).released).toBe(true);
    } finally {
      olderKeys.forEach((k, i) => {
        if (saved[i] === undefined) delete host[k];
        else host[k] = saved[i];
      });
      el.remove();
    }
  });

  it('reapplyIfIdle: a pointer someone else moved since the snapshot is never overridden', async () => {
    const a = document.createElement('span');
    const b = document.createElement('i');
    document.body.append(a, b);
    try {
      await forcePseudoState(a, 'hover', { holdMs: 60_000 });
      const snap = snapshotForcedPseudoState()!;
      // Another caller hovers b and then releases it: the pointer is idle
      // again, but it is not the pointer the snapshot describes.
      await forcePseudoState(b, 'hover');
      await releaseForcedPseudoState();
      expect(getForcedPseudoState()).toBeNull();
      expect(await reapplyIfIdle(snap)).toBeNull();
      expect(getForcedPseudoState()).toBeNull();
    } finally {
      a.remove();
      b.remove();
    }
  });

  it('reapplyIfIdle: a borrower gets the snapshot back, with its original deadline and JS half', async () => {
    const a = document.createElement('span');
    const b = document.createElement('i');
    document.body.append(a, b);
    try {
      let replays = 0;
      await forcePseudoState(a, 'hover', { holdMs: 60_000, afterMark: () => (replays += 1) });
      const snap = snapshotForcedPseudoState()!;
      expect(snap).toMatchObject({ target: a, state: 'hover' });
      // Borrow: suspend the agent's hold, use the pointer, give it back.
      await releaseForcedPseudoStateIfOwner(snap.holdId, 'replaced', { borrowedFrom: snap });
      const own = await forcePseudoState(b, 'hover', { borrowedFrom: snap });
      await releaseForcedPseudoStateIfOwner(own.holdId);
      const back = await reapplyIfIdle(snap);
      expect(back).not.toBeNull();
      expect(getForcedPseudoState()).toMatchObject({ target: 'span' });
      expect(Math.abs(back!.expiresAt - snap.expiresAt)).toBeLessThanOrEqual(5);
      expect(replays).toBe(2);
    } finally {
      a.remove();
      b.remove();
    }
  });

  it('reapplyIfIdle: a snapshot whose deadline has passed is not re-applied', async () => {
    const a = document.createElement('span');
    document.body.append(a);
    try {
      await forcePseudoState(a, 'hover', { holdMs: 60_000 });
      const snap = snapshotForcedPseudoState()!;
      await releaseForcedPseudoStateIfOwner(snap.holdId, 'replaced', { borrowedFrom: snap });
      expect(await reapplyIfIdle({ ...snap, expiresAt: Date.now() + 1 })).toBeNull();
      expect(await reapplyIfIdle({ ...snap, expiresAt: Date.now() - 10 })).toBeNull();
      expect(getForcedPseudoState()).toBeNull();
    } finally {
      a.remove();
    }
  });

  it('releaseForcedPseudoStateIfOwner releases only the hold it names', async () => {
    const a = document.createElement('span');
    const b = document.createElement('i');
    document.body.append(a, b);
    try {
      const first = await forcePseudoState(a, 'hover');
      const second = await forcePseudoState(b, 'hover');
      expect((await releaseForcedPseudoStateIfOwner(first.holdId)).released).toBe(false);
      expect(getForcedPseudoState()).toMatchObject({ holdId: second.holdId });
      expect((await releaseForcedPseudoStateIfOwner(second.holdId)).released).toBe(true);
    } finally {
      a.remove();
      b.remove();
    }
  });
});

describe('releaseAfter — which dispatches release the hold', () => {
  let root: HTMLDivElement | null = null;
  afterEach(async () => {
    await __resetForcedPseudoStateForTest();
    root?.remove();
    root = null;
  });

  async function held(): Promise<void> {
    root = document.createElement('div');
    root.innerHTML = `<span id="t">t</span>`;
    document.body.appendChild(root);
    await forcePseudoState(document.getElementById('t')!, 'hover');
  }

  it('a write-class action releases after it completes and reports the release', async () => {
    await held();
    let during: unknown = 'unset';
    const onRelease = vi.fn();
    const out = await releaseAfter(
      'click',
      () => {
        during = getForcedPseudoState();
        return 42;
      },
      { onRelease }
    );
    expect(out).toBe(42);
    expect(during).not.toBeNull(); // held while the click ran
    expect(getForcedPseudoState()).toBeNull();
    expect(onRelease).toHaveBeenCalledWith(
      expect.objectContaining({ released: true, reason: 'next-action' })
    );
  });

  it('a write-class action that threw after dispatch still releases', async () => {
    await held();
    await expect(
      releaseAfter('type', () => {
        throw new Error('handler blew up');
      })
    ).rejects.toThrow('handler blew up');
    expect(getForcedPseudoState()).toBeNull();
  });

  it('a refusal classified as not-dispatched keeps the hold', async () => {
    await held();
    class Refused extends Error {}
    await expect(
      releaseAfter(
        'click',
        () => {
          throw new Refused('pointer-events:none');
        },
        { notDispatched: (e) => e instanceof Refused }
      )
    ).rejects.toThrow();
    expect(getForcedPseudoState()).not.toBeNull();
  });

  it('read-class actions keep the hold', async () => {
    await held();
    for (const a of ['scroll', 'scrollIntoView', 'focus', 'blur', 'hover']) {
      await releaseAfter(a, () => undefined);
    }
    expect(getForcedPseudoState()).not.toBeNull();
  });

  it('a dispatch that was never reached (dispatched() false) keeps the hold', async () => {
    await held();
    await releaseAfter('click', () => undefined, { dispatched: () => false });
    expect(getForcedPseudoState()).not.toBeNull();
    await releaseAfter('click', () => undefined, { dispatched: () => true });
    expect(getForcedPseudoState()).toBeNull();
  });

  it('with nothing held, a write action reports no release', async () => {
    const onRelease = vi.fn();
    await releaseAfter('click', () => undefined, { onRelease });
    expect(onRelease).not.toHaveBeenCalled();
  });
});

describe('forcePseudoState — the discovery rescan (Phase 5a, jsdom)', () => {
  let style: HTMLStyleElement | null = null;
  let root: HTMLDivElement | null = null;

  // `.late` is an own-`opacity-0 group-hover:opacity-100` control: hidden by its
  // OWN style at rest, so discovery never admits it until the hover is forced.
  // `.ghost` never draws. `#rest` draws at rest but is not registered.
  function setup(): void {
    style = document.createElement('style');
    style.textContent = `.late { opacity: 0; } .group:hover .late { opacity: 1; } .ghost { opacity: 0; }`;
    document.head.appendChild(style);
    root = document.createElement('div');
    root.innerHTML = `<div class="group" id="g"><span id="header">h</span><button id="late" class="late">l</button><button id="ghost" class="ghost">g</button><button id="rest">r</button></div>`;
    document.body.appendChild(root);
  }

  const el = (id: string): HTMLElement => document.getElementById(id)!;
  const draws = (e: Element): boolean => {
    const cs = getComputedStyle(e);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) !== 0;
  };

  /**
   * A registry whose discovery is modelled on `useAutoRegister`: every `rescan`
   * registers each candidate that draws right now. `log` records every read and
   * every rescan, in order.
   */
  function discovery(candidates: string[], initial: string[] = ['header']) {
    const registered = new Map<string, Element>(initial.map((id) => [id, el(id)]));
    const log: string[] = [];
    const source: ForcedPseudoElementSource = {
      getAllElements: () => {
        log.push('getAllElements');
        return Array.from(registered, ([id, element]) => ({ id, element }));
      },
      rescan: () => {
        log.push('rescan');
        for (const id of candidates) {
          if (!registered.has(id) && draws(el(id))) registered.set(id, el(id));
        }
        return { rescanners: 1 };
      },
    };
    return { registered, log, source };
  }

  afterEach(async () => {
    await __resetForcedPseudoStateForTest();
    style?.remove();
    root?.remove();
    style = null;
    root = null;
  });

  it('rescans once before the `before` snapshot and once after the settle, and never on release', async () => {
    setup();
    const d = discovery(['late']);
    await forcePseudoState(el('header'), 'hover', {
      registry: d.source,
      afterMark: () => {
        d.log.push('afterMark');
        // Fires during the settle's frame wait: the second rescan must come after it.
        setTimeout(() => d.log.push('settle-tick'), 0);
      },
    });
    expect(d.log).toEqual([
      'rescan',
      'getAllElements',
      'afterMark',
      'settle-tick',
      'rescan',
      'getAllElements',
    ]);
    await releaseForcedPseudoState();
    expect(d.log.filter((e) => e === 'rescan')).toHaveLength(2);
  });

  it('an element the post-settle rescan registers is revealed with appeared: true; a non-drawing one is dropped', async () => {
    setup();
    const registered = new Map<string, Element>([['header', el('header')]]);
    let calls = 0;
    const report = await forcePseudoState(el('header'), 'hover', {
      registry: {
        getAllElements: () => Array.from(registered, ([id, element]) => ({ id, element })),
        rescan: () => {
          calls += 1;
          // The post-settle call: a discovery that admits hidden elements too
          // (`persistWhileMounted`) registers both.
          if (calls === 2) {
            registered.set('late', el('late'));
            registered.set('ghost', el('ghost'));
          }
          return { rescanners: 1 };
        },
      },
    });
    expect(report.revealed).toEqual([
      expect.objectContaining({
        id: 'late',
        appeared: true,
        changes: expect.arrayContaining([{ property: 'opacity', before: null, after: '1' }]),
      }),
    ]);
    expect(report).toMatchObject({ rescanners: 1, revealedComplete: true });
    expect(report.revealedIncompleteReason).toBeUndefined();
    expect(Number.isFinite(report.rescanMs)).toBe(true);
    expect(report.rescanMs).toBeGreaterThanOrEqual(0);
  });

  it('an element that draws at rest but was never registered is NOT reported as revealed (the baseline rescan)', async () => {
    setup();
    const d = discovery(['rest', 'late']);
    const report = await forcePseudoState(el('header'), 'hover', { registry: d.source });
    // `#rest` was registered by the baseline call, so it is in `before` and
    // unchanged. Only the control the hover revealed is reported.
    expect(report.revealed.map((r) => r.id)).toEqual(['late']);
    expect(report.revealed[0].appeared).toBe(true);
    expect(d.registered.has('rest')).toBe(true);
    const release = await releaseForcedPseudoState();
    expect(release.restore).toBe('verified');
    expect(release.drift).toEqual([]);
  });

  it('release verifies an appeared element: it passes once it stops drawing, and `checked` names it', async () => {
    setup();
    const d = discovery(['late']);
    await forcePseudoState(el('header'), 'hover', { registry: d.source });
    const release = await releaseForcedPseudoState('explicit');
    expect(release.restore).toBe('verified');
    expect(release.checked).toEqual(
      expect.arrayContaining([
        { id: 'late', appeared: true, verdict: 'pass' },
        { id: 'header', appeared: false, verdict: 'pass' },
      ])
    );
    // It stays registered: a later hover reports it with real before values.
    expect(d.registered.has('late')).toBe(true);
    const again = await forcePseudoState(el('header'), 'hover', { registry: d.source });
    expect(again.revealed).toEqual([
      expect.objectContaining({
        id: 'late',
        appeared: false,
        changes: [{ property: 'opacity', before: '0', after: '1' }],
      }),
    ]);
  });

  it('an appeared element that still draws after release is restored_with_drift, with checked verdict drift', async () => {
    setup();
    const d = discovery(['late']);
    await forcePseudoState(el('header'), 'hover', { registry: d.source });
    // The app pins it visible during the hold; jsdom has no layout, so give it a box.
    const late = el('late');
    late.style.opacity = '1';
    late.getBoundingClientRect = () => new DOMRect(0, 0, 40, 20);
    const release = await releaseForcedPseudoState('explicit');
    expect(release.restore).toBe('restored_with_drift');
    expect(release.checked).toEqual(
      expect.arrayContaining([{ id: 'late', appeared: true, verdict: 'drift' }])
    );
    expect(release.drift).toEqual(
      expect.arrayContaining([{ id: 'late', property: 'opacity', before: null, after: '1' }])
    );
  });

  it('an appeared element unmounted during the hold is disconnected, which still verifies', async () => {
    setup();
    const d = discovery(['late']);
    await forcePseudoState(el('header'), 'hover', { registry: d.source });
    el('late').remove();
    const release = await releaseForcedPseudoState('explicit');
    expect(release.restore).toBe('verified');
    expect(release.checked).toEqual(
      expect.arrayContaining([{ id: 'late', appeared: true, verdict: 'disconnected' }])
    );
  });

  it('a throwing rescan makes revealed incomplete (rescan-threw) and never fails the hover', async () => {
    setup();
    const registered = [{ id: 'header', element: el('header') }];
    const report = await forcePseudoState(el('header'), 'hover', {
      registry: {
        getAllElements: () => registered,
        rescan: () => {
          throw new Error('discovery blew up');
        },
      },
    });
    expect(report.rulesRewritten).toBe(1);
    expect(report).toMatchObject({
      rescanners: 0,
      revealedComplete: false,
      revealedIncompleteReason: 'rescan-threw',
    });
  });

  it('a rejecting rescan, or one that fails only after the settle, is rescan-threw too', async () => {
    setup();
    const rejecting = await forcePseudoState(el('header'), 'hover', {
      registry: {
        getAllElements: () => [],
        rescan: () => Promise.reject(new Error('async blew up')),
      },
    });
    expect(rejecting).toMatchObject({
      revealedComplete: false,
      revealedIncompleteReason: 'rescan-threw',
    });
    let calls = 0;
    const late = await forcePseudoState(el('header'), 'hover', {
      registry: {
        getAllElements: () => [],
        rescan: () => {
          calls += 1;
          if (calls === 2) throw new Error('post-settle blew up');
          return { rescanners: 1 };
        },
      },
    });
    // The baseline call's count is what is known.
    expect(late).toMatchObject({
      rescanners: 1,
      revealedComplete: false,
      revealedIncompleteReason: 'rescan-threw',
    });
  });

  it('a hanging rescan is bounded and reported as rescan-timeout', async () => {
    setup();
    const started = Date.now();
    const report = await forcePseudoState(el('header'), 'hover', {
      registry: {
        getAllElements: () => [{ id: 'header', element: el('header') }],
        rescan: () => new Promise<{ rescanners: number }>(() => undefined),
      },
    });
    const elapsed = Date.now() - started;
    expect(report).toMatchObject({
      revealedComplete: false,
      revealedIncompleteReason: 'rescan-timeout',
    });
    // Two bounded calls, not an unbounded wait.
    expect(elapsed).toBeGreaterThanOrEqual(2 * RESCAN_TIMEOUT_MS - 20);
    expect(elapsed).toBeLessThan(2 * RESCAN_TIMEOUT_MS + 1_000);
    expect(getForcedPseudoState()).not.toBeNull();
  });

  it('a rescan whose SYNCHRONOUS scan overruns the budget is rescan-timeout, though its registrations landed', async () => {
    setup();
    const registered = new Map<string, Element>([['header', el('header')]]);
    let calls = 0;
    const report = await forcePseudoState(el('header'), 'hover', {
      registry: {
        getAllElements: () => Array.from(registered, ([id, element]) => ({ id, element })),
        // The shape of `UIBridgeRegistry.requestDiscoveryRescan`: all the work
        // is synchronous and the promise is already settled when it returns.
        rescan: () => {
          calls += 1;
          if (calls === 2) {
            const end = performance.now() + RESCAN_TIMEOUT_MS + 50;
            while (performance.now() < end) {
              // a slow synchronous scan
            }
            registered.set('late', el('late'));
          }
          return Promise.resolve({ rescanners: 1 });
        },
      },
    });
    expect(report).toMatchObject({
      rescanners: 1,
      revealedComplete: false,
      revealedIncompleteReason: 'rescan-timeout',
    });
    expect(report.rescanMs).toBeGreaterThanOrEqual(RESCAN_TIMEOUT_MS + 50);
    // Late, not lost: what it registered is still reported.
    expect(report.revealed).toEqual([expect.objectContaining({ id: 'late', appeared: true })]);
  });

  it('a baseline that ran no rescanner is never a complete reveal, even when the post-settle call ran one', async () => {
    setup();
    const d = discovery(['rest', 'late']);
    let calls = 0;
    const report = await forcePseudoState(el('header'), 'hover', {
      registry: {
        getAllElements: d.source.getAllElements,
        // No discovery installed for the baseline; one installed by the
        // post-settle call (a provider that mounted in between).
        rescan: () => {
          calls += 1;
          if (calls === 1) return { rescanners: 0 };
          return d.source.rescan!();
        },
      },
    });
    expect(report).toMatchObject({
      rescanners: 1,
      revealedComplete: false,
      revealedIncompleteReason: 'no-baseline-rescanner',
    });
    // Exactly the false `appeared` the flag exists for: `#rest` drew at rest.
    expect(report.revealed.map((r) => r.id).sort()).toEqual(['late', 'rest']);
  });

  it('after a replaced release the baseline rescan runs, so it never sees the old hold', async () => {
    setup();
    const d = discovery(['late']);
    const marks = (): number => document.querySelectorAll(`[${ATTR}]`).length;
    const source: ForcedPseudoElementSource = {
      getAllElements: d.source.getAllElements,
      rescan: () => {
        d.log.push(`rescan:marks=${marks()}`);
        return d.source.rescan!();
      },
    };
    // The replaced release sends the leave events a real pointer would.
    el('g').addEventListener('mouseleave', () => d.log.push('release:leave'));
    await forcePseudoState(el('header'), 'hover', { registry: source });
    const chain = composedAncestry(el('header')).length;
    const second = await forcePseudoState(el('header'), 'hover', { registry: source });
    expect(second.replaced).toMatchObject({ released: true, reason: 'replaced' });
    const calls = d.log.filter((e) => e !== 'getAllElements' && e !== 'rescan');
    expect(calls).toEqual([
      'rescan:marks=0',
      `rescan:marks=${chain}`,
      'release:leave',
      'rescan:marks=0',
      `rescan:marks=${chain}`,
    ]);
  });

  it('rescanners: 0 is reported as is, and never as a complete reveal', async () => {
    setup();
    const none = await forcePseudoState(el('header'), 'hover', {
      registry: { getAllElements: () => [], rescan: () => ({ rescanners: 0 }) },
    });
    expect(none).toMatchObject({
      rescanners: 0,
      revealedComplete: false,
      revealedIncompleteReason: 'no-rescanner',
    });
    // A source without `rescan` computes `revealed` exactly as before, and says
    // no discovery ran.
    const plain = await forcePseudoState(el('header'), 'hover', {
      registry: {
        getAllElements: () => [
          { id: 'header', element: el('header') },
          { id: 'late', element: el('late') },
        ],
      },
    });
    expect(plain.revealed).toEqual([
      expect.objectContaining({
        id: 'late',
        appeared: false,
        changes: [{ property: 'opacity', before: '0', after: '1' }],
      }),
    ]);
    expect(plain).toMatchObject({
      rescanners: 0,
      revealedComplete: false,
      revealedIncompleteReason: 'no-rescanner',
    });
  });

  it('revealSourceOf adapts a registry, and degrades to no rescan when the registry has none', async () => {
    let rescans = 0;
    const withRescan = revealSourceOf({
      getAllElements: () => [],
      requestDiscoveryRescan: async () => {
        rescans += 1;
        return { rescanners: 2 };
      },
    });
    expect(await withRescan.rescan!()).toEqual({ rescanners: 2 });
    expect(rescans).toBe(1);
    // A registry from an SDK copy that predates the method.
    const older = revealSourceOf({ getAllElements: () => [] });
    expect(older.rescan).toBeUndefined();
  });
});
