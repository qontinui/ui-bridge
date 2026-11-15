/**
 * `useUIElement` mirrors `customActions` into the entry it registered AT
 * COMMIT, so a custom-action call — the executor's unknown-verb gate and the
 * handler it then runs — reads the latest COMMITTED declaration and closure:
 *
 * - a handler whose closure changed under an unchanged declaration runs the
 *   NEW closure (the declaration-keyed sync this replaced kept running the old
 *   one, and reported `success: true`);
 * - an action a commit withdrew, or a dropped `customActions` option, is
 *   refused `UB-UNSUPPORTED-ACTION` and no handler runs;
 * - an action a commit added can be called straight away, and an `effect` flip
 *   to `'destructive'` is advertised at the commit that makes it;
 * - an instance whose slot-keyed id another instance took over never writes
 *   that instance's handlers, and one sharing an id with another WINDOW's
 *   element writes its own window's entry, not the default one;
 * - an id change under a non-default window keeps the entry in that window,
 *   where the mirror writes.
 *
 * Every call goes through the `DefaultActionExecutor` the REAL
 * `UIBridgeProvider` builds. Updates are applied from a resolved promise: a
 * non-discrete update, which React commits in one task and whose passive
 * effects it flushes in a later one. The call under test is made from a
 * MutationObserver callback, a microtask queued by the commit's own DOM
 * mutation, so it lands after the commit (layout effects included) and before
 * that passive flush. Each such sample also reads a passive probe and asserts
 * the flush had NOT run, so a sample that drifted out of the gap fails instead
 * of passing. `act` is never used — IS_REACT_ACT_ENVIRONMENT is false for the
 * whole file — and neither is RTL, which wraps in it: both flush passive
 * effects. Every expectation is a hand-written literal.
 */

import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import {
  UIBridgeProvider,
  useUIBridgeOptional,
  type UIBridgeContextValue,
} from '../UIBridgeProvider';
import { useUIElement } from '../useUIElement';
import { serializeElementCustomActions } from '../../core/element-actions';
import type { CustomAction } from '../../core/types';
import type { ControlActionResponse } from '../../control/types';

const g = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let savedAct: boolean | undefined;
beforeAll(() => {
  savedAct = g.IS_REACT_ACT_ENVIRONMENT;
  g.IS_REACT_ACT_ENVIRONMENT = false;
});
afterAll(() => {
  g.IS_REACT_ACT_ENVIRONMENT = savedAct;
});

// A PRECONDITION wait: `act` is off, so commits and passive flushes run on
// React's own schedule, which a fixed sleep cannot bound on a loaded box. Poll
// until the precondition holds; time out loudly if it never does. Never used
// for the property under test.
const until = (pred: () => boolean, what: string) =>
  vi.waitFor(
    () => {
      if (!pred()) throw new Error(`timed out waiting for: ${what}`);
    },
    // Under vitest's 5 s test timeout, so a precondition that never holds
    // fails with its own name rather than a generic test timeout.
    { timeout: 2000, interval: 10 }
  );

/** The real provider's context value, captured when it renders. */
let bridge: UIBridgeContextValue | null = null;
function CaptureBridge() {
  bridge = useUIBridgeOptional();
  return null;
}
function liveBridge(): UIBridgeContextValue {
  if (!bridge) throw new Error('UIBridgeProvider has not rendered');
  return bridge;
}

/** Every handler that ran, in order — appended by the handlers themselves. */
let ran: string[] = [];

/** A custom action whose handler records (and returns) `tag`. */
function action(id: string, tag: string, label = 'Act'): CustomAction {
  return {
    id,
    label,
    handler: () => {
      ran.push(tag);
      return tag;
    },
  };
}

interface TargetOptions {
  id: string;
  /** The button's text, so every new tag is a DOM mutation the sampler sees. */
  tag: string;
  customActions?: Record<string, CustomAction>;
  windowLabel?: string;
}

/** Per instance, its state setter: an update re-renders that instance alone. */
const setters = new Map<string, (next: TargetOptions) => void>();
/** Per instance, the tag of the latest commit whose PASSIVE effects have run. */
const flushed = new Map<string, string>();

function Target({ name, initial }: { name: string; initial: TargetOptions }) {
  const [options, setOptions] = useState(initial);
  useLayoutEffect(() => {
    setters.set(name, setOptions);
  }, [name]);
  const { ref } = useUIElement({
    id: options.id,
    type: 'button',
    label: name,
    customActions: options.customActions,
    windowLabel: options.windowLabel,
  });
  // The passive probe. Dep-free, so it runs in the passive flush of EVERY
  // commit of this component — the same flush as the hook's passive effects.
  useEffect(() => {
    flushed.set(name, options.tag);
  });
  return (
    <button ref={ref} data-name={name}>
      {options.tag}
    </button>
  );
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/** Render `children` under the real provider (mounting the root on first use). */
function renderApp(children: ReactNode): void {
  if (!root) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  }
  root.render(
    <UIBridgeProvider>
      <CaptureBridge />
      {children}
    </UIBridgeProvider>
  );
}

