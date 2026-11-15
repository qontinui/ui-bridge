/**
 * @vitest-environment jsdom
 *
 * Plan 2026-11-11-ui-bridge-element-and-auxiliary-hooks-serve-stale-closures,
 * Phase 2 (D2), for the native hooks that ship inside `@qontinui/ui-bridge`
 * (`@qontinui/ui-bridge/native`). `useUIElement` and `useUIElementWithProps`
 * must put in the registry what a render COMMITTED, at that commit:
 *
 *   1. A render that React abandons never reaches the registry through
 *      `captureProps`.
 *   2. `customActions` follow every commit: a changed handler runs, an added
 *      action can be called, and a withdrawn one is refused. A second instance
 *      holding the same id keeps its own actions.
 *   3. An inline `customActions` object, or an inline `actions` list with
 *      unchanged entries, re-registers NOTHING. Re-registering replaced the
 *      entry on every passive flush: it wiped captured props and emitted
 *      `element:registered` per commit.
 *
 * Harness:
 * - the real `UIBridgeNativeProvider` (its registry and executor);
 * - React DOM's `createRoot`, with `IS_REACT_ACT_ENVIRONMENT = false`, since
 *   `act()` flushes passive effects before it returns;
 * - updates issued from a resolved promise, a non-discrete DefaultLane update;
 * - samples taken in a MutationObserver callback, a microtask of the commit's
 *   own task, which runs before the passive flush React's scheduler leaves for
 *   a later task.
 *
 * Every in-gap test checks that its sample sat between the commit's layout
 * phase and its passive flush. Every expectation is a hand-written literal.
 */
import { Suspense, startTransition, use, useEffect, useLayoutEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { NativeStandardAction } from '../core/types';
import { UIBridgeNativeProvider, useUIBridgeNative } from './UIBridgeNativeProvider';
import { useUIElement, useUIElementWithProps } from './useUIElement';

const g = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let savedAct: boolean | undefined;
beforeAll(() => {
  savedAct = g.IS_REACT_ACT_ENVIRONMENT;
  g.IS_REACT_ACT_ENVIRONMENT = false;
});
afterAll(() => {
  g.IS_REACT_ACT_ENVIRONMENT = savedAct;
});

// A PRECONDITION wait. `act` is off, so passive effects flush on React's own
// schedule. Poll until the precondition holds, and time out loudly if it
// never does. This is never used for the property under test.
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

// The boundary is visible from the first commit, so a transition that
// suspends inside it commits nothing: that is the abandoned render.
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

// `layout` is the version of the latest commit whose layout phase has run,
// and `passive` is the version whose passive effects have flushed. A sample is
// IN THE GAP exactly when `layout` is new and `passive` is still old.
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
 * the first MutationObserver callback that sees `marker` in `container`.
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
  for (const { root, container } of mounted.splice(0)) {
    root.unmount();
    container.remove();
  }
  grabbed.bridge = null;
});

const press = (id: string, action = 'press') => bridgeOf().executor.executeAction(id, { action });
const propsOf = (id: string) => bridgeOf().registry.getElement(id)?.props ?? {};

/** Record every registration event the registry emits until `stop()`. */
function recordRegistrations(): { events: string[]; stop: () => void } {
  const events: string[] = [];
  const registry = bridgeOf().registry;
  const offRegistered = registry.on('element:registered', (event) => {
    events.push(`${event.type} ${(event.data as { id: string }).id}`);
  });
  const offUnregistered = registry.on('element:unregistered', (event) => {
    events.push(`${event.type} ${(event.data as { id: string }).id}`);
  });
  return {
    events,
    stop: () => {
      offRegistered();
      offUnregistered();
    },
  };
}

// ---------------------------------------------------------------------------
// 1. An abandoned render's captureProps never reaches the registry
// ---------------------------------------------------------------------------

