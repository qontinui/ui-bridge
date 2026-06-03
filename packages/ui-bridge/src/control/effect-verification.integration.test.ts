/**
 * D3 Effect Calculus — end-to-end integration through executeAction.
 *
 * Proves the opt-in wiring: when effect verification is enabled and a signature
 * resolves for the (action, element), `executeAction` returns an
 * `effectVerification` on the response; when disabled (the default) it does not,
 * and action behaviour is unchanged.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from './action-executor';
import {
  getGlobalActionWindowRegistry,
  resetGlobalActionWindowRegistry,
} from './action-window-registry';
import { resetGlobalEffectStore, getGlobalEffectStore } from './effect-store';

describe('DefaultActionExecutor — D3 effect verification wiring', () => {
  let registry: UIBridgeRegistry;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
    // Phase 2 globals — isolate per test.
    resetGlobalActionWindowRegistry();
    resetGlobalEffectStore();
  });

  afterEach(() => {
    document.body.removeChild(container);
    resetGlobalActionWindowRegistry();
    resetGlobalEffectStore();
  });

  function makeButton(id: string): HTMLButtonElement {
    const el = document.createElement('button');
    el.setAttribute('data-testid', id);
    container.appendChild(el);
    return el;
  }

  it('is OFF by default — no effectVerification, behaviour unchanged', async () => {
    const executor = new DefaultActionExecutor(registry);
    const btn = makeButton('menu-btn');
    registry.registerElement('menu-btn', btn, {
      type: 'button',
      label: 'Menu',
      reveals: ['user-menu'],
    });

    const res = await executor.executeAction('menu-btn', { action: 'click' });

    expect(res.success).toBe(true);
    expect(res.effectVerification).toBeUndefined();
  });

  it('Confirmed: a click that reveals its predicted element', async () => {
    const executor = new DefaultActionExecutor(registry, undefined, {
      enableEffectVerification: true,
    });
    const btn = makeButton('menu-btn');
    registry.registerElement('menu-btn', btn, {
      type: 'button',
      label: 'Menu',
      reveals: ['user-menu'],
    });

    // The click reveals the user-menu: register it during the click so it is
    // present in the post-snapshot but absent from the pre-snapshot → "appeared".
    btn.addEventListener('click', () => {
      const menu = document.createElement('div');
      menu.setAttribute('data-testid', 'user-menu');
      container.appendChild(menu);
      registry.registerElement('user-menu', menu, { type: 'menu', label: 'User Menu' });
    });

    const res = await executor.executeAction('menu-btn', { action: 'click' });

    expect(res.success).toBe(true);
    expect(res.effectVerification).toBeDefined();
    expect(res.effectVerification?.outcome).toBe('Confirmed');
    expect(res.effectVerification?.containment.predictedSubsetObserved).toBe(true);
    expect(res.effectVerification?.predicted.elementsAppear).toEqual([{ id: 'user-menu' }]);
  });

  it('Failure: a click whose predicted reveal never appears', async () => {
    const executor = new DefaultActionExecutor(registry, undefined, {
      enableEffectVerification: true,
    });
    const btn = makeButton('menu-btn');
    registry.registerElement('menu-btn', btn, {
      type: 'button',
      label: 'Menu',
      reveals: ['user-menu'],
    });
    // No click handler — nothing is revealed.

    const res = await executor.executeAction('menu-btn', { action: 'click' });

    expect(res.success).toBe(true);
    expect(res.effectVerification?.outcome).toBe('Failure');
    expect(res.effectVerification?.containment.predictedSubsetObserved).toBe(false);
  });

  it('no signature → no verification even when enabled (honest no-op)', async () => {
    const executor = new DefaultActionExecutor(registry, undefined, {
      enableEffectVerification: true,
    });
    // A click on an element WITHOUT `reveals` resolves no signature.
    const btn = makeButton('plain-btn');
    registry.registerElement('plain-btn', btn, { type: 'button', label: 'Plain' });

    const res = await executor.executeAction('plain-btn', { action: 'click' });

    expect(res.success).toBe(true);
    expect(res.effectVerification).toBeUndefined();
  });

  it('can be toggled at runtime via setEffectVerificationEnabled', async () => {
    const executor = new DefaultActionExecutor(registry);
    const btn = makeButton('menu-btn');
    registry.registerElement('menu-btn', btn, {
      type: 'button',
      label: 'Menu',
      reveals: ['user-menu'],
    });

    const off = await executor.executeAction('menu-btn', { action: 'click' });
    expect(off.effectVerification).toBeUndefined();

    executor.setEffectVerificationEnabled(true);
    const on = await executor.executeAction('menu-btn', { action: 'click' });
    expect(on.effectVerification).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Phase 2 — settle-window cause attribution
  // -------------------------------------------------------------------------

  it("cause: 'causal' for a clean Confirmed (no concurrent observation)", async () => {
    const executor = new DefaultActionExecutor(registry, undefined, {
      enableEffectVerification: true,
    });
    const btn = makeButton('menu-btn');
    registry.registerElement('menu-btn', btn, {
      type: 'button',
      label: 'Menu',
      reveals: ['user-menu'],
    });
    btn.addEventListener('click', () => {
      const menu = document.createElement('div');
      menu.setAttribute('data-testid', 'user-menu');
      container.appendChild(menu);
      registry.registerElement('user-menu', menu, { type: 'menu', label: 'User Menu' });
    });

    const res = await executor.executeAction('menu-btn', { action: 'click' });

    expect(res.effectVerification?.outcome).toBe('Confirmed');
    expect(res.effectVerification?.cause).toBe('causal');
  });

  it("cause: 'mixed' downgrades Confirmed → Surprise when a concurrent observation lands in the window", async () => {
    const executor = new DefaultActionExecutor(registry, undefined, {
      enableEffectVerification: true,
    });
    const btn = makeButton('menu-btn');
    registry.registerElement('menu-btn', btn, {
      type: 'button',
      label: 'Menu',
      reveals: ['user-menu'],
    });

    // The click reveals the predicted element (would be Confirmed) AND
    // simulates the BackgroundObserver flagging a concurrent significant change
    // inside the open settle window → the verifier reports cause: 'mixed' and
    // computeVerification downgrades Confirmed → Surprise.
    btn.addEventListener('click', () => {
      const menu = document.createElement('div');
      menu.setAttribute('data-testid', 'user-menu');
      container.appendChild(menu);
      registry.registerElement('user-menu', menu, { type: 'menu', label: 'User Menu' });
      getGlobalActionWindowRegistry().recordConcurrentObservation(Date.now());
    });

    const res = await executor.executeAction('menu-btn', {
      action: 'click',
      requestId: 'req-mixed-1',
    });

    expect(res.effectVerification?.cause).toBe('mixed');
    expect(res.effectVerification?.outcome).toBe('Surprise');
    // The underlying containment still holds (P ⊆ O ∧ O ⊆ P) — only the
    // terminal outcome was downgraded by the mixed cause.
    expect(res.effectVerification?.containment.predictedSubsetObserved).toBe(true);
    expect(res.effectVerification?.containment.observedSubsetPredicted).toBe(true);
  });

  it('records each verified cycle into the global effect store (newest-first)', async () => {
    const executor = new DefaultActionExecutor(registry, undefined, {
      enableEffectVerification: true,
    });
    const btn = makeButton('menu-btn');
    registry.registerElement('menu-btn', btn, {
      type: 'button',
      label: 'Menu',
      reveals: ['user-menu'],
    });
    btn.addEventListener('click', () => {
      const menu = document.createElement('div');
      menu.setAttribute('data-testid', 'user-menu');
      container.appendChild(menu);
      registry.registerElement('user-menu', menu, { type: 'menu', label: 'User Menu' });
    });

    await executor.executeAction('menu-btn', { action: 'click', requestId: 'req-store-1' });

    const recent = getGlobalEffectStore().getRecent();
    expect(recent.length).toBe(1);
    expect(recent[0].action).toBe('click');
    expect(recent[0].elementId).toBe('menu-btn');
    expect(recent[0].requestId).toBe('req-store-1');
    expect(recent[0].outcome).toBe('Confirmed');
    expect(recent[0].cause).toBe('causal');
  });

  it('does NOT record into the effect store when verification is disabled', async () => {
    const executor = new DefaultActionExecutor(registry);
    const btn = makeButton('menu-btn');
    registry.registerElement('menu-btn', btn, {
      type: 'button',
      label: 'Menu',
      reveals: ['user-menu'],
    });

    await executor.executeAction('menu-btn', { action: 'click' });

    expect(getGlobalEffectStore().getRecent().length).toBe(0);
  });
});
