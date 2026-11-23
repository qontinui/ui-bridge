/**
 * ARMING — plan 2026-11-08-relayed-ui-bridge-actions-have-no-browser-case,
 * Phase 2: the four read-only verbs the relay already sends to browser tabs
 * (`getElementReactState`, `getDiagnostics`, `getElementHistory`,
 * `getRecentEffects`) are answered by the page.
 *
 * Enters where exec mode's population enters: the injected bootstrap and the
 * `window.__uiBridgeInjected.execute` it installs. Nothing here calls the
 * dispatcher directly.
 *
 * Before this phase `getElementReactState` and `getDiagnostics` rejected with
 * `Unknown command action: …`, and `getElementHistory` / `getRecentEffects`
 * did too — which the relay's `relayWithFallback` turned into an empty
 * success on every call.
 *
 * Each case boots a fresh runtime: `import('./bootstrap')` is cached per test
 * file, so `vi.resetModules()` runs before every re-import.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGlobalRegistry, setGlobalRegistry, UIBridgeRegistry } from '../core/registry';
import { REDACTED_VALUE } from '../core/redaction';
import { getGlobalEffectStore, resetGlobalEffectStore } from '../control/effect-store';
import type { EffectRecordEntry } from '../control/effect-store';

/** A fresh injected runtime over the current DOM. */
async function bootRuntime() {
  vi.resetModules();
  await import('./bootstrap');
  const api = window.__uiBridgeInjected!;
  expect(api.ready).toBe(true);
  return api;
}

function SaveButton() {
  return null;
}

/**
 * Give a DOM node fake React internals, as `extract-react-state.test.ts`
 * builds them: a host fiber whose `return` is a function component holding
 * one hook, and the host's props.
 */
function withReactInternals<T extends HTMLElement>(el: T, props: Record<string, unknown>): T {
  const component = {
    type: SaveButton,
    memoizedState: { memoizedState: 3, next: null },
  };
  const host = { type: el.tagName.toLowerCase(), memoizedState: null, return: component };
  Object.defineProperty(el, '__reactFiber$arming', { value: host, enumerable: true });
  Object.defineProperty(el, '__reactProps$arming', { value: props, enumerable: true });
  return el;
}

interface Failure {
  success: false;
  error: string;
  failureDetails: { errorCode: string; elementId: string };
}

beforeEach(() => {
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
  withReactInternals(react, { 'data-testid': 'react', label: 'Save', onClick: () => {} });

  const boundary = document.createElement('div');
  boundary.setAttribute('data-bridge-redact', 'true');
  const secret = document.createElement('button');
  secret.setAttribute('data-testid', 'secret');
  secret.textContent = 'Reveal';
  withReactInternals(secret, { 'data-testid': 'secret', label: 'Account 4111', onClick: () => {} });
  boundary.append(secret);

  const pw = document.createElement('input');
  pw.type = 'password';
  pw.setAttribute('data-testid', 'pw');
  withReactInternals(pw, { type: 'password', value: 'hunter2', onChange: () => {} });

  document.body.append(go, react, boundary, pw);
});

afterEach(() => {
  delete window.__uiBridgeInjected;
  setGlobalRegistry(new UIBridgeRegistry());
  resetGlobalEffectStore();
  document.body.innerHTML = '';
});

