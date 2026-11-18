/**
 * @vitest-environment jsdom
 *
 * Plan 2026-11-11-ui-bridge-element-and-auxiliary-hooks-serve-stale-closures,
 * Phase 2 (D2). `useUIElement` and `useUIElementWithProps` must put in the
 * registry what a render COMMITTED, at that commit:
 *
 *   1. Handler props and the controlled `value` are published at commit, so a
 *      press or a state read made before the passive flush gets the new ones.
 *   2. A handler that the commit dropped is gone at commit.
 *   3. A render that React abandons never reaches the registry through
 *      `captureProps`.
 *   4. `customActions` follow every commit: a changed handler runs, an added
 *      action can be called, and a withdrawn one is refused.
 *   5. The ref interceptor writes through the COMMITTED bridge, never through
 *      the bridge of a render that was thrown away.
 *
 * Harness:
 * - the real `UIBridgeNativeProvider` (its registry and executor);
 * - React DOM's `createRoot`, with `IS_REACT_ACT_ENVIRONMENT = false`, since
 *   `act()` flushes passive effects before it returns and so hides the window
 *   these defects live in;
 * - updates issued from a resolved promise, a non-discrete DefaultLane update;
 * - samples taken in a MutationObserver callback.
 *
 * That callback is a microtask of the commit's own task. React's scheduler
 * yields after every commit, so passive effects flush in a LATER task. Every
 * in-gap test also checks that its sample really sat between the commit's
 * layout phase and its passive flush, using a layout-effect probe and a
 * passive-effect probe.
 *
 * Every expectation is a hand-written literal.
 */
import { Suspense, startTransition, use, useEffect, useLayoutEffect, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NativeUIBridgeRegistry } from '../../core/registry';

// Mock react-native before importing the hook so StyleSheet.flatten exists.
vi.mock('react-native', () => ({
  StyleSheet: { flatten: (style: unknown) => style ?? undefined },
  PixelRatio: { get: () => 1 },
  Dimensions: { get: () => ({ width: 400, height: 800, scale: 1, fontScale: 1 }) },
}));

// The REAL provider, plus one seam. `useUIBridgeNativeOptional` still runs
// the real hook, so the hook order never changes, but a test can make the
// hook see a different bridge for one render. Only the abandoned-bridge test
// uses it.
const harness = vi.hoisted(() => ({ bridgeOverride: null as unknown }));
vi.mock('../UIBridgeNativeProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../UIBridgeNativeProvider')>();
  return {
    ...actual,
    useUIBridgeNativeOptional: () => {
      const real = actual.useUIBridgeNativeOptional();
      return (harness.bridgeOverride ?? real) as typeof real;
    },
  };
});

import { UIBridgeNativeProvider, useUIBridgeNative } from '../UIBridgeNativeProvider';
import { useUIElement, useUIElementWithProps } from '../useUIElement';

const g = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let savedAct: boolean | undefined;
beforeAll(() => {
  savedAct = g.IS_REACT_ACT_ENVIRONMENT;
  g.IS_REACT_ACT_ENVIRONMENT = false;
});
afterAll(() => {
  g.IS_REACT_ACT_ENVIRONMENT = savedAct;
});

// A PRECONDITION wait. `act` is off, so passive effects (registration
// included) and the re-renders they cause flush on React's own schedule,
// which a fixed sleep cannot bound on a loaded box. Poll until the
// precondition holds, and time out loudly if it never does. This is never
// used for the property under test.
const until = (pred: () => boolean, what: string) =>
  vi.waitFor(
    () => {
      if (!pred()) throw new Error(`timed out waiting for: ${what}`);
    },
    { timeout: 2000, interval: 10 }
  );

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type Bridge = ReturnType<typeof useUIBridgeNative>;
const grabbed: { bridge: Bridge | null } = { bridge: null };

function GrabBridge() {
  const bridge = useUIBridgeNative();
  useLayoutEffect(() => {
    grabbed.bridge = bridge;
  });
  return null;
}

function bridgeOf(): Bridge {
  if (!grabbed.bridge) throw new Error('the provider has not committed yet');
  return grabbed.bridge;
}

