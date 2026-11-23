/**
 * TRANSPORT PARITY — the four read verbs answer the same thing whichever
 * transport serves them (plan 2026-11-08-relayed-ui-bridge-actions-have-no-browser-case,
 * Phase 2, D5).
 *
 * Over the same jsdom page and the same registry:
 *   - the page: `window.__uiBridgeInjected.execute(<verb>, …)` (exec mode; the
 *     relay reaches the same dispatcher);
 *   - in-process: `createHandlers(…).<verb>`, whose envelope `data` must
 *     deep-equal the page's answer on success. A failure is the page's
 *     returned answer lifted by the shared inner-failure rule: the canonical
 *     `UB-*` code on the envelope, the raw code in `data.failureDetails`.
 *
 * A registry that keeps no history answers the existing typed
 * `UB-CAPABILITY-UNAVAILABLE` envelope on both, never `[]`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGlobalRegistry, setGlobalRegistry, UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from '../control/action-executor';
import { getGlobalEffectStore, resetGlobalEffectStore } from '../control/effect-store';
import type { EffectRecordEntry } from '../control/effect-store';
import { createHandlers, type RegistryLike } from '../server/handlers';

function SaveButton() {
  return null;
}

const CAPABILITY_UNAVAILABLE = {
  success: false,
  code: 'UB-CAPABILITY-UNAVAILABLE',
  data: { code: 'capability_unavailable_in_build', reason: 'registry_has_no_history' },
};

let api: NonNullable<Window['__uiBridgeInjected']>;
let handlers: ReturnType<typeof createHandlers>;

function handlersOver(registry: UIBridgeRegistry | RegistryLike) {
  return createHandlers(
    registry as unknown as RegistryLike,
    new DefaultActionExecutor(registry as UIBridgeRegistry) as never
  );
}

beforeEach(async () => {
  delete window.__uiBridgeInjected;
  delete window.__uiBridgeInjectedConfig;
  resetGlobalEffectStore();
  document.body.innerHTML = '';
  const go = document.createElement('button');
  go.setAttribute('data-testid', 'go');
  go.textContent = 'Go';
  const react = document.createElement('button');
  react.setAttribute('data-testid', 'react');
  react.textContent = 'Save';
  Object.defineProperty(react, '__reactFiber$parity', {
    value: {
      type: 'button',
      memoizedState: null,
      return: { type: SaveButton, memoizedState: { memoizedState: 'on', next: null } },
    },
    enumerable: true,
  });
  Object.defineProperty(react, '__reactProps$parity', {
    value: { 'data-testid': 'react', onClick: () => {} },
    enumerable: true,
  });
  document.body.append(go, react);

  vi.resetModules();
  await import('./bootstrap');
  api = window.__uiBridgeInjected!;
  expect(api.ready).toBe(true);
  // The in-process server over the SAME registry the page just populated.
  handlers = handlersOver(getGlobalRegistry());
}, 30_000);

afterEach(() => {
  delete window.__uiBridgeInjected;
  setGlobalRegistry(new UIBridgeRegistry());
  resetGlobalEffectStore();
  document.body.innerHTML = '';
});

describe('getElementReactState · one projection on the page and in-process', () => {
  it.each([['dom-react'], ['dom-go']])('%s: the answers deep-equal', async (id) => {
    const page = await api.execute('getElementReactState', { id });
    const envelope = await handlers.getElementReactState(id);
    expect(envelope.success).toBe(true);
    expect(envelope.data).toEqual(page);
  });

  it('the React element answers the same literal on both', async () => {
    const expected = {
      props: { 'data-testid': 'react', onClick: '[Function]' },
      fiberState: ['on'],
      componentName: 'SaveButton',
    };
    expect(await api.execute('getElementReactState', { id: 'dom-react' })).toEqual(expected);
    expect((await handlers.getElementReactState('dom-react')).data).toEqual(expected);
  });

  it.each([
    ['an unknown id', 'dom-nope', 'Element dom-nope not found'],
    ['a registration whose DOM node is gone', 'detached', 'DOM element for detached not found'],
  ])('%s: ELEMENT_NOT_FOUND on both, UB-ELEM-NOT-FOUND on the envelope', async (_l, id, error) => {
    getGlobalRegistry().registerElement('detached', document.createElement('button'), {
      type: 'button',
    });
    const page = (await api.execute('getElementReactState', { id })) as {
      success: boolean;
      error: string;
      failureDetails: { errorCode: string };
    };
    expect(page.success).toBe(false);
    expect(page.error).toBe(error);
    expect(page.failureDetails.errorCode).toBe('ELEMENT_NOT_FOUND');

    const envelope = await handlers.getElementReactState(id);
    expect(envelope.success).toBe(false);
    expect(envelope.error).toBe(error);
    expect(envelope.code).toBe('UB-ELEM-NOT-FOUND');
    expect(
      (envelope.data as { failureDetails: { errorCode: string; elementId: string } }).failureDetails
    ).toMatchObject({ errorCode: 'ELEMENT_NOT_FOUND', elementId: id });
  });
});

describe('getDiagnostics · one builder on the page and in-process', () => {
  it('the answers deep-equal', async () => {
    const page = await api.execute('getDiagnostics', {});
    const envelope = await handlers.getDiagnostics();
    expect(envelope.success).toBe(true);
    expect(envelope.data).toEqual(page);
    expect((page as { registered_elements: number }).registered_elements).toBe(2);
  });
});

describe('getElementHistory · one command on the page and in-process', () => {
  it('the logged entries deep-equal', async () => {
    getGlobalRegistry().dispatchEvent('element:stateChanged', { elementId: 'dom-go' });
    const page = await api.execute('getElementHistory', { elementId: 'dom-go', options: {} });
    const envelope = await handlers.getElementHistory('dom-go', {});
    expect(envelope.success).toBe(true);
    expect(envelope.data).toEqual(page);
    expect(page).toHaveLength(1);
  });

  it('a registry built without an event log: UB-CAPABILITY-UNAVAILABLE on both, never []', async () => {
    const noLog = new UIBridgeRegistry();
    setGlobalRegistry(noLog);
    const page = await api.execute('getElementHistory', { elementId: 'dom-go' });
    expect(page).toMatchObject(CAPABILITY_UNAVAILABLE);

    const envelope = await handlersOver(noLog).getElementHistory('dom-go');
    expect(envelope).toMatchObject(CAPABILITY_UNAVAILABLE);
    expect(envelope.error).toBe((page as { error: string }).error);
    expect(typeof envelope.timestamp).toBe('number');
  });

  it('a registry with no getElementHistory at all answers the same envelope in-process', async () => {
    const registry = getGlobalRegistry();
    const bare = {
      getElement: (id: string) => registry.getElement(id),
      getAllElements: () => registry.getAllElements(),
      getAllComponents: () => registry.getAllComponents(),
      getAllWorkflows: () => registry.getAllWorkflows(),
      createSnapshot: () => registry.createSnapshot(),
    } as unknown as RegistryLike;
    const envelope = await handlersOver(bare).getElementHistory('dom-go');
    expect(envelope).toEqual({
      ...CAPABILITY_UNAVAILABLE,
      error: expect.stringContaining('keeps no element history'),
      timestamp: expect.any(Number),
    });
  });
});

describe('getRecentEffects · one command on the page and in-process', () => {
  it.each([[{ limit: '1' }], [{ limit: 1 }], [{}], [{ limit: '' }], [{ limit: 'many' }]])(
    '%j: the answers deep-equal',
    async (payload) => {
      getGlobalEffectStore().record({ action: 'click', timestamp: 1 } as EffectRecordEntry);
      getGlobalEffectStore().record({ action: 'type', timestamp: 2 } as EffectRecordEntry);
      const page = await api.execute('getRecentEffects', payload);
      const envelope = await handlers.getRecentEffects(payload as never);
      expect(envelope.success).toBe(true);
      expect(envelope.data).toEqual(page);
      expect((page as unknown[]).length).toBe(
        'limit' in payload && Number(payload.limit) === 1 ? 1 : 2
      );
    }
  );
});
