/**
 * @vitest-environment jsdom
 */
/**
 * `useUIComponent` refuses a component action call to an action that the latest
 * committed render WITHDREW, and keeps an action installed through
 * `updateActions` callable.
 *
 * Plan `2026-11-08-ui-bridge-useuicomponent-state-lags-the-dom-by-one-task`.
 * The hook republishes its actions from a passive effect, so after a commit that
 * withdraws an action the registry still lists it until that effect runs. For a
 * non-discrete update that is a task later under React 19, whose scheduler
 * yields after every commit; React 18's scheduler yields only once its 5 ms
 * frame is spent, so there the gap is rarer. A call in the gap reaches the
 * registered trampoline.
 *
 * The trampoline resolves the handler through two lanes. The DECLARED lane is
 * the `actions` option, refreshed in a layout effect so it is the committed
 * render's, with an absent option declaring no actions. The IMPERATIVE lane is
 * the list `updateActions` installed, held until the declared actions change
 * value. For an id in both, the `declaredAtInstallRef` comparison picks the
 * handler supplied last: the install while the declared ref still holds the list
 * it was made against, the declared closure once a render supplies a new array.
 * When neither lane provides the id, the trampoline throws, and the native
 * executor answers `success: false` with the message.
 *
 * Before this, one ref held both lists, and the trampoline fell back to the
 * handler captured when the action was last published. That fallback is what
 * kept an installed action callable once the declared sync had overwritten the
 * shared ref, and it is also what ran a withdrawn action's stale closure. A
 * dropped `actions` option was not written at all, so its list stayed listed and
 * callable for good.
 *
 * Why not RTL: `render`, `rerender` and `act` flush every effect before they
 * return, so under `act()` the gap does not exist. This file drives
 * `react-dom/client` directly with `IS_REACT_ACT_ENVIRONMENT = false`, makes
 * each update from a resolved promise, and calls actions from a
 * `MutationObserver` on the component's own DOM: a microtask the commit's DOM
 * write queues, which runs after the commit and before the passive flush. Each
 * gap test asserts the call sat in the gap: the component's own passive effect
 * had not seen the update yet.
 *
 * Under the REAL `UIBridgeNativeProvider`, through `NativeActionExecutor`. Every
 * expectation is a hand-written literal.
 */

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The provider reads the window size and pixel ratio from react-native.
vi.mock('react-native', () => ({
  StyleSheet: {
    flatten: (style: unknown) => style ?? undefined,
  },
  PixelRatio: {
    get: () => 1,
  },
  Dimensions: {
    get: () => ({ width: 390, height: 844 }),
  },
}));

import {
  UIBridgeNativeProvider,
  useUIBridgeNativeOptional,
  type UIBridgeNativeContextValue,
} from '../UIBridgeNativeProvider';
import { useUIComponent, type UseUIComponentReturn } from '../useUIComponent';

// --- Harness ----------------------------------------------------------------

type ActEnvironmentGlobal = typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const actEnvironment = globalThis as ActEnvironmentGlobal;
let previousActEnvironment: boolean | undefined;
const mounted: Array<{ root: Root; container: HTMLElement }> = [];

/** The real provider's context value, handed out by `BridgeProbe`. */
let bridge: UIBridgeNativeContextValue | null = null;

function BridgeProbe(): null {
  bridge = useUIBridgeNativeOptional();
  return null;
}

function liveBridge(): UIBridgeNativeContextValue {
  if (!bridge) throw new Error('no UIBridgeNativeProvider is mounted');
  return bridge;
}

/** The action ids the registry lists for `componentId` right now. */
function listedActions(componentId: string): string[] | undefined {
  const component = liveBridge().registry.getComponent(componentId);
  return component?.actions.map((a) => a.id);
}

/** Mount `element` in a fresh container. Outside act(), React renders it in a scheduler task. */
function mount(element: React.ReactElement): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  root.render(element);
  return container;
}

/** Turn the task queue until `ready()` holds. */
async function until(ready: () => boolean, what: string): Promise<void> {
  for (let turn = 0; turn < 200; turn += 1) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`gave up waiting for ${what}`);
}

