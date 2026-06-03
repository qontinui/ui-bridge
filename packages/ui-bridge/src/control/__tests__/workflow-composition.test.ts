/**
 * D3 Effect Calculus — Phase 3b workflow-level composition, end-to-end.
 *
 * Drives the real {@link DefaultWorkflowEngine} + {@link DefaultActionExecutor}
 * against a jsdom DOM. Proves:
 *   - a 2-step workflow whose every predicted element appears → composition
 *     `Confirmed`,
 *   - a workflow where an EXTRA unpredicted element appears by the end →
 *     composition `Surprise` (the "stepwise OK, globally drifted" deliverable),
 *   - off-by-default: with composition disabled `compositionVerification` is
 *     undefined and behaviour matches a baseline run.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry } from '../../core/registry';
import { DefaultActionExecutor } from '../action-executor';
import { DefaultWorkflowEngine } from '../workflow-engine';
import {
  resetGlobalActionWindowRegistry,
} from '../action-window-registry';
import { resetGlobalEffectStore } from '../effect-store';
import type { Workflow } from '../../core/types';

describe('DefaultWorkflowEngine — D3 workflow composition', () => {
  let registry: UIBridgeRegistry;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
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

  /** Register a button whose click reveals `revealId` (and optional extras). */
  function registerRevealButton(
    btnId: string,
    revealId: string,
    extraIds: string[] = [],
  ): void {
    const btn = makeButton(btnId);
    registry.registerElement(btnId, btn, {
      type: 'button',
      label: btnId,
      reveals: [revealId],
    });
    btn.addEventListener('click', () => {
      for (const id of [revealId, ...extraIds]) {
        const el = document.createElement('div');
        el.setAttribute('data-testid', id);
        container.appendChild(el);
        registry.registerElement(id, el, { type: 'menu', label: id });
      }
    });
  }

  const twoStepWorkflow: Workflow = {
    id: 'wf-two-step',
    name: 'Two Step',
    steps: [
      { id: 's1', type: 'element-action', target: 'btn-a', action: 'click' },
      { id: 's2', type: 'element-action', target: 'btn-b', action: 'click' },
    ],
  };

  it('Confirmed: every step\'s predicted reveal appears by the end', async () => {
    registerRevealButton('btn-a', 'panel-a');
    registerRevealButton('btn-b', 'panel-b');
    registry.registerWorkflow(twoStepWorkflow);

    const executor = new DefaultActionExecutor(registry, undefined, {
      enableEffectVerification: true,
    });
    const engine = new DefaultWorkflowEngine(registry, executor, {
      enableEffectComposition: true,
    });

    const res = await engine.run('wf-two-step');

    expect(res.success).toBe(true);
    expect(res.compositionVerification).toBeDefined();
    expect(res.compositionVerification?.outcome).toBe('Confirmed');
    // The composed prediction unioned both reveals.
    expect(res.compositionVerification?.predicted.elementsAppear).toEqual([
      { id: 'panel-a' },
      { id: 'panel-b' },
    ]);
    // Both containments hold.
    expect(res.compositionVerification?.containment.predictedSubsetObserved).toBe(true);
    expect(res.compositionVerification?.containment.observedSubsetPredicted).toBe(true);
    // Per-step verification threaded onto each step result.
    expect(res.steps[0].effectVerification?.outcome).toBe('Confirmed');
    expect(res.steps[1].effectVerification?.outcome).toBe('Confirmed');
  });

  it('Surprise: stepwise OK but an EXTRA unpredicted element appears by the end', async () => {
    registerRevealButton('btn-a', 'panel-a');
    registerRevealButton('btn-b', 'panel-b');

    // A `custom` step (no signature → NOT per-step verified) injects an
    // unpredicted element between the two verified clicks. Each click is
    // individually Confirmed, but the workflow-level diff sees an extra
    // `surprise-toast` that no step predicted → composition Surprise. This is
    // the "every step Confirmed individually but the workflow drifted" case.
    const driftWorkflow: Workflow = {
      id: 'wf-drift',
      name: 'Drift',
      steps: [
        { id: 's1', type: 'element-action', target: 'btn-a', action: 'click' },
        {
          id: 'inject',
          type: 'custom',
          handler: () => {
            const el = document.createElement('div');
            el.setAttribute('data-testid', 'surprise-toast');
            container.appendChild(el);
            registry.registerElement('surprise-toast', el, {
              type: 'alert',
              label: 'Surprise',
            });
            return { injected: true };
          },
        },
        { id: 's2', type: 'element-action', target: 'btn-b', action: 'click' },
      ],
    };
    registry.registerWorkflow(driftWorkflow);

    const executor = new DefaultActionExecutor(registry, undefined, {
      enableEffectVerification: true,
    });
    const engine = new DefaultWorkflowEngine(registry, executor, {
      enableEffectComposition: true,
    });

    const res = await engine.run('wf-drift');

    expect(res.success).toBe(true);
    // Steps are [click btn-a, custom inject, click btn-b]. Each verified click
    // is still Confirmed individually (its own reveal appeared in its own
    // window; the injected element appeared OUTSIDE both click windows, in the
    // unverified custom step)...
    expect(res.steps[0].effectVerification?.outcome).toBe('Confirmed'); // btn-a
    expect(res.steps[1].effectVerification).toBeUndefined(); // custom inject
    expect(res.steps[2].effectVerification?.outcome).toBe('Confirmed'); // btn-b
    // ...but the WORKFLOW as a whole drifted: panel-a + panel-b +
    // surprise-toast appeared end-to-end, and surprise-toast was never
    // predicted by any step.
    expect(res.compositionVerification).toBeDefined();
    expect(res.compositionVerification?.outcome).toBe('Surprise');
    expect(res.compositionVerification?.containment.predictedSubsetObserved).toBe(true);
    expect(res.compositionVerification?.containment.observedSubsetPredicted).toBe(false);
  });

  it('off-by-default: no compositionVerification and behaviour matches baseline', async () => {
    registerRevealButton('btn-a', 'panel-a');
    registerRevealButton('btn-b', 'panel-b');
    registry.registerWorkflow(twoStepWorkflow);

    // Composition disabled (default). Effect verification also off → byte-identical
    // baseline behaviour.
    const executor = new DefaultActionExecutor(registry);
    const engine = new DefaultWorkflowEngine(registry, executor);

    const res = await engine.run('wf-two-step');

    expect(res.success).toBe(true);
    expect(res.compositionVerification).toBeUndefined();
    expect(res.steps[0].effectVerification).toBeUndefined();
    expect(res.steps[1].effectVerification).toBeUndefined();
    // Baseline shape preserved.
    expect(res.totalSteps).toBe(2);
    expect(res.steps.every((s) => s.success)).toBe(true);
  });

  it('setEffectCompositionEnabled toggles composition at runtime', async () => {
    registerRevealButton('btn-a', 'panel-a');
    registerRevealButton('btn-b', 'panel-b');
    registry.registerWorkflow(twoStepWorkflow);

    const executor = new DefaultActionExecutor(registry, undefined, {
      enableEffectVerification: true,
    });
    const engine = new DefaultWorkflowEngine(registry, executor);

    const off = await engine.run('wf-two-step');
    expect(off.compositionVerification).toBeUndefined();

    // The off-run already executed the clicks, registering panel-a/panel-b.
    // Clear that revealed state so the on-run starts from a clean pre-snapshot
    // (the clicks will re-reveal them → they "appear" again → Confirmed).
    for (const id of ['panel-a', 'panel-b']) {
      const node = container.querySelector(`[data-testid="${id}"]`);
      if (node) node.remove();
      registry.unregisterElement(id);
    }

    engine.setEffectCompositionEnabled(true);
    const on = await engine.run('wf-two-step');
    expect(on.compositionVerification).toBeDefined();
    expect(on.compositionVerification?.outcome).toBe('Confirmed');
  });

  it('no-signature workflow → composition skipped (no compositionVerification)', async () => {
    // A custom step has no action signature; the engine should skip composition.
    const wf: Workflow = {
      id: 'wf-custom',
      name: 'Custom only',
      steps: [{ id: 'c1', type: 'custom', handler: () => ({ ok: true }) }],
    };
    registry.registerWorkflow(wf);

    const executor = new DefaultActionExecutor(registry, undefined, {
      enableEffectVerification: true,
    });
    const engine = new DefaultWorkflowEngine(registry, executor, {
      enableEffectComposition: true,
    });

    const res = await engine.run('wf-custom');

    expect(res.success).toBe(true);
    expect(res.compositionVerification).toBeUndefined();
  });
});
