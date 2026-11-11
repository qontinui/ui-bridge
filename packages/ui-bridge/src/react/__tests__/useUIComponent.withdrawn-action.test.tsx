/**
 * A component action call to an action that the latest committed render
 * WITHDREW is refused: no handler runs, and the call fails naming the action.
 *
 * Plan `2026-11-08-ui-bridge-useuicomponent-state-lags-the-dom-by-one-task`.
 * `useUIComponent` publishes its actions to the registry from a passive effect,
 * so after a commit that withdraws an action (one that exists only while a row
 * is selected, say) the registry still lists it until that effect runs. For a
 * non-discrete update that is a task later under React 19, whose scheduler
 * yields after every commit; React 18's scheduler yields only once its 5 ms
 * frame is spent, so there the gap is rarer. A call in the gap reaches the
 * registered wrapper. The wrapper resolves the handler through `findAction`:
 * the declared list, refreshed in a layout effect so it is the committed
 * render's, and the `updateActions` list, with the `declaredAtInstallRef`
 * comparison picking between them for an id in both. When neither provides the
 * id, the wrapper throws `ComponentActionUnavailableError`, and the executor
 * answers it under `UB-UNSUPPORTED-ACTION`, as it answers an action the registry
 * does not list. Before the refusal the wrapper returned `undefined` there, and
 * the executor reported `success: true` with no handler run.
 *
 * Why not RTL: `render`, `rerender` and `act` flush every effect before they
 * return, so under `act()` the gap does not exist. This file drives
 * `react-dom/client` directly with `IS_REACT_ACT_ENVIRONMENT = false` (importing
 * RTL would set it back to `true` in a global `beforeAll`), makes each update
 * from a resolved promise, and calls the action from a `MutationObserver` on the
 * component's own DOM: a microtask the commit's DOM write queues, which runs
 * after the commit and before the passive flush. The test asserts the call sat
 * in the gap: the component's own passive effect had not seen the deselect, and
 * the registry still listed the action.
 *
 * Under the REAL `UIBridgeProvider`, through `ActionExecutor.executeComponentAction`.
 * Every expectation is a hand-written literal.
 */

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  UIBridgeProvider,
  useUIBridgeOptional,
  type UIBridgeContextValue,
} from '../UIBridgeProvider';
import { useUIComponent } from '../useUIComponent';

// --- Harness ----------------------------------------------------------------

type ActEnvironmentGlobal = typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const actEnvironment = globalThis as ActEnvironmentGlobal;
let previousActEnvironment: boolean | undefined;
const mounted: Array<{ root: Root; container: HTMLElement }> = [];

/** The real provider's context value, handed out by `BridgeProbe`. */
let bridge: UIBridgeContextValue | null = null;

function BridgeProbe(): null {
  bridge = useUIBridgeOptional();
  return null;
}

function liveBridge(): UIBridgeContextValue {
  if (!bridge) throw new Error('no UIBridgeProvider is mounted');
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

// --- A table whose `delete` exists only while a row is selected ---------------

const TABLE_ID = 'withdrawn-action-table';
let applyRow!: (row: string | null) => void;
/** The row the table's own passive effect last saw. */
let passiveRow: string | null | undefined;
let deleted: Array<string | null> = [];

function Table(): React.ReactElement {
  const [row, setRow] = React.useState<string | null>('A');
  applyRow = setRow;
  useUIComponent({
    id: TABLE_ID,
    name: 'Table',
    // The published shape of `delete` does not change with the row, so selecting
    // another row republishes nothing: the registry's copy keeps the wrapper it
    // was given while A was selected.
    actions: [
      { id: 'open', label: 'Open', handler: () => 'opened' },
      ...(row === null
        ? []
        : [
            {
              id: 'delete',
              label: 'Delete',
              handler: () => {
                deleted.push(row);
                return `deleted ${row}`;
              },
            },
          ]),
    ],
  });
  React.useEffect(() => {
    passiveRow = row;
  }, [row]);
  return <output>{row ?? 'none'}</output>;
}

describe('useUIComponent — a call to an action the latest commit withdrew', () => {
  // Measured: with the refs refreshed passively the call ran B's handler, the
  // previous render's closure; with them refreshed at commit and no refusal it
  // ran nothing and reported `success: true`.
  it("refuses it in the gap, running neither A's handler nor B's", async () => {
    passiveRow = undefined;
    deleted = [];
    const container = mount(
      <UIBridgeProvider>
        <BridgeProbe />
        <Table />
      </UIBridgeProvider>
    );
    await until(
      () => passiveRow === 'A' && bridge?.registry.getComponent(TABLE_ID) !== undefined,
      'the table to mount and register'
    );
    await updateAfterAwait(() => applyRow('B'));
    await until(() => passiveRow === 'B', 'B to be selected');
    const output = container.querySelector('output');
    if (!output) throw new Error('the table rendered no <output>');

    const called = sampleAtCommit(output, () => ({
      shown: output.textContent,
      passive: passiveRow,
      listed: listedActions(TABLE_ID),
      response: liveBridge().executor.executeComponentAction(TABLE_ID, { action: 'delete' }),
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
      'Action "delete" is no longer declared by component "withdrawn-action-table": its latest committed render withdrew it. Read the component again before calling one of its actions.'
    );
    // The code of an action the registry does not list, not a retryable failure.
    expect(response.failureDetails?.errorCode).toBe('UB-UNSUPPORTED-ACTION');

    // Once the passive republish has run, the registry no longer lists it and
    // the same call gets the executor's own answer, under the same code.
    await until(() => passiveRow === null, 'the deselect to flush');
    expect(listedActions(TABLE_ID)).toEqual(['open']);
    const later = await liveBridge().executor.executeComponentAction(TABLE_ID, {
      action: 'delete',
    });
    expect(later.success).toBe(false);
    expect(later.error).toBe('Action not found: delete');
    expect(later.failureDetails?.errorCode).toBe('UB-UNSUPPORTED-ACTION');
    expect(deleted).toEqual([]);
  });
});