/** Let `turns` more tasks run, long after any flush the test waited for. */
async function laterTasks(turns: number): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * `sample()` as taken by the first callback of a MutationObserver on `node`: a
 * microtask the commit's own DOM write queues, so it runs after the commit and
 * before the task in which React flushes that commit's passive effects.
 */
function sampleAtCommit<T>(node: Node, sample: () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const observer = new MutationObserver(() => {
      observer.disconnect();
      try {
        resolve(sample());
      } catch (error) {
        reject(error);
      }
    });
    observer.observe(node, { childList: true, characterData: true, subtree: true });
  });
}

/** A non-discrete update: a setState from a resolved promise, like a write's read-back after `await fetch(...)`. */
function updateAfterAwait(update: () => void): Promise<void> {
  return Promise.resolve().then(update);
}

function outputOf(container: HTMLElement): HTMLOutputElement {
  const output = container.querySelector('output');
  if (!output) throw new Error('the component rendered no <output>');
  return output;
}

beforeEach(() => {
  previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  bridge = null;
});

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    root.unmount();
    container.remove();
  }
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

// --- A conditional `delete` -----------------------------------------------------

let applyRow!: (row: string | null) => void;
/** The row the component's own passive effect last saw. */
let passiveRow: string | null | undefined;
let rowRegistered = false;
let deleted: Array<string | null> = [];

/**
 * `delete` exists only while a row is selected. `whenNone` is what the call site
 * passes once nothing is: a list without `delete`, or no `actions` option at all.
 * Its published shape does not change with the row, so selecting another row
 * republishes nothing: the registry's copy keeps the trampoline it was given
 * while A was selected.
 */
function RowActions({ id, whenNone }: { id: string; whenNone: 'open-only' | 'undefined' }) {
  const [row, setRow] = React.useState<string | null>('A');
  applyRow = setRow;
  const deleteAction = {
    id: 'delete',
    label: 'Delete',
    handler: () => {
      deleted.push(row);
      return `deleted ${row}`;
    },
  };
  const { registered } = useUIComponent({
    id,
    name: 'Rows',
    actions:
      whenNone === 'open-only'
        ? [
            { id: 'open', label: 'Open', handler: () => 'opened' },
            ...(row === null ? [] : [deleteAction]),
          ]
        : row === null
          ? undefined
          : [deleteAction],
  });
  React.useEffect(() => {
    passiveRow = row;
  }, [row]);
  React.useEffect(() => {
    rowRegistered = registered;
  }, [registered]);
  return <output>{row ?? 'none'}</output>;
}

/** Mount `RowActions`, select A then B, and return its `<output>`. */
async function mountAndSelectB(
  id: string,
  whenNone: 'open-only' | 'undefined'
): Promise<HTMLOutputElement> {
  passiveRow = undefined;
  rowRegistered = false;
  deleted = [];
  const container = mount(
    <UIBridgeNativeProvider>
      <BridgeProbe />
      <RowActions id={id} whenNone={whenNone} />
    </UIBridgeNativeProvider>
  );
  await until(() => rowRegistered && passiveRow === 'A', 'the component to register and settle');
  await updateAfterAwait(() => applyRow('B'));
  await until(() => passiveRow === 'B', 'B to be selected');
  return outputOf(container);
}