// The Suspense boundary is visible from the first commit. A transition that
// suspends inside it therefore keeps showing the old content and commits
// nothing, which is how the abandoned-render tests get a render that never
// commits.
function Harness({ children }: { children: ReactNode }) {
  return (
    <UIBridgeNativeProvider>
      <GrabBridge />
      <Suspense fallback={<i>fallback</i>}>{children}</Suspense>
    </UIBridgeNativeProvider>
  );
}

const never = new Promise<never>(() => {});
function Suspends(): ReactNode {
  use(never);
  return null;
}

// The two observers the in-gap assertions read. `layout` is the version of
// the latest commit whose layout phase has run, and `passive` is the version
// whose passive effects have flushed. A sample is IN THE GAP exactly when
// `layout` shows the new version and `passive` still shows the old one.
const probe = { layout: 0, passive: 0 };
function useGapProbe(version: number): void {
  useLayoutEffect(() => {
    probe.layout = version;
  });
  useEffect(() => {
    probe.passive = version;
  });
}

interface GapSample<T> {
  value: T;
  layoutAtSample: number;
  passiveAtSample: number;
}

/**
 * Re-render `root` with `next` from a resolved promise. Then run `sample` from
 * the first MutationObserver callback that sees `marker` in `container`, which
 * is the first moment that commit is observable.
 */
function renderAndSampleInGap<T>(
  root: Root,
  container: HTMLElement,
  next: ReactNode,
  marker: string,
  sample: () => T
): Promise<GapSample<T>> {
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (!container.textContent?.includes(marker)) return;
      observer.disconnect();
      const layoutAtSample = probe.layout;
      const passiveAtSample = probe.passive;
      resolve({ value: sample(), layoutAtSample, passiveAtSample });
    });
    observer.observe(container, { childList: true, characterData: true, subtree: true });
    void Promise.resolve().then(() => root.render(next));
  });
}

const mounted: Array<{ root: Root; container: HTMLElement }> = [];
function mount(node: ReactNode): { root: Root; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  root.render(node);
  mounted.push({ root, container });
  return { root, container };
}

beforeEach(() => {
  probe.layout = 0;
  probe.passive = 0;
});

afterEach(() => {
  harness.bridgeOverride = null;
  for (const { root, container } of mounted.splice(0)) {
    root.unmount();
    container.remove();
  }
  grabbed.bridge = null;
});

const press = (id: string, action = 'press') => bridgeOf().executor.executeAction(id, { action });
const propsOf = (id: string) => bridgeOf().registry.getElement(id)?.props ?? {};

// ---------------------------------------------------------------------------
// 1. Handler props and `value` publish at commit
// ---------------------------------------------------------------------------