afterEach(() => {
  root?.unmount();
  container?.remove();
  root = null;
  container = null;
  bridge = null;
  ran = [];
  setters.clear();
  flushed.clear();
});

/** Re-render instance `name` with `next` from a resolved promise. */
function update(name: string, next: TargetOptions): void {
  const set = setters.get(name);
  if (!set) throw new Error(`no mounted Target named ${name}`);
  void Promise.resolve().then(() => set(next));
}

/** Apply `next` to `name` and wait until that commit's passive flush has run. */
async function commitAndFlush(name: string, next: TargetOptions): Promise<void> {
  update(name, next);
  await until(() => flushed.get(name) === next.tag, `${name} flushed ${next.tag}`);
}

interface GapSample<T> {
  value: T;
  /** The updated instance's latest passive-flushed tag, at the sample. */
  flushedAtSample: string | undefined;
}

/**
 * Apply `next` to instance `name` from a resolved promise and run `probe` in
 * the first MutationObserver callback that sees its button render `next.tag`.
 */
function sampleInGap<T>(name: string, next: TargetOptions, probe: () => T): Promise<GapSample<T>> {
  const host = container;
  const button = host?.querySelector(`[data-name="${name}"]`);
  if (!host || !button) throw new Error(`no rendered Target named ${name}`);
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (button.textContent !== next.tag) return;
      observer.disconnect();
      clearTimeout(timer);
      const flushedAtSample = flushed.get(name);
      resolve({ value: probe(), flushedAtSample });
    });
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`the commit rendering ${next.tag} was never observed`));
    }, 2000);
    observer.observe(host, { childList: true, characterData: true, subtree: true });
    update(name, next);
  });
}

interface GapCall {
  /** The custom-action names the registry entry advertised at the sample. */
  advertised: string[] | undefined;
  /** The handlers that ran during the call — inside the gap. */
  ranInGap: string[];
  /** The updated instance's latest passive-flushed tag, at the sample. */
  flushedAtSample: string | undefined;
  /** The executor's answer, awaited once the gap is over. */
  response: Promise<ControlActionResponse>;
}

/**
 * {@link sampleInGap}, calling `actionName` on `elementId` through the
 * provider's executor. The executor reaches a custom action's gate and its
 * handler synchronously (no wait options, no effect verification), so
 * `ranInGap` is what ran in the gap itself; only the response settles later.
 */
async function callInGap(
  name: string,
  next: TargetOptions,
  elementId: string,
  actionName: string
): Promise<GapCall> {
  const { value, flushedAtSample } = await sampleInGap(name, next, () => {
    const { registry, executor } = liveBridge();
    const entry = registry.getElement(elementId);
    const advertised = entry?.customActions ? Object.keys(entry.customActions) : undefined;
    const before = ran.length;
    const response = executor.executeAction(elementId, { action: actionName });
    return { advertised, ranInGap: ran.slice(before), response };
  });
  return { ...value, flushedAtSample };
}

/** The entry registered under `id` in one window (`undefined` = the default). */
function entryIn(windowLabel: string | undefined, id: string) {
  return liveBridge()
    .registry.getAllElements()
    .find((e) => e.id === id && e.windowLabel === windowLabel);
}