describe('useUIComponent — a call to an action the latest commit withdrew', () => {
  // Measured: with the refs refreshed passively the call ran B's handler, the
  // previous render's closure; with them refreshed at commit the trampoline fell
  // back to the handler captured at publish and ran A's.
  it("refuses it in the gap, running neither A's handler nor B's", async () => {
    const id = 'rn-withdrawn-action-table';
    const output = await mountAndSelectB(id, 'open-only');

    const called = sampleAtCommit(output, () => ({
      shown: output.textContent,
      passive: passiveRow,
      listed: listedActions(id),
      response: liveBridge().executor.executeComponentAction(id, { action: 'delete' }),
    }));
    // Deselect: this commit withdraws `delete`.
    await updateAfterAwait(() => applyRow(null));
    const seen = await called;

    // Sampled after the commit wrote the DOM and before its passive effects ran,
    // while the registry still listed `delete`.
    expect(seen.shown).toBe('none');
    expect(seen.passive).toBe('B');
    expect(seen.listed).toEqual(['open', 'delete']);
    const response = await seen.response;
    expect(deleted).toEqual([]);
    expect(response.success).toBe(false);
    expect(response.error).toBe(
      'Action "delete" is no longer declared by component "rn-withdrawn-action-table": its latest committed render withdrew it. Read the component again before calling one of its actions.'
    );

    // Once the passive republish has run, the registry no longer lists it and
    // the same call gets the executor's own answer for an unknown action.
    await until(() => passiveRow === null, 'the deselect to flush');
    expect(listedActions(id)).toEqual(['open']);
    const later = await liveBridge().executor.executeComponentAction(id, { action: 'delete' });
    expect(later.success).toBe(false);
    expect(later.error).toBe('Action not found: delete');
    expect(deleted).toEqual([]);
  });

  // An `actions` option that becomes `undefined` declares no actions any more.
  // Before, an absent option was not written at all, and the republish skipped
  // the actions, so the list stayed listed and callable for good; a
  // reviewer's probe measured "deleted A" long after the deselect.
  it('refuses an action whose whole `actions` option was dropped, in the gap and long after', async () => {
    const id = 'rn-withdrawn-action-dropped';
    const output = await mountAndSelectB(id, 'undefined');

    const called = sampleAtCommit(output, () => ({
      shown: output.textContent,
      passive: passiveRow,
      listed: listedActions(id),
      response: liveBridge().executor.executeComponentAction(id, { action: 'delete' }),
    }));
    // Deselect: the call site now passes `actions: undefined`.
    await updateAfterAwait(() => applyRow(null));
    const seen = await called;

    expect(seen.shown).toBe('none');
    expect(seen.passive).toBe('B');
    expect(seen.listed).toEqual(['delete']);
    const response = await seen.response;
    expect(response.success).toBe(false);
    expect(response.error).toBe(
      'Action "delete" is no longer declared by component "rn-withdrawn-action-dropped": its latest committed render withdrew it. Read the component again before calling one of its actions.'
    );

    // Long after: the republish published the withdrawal, and it stays withdrawn.
    await until(() => passiveRow === null, 'the deselect to flush');
    await laterTasks(20);
    expect(listedActions(id)).toEqual([]);
    const later = await liveBridge().executor.executeComponentAction(id, { action: 'delete' });
    expect(later.success).toBe(false);
    expect(later.error).toBe('Action not found: delete');
    expect(deleted).toEqual([]);
  });
});

// --- The other population: actions installed through `updateActions` ---------

let applyTick!: (tick: number) => void;
let imperative!: UseUIComponentReturn;
/** The tick the component's own passive effect last saw. */
let passiveTick: number | null = null;
let imperativeRegistered = false;
/** The action ids of `registeredComponent` as the last flushed render saw them. */
let renderedListed: string[] = [];
let ran: string[] = [];

/**
 * Declares NO `actions` option, and changes its `name` with the tick, so every
 * re-render also runs the republish effect, which now always publishes actions.
 */
function Imperative({ id }: { id: string }) {
  const [tick, setTick] = React.useState(0);
  applyTick = setTick;
  imperative = useUIComponent({ id, name: `Imperative ${tick}` });
  const { registered, registeredComponent } = imperative;
  React.useEffect(() => {
    passiveTick = tick;
  }, [tick]);
  React.useEffect(() => {
    imperativeRegistered = registered;
  }, [registered]);
  React.useEffect(() => {
    renderedListed = registeredComponent?.actions.map((a) => a.id) ?? [];
  }, [registeredComponent]);
  return <output>{tick}</output>;
}

