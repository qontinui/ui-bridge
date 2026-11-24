/**
 * What `include_hidden: false` costs in hit-tests — plan
 * `2026-11-24-ui-bridge-find-visibility-and-fallback-label-read-the-canonical-verdicts`,
 * review round 1 (A2, A7).
 *
 * On a live node with no `state.visible` the filter's visibility arm is the
 * canonical verdict, which hit-tests up to nine sample points with
 * `document.elementFromPoint`. This counts those calls through a stub, so the
 * cost is a CI assertion rather than an env-gated timing:
 *  (a) a row a cheap predicate rejects is never hit-tested;
 *  (b) a row the arm does judge costs at most the nine-point probe;
 *  (c) a row that carries `state.visible` costs no hit-test at all.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applyCanonicalFindFilter } from './find-filter';
import { getGlobalRegistry, resetGlobalRegistry } from './registry';
import { createHandlers, type RegistryLike } from '../server/handlers';
import { createActionExecutor } from '../control/action-executor';
import { executeCommand, type BridgeAccess } from '../react/commandHandlers';

const ROWS = 40;
/** The canonical verdict's sample-point count for an element >= 48px on an axis. */
const MAX_PROBES_PER_ROW = 9;

const realElementFromPoint = document.elementFromPoint;
let hitTests = 0;
let nodes: HTMLElement[] = [];

function placeRows(): void {
  document.body.innerHTML = '';
  nodes = [];
  for (let i = 0; i < ROWS; i++) {
    const el = document.createElement('button');
    el.textContent = `Save ${i}`;
    // 100x50: wide AND tall enough for the full nine-point probe.
    const x = (i % 10) * 110;
    const y = Math.floor(i / 10) * 60;
    el.getBoundingClientRect = () =>
      ({
        x,
        y,
        width: 100,
        height: 50,
        top: y,
        left: x,
        right: x + 100,
        bottom: y + 50,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(el);
    nodes.push(el);
  }
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 720, configurable: true });
  hitTests = 0;
  document.elementFromPoint = ((px: number, py: number) => {
    hitTests++;
    // Each node paints its own box, so every probe lands on the node itself.
    return (
      nodes.find((n) => {
        const r = n.getBoundingClientRect();
        return px >= r.left && px < r.right && py >= r.top && py < r.bottom;
      }) ?? null
    );
  }) as typeof document.elementFromPoint;
  placeRows();
});

afterEach(() => {
  document.elementFromPoint = realElementFromPoint;
  document.body.innerHTML = '';
});

const liveRows = () => nodes.map((element, i) => ({ id: `row-${i}`, label: `Save ${i}`, element }));

describe('include_hidden:false hit-test cost', () => {
  it('a row a cheap predicate rejects is never hit-tested', () => {
    expect(
      applyCanonicalFindFilter(liveRows(), { include_hidden: false, text: 'no such text' })
    ).toEqual([]);
    expect(applyCanonicalFindFilter(liveRows(), { include_hidden: false, testId: 'nope' })).toEqual(
      []
    );
    expect(hitTests).toBe(0);
  });

  it('only the rows the cheap predicates keep are hit-tested', () => {
    const kept = applyCanonicalFindFilter(liveRows(), { include_hidden: false, text: 'save 7' });
    expect(kept.map((r) => r.id)).toEqual(['row-7']);
    expect(hitTests).toBeGreaterThan(0);
    expect(hitTests).toBeLessThanOrEqual(MAX_PROBES_PER_ROW);
  });

  it('a live-node row costs at most the nine-point probe', () => {
    const kept = applyCanonicalFindFilter(liveRows(), { include_hidden: false });
    expect(kept).toHaveLength(ROWS);
    expect(hitTests).toBeGreaterThan(0);
    expect(hitTests).toBeLessThanOrEqual(ROWS * MAX_PROBES_PER_ROW);
  });

  it('a row that carries state.visible costs no hit-test', () => {
    const rows = liveRows().map((row) => ({ ...row, state: { visible: true } }));
    expect(applyCanonicalFindFilter(rows, { include_hidden: false })).toHaveLength(ROWS);
    expect(hitTests).toBe(0);
  });
});

/**
 * A registry row's state is read ONCE per find — review round 4, A1. The
 * visibility arm judges a registry row by `getState()`, and the arm then
 * reports that row's `state`; without reuse every kept row paid the full
 * state read (and its hit-test) twice. So a visible-only find must cost no
 * more hit-tests than an unfiltered one, through each registry arm.
 */
describe('registry arms read each kept row once', () => {
  const REGISTERED = 20;

  beforeEach(() => {
    resetGlobalRegistry();
    const registry = getGlobalRegistry();
    nodes
      .slice(0, REGISTERED)
      .forEach((el, i) =>
        registry.registerElement(`reg-${i}`, el, { type: 'button', label: `Save ${i}` })
      );
  });

  afterEach(() => {
    resetGlobalRegistry();
  });

  function registryLike(): RegistryLike {
    const reg = getGlobalRegistry();
    return {
      getAllElements: () => reg.getAllElements(),
      getElement: (id) => reg.getElement(id),
      getAllComponents: () => reg.getAllComponents(),
      getComponent: (id) => reg.getComponent(id),
      createSnapshot: () => reg.createSnapshot() as ReturnType<RegistryLike['createSnapshot']>,
    };
  }

  async function countHitTests(run: () => Promise<unknown>): Promise<number> {
    hitTests = 0;
    await run();
    return hitTests;
  }

  it('createHandlers find: include_hidden:false costs no more hit-tests than {}', async () => {
    const handlers = createHandlers(registryLike(), createActionExecutor(getGlobalRegistry()));
    const all = await countHitTests(() => handlers.find({ skipSettle: true } as never));
    const visibleOnly = await countHitTests(async () => {
      const reply = await handlers.find({ skipSettle: true, include_hidden: false } as never);
      const rows = (reply.data as unknown as { elements: unknown[] }).elements;
      expect(rows).toHaveLength(REGISTERED);
    });
    expect(all).toBeGreaterThan(0);
    expect(visibleOnly).toBeLessThanOrEqual(all);
  });

  it('React find command: includeHidden:false costs no more hit-tests than {}', async () => {
    const bridge: BridgeAccess = {
      elements: [],
      getElement: () => undefined,
      components: [],
      workflows: [],
    };
    const all = await countHitTests(() => executeCommand('find', {}, bridge));
    const visibleOnly = await countHitTests(async () => {
      const reply = (await executeCommand('find', { includeHidden: false }, bridge)) as {
        elements: unknown[];
      };
      expect(reply.elements).toHaveLength(REGISTERED);
    });
    expect(all).toBeGreaterThan(0);
    expect(visibleOnly).toBeLessThanOrEqual(all);
  });
});