describe('ui-bridge-native useUIElement publishes handlers and value at commit', () => {
  it('runs the NEW onPress for a press made after the commit and before its passive flush', async () => {
    const ran: number[] = [];
    function Button({ version }: { version: number }) {
      useUIElement({
        id: 'gap-press',
        type: 'view',
        handlers: { onPress: () => ran.push(version) },
      });
      useGapProbe(version);
      return <span>{`press-${version}`}</span>;
    }

    const { root, container } = mount(
      <Harness>
        <Button version={1} />
      </Harness>
    );
    await until(
      () => typeof propsOf('gap-press').onPress === 'function' && probe.passive === 1,
      'gap-press registered with its v1 onPress'
    );

    const sampled = await renderAndSampleInGap(
      root,
      container,
      <Harness>
        <Button version={2} />
      </Harness>,
      'press-2',
      () => {
        const response = press('gap-press');
        return { response, ranAtSample: [...ran] };
      }
    );

    // In the gap: commit 2's layout phase ran and its passive flush had not.
    expect(sampled.layoutAtSample).toBe(2);
    expect(sampled.passiveAtSample).toBe(1);
    // The press read the registry synchronously and ran commit 2's handler.
    expect(sampled.value.ranAtSample).toEqual([2]);
    expect((await sampled.value.response).success).toBe(true);
  });

  it('reads the NEW value for a state read made after the commit and before its passive flush', async () => {
    function Field({ version }: { version: number }) {
      useUIElement({ id: 'gap-value', type: 'input', value: `text-${version}` });
      useGapProbe(version);
      return <span>{`value-${version}`}</span>;
    }

    const { root, container } = mount(
      <Harness>
        <Field version={1} />
      </Harness>
    );
    await until(
      () =>
        bridgeOf().registry.getElement('gap-value')?.getState().value === 'text-1' &&
        probe.passive === 1,
      'gap-value registered with text-1'
    );

    const sampled = await renderAndSampleInGap(
      root,
      container,
      <Harness>
        <Field version={2} />
      </Harness>,
      'value-2',
      () => bridgeOf().registry.getElement('gap-value')?.getState().value
    );

    expect(sampled.layoutAtSample).toBe(2);
    expect(sampled.passiveAtSample).toBe(1);
    expect(sampled.value).toBe('text-2');
  });

  // The handlers effect runs at layout, BEFORE the passive re-registration
  // that an id or bridge change causes. `registerElement` replaces the entry,
  // props included, and the render that follows bails out. So only a
  // re-publish after that passive flush can land the committed handlers.
  it('puts the committed handlers on the new id after a recycled cell changes id', async () => {
    const ran: string[] = [];
    function HandlerCell({ id }: { id: string }) {
      useUIElement({ id, type: 'view', handlers: { onPress: () => ran.push(id) } });
      return <span>{id}</span>;
    }

    const { root } = mount(
      <Harness>
        <HandlerCell id="handler-cell-a" />
      </Harness>
    );
    await until(
      () => typeof propsOf('handler-cell-a').onPress === 'function',
      'handler-cell-a registered with its onPress'
    );

    root.render(
      <Harness>
        <HandlerCell id="handler-cell-b" />
      </Harness>
    );
    await until(
      () =>
        bridgeOf().registry.getElement('handler-cell-a') === undefined &&
        typeof propsOf('handler-cell-b').onPress === 'function',
      'handler-cell-b registered with its onPress'
    );

    expect((await press('handler-cell-b')).success).toBe(true);
    expect(ran).toEqual(['handler-cell-b']);
  });

  it('leaves the new id without handlers when the id change also drops them', async () => {
    // The passive re-apply must stay silent. It re-publishes this commit's own
    // handlers, and this commit has none, so nothing may carry cell a's onPress
    // over to cell b.
    const ran: string[] = [];
    function MaybeHandlers({ id, withHandlers }: { id: string; withHandlers: boolean }) {
      useUIElement({
        id,
        type: 'view',
        handlers: withHandlers ? { onPress: () => ran.push(id) } : undefined,
      });
      return <span>{id}</span>;
    }

    const { root } = mount(
      <Harness>
        <MaybeHandlers id="drop-cell-a" withHandlers />
      </Harness>
    );
    await until(
      () => typeof propsOf('drop-cell-a').onPress === 'function',
      'drop-cell-a registered with its onPress'
    );

    root.render(
      <Harness>
        <MaybeHandlers id="drop-cell-b" withHandlers={false} />
      </Harness>
    );
    // The registration and the re-apply run in the same passive flush, so
    // once drop-cell-b is registered, the re-apply has already run.
    await until(
      () =>
        bridgeOf().registry.getElement('drop-cell-a') === undefined &&
        bridgeOf().registry.getElement('drop-cell-b') !== undefined,
      'drop-cell-b registered in place of drop-cell-a'
    );

    const response = await press('drop-cell-b');
    expect(response.success).toBe(false);
    expect(response.error).toBe('No press handler found on element');
    expect(ran).toEqual([]);
  });

  it('keeps the committed handlers after a bridge change re-registers the element', async () => {
    const ran: string[] = [];
    function Swapped({ version }: { version: number }) {
      useUIElement({
        id: 'bridge-swap',
        type: 'view',
        handlers: { onPress: () => ran.push(`v${version}`) },
      });
      useGapProbe(version);
      return <span>{`swap-${version}`}</span>;
    }

    const { root } = mount(
      <Harness>
        <Swapped version={1} />
      </Harness>
    );
    await until(
      () => typeof propsOf('bridge-swap').onPress === 'function' && probe.passive === 1,
      'bridge-swap registered with its onPress'
    );
    const registrations: string[] = [];
    const off = bridgeOf().registry.on('element:registered', (event) => {
      registrations.push((event.data as { id: string }).id);
    });

    // A new bridge object over the same registry and executor, which is what
    // the provider hands out when its server starts (`serverRunning` is part of
    // the context value).
    harness.bridgeOverride = { ...bridgeOf() };
    root.render(
      <Harness>
        <Swapped version={2} />
      </Harness>
    );
    await until(() => probe.passive === 2, 'commit 2 to flush');
    off();

    // The swap really replaced the entry.
    expect(registrations).toEqual(['bridge-swap']);
    expect((await press('bridge-swap')).success).toBe(true);
    expect(ran).toEqual(['v2']);
  });
});