/** Declares an INLINE `actions` array, a new identity on every render. */
function Toolbar({ id }: { id: string }) {
  const [tick, setTick] = React.useState(0);
  applyTick = setTick;
  imperative = useUIComponent({
    id,
    name: 'Toolbar',
    actions: [
      {
        id: 'undo',
        label: 'Undo',
        handler: () => {
          ran.push(`declared undo@${tick}`);
          return 'undone';
        },
      },
    ],
  });
  const { registered, registeredComponent } = imperative;
  React.useEffect(() => {
    passiveTick = tick;
  }, [tick]);
  React.useEffect(() => {
    imperativeRegistered = registered;
  }, [registered]);
  React.useEffect(() => {
    renderedListed = registeredComponent?.actions.map((a) => a.id) ?? [];
  }, [registeredComponent]);
  return <output>{tick}</output>;
}

const installed = {
  undo: {
    id: 'undo',
    label: 'Undo',
    handler: () => {
      ran.push('installed undo');
      return 'installed undo';
    },
  },
  redo: {
    id: 'redo',
    label: 'Redo',
    handler: () => {
      ran.push('installed redo');
      return 'redone';
    },
  },
};

function resetImperative(): void {
  passiveTick = null;
  imperativeRegistered = false;
  renderedListed = [];
  ran = [];
}