describe('native useUIElementWithProps publishes captureProps only from a commit', () => {
  it('keeps running the committed onPress while a transition render that captured another one is suspended', async () => {
    const ran: string[] = [];
    const rendered: string[] = [];
    function Capturing({ mode, tick }: { mode: 'committed' | 'abandoned'; tick: number }) {
      const { captureProps } = useUIElementWithProps({ id: 'abandon-press', type: 'button' });
      captureProps({ onPress: () => ran.push(`${mode} ${tick}`) });
      useLayoutEffect(() => {
        rendered.push(`${mode} ${tick} committed`);
      });
      rendered.push(`${mode} ${tick}`);
      return (
        <span>
          {`capture-${mode}-${tick}`}
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
      () => typeof propsOf('abandon-press').onPress === 'function',
      'abandon-press registered with the committed onPress'
    );

    startTransition(() => {
      root.render(
        <Harness>
          <Capturing mode="abandoned" tick={0} />
        </Harness>
      );
    });
    await until(() => rendered.includes('abandoned 0'), 'the transition render to run');

    expect(rendered).not.toContain('abandoned 0 committed');
    expect(container.textContent).toBe('capture-committed-0');

    const response = await press('abandon-press');
    expect(response.success).toBe(true);
    expect(ran).toEqual(['committed 0']);
  });

  it('publishes the mount captures after the passive registration, with no further render', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ran: string[] = [];
    const rendered: number[] = [];
    function Mounted() {
      const { captureProps } = useUIElementWithProps({ id: 'mount-capture', type: 'button' });
      captureProps({ onPress: () => ran.push('mount press') });
      rendered.push(rendered.length + 1);
      return <span>mounted</span>;
    }

    try {
      mount(
        <Harness>
          <Mounted />
        </Harness>
      );
      await until(
        () => bridgeOf().registry.getElement('mount-capture') !== undefined,
        'mount-capture registered'
      );
      // Registering never re-renders this hook, so the passive re-publish
      // is the only thing that can land the first render's captures. The
      // press-handler warning's timer was set during that same flush, and
      // this macrotask turn lets it fire.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(rendered).toEqual([1]);
      expect((await press('mount-capture')).success).toBe(true);
      expect(ran).toEqual(['mount press']);
      expect(warn.mock.calls.filter(([msg]) => String(msg).includes('mount-capture'))).toEqual([]);
    } finally {
      warn.mockRestore();
    }
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
      () => bridgeOf().registry.getElement('abandon-key') !== undefined,
      'abandon-key registered'
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
});

// ---------------------------------------------------------------------------
// 2. customActions follow every commit
// ---------------------------------------------------------------------------

describe('native useUIElement publishes customActions at commit', () => {
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
    // alone (see the ui-bridge-native twin of this test for why).
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

    first.bump?.();
    await until(() => probe.passive === 2, 'First to commit again');

    expect((await press('shared-slot', 'go')).success).toBe(true);
    expect(ran).toEqual(['second']);
  });
});

// ---------------------------------------------------------------------------
// 3. Inline declarations re-register nothing
// ---------------------------------------------------------------------------

describe('native useUIElement does not re-register on the identity of an inline declaration', () => {
  it('emits no registration events for an inline customActions object, and keeps captured props', async () => {
    const ran: string[] = [];
    function Inline({ version }: { version: number }) {
      const { captureProps } = useUIElementWithProps({
        id: 'inline-actions',
        type: 'button',
        customActions: { ping: { id: 'ping', handler: () => ran.push(`ping v${version}`) } },
      });
      captureProps({ onPress: () => ran.push(`press v${version}`) });
      useGapProbe(version);
      return <span>{`inline-${version}`}</span>;
    }

    const { root } = mount(
      <Harness>
        <Inline version={1} />
      </Harness>
    );
    await until(
      () => bridgeOf().registry.getElement('inline-actions') !== undefined && probe.passive === 1,
      'inline-actions registered'
    );
    const recorder = recordRegistrations();

    for (const version of [2, 3]) {
      root.render(
        <Harness>
          <Inline version={version} />
        </Harness>
      );
      await until(() => probe.passive === version, `commit ${version} to flush`);
    }
    recorder.stop();

    expect(recorder.events).toEqual([]);
    expect((await press('inline-actions')).success).toBe(true);
    expect((await press('inline-actions', 'ping')).success).toBe(true);
    expect(ran).toEqual(['press v3', 'ping v3']);
  });

  it('emits no registration events for an inline actions list with the same entries, and re-registers once when they change', async () => {
    function Listed({ version, actions }: { version: number; actions: NativeStandardAction[] }) {
      useUIElement({ id: 'inline-list', type: 'view', actions: [...actions] });
      useGapProbe(version);
      return <span>{`list-${version}`}</span>;
    }

    const { root } = mount(
      <Harness>
        <Listed version={1} actions={['press']} />
      </Harness>
    );
    await until(
      () => bridgeOf().registry.getElement('inline-list') !== undefined && probe.passive === 1,
      'inline-list registered'
    );
    const recorder = recordRegistrations();

    root.render(
      <Harness>
        <Listed version={2} actions={['press']} />
      </Harness>
    );
    await until(() => probe.passive === 2, 'commit 2 to flush');
    expect(recorder.events).toEqual([]);

    root.render(
      <Harness>
        <Listed version={3} actions={['press', 'longPress']} />
      </Harness>
    );
    await until(() => probe.passive === 3, 'commit 3 to flush');
    recorder.stop();

    expect(recorder.events).toEqual([
      'element:unregistered inline-list',
      'element:registered inline-list',
    ]);
    expect(bridgeOf().registry.getElement('inline-list')?.actions).toEqual(['press', 'longPress']);
  });
});