describe('useUIElement custom actions are the latest committed ones', () => {
  it('runs the NEW closure after a handler-only re-render', async () => {
    renderApp(
      <Target
        name="T"
        initial={{ id: 'handler-only', tag: 'r1', customActions: { act: action('act', 'r1') } }}
      />
    );
    await until(() => flushed.get('T') === 'r1', 'T mounted');
    // Settle past the keyed sync's null-to-key transition: its second render
    // always republished, so a change made there passes against the defect.
    await commitAndFlush('T', {
      id: 'handler-only',
      tag: 'r2',
      customActions: { act: action('act', 'r2') },
    });

    // Same `id`/`label`, a new closure.
    const call = await callInGap(
      'T',
      { id: 'handler-only', tag: 'r3', customActions: { act: action('act', 'r3') } },
      'handler-only',
      'act'
    );

    expect(call.flushedAtSample).toBe('r2');
    expect(call.ranInGap).toEqual(['r3']);
    const res = await call.response;
    expect(res.success).toBe(true);
    expect(res.result).toBe('r3');

    // Still the new closure once the passive flush has run.
    await until(() => flushed.get('T') === 'r3', 'T flushed r3');
    const after = await liveBridge().executor.executeAction('handler-only', { action: 'act' });
    expect(after.result).toBe('r3');
    expect(ran).toEqual(['r3', 'r3']);
  });

  it('refuses an action the commit withdrew, and runs no handler', async () => {
    const both = (tag: string) => ({
      keep: action('keep', `keep@${tag}`),
      archive: action('archive', `archive@${tag}`),
    });
    renderApp(
      <Target name="T" initial={{ id: 'withdrawn', tag: 'r1', customActions: both('r1') }} />
    );
    await until(() => flushed.get('T') === 'r1', 'T mounted');
    await commitAndFlush('T', { id: 'withdrawn', tag: 'r2', customActions: both('r2') });

    const call = await callInGap(
      'T',
      { id: 'withdrawn', tag: 'r3', customActions: { keep: action('keep', 'keep@r3') } },
      'withdrawn',
      'archive'
    );

    expect(call.flushedAtSample).toBe('r2');
    expect(call.advertised).toEqual(['keep']);
    expect(call.ranInGap).toEqual([]);
    const res = await call.response;
    expect(res.success).toBe(false);
    expect(res.failureDetails?.errorCode).toBe('UB-UNSUPPORTED-ACTION');
    expect(ran).toEqual([]);
  });

  it('withdraws every custom action when the option is dropped', async () => {
    const both = (tag: string) => ({
      keep: action('keep', `keep@${tag}`),
      archive: action('archive', `archive@${tag}`),
    });
    renderApp(
      <Target name="T" initial={{ id: 'dropped', tag: 'r1', customActions: both('r1') }} />
    );
    await until(() => flushed.get('T') === 'r1', 'T mounted');
    await commitAndFlush('T', { id: 'dropped', tag: 'r2', customActions: both('r2') });

    const call = await callInGap('T', { id: 'dropped', tag: 'r3' }, 'dropped', 'keep');

    expect(call.flushedAtSample).toBe('r2');
    expect(call.advertised).toBeUndefined();
    expect(call.ranInGap).toEqual([]);
    const keep = await call.response;
    expect(keep.success).toBe(false);
    expect(keep.failureDetails?.errorCode).toBe('UB-UNSUPPORTED-ACTION');

    // Still withdrawn once the passive flush has run: the keyed sync's
    // `updateElement` read the absent option as "keep".
    await until(() => flushed.get('T') === 'r3', 'T flushed r3');
    const archive = await liveBridge().executor.executeAction('dropped', { action: 'archive' });
    expect(archive.success).toBe(false);
    expect(archive.failureDetails?.errorCode).toBe('UB-UNSUPPORTED-ACTION');
    expect(liveBridge().registry.getElement('dropped')?.customActions).toBeUndefined();
    expect(ran).toEqual([]);
  });

  it('can call an action the commit added before the passive flush', async () => {
    renderApp(
      <Target
        name="T"
        initial={{ id: 'added', tag: 'r1', customActions: { keep: action('keep', 'keep@r1') } }}
      />
    );
    await until(() => flushed.get('T') === 'r1', 'T mounted');
    await commitAndFlush('T', {
      id: 'added',
      tag: 'r2',
      customActions: { keep: action('keep', 'keep@r2') },
    });

    const call = await callInGap(
      'T',
      {
        id: 'added',
        tag: 'r3',
        customActions: {
          keep: action('keep', 'keep@r3'),
          archive: action('archive', 'archive@r3'),
        },
      },
      'added',
      'archive'
    );

    // The sample sat in the gap: this commit's passive effects had not run.
    expect(call.flushedAtSample).toBe('r2');
    expect(call.advertised).toEqual(['keep', 'archive']);
    expect(call.ranInGap).toEqual(['archive@r3']);
    const res = await call.response;
    expect(res.success).toBe(true);
    expect(res.result).toBe('archive@r3');
  });

  it('advertises an effect flip at the commit that makes it', async () => {
    const purge = (effect: NonNullable<CustomAction['effect']>, tag: string): TargetOptions => ({
      id: 'effect-flip',
      tag,
      customActions: { purge: { ...action('purge', tag), effect } },
    });
    renderApp(<Target name="T" initial={purge('write', 'r1')} />);
    await until(() => flushed.get('T') === 'r1', 'T mounted');
    await commitAndFlush('T', purge('write', 'r2'));

    // `serializeElementCustomActions` is the one projection every surface
    // advertises custom actions through; the flip must be on it before an
    // autonomous walk can read the action as a mere `write`.
    const advertised = () =>
      serializeElementCustomActions(liveBridge().registry.getElement('effect-flip')?.customActions);
    const sample = await sampleInGap('T', purge('destructive', 'r3'), advertised);

    expect(sample.flushedAtSample).toBe('r2');
    expect(sample.value).toEqual([{ id: 'purge', label: 'Act', effect: 'destructive' }]);
    await until(() => flushed.get('T') === 'r3', 'T flushed r3');
    expect(advertised()).toEqual([{ id: 'purge', label: 'Act', effect: 'destructive' }]);
  });

  it('a second instance holding the same slot id keeps its own handlers', async () => {
    const a1: TargetOptions = {
      id: 'slot',
      tag: 'a1',
      customActions: { act: action('act', 'A@a1') },
    };
    const b1: TargetOptions = {
      id: 'slot',
      tag: 'b1',
      customActions: { act: action('act', 'B@b1', 'Act (B)') },
    };
    renderApp(<Target key="A" name="A" initial={a1} />);
    await until(() => flushed.get('A') === 'a1', 'A mounted');

    // B mounts into the same slot and takes the id over (last write wins).
    renderApp(
      <>
        <Target key="A" name="A" initial={a1} />
        <Target key="B" name="B" initial={b1} />
      </>
    );
    await until(() => flushed.get('B') === 'b1', 'B mounted');
    const nodeB = container?.querySelector('[data-name="B"]');
    expect(liveBridge().registry.getElement('slot')?.element).toBe(nodeB);

    // A commits a new declaration AND a new closure, re-rendering alone. B
    // owns the entry now, so neither A's commit nor its passive flush may
    // write B's handlers.
    const call = await callInGap(
      'A',
      { id: 'slot', tag: 'a2', customActions: { act: action('act', 'A@a2', 'Act (A, v2)') } },
      'slot',
      'act'
    );

    expect(call.flushedAtSample).toBe('a1');
    expect(call.ranInGap).toEqual(['B@b1']);
    expect((await call.response).result).toBe('B@b1');

    await until(() => flushed.get('A') === 'a2', 'A flushed a2');
    const after = await liveBridge().executor.executeAction('slot', { action: 'act' });
    expect(after.result).toBe('B@b1');
    expect(liveBridge().registry.getElement('slot')?.customActions?.act?.label).toBe('Act (B)');
    expect(ran).toEqual(['B@b1', 'B@b1']);
  });

  it('writes its own window when another window holds the same id', async () => {
    const at = (windowLabel: string | undefined, tag: string): TargetOptions => ({
      id: 'twin',
      tag,
      windowLabel,
      customActions: { act: action('act', tag) },
    });
    renderApp(
      <>
        <Target key="M" name="M" initial={at(undefined, 'm1')} />
        <Target key="P" name="P" initial={at('popout', 'p1')} />
      </>
    );
    await until(() => flushed.get('M') === 'm1' && flushed.get('P') === 'p1', 'M and P mounted');
    await commitAndFlush('P', at('popout', 'p2'));

    // P commits a new closure. Looked up by id alone, "twin" resolves to M's
    // default-window entry first — so P must write the popout entry exactly.
    const sample = await sampleInGap('P', at('popout', 'p3'), () => ({
      popout: entryIn('popout', 'twin')?.customActions?.act?.handler(),
      main: entryIn(undefined, 'twin')?.customActions?.act?.handler(),
    }));

    expect(sample.flushedAtSample).toBe('p2');
    expect(sample.value).toEqual({ popout: 'p3', main: 'm1' });
  });

  it('keeps the entry current across an id change under a non-default window', async () => {
    const at = (id: string, tag: string): TargetOptions => ({
      id,
      tag,
      windowLabel: 'popout',
      customActions: { act: action('act', tag) },
    });
    renderApp(<Target name="T" initial={at('win-1', 'r1')} />);
    await until(() => flushed.get('T') === 'r1', 'T mounted');
    await commitAndFlush('T', at('win-1', 'r2'));

    // The id changes, so the keyed sync re-registers the element under it.
    await commitAndFlush('T', at('win-2', 'r3'));
    expect(liveBridge().registry.getElement('win-2')?.windowLabel).toBe('popout');
    expect(liveBridge().registry.getElement('win-1')).toBeUndefined();

    // A handler-only commit after the re-registration still reaches the entry.
    const call = await callInGap('T', at('win-2', 'r4'), 'win-2', 'act');

    expect(call.flushedAtSample).toBe('r3');
    expect(call.ranInGap).toEqual(['r4']);
    expect((await call.response).result).toBe('r4');
  });
});