describe('injected execute("getElementReactState")', () => {
  it('a React element answers its prop keys and values, hook state and component', async () => {
    const api = await bootRuntime();
    const state = await api.execute('getElementReactState', { id: 'dom-react' });
    expect(state).toEqual({
      props: { 'data-testid': 'react', label: 'Save', onClick: '[Function]' },
      fiberState: [3],
      componentName: 'SaveButton',
    });
  }, 30_000);

  it.each([
    [
      'inside data-bridge-redact="true"',
      'dom-secret',
      { 'data-testid': REDACTED_VALUE, label: REDACTED_VALUE, onClick: REDACTED_VALUE },
    ],
    [
      'a password input',
      'dom-pw',
      { type: REDACTED_VALUE, value: REDACTED_VALUE, onChange: REDACTED_VALUE },
    ],
  ])(
    '%s answers every prop value as the redaction sentinel, with no fiber state',
    async (_label, id, props) => {
      const api = await bootRuntime();
      const state = await api.execute('getElementReactState', { id });
      expect(state).toEqual({ props, fiberState: [], componentName: undefined });
    },
    30_000
  );

  it('a non-React element answers the typed "not React" shape with the note', async () => {
    const api = await bootRuntime();
    const state = await api.execute('getElementReactState', { id: 'dom-go' });
    expect(state).toEqual({
      props: {},
      fiberState: [],
      componentName: undefined,
      note: 'No React internals found on this element',
    });
  }, 30_000);

  it('the WebSocket protocol\'s {"elementId"} spelling is read too', async () => {
    const api = await bootRuntime();
    const state = (await api.execute('getElementReactState', { elementId: 'dom-react' })) as {
      componentName?: string;
    };
    expect(state.componentName).toBe('SaveButton');
  }, 30_000);

  it('an unknown id answers a RETURNED ELEMENT_NOT_FOUND', async () => {
    const api = await bootRuntime();
    const answer = (await api.execute('getElementReactState', { id: 'dom-nope' })) as Failure;
    expect(answer.success).toBe(false);
    expect(answer.error).toBe('Element dom-nope not found');
    expect(answer.failureDetails.errorCode).toBe('ELEMENT_NOT_FOUND');
    expect(answer.failureDetails.elementId).toBe('dom-nope');
  }, 30_000);

  it('a registration whose DOM node is gone answers ELEMENT_NOT_FOUND', async () => {
    const api = await bootRuntime();
    // Registered, never attached: the registration outlives its node.
    getGlobalRegistry().registerElement('detached', document.createElement('button'), {
      type: 'button',
    });
    const answer = (await api.execute('getElementReactState', { id: 'detached' })) as Failure;
    expect(answer.success).toBe(false);
    expect(answer.error).toBe('DOM element for detached not found');
    expect(answer.failureDetails.errorCode).toBe('ELEMENT_NOT_FOUND');
  }, 30_000);

  it('a payload with no id is refused INVALID_REQUEST', async () => {
    const api = await bootRuntime();
    const answer = (await api.execute('getElementReactState', {})) as Failure;
    expect(answer.success).toBe(false);
    expect(answer.failureDetails.errorCode).toBe('INVALID_REQUEST');
  }, 30_000);
});

describe('injected execute("getDiagnostics")', () => {
  it('answers the registry count and the page URL', async () => {
    const api = await bootRuntime();
    const diag = (await api.execute('getDiagnostics', {})) as Record<string, unknown>;
    const registered = getGlobalRegistry().getAllElements().length;
    expect(registered).toBe(4);
    expect(diag.registered_elements).toBe(4);
    expect(diag.page_url).toBe('http://localhost:3000/');
    expect(diag.page_url).toBe(window.location.href);
    // Exec mode mounts no provider: no `window.__UI_BRIDGE__`, no adapter.
    expect(diag.sdk_initialized).toBe(false);
    expect(diag.navigation_adapter).toBe('window-location');
    expect(diag.capabilities).toEqual(['control', 'find', 'ai']);
    expect(diag.dom_interactive_elements).toBe(4);
  }, 30_000);
});

describe('injected execute("getElementHistory")', () => {
  it('{elementId, options} returns the entries the registry logged, after one state change', async () => {
    const api = await bootRuntime();
    getGlobalRegistry().dispatchEvent('element:stateChanged', {
      elementId: 'dom-go',
      state: { focused: true },
    });
    const entries = (await api.execute('getElementHistory', {
      elementId: 'dom-go',
      options: {},
    })) as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      elementId: 'dom-go',
      eventType: 'element:stateChanged',
      level: 'info',
      message: 'State changed: dom-go',
      data: { elementId: 'dom-go', state: { focused: true } },
    });
  }, 30_000);

  it('the registry options are passed through (eventTypes filters the log)', async () => {
    const api = await bootRuntime();
    getGlobalRegistry().dispatchEvent('element:stateChanged', { elementId: 'dom-go' });
    const entries = await api.execute('getElementHistory', {
      elementId: 'dom-go',
      options: { eventTypes: ['action:failed'] },
    });
    expect(entries).toEqual([]);
  }, 30_000);
});

describe('injected execute("getRecentEffects")', () => {
  it('{limit:"1"} returns the store\'s newest entry, the string limit coerced', async () => {
    const api = await bootRuntime();
    const older = { action: 'click', elementId: 'dom-go', timestamp: 1 } as EffectRecordEntry;
    const newer = { action: 'type', elementId: 'dom-go', timestamp: 2 } as EffectRecordEntry;
    getGlobalEffectStore().record(older);
    getGlobalEffectStore().record(newer);
    const recent = await api.execute('getRecentEffects', { limit: '1' });
    expect(recent).toEqual([newer]);
  }, 30_000);

  it('no limit returns every record, newest first', async () => {
    const api = await bootRuntime();
    const older = { action: 'click', timestamp: 1 } as EffectRecordEntry;
    const newer = { action: 'type', timestamp: 2 } as EffectRecordEntry;
    getGlobalEffectStore().record(older);
    getGlobalEffectStore().record(newer);
    expect(await api.execute('getRecentEffects', {})).toEqual([newer, older]);
  }, 30_000);
});
