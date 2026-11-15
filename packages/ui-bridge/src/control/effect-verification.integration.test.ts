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
import { EffectVerifier } from './effect-verifier';
import type { SemanticSnapshot } from '../ai/types';

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

  it('per-request verifyEffect: true verifies a single action with the global flag OFF', async () => {
    // Executor verification is OFF (default) — the per-request flag opts in.
    const executor = new DefaultActionExecutor(registry);

    // Helper: a button that reveals `revealId` (registered on click).
    const wireReveal = (btnId: string, revealId: string) => {
      const btn = makeButton(btnId);
      registry.registerElement(btnId, btn, { type: 'button', label: btnId, reveals: [revealId] });
      btn.addEventListener('click', () => {
        const el = document.createElement('div');
        el.setAttribute('data-testid', revealId);
        container.appendChild(el);
        registry.registerElement(revealId, el, { type: 'menu', label: revealId });
      });
    };

    // Distinct buttons/reveals so each click is a clean first appearance.
    wireReveal('btn-a', 'menu-a');
    wireReveal('btn-b', 'menu-b');

    // Without the flag: no verification (proves it's genuinely off globally).
    const off = await executor.executeAction('btn-a', { action: 'click' });
    expect(off.success).toBe(true);
    expect(off.effectVerification).toBeUndefined();

    // With verifyEffect: true on the request: this single action is verified.
    const on = await executor.executeAction('btn-b', { action: 'click', verifyEffect: true });
    expect(on.effectVerification).toBeDefined();
    expect(on.effectVerification?.outcome).toBe('Confirmed');
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

  /**
   * Drive a slow click (500 ms of pinned time, past the 150 ms click band)
   * through `executeAction`, with ONE concurrent observation: either late in
   * the action body (before the settle starts) or 50 ms into the real settle.
   * Each case alone must yield 'mixed', so each half of the window — the
   * action body and the settle — is pinned separately.
   */
  async function runSlowClickObservedOnce(observeDuring: 'action' | 'settle') {
    const SETTLE_MS = 150; // the click band
    const ACTION_MS = 500; // the click outlasts the band
    let clock = 50_000;
    let openedAt = Number.NaN;
    let settleStartedAt = Number.NaN;
    const observations: number[] = [];
    const observe = (atMs: number) => {
      observations.push(atMs);
      getGlobalActionWindowRegistry().recordConcurrentObservation(atMs);
    };

    const executor = new DefaultActionExecutor(registry, undefined, {
      enableEffectVerification: true,
      effectTiming: {
        now: () => {
          // The first read inside the action cycle is the verifier's own start;
          // record the clock before the action advances it.
          if (Number.isNaN(openedAt)) openedAt = clock;
          return clock;
        },
        settle: async (ms) => {
          expect(ms).toBe(SETTLE_MS);
          settleStartedAt = clock;
          if (observeDuring === 'settle') observe(clock + 50); // inside the real settle
          clock += ms;
        },
      },
    });
    const btn = makeButton('menu-btn');
    registry.registerElement('menu-btn', btn, {
      type: 'button',
      label: 'Menu',
      reveals: ['user-menu'],
    });
    btn.addEventListener('click', () => {
      clock += ACTION_MS; // the action takes 500 ms of (pinned) time
      const menu = document.createElement('div');
      menu.setAttribute('data-testid', 'user-menu');
      container.appendChild(menu);
      registry.registerElement('user-menu', menu, { type: 'menu', label: 'User Menu' });
      if (observeDuring === 'action') observe(clock - 1); // late in the action body
    });

    const res = await executor.executeAction('menu-btn', {
      action: 'click',
      requestId: `req-mixed-slow-${observeDuring}`,
    });

    // Exactly one observation, outside a window anchored at open time.
    expect(observations.length).toBe(1);
    expect(observations[0]).toBeGreaterThan(openedAt + SETTLE_MS);
    if (observeDuring === 'action') {
      expect(observations[0]).toBeLessThan(settleStartedAt);
    } else {
      expect(observations[0]).toBeGreaterThan(settleStartedAt);
      expect(observations[0]).toBeLessThan(settleStartedAt + SETTLE_MS);
    }
    expect(res.effectVerification?.cause).toBe('mixed');
    expect(res.effectVerification?.outcome).toBe('Surprise');
    expect(res.effectVerification?.containment.predictedSubsetObserved).toBe(true);
    expect(res.effectVerification?.containment.observedSubsetPredicted).toBe(true);
    expect(res.effectVerification?.durationMs).toBe(ACTION_MS + SETTLE_MS);
  }

  it("cause: 'mixed' when a slow click (outlasting settleMs) is observed only late in the action body, via executeAction on a pinned clock", async () => {
    await runSlowClickObservedOnce('action');
  });

  it("cause: 'mixed' when a slow click (outlasting settleMs) is observed only during the real settle, via executeAction on a pinned clock", async () => {
    await runSlowClickObservedOnce('settle');
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

/**
 * Finding 736a7c2c: the window was anchored to `begin` (before the action ran),
 * so an action slower than `settleMs` expired it before the real settle began
 * and an observation during that settle was dropped (`causal`, not `mixed`).
 * The clock is pinned through the verifier's `now` seam, so this is
 * deterministic under any load — no real time elapses that matters.
 */
describe('EffectVerifier — the settle window is anchored to the real settle', () => {
  beforeEach(() => resetGlobalActionWindowRegistry());
  afterEach(() => resetGlobalActionWindowRegistry());

  function snapshot(elementIds: string[], at: number): SemanticSnapshot {
    return {
      timestamp: at,
      snapshotId: `snap-${elementIds.join('+')}`,
      page: { url: 'http://localhost/test', title: 't', activeModals: [] },
      elements: elementIds.map((id) => ({
        id,
        type: 'button',
        label: id,
        tagName: 'button',
        actions: ['click'],
        state: {
          visible: true,
          enabled: true,
          focused: false,
          rect: { x: 0, y: 0, width: 10, height: 10, top: 0, right: 10, bottom: 10, left: 0 },
          textContent: id,
        },
        registered: true,
        description: id,
        aliases: [],
        suggestedActions: [],
        category: 'interactive' as const,
      })),
      forms: [],
      activeModals: [],
      summary: 's',
      elementCounts: {},
    };
  }

  const SETTLE_MS = 150; // the click band; asserted in settle() so a band change cannot hollow these tests
  const ACTION_MS = 500; // > SETTLE_MS: a window anchored at open time expires mid-action

  /**
   * One verified click whose action takes ACTION_MS on a pinned clock, with a
   * single concurrent observation landing at `observeIn`:
   * - `'action'`: at the end of the action, past open + SETTLE_MS;
   * - `'settle'`: 50 ms into the real settle;
   * - `'after'`:  1 ms past the end of the real settle.
   */
  async function verifySlowClick(observeIn: 'action' | 'settle' | 'after') {
    let clock = 10_000;
    let captures = 0;
    let observedAt = Number.NaN;
    const observe = (atMs: number) => {
      observedAt = atMs;
      getGlobalActionWindowRegistry().recordConcurrentObservation(atMs);
    };

    const verifier = new EffectVerifier({
      now: () => clock,
      captureSnapshot: async () =>
        captures++ === 0
          ? snapshot(['menu-btn'], clock)
          : snapshot(['menu-btn', 'user-menu'], clock),
      settle: async (ms) => {
        expect(ms).toBe(SETTLE_MS);
        if (observeIn === 'settle') observe(clock + 50);
        clock += ms;
        if (observeIn === 'after') observe(clock + 1);
      },
    });

    const openedAt = clock;
    const { verification } = await verifier.verifyAction(
      { action: 'click', elementId: 'menu-btn', requestId: `req-slow-${observeIn}` },
      {
        predicts: () => ({ elementsAppear: [{ id: 'user-menu' }] }),
        scope: {},
        reversibility: 'reversible',
      },
      async () => {
        clock += ACTION_MS;
        if (observeIn === 'action') observe(clock);
        return 'clicked';
      }
    );
    return { verification, openedAt, observedAt };
  }

  it("an observation late in a slow action (past open + settleMs) yields 'mixed'", async () => {
    const { verification, openedAt, observedAt } = await verifySlowClick('action');

    // Outside a window anchored at open time — the shape of the 736a7c2c trace.
    expect(observedAt).toBeGreaterThan(openedAt + SETTLE_MS);
    expect(verification.cause).toBe('mixed');
    expect(verification.outcome).toBe('Surprise');
    expect(verification.containment.predictedSubsetObserved).toBe(true);
    expect(verification.containment.observedSubsetPredicted).toBe(true);
  });

  it("an observation during the real settle of a slow action yields 'mixed'", async () => {
    const { verification, openedAt, observedAt } = await verifySlowClick('settle');

    expect(observedAt).toBeGreaterThan(openedAt + SETTLE_MS);
    expect(verification.cause).toBe('mixed');
    expect(verification.outcome).toBe('Surprise');
    expect(verification.durationMs).toBe(ACTION_MS + SETTLE_MS);
  });

  it("an observation after the real settle ends is not attributed ('causal')", async () => {
    // The window ends at settle start + settleMs: anchoring did not widen it.
    const { verification } = await verifySlowClick('after');

    expect(verification.cause).toBe('causal');
    expect(verification.outcome).toBe('Confirmed');
  });
});