// ---------------------------------------------------------------------------
// 2. A dropped handler is gone at commit
// ---------------------------------------------------------------------------

describe('ui-bridge-native useUIElement withdraws a dropped handler at commit', () => {
  it('fails a press made in the gap after onPress was dropped, and runs no handler', async () => {
    const ran: string[] = [];
    function Droppable({ version }: { version: number }) {
      useUIElement({
        id: 'gap-drop',
        type: 'view',
        handlers: version === 1 ? { onPress: () => ran.push('dropped handler') } : undefined,
      });
      useGapProbe(version);
      return <span>{`drop-${version}`}</span>;
    }

    const { root, container } = mount(
      <Harness>
        <Droppable version={1} />
      </Harness>
    );
    await until(
      () => typeof propsOf('gap-drop').onPress === 'function' && probe.passive === 1,
      'gap-drop registered with its onPress'
    );

    const sampled = await renderAndSampleInGap(
      root,
      container,
      <Harness>
        <Droppable version={2} />
      </Harness>,
      'drop-2',
      () => {
        const response = press('gap-drop');
        return { response, ranAtSample: [...ran] };
      }
    );

    expect(sampled.layoutAtSample).toBe(2);
    expect(sampled.passiveAtSample).toBe(1);
    expect(sampled.value.ranAtSample).toEqual([]);
    const response = await sampled.value.response;
    expect(response.success).toBe(false);
    expect(response.error).toBe('No press handler found on element');
    expect(ran).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. An abandoned render's captureProps never reaches the registry
// ---------------------------------------------------------------------------

describe('ui-bridge-native useUIElementWithProps publishes captureProps only from a commit', () => {
  it('keeps running the committed onPress while a transition render that captured another one is suspended', async () => {
    const ran: string[] = [];
    const rendered: string[] = [];
    function Capturing({ mode }: { mode: 'committed' | 'abandoned' }) {
      const { captureProps } = useUIElementWithProps({ id: 'abandon-press', type: 'button' });
      captureProps({ onPress: () => ran.push(mode) });
      useLayoutEffect(() => {
        rendered.push(`${mode} committed`);
      });
      rendered.push(mode);
      return (
        <span>
          {`capture-${mode}`}
          {mode === 'abandoned' ? <Suspends /> : null}
        </span>
      );
    }

    const { root, container } = mount(
      <Harness>
        <Capturing mode="committed" />
      </Harness>
    );
    await until(
      () => typeof propsOf('abandon-press').onPress === 'function',
      'abandon-press registered with the committed onPress'
    );

    startTransition(() => {
      root.render(
        <Harness>
          <Capturing mode="abandoned" />
        </Harness>
      );
    });
    await until(() => rendered.includes('abandoned'), 'the transition render to run');

    // It rendered, captured, suspended, and committed nothing.
    expect(rendered).not.toContain('abandoned committed');
    expect(container.textContent).toBe('capture-committed');

    const response = await press('abandon-press');
    expect(response.success).toBe(true);
    expect(ran).toEqual(['committed']);
  });

  it('does not carry a key that only an abandoned render captured into the next commit', async () => {
    const ran: string[] = [];
    const rendered: string[] = [];
    function Capturing({ mode, tick }: { mode: 'committed' | 'abandoned'; tick: number }) {
      const { captureProps } = useUIElementWithProps({ id: 'abandon-key', type: 'button' });
      if (mode === 'abandoned') {
        captureProps({
          onPress: () => ran.push('abandoned press'),
          onLongPress: () => ran.push('abandoned long press'),
        });
      } else {
        captureProps({ onPress: () => ran.push(`committed press ${tick}`) });
      }
      useGapProbe(tick);
      rendered.push(`${mode}-${tick}`);
      return (
        <span>
          {`key-${mode}-${tick}`}
          {mode === 'abandoned' ? <Suspends /> : null}
        </span>
      );
    }

    const { root, container } = mount(
      <Harness>
        <Capturing mode="committed" tick={0} />
      </Harness>
    );
    await until(
      () => typeof propsOf('abandon-key').onPress === 'function',
      'abandon-key registered with the committed onPress'
    );

    startTransition(() => {
      root.render(
        <Harness>
          <Capturing mode="abandoned" tick={0} />
        </Harness>
      );
    });
    await until(() => rendered.includes('abandoned-0'), 'the transition render to run');
    expect(container.textContent).toBe('key-committed-0');

    // An urgent update commits a render that captures `onPress` only.
    root.render(
      <Harness>
        <Capturing mode="committed" tick={1} />
      </Harness>
    );
    await until(
      () => container.textContent === 'key-committed-1' && probe.passive === 1,
      'the urgent render to commit and flush'
    );

    const longPress = await press('abandon-key', 'longPress');
    expect(longPress.success).toBe(false);
    expect(longPress.error).toBe('No long press handler found on element');
    expect((await press('abandon-key')).success).toBe(true);
    expect(ran).toEqual(['committed press 1']);
  });

  it('puts the captures on the new id after a recycled cell changes id', async () => {
    // The re-registration under the new id is passive, and it replaces the
    // entry. The render it causes bails out (`registered` ends where it
    // started), so only a re-publish after that passive flush can land the
    // captures. A regression guard: the render-phase write used to do this.
    const ran: string[] = [];
    function Cell({ id }: { id: string }) {
      const { captureProps } = useUIElementWithProps({ id, type: 'button' });
      captureProps({ onPress: () => ran.push(id) });
      return <span>{id}</span>;
    }

    const { root } = mount(
      <Harness>
        <Cell id="cell-a" />
      </Harness>
    );
    await until(() => typeof propsOf('cell-a').onPress === 'function', 'cell-a registered');

    root.render(
      <Harness>
        <Cell id="cell-b" />
      </Harness>
    );
    await until(
      () =>
        bridgeOf().registry.getElement('cell-a') === undefined &&
        typeof propsOf('cell-b').onPress === 'function',
      'cell-b registered with its captured onPress'
    );

    expect((await press('cell-b')).success).toBe(true);
    expect(ran).toEqual(['cell-b']);
  });

  it('publishes a captureProps call made from an effect at once, with no further commit', async () => {
    // The caller that lists `captureProps` in an effect's deps calls it from
    // that effect, after the commit. That call has no commit left to wait for,
    // so it must reach the registry immediately. A `captureProps` that only
    // staged for the next commit would leave it unpublished here.
    const ran: string[] = [];
    function EffectCapture({ version }: { version: number }) {
      const { captureProps } = useUIElementWithProps({ id: 'effect-capture', type: 'view' });
      useEffect(() => {
        if (version === 2) captureProps({ onLongPress: () => ran.push('effect long press') });
      }, [captureProps, version]);
      useGapProbe(version);
      return <span>{`effect-${version}`}</span>;
    }

    const { root } = mount(
      <Harness>
        <EffectCapture version={1} />
      </Harness>
    );
    await until(
      () => bridgeOf().registry.getElement('effect-capture') !== undefined && probe.passive === 1,
      'effect-capture registered'
    );

    root.render(
      <Harness>
        <EffectCapture version={2} />
      </Harness>
    );
    await until(() => probe.passive === 2, 'commit 2 to flush');

    // The effect ran in commit 2's passive flush, and nothing has committed since.
    expect(typeof propsOf('effect-capture').onLongPress).toBe('function');
    expect((await press('effect-capture', 'longPress')).success).toBe(true);
    expect(ran).toEqual(['effect long press']);
  });
});

// ---------------------------------------------------------------------------
// 4. customActions follow every commit
// ---------------------------------------------------------------------------

describe('ui-bridge-native useUIElement publishes customActions at commit', () => {
  it('runs a changed handler and an added action in the gap, and refuses a withdrawn one', async () => {
    const ran: string[] = [];
    function Actions({ version }: { version: number }) {
      const customActions =
        version === 1
          ? {
              refresh: { id: 'refresh', handler: () => ran.push('refresh v1') },
              retire: { id: 'retire', handler: () => ran.push('retire v1') },
            }
          : version === 2
            ? {
                refresh: { id: 'refresh', handler: () => ran.push('refresh v2') },
                added: { id: 'added', handler: () => ran.push('added v2') },
              }
            : undefined;
      useUIElement({ id: 'gap-actions', type: 'view', customActions });
      useGapProbe(version);
      return <span>{`actions-${version}`}</span>;
    }

    const { root, container } = mount(
      <Harness>
        <Actions version={1} />
      </Harness>
    );
    await until(
      () => bridgeOf().registry.getElement('gap-actions') !== undefined && probe.passive === 1,
      'gap-actions registered'
    );
    expect((await press('gap-actions', 'refresh')).success).toBe(true);
    expect(ran).toEqual(['refresh v1']);
    ran.length = 0;

    // Commit 2 changes `refresh`'s handler, adds `added` and withdraws `retire`.
    const changed = await renderAndSampleInGap(
      root,
      container,
      <Harness>
        <Actions version={2} />
      </Harness>,
      'actions-2',
      () => {
        const advertised = Object.keys(
          bridgeOf().registry.getElement('gap-actions')?.customActions ?? {}
        );
        const refresh = press('gap-actions', 'refresh');
        const added = press('gap-actions', 'added');
        const retire = press('gap-actions', 'retire');
        return { advertised, refresh, added, retire, ranAtSample: [...ran] };
      }
    );
    expect(changed.layoutAtSample).toBe(2);
    expect(changed.passiveAtSample).toBe(1);
    expect(changed.value.advertised).toEqual(['refresh', 'added']);
    expect(changed.value.ranAtSample).toEqual(['refresh v2', 'added v2']);
    expect((await changed.value.refresh).success).toBe(true);
    expect((await changed.value.added).success).toBe(true);
    const retire = await changed.value.retire;
    expect(retire.success).toBe(false);
    expect(retire.code).toBe('UNKNOWN_ACTION');
    await until(() => probe.passive === 2, 'commit 2 to flush');
    ran.length = 0;

    // Commit 3 drops the option entirely, which withdraws every action.
    const dropped = await renderAndSampleInGap(
      root,
      container,
      <Harness>
        <Actions version={3} />
      </Harness>,
      'actions-3',
      () => {
        const element = bridgeOf().registry.getElement('gap-actions');
        const refresh = press('gap-actions', 'refresh');
        return { customActions: element?.customActions, refresh, ranAtSample: [...ran] };
      }
    );
    expect(dropped.layoutAtSample).toBe(3);
    expect(dropped.passiveAtSample).toBe(2);
    expect(dropped.value.customActions).toBe(undefined);
    expect(dropped.value.ranAtSample).toEqual([]);
    const refresh = await dropped.value.refresh;
    expect(refresh.success).toBe(false);
    expect(refresh.code).toBe('UNKNOWN_ACTION');
    expect(ran).toEqual([]);
  });

  it('leaves a second instance holding the same id with its own actions', async () => {
    const ran: string[] = [];
    const first: { bump: (() => void) | null } = { bump: null };
    // First re-renders from its OWN state, so the final commit re-renders First
    // alone. If Second re-rendered in that commit too, its own mirror would run
    // after First's and put its actions back, hiding a missing owner guard.
    function First() {
      const [version, setVersion] = useState(1);
      useLayoutEffect(() => {
        first.bump = () => setVersion((v) => v + 1);
      });
      useUIElement({
        id: 'shared-slot',
        type: 'view',
        customActions: { go: { id: 'go', handler: () => ran.push(`first v${version}`) } },
      });
      useGapProbe(version);
      return <span>{`first-${version}`}</span>;
    }
    function Second({ register }: { register: boolean }) {
      useUIElement({
        id: 'shared-slot',
        type: 'view',
        label: 'second',
        autoRegister: register,
        customActions: { go: { id: 'go', handler: () => ran.push('second') } },
      });
      return null;
    }

    const { root } = mount(
      <Harness>
        <First />
        <Second register={false} />
      </Harness>
    );
    await until(
      () => bridgeOf().registry.getElement('shared-slot') !== undefined && probe.passive === 1,
      'shared-slot registered by First'
    );

    // Second registers over the same id, which is last-write-wins.
    root.render(
      <Harness>
        <First />
        <Second register />
      </Harness>
    );
    await until(
      () => bridgeOf().registry.getElement('shared-slot')?.label === 'second',
      'Second to take the slot'
    );

    // First alone re-renders and commits, and its mirror runs.
    first.bump?.();
    await until(() => probe.passive === 2, 'First to commit again');

    expect((await press('shared-slot', 'go')).success).toBe(true);
    expect(ran).toEqual(['second']);
  });
});

// ---------------------------------------------------------------------------
// 5. The ref interceptor reads the COMMITTED bridge
// ---------------------------------------------------------------------------

describe('ui-bridge-native useUIElement ref interceptor uses the committed bridge', () => {
  it('detaches through the committed bridge after an abandoned render saw a different one', async () => {
    const decoy = { registry: new NativeUIBridgeRegistry(), getCurrentRoute: () => undefined };
    const rendered: string[] = [];
    const holder: { hide: (() => void) | null } = { hide: null };

    // Renders the element's host node itself, so its ref can detach in a commit
    // that does not re-render the hook's own component.
    function Holder({ nodeRef }: { nodeRef: RefObject<unknown> }) {
      const [shown, setShown] = useState(true);
      useLayoutEffect(() => {
        holder.hide = () => setShown(false);
      });
      return shown ? <b ref={nodeRef as RefObject<HTMLElement>}>node</b> : <i>gone</i>;
    }
    function Owner({ suspend }: { suspend: boolean }) {
      const { ref } = useUIElement({ id: 'committed-bridge', type: 'view' });
      rendered.push(suspend ? 'suspending' : 'plain');
      return (
        <>
          <Holder nodeRef={ref} />
          {suspend ? <Suspends /> : null}
        </>
      );
    }

    const { root, container } = mount(
      <Harness>
        <Owner suspend={false} />
      </Harness>
    );
    await until(
      () => bridgeOf().registry.getElement('committed-bridge')?.getState().visible === true,
      'committed-bridge registered and visible'
    );

    // A transition render sees the decoy bridge, then suspends and commits
    // nothing.
    harness.bridgeOverride = decoy;
    startTransition(() => {
      root.render(
        <Harness>
          <Owner suspend />
        </Harness>
      );
    });
    await until(() => rendered.includes('suspending'), 'the transition render to run');
    harness.bridgeOverride = null;
    expect(container.textContent).toBe('node');

    // An urgent update in Holder alone detaches the node. Owner does not
    // re-render, so the interceptor uses whatever bridge it last saw.
    holder.hide?.();
    await until(() => container.textContent === 'gone', 'the node to detach');

    expect(bridgeOf().registry.getElement('committed-bridge')?.getState().visible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Writes go only to the entry this instance owns
// ---------------------------------------------------------------------------

describe('ui-bridge-native element hooks write only the entry their instance registered', () => {
  // Ids are a shared key space and registration is last-write-wins, so a
  // slot-keyed id can pass from one instance to another. In each test First
  // registers, Second takes the id over, and then First alone re-renders,
  // from its own state, so Second's effects cannot repair what First's write
  // would have overwritten.
  it("leaves another instance's handlers and value alone on a shared id", async () => {
    const ran: string[] = [];
    const first: { bump: (() => void) | null } = { bump: null };
    function First() {
      const [version, setVersion] = useState(1);
      useLayoutEffect(() => {
        first.bump = () => setVersion((v) => v + 1);
      });
      useUIElement({
        id: 'owned-slot',
        type: 'input',
        value: `first-${version}`,
        handlers: { onPress: () => ran.push(`first v${version}`) },
      });
      useGapProbe(version);
      return <span>{`owned-${version}`}</span>;
    }
    function Second({ register }: { register: boolean }) {
      useUIElement({
        id: 'owned-slot',
        type: 'input',
        label: 'second',
        value: 'second',
        autoRegister: register,
        handlers: { onPress: () => ran.push('second') },
      });
      return null;
    }

    const { root } = mount(
      <Harness>
        <First />
        <Second register={false} />
      </Harness>
    );
    await until(
      () => typeof propsOf('owned-slot').onPress === 'function' && probe.passive === 1,
      'owned-slot registered by First'
    );

    root.render(
      <Harness>
        <First />
        <Second register />
      </Harness>
    );
    // The new entry starts with no props, so an onPress on an entry labelled
    // `second` is Second's own.
    await until(() => {
      const element = bridgeOf().registry.getElement('owned-slot');
      return element?.label === 'second' && typeof element.props?.onPress === 'function';
    }, 'Second to take the slot with its handlers');

    first.bump?.();
    await until(() => probe.passive === 2, 'First to commit again');

    expect((await press('owned-slot')).success).toBe(true);
    expect(ran).toEqual(['second']);
    expect(bridgeOf().registry.getElement('owned-slot')?.getState().value).toBe('second');
  });

  it("leaves another instance's captured props alone on a shared id", async () => {
    const ran: string[] = [];
    const first: { bump: (() => void) | null } = { bump: null };
    function First() {
      const [version, setVersion] = useState(1);
      useLayoutEffect(() => {
        first.bump = () => setVersion((v) => v + 1);
      });
      const { captureProps } = useUIElementWithProps({ id: 'owned-capture', type: 'view' });
      captureProps({ onPress: () => ran.push(`first v${version}`) });
      useGapProbe(version);
      return <span>{`owned-capture-${version}`}</span>;
    }
    function Second({ register }: { register: boolean }) {
      const { captureProps } = useUIElementWithProps({
        id: 'owned-capture',
        type: 'view',
        label: 'second',
        autoRegister: register,
      });
      captureProps({ onPress: () => ran.push('second') });
      return null;
    }

    const { root } = mount(
      <Harness>
        <First />
        <Second register={false} />
      </Harness>
    );
    await until(
      () => typeof propsOf('owned-capture').onPress === 'function' && probe.passive === 1,
      'owned-capture registered by First'
    );

    root.render(
      <Harness>
        <First />
        <Second register />
      </Harness>
    );
    await until(() => {
      const element = bridgeOf().registry.getElement('owned-capture');
      return element?.label === 'second' && typeof element.props?.onPress === 'function';
    }, 'Second to take the slot with its captured onPress');

    first.bump?.();
    await until(() => probe.passive === 2, 'First to commit again');

    expect((await press('owned-capture')).success).toBe(true);
    expect(ran).toEqual(['second']);
  });

  it("leaves another instance's entry registered when the first instance unmounts", async () => {
    // First registers, Second takes the id over, and then First unmounts. Both
    // its layout cleanup (the at-commit unregister) and its passive cleanup
    // reach `unregister`, and neither may delete the entry Second now owns.
    function First() {
      useUIElement({ id: 'unmount-slot', type: 'view' });
      return <span>first</span>;
    }
    function Second({ register }: { register: boolean }) {
      useUIElement({ id: 'unmount-slot', type: 'view', label: 'second', autoRegister: register });
      return null;
    }
    function Probe({ version }: { version: number }) {
      useGapProbe(version);
      return null;
    }
    // First's slot stays in the child list as `null` once it is hidden, so
    // Second keeps its position and stays the SAME instance. A child list that
    // shrank would remount Second, and the fresh Second would re-register the
    // id itself, hiding the bug.
    function Slots(props: { showFirst: boolean; register: boolean; version: number }) {
      return (
        <>
          {props.showFirst ? <First /> : null}
          <Second register={props.register} />
          <Probe version={props.version} />
        </>
      );
    }

    const { root, container } = mount(
      <Harness>
        <Slots showFirst register={false} version={1} />
      </Harness>
    );
    await until(
      () => bridgeOf().registry.getElement('unmount-slot') !== undefined && probe.passive === 1,
      'unmount-slot registered by First'
    );

    root.render(
      <Harness>
        <Slots showFirst register version={1} />
      </Harness>
    );
    await until(
      () => bridgeOf().registry.getElement('unmount-slot')?.label === 'second',
      'Second to take the slot'
    );
    const unregistered: string[] = [];
    const off = bridgeOf().registry.on('element:unregistered', (event) => {
      unregistered.push((event.data as { id: string }).id);
    });

    root.render(
      <Harness>
        <Slots showFirst={false} register version={2} />
      </Harness>
    );
    // `passive` reaching 2 means that commit's passive flush, First's passive
    // cleanup included, has run.
    await until(
      () => !container.textContent?.includes('first') && probe.passive === 2,
      'First to unmount and its commit to flush'
    );
    off();

    // Second's entry was never deleted, and is still there.
    expect(unregistered).toEqual([]);
    expect(bridgeOf().registry.getElement('unmount-slot')?.label).toBe('second');
  });
});