describe('useUIComponent — actions installed through updateActions stay callable', () => {
  it('keeps an installed list across re-renders of a call site that declares no actions', async () => {
    resetImperative();
    const id = 'rn-withdrawn-action-imperative';
    const container = mount(
      <UIBridgeNativeProvider>
        <BridgeProbe />
        <Imperative id={id} />
      </UIBridgeNativeProvider>
    );
    await until(() => imperativeRegistered && passiveTick === 0, 'the component to register');
    imperative.updateActions([installed.redo]);
    await until(() => renderedListed.join() === 'redo', 'the install to republish');
    const output = outputOf(container);

    const called = sampleAtCommit(output, () => ({
      passive: passiveTick,
      response: liveBridge().executor.executeComponentAction(id, { action: 'redo' }),
    }));
    await updateAfterAwait(() => applyTick(1));
    const seen = await called;

    expect(seen.passive).toBe(0);
    const response = await seen.response;
    expect(response.success).toBe(true);
    expect(response.result).toBe('redone');

    // More renders, each running the republish (the name changes with the tick).
    await updateAfterAwait(() => applyTick(2));
    await until(() => passiveTick === 2, 'the second re-render');
    await updateAfterAwait(() => applyTick(3));
    await until(() => passiveTick === 3, 'the third re-render');
    expect(liveBridge().registry.getComponent(id)?.name).toBe('Imperative 3');
    expect(listedActions(id)).toEqual(['redo']);
    const later = await liveBridge().executor.executeComponentAction(id, { action: 'redo' });
    expect(later.success).toBe(true);
    expect(ran).toEqual(['installed redo', 'installed redo']);
  });

  // With one shared ref, the next render's declared sync overwrote the install,
  // and `redo` stayed callable only through the handler captured at publish, the
  // fallback the refusal removes. Its own lane keeps it resolvable.
  it('keeps an installed action callable in the gap of a later render beside an inline declared array', async () => {
    resetImperative();
    const id = 'rn-withdrawn-action-toolbar';
    const container = mount(
      <UIBridgeNativeProvider>
        <BridgeProbe />
        <Toolbar id={id} />
      </UIBridgeNativeProvider>
    );
    await until(() => imperativeRegistered && passiveTick === 0, 'the toolbar to register');
    imperative.updateActions([installed.undo, installed.redo]);
    // The install changed the published shape, which re-renders the toolbar with
    // a new inline declared array.
    await until(() => renderedListed.join() === 'undo,redo', 'the install to republish');
    const output = outputOf(container);

    const called = sampleAtCommit(output, () => ({
      shown: output.textContent,
      passive: passiveTick,
      redo: liveBridge().executor.executeComponentAction(id, { action: 'redo' }),
      undo: liveBridge().executor.executeComponentAction(id, { action: 'undo' }),
    }));
    await updateAfterAwait(() => applyTick(1));
    const seen = await called;

    expect(seen.shown).toBe('1');
    expect(seen.passive).toBe(0);
    const redo = await seen.redo;
    const undo = await seen.undo;
    expect(redo.success).toBe(true);
    expect(redo.result).toBe('redone');
    // `undo` is in both lists: the inline array supplied a closure after the
    // install, so `declaredAtInstallRef` no longer matches and the declared one
    // runs.
    expect(undo.success).toBe(true);
    expect(undo.result).toBe('undone');
    expect(ran).toEqual(['installed redo', 'declared undo@1']);
    expect(listedActions(id)).toEqual(['undo', 'redo']);
  });

  // Unlike the parent package's native hook, the installed list is not tied to
  // the id: a declared-less call site's list has always followed its id, and a
  // call site that declares `actions` now keeps it the same way.
  it('keeps an installed list across an id change, at a call site that declares actions', async () => {
    resetImperative();
    let applyId!: (id: string) => void;
    function Cell() {
      const [cellId, setCellId] = React.useState('rn-withdrawn-action-cell-a');
      applyId = setCellId;
      imperative = useUIComponent({
        id: cellId,
        name: 'Cell',
        actions: [{ id: 'undo', label: 'Undo', handler: () => 'undone' }],
      });
      const { registered } = imperative;
      React.useEffect(() => {
        imperativeRegistered = registered;
      }, [registered]);
      return <output>{cellId}</output>;
    }
    mount(
      <UIBridgeNativeProvider>
        <BridgeProbe />
        <Cell />
      </UIBridgeNativeProvider>
    );
    await until(
      () => imperativeRegistered && listedActions('rn-withdrawn-action-cell-a') !== undefined,
      'the cell to register'
    );
    imperative.updateActions([installed.undo, installed.redo]);
    await updateAfterAwait(() => applyId('rn-withdrawn-action-cell-b'));
    await until(
      () => listedActions('rn-withdrawn-action-cell-b') !== undefined,
      'the cell to re-register under its new id'
    );

    expect(listedActions('rn-withdrawn-action-cell-a')).toBeUndefined();
    expect(listedActions('rn-withdrawn-action-cell-b')).toEqual(['undo', 'redo']);
    const response = await liveBridge().executor.executeComponentAction(
      'rn-withdrawn-action-cell-b',
      { action: 'redo' }
    );
    expect(response.success).toBe(true);
    expect(response.result).toBe('redone');
  });

  // Dropping a DECLARED option changes the declared actions (to none), and the
  // option wins on the next render that changes its signature, so the installed
  // list goes with it. Only a call site that never declares `actions` keeps one
  // (the first test in this block).
  it('clears an installed list when a declared actions option is dropped', async () => {
    resetImperative();
    const id = 'rn-withdrawn-action-drop-installed';
    let applyEditing!: (editing: boolean) => void;
    function Editor() {
      const [editing, setEditing] = React.useState(true);
      applyEditing = setEditing;
      imperative = useUIComponent({
        id,
        name: 'Editor',
        actions: editing ? [{ id: 'save', label: 'Save', handler: () => 'saved' }] : undefined,
      });
      const { registered } = imperative;
      React.useEffect(() => {
        imperativeRegistered = registered;
      }, [registered]);
      return <output>{editing ? 'editing' : 'viewing'}</output>;
    }
    mount(
      <UIBridgeNativeProvider>
        <BridgeProbe />
        <Editor />
      </UIBridgeNativeProvider>
    );
    await until(
      () => imperativeRegistered && listedActions(id)?.join() === 'save',
      'the editor to register'
    );
    imperative.updateActions([
      { id: 'save', label: 'Save', handler: () => 'saved' },
      installed.redo,
    ]);
    await until(() => listedActions(id)?.join() === 'save,redo', 'the install to republish');

    await updateAfterAwait(() => applyEditing(false));
    await until(() => listedActions(id)?.length === 0, 'the drop to republish');

    const response = await liveBridge().executor.executeComponentAction(id, { action: 'redo' });
    expect(response.success).toBe(false);
    expect(ran).toEqual([]);
  });
});
