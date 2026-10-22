/**
 * Text visibility on every SDK transport, and the dev-controls gate on each
 * (plan 2026-10-13-image-generation-and-visual-judgment, Phase 16 step 1).
 *
 *   - the dispatcher (`executeCommand`) the relay and the injected runtime
 *     both run in the page: refused until the realm opts in;
 *   - an embedded app (`initializeUIBridge`): a non-dev build, whose
 *     `features.devControls` resolves to false or is absent, is refused; a dev
 *     build that opts in is served;
 *   - the injected runtime (`injected/bootstrap.ts`): served, because only a
 *     driver installs it;
 *   - the relay handlers: forward to the tab, and a tab's typed refusal
 *     surfaces as a failure with its code, never a 2xx;
 *   - the Node-side direct handlers: `capability_unavailable_in_build`,
 *     unconditionally — there is no page to alter.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeCommand, type BridgeAccess } from '../react/commandHandlers';
import { enableDevControls, resetDevControlsForTest } from '../core/dev-controls';
import { createHandlers } from '../server/handlers';
import { createRelayHandlers } from '../server/relay-handlers';
import { CommandRelay } from '../server/command-relay';
import { UIBridgeRegistry } from '../core/registry';
import { createActionExecutor } from './action-executor';
import { initializeUIBridge } from '../react/UIBridgeProviderInit';
import { UI_BRIDGE_ROUTES } from '../server/types';
import type { UIBridgeConfig } from '../core/types';
import { resetTextVisibilityForTest, textHidden } from './text-visibility';

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

const PAGE = '<p style="color: red !important">Over the hero</p><span>plain</span>';

beforeEach(() => {
  document.body.innerHTML = PAGE;
});

afterEach(() => {
  resetTextVisibilityForTest();
  resetDevControlsForTest();
  document.body.innerHTML = '';
});

const REFUSAL = {
  success: false,
  code: 'capability_unavailable_in_build',
  reason: 'dev_controls_disabled',
};

describe('the route', () => {
  it('is one POST in UI_BRIDGE_ROUTES, the list the runner diffs against', () => {
    expect(UI_BRIDGE_ROUTES.filter((r) => r.path === '/control/text-visibility')).toEqual([
      {
        method: 'POST',
        path: '/control/text-visibility',
        handler: 'textVisibility',
        bodyRequired: true,
      },
    ]);
  });
});

describe('the dispatcher (relay tab and injected runtime)', () => {
  it('refuses until the realm opts in, and alters nothing', async () => {
    for (const hidden of [true, false]) {
      expect(await executeCommand('textVisibility', { hidden }, emptyBridge)).toMatchObject(
        REFUSAL
      );
    }
    expect(document.body.innerHTML).toBe(PAGE);
    expect(textHidden()).toBe(false);
  });

  it('once opted in, hides and restores exactly', async () => {
    enableDevControls('explicit');
    const hidden = (await executeCommand('textVisibility', { hidden: true }, emptyBridge)) as {
      success: boolean;
      hidden: boolean;
    };
    expect(hidden).toMatchObject({ success: true, hidden: true, changed: true });
    expect(document.body.innerHTML).not.toBe(PAGE);
    expect(await executeCommand('textVisibility', { hidden: false }, emptyBridge)).toMatchObject({
      success: true,
      hidden: false,
      restore: { verified: true },
    });
    expect(document.body.innerHTML).toBe(PAGE);
  });
});

describe('an embedded app', () => {
  // What `devControls: process.env.NODE_ENV === 'development'` resolves to in
  // a production bundle, and an app that never mentions it.
  it.each([
    ['a non-dev build (devControls: false)', { devControls: false }],
    ['an app that does not opt in', {}],
  ])('%s is refused', async (_label, features) => {
    initializeUIBridge({ config: {} as UIBridgeConfig, features });
    expect(await executeCommand('textVisibility', { hidden: true }, emptyBridge)).toMatchObject(
      REFUSAL
    );
    expect(document.body.innerHTML).toBe(PAGE);
  });

  it('a dev build that opts in (devControls: true) is served', async () => {
    initializeUIBridge({ config: {} as UIBridgeConfig, features: { devControls: true } });
    expect(await executeCommand('textVisibility', { hidden: true }, emptyBridge)).toMatchObject({
      success: true,
      hidden: true,
    });
  });
});

describe('the relay handlers', () => {
  /** A relay whose tab is this jsdom page, dispatching through executeCommand. */
  function relayToThisPage() {
    const relay = new CommandRelay({
      globalPrefix: `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`,
    });
    const queue = vi
      .spyOn(relay, 'queueCommand')
      .mockImplementation(async (action: string, payload: unknown) =>
        executeCommand(action, payload as Record<string, unknown>, emptyBridge)
      );
    return { queue, handlers: createRelayHandlers(relay) };
  }

  it('forwards the body to the tab as textVisibility', async () => {
    enableDevControls('explicit');
    const { queue, handlers } = relayToThisPage();
    const res = await handlers.textVisibility({ hidden: true, ttlMs: 5_000 });
    expect(queue).toHaveBeenCalledWith('textVisibility', { hidden: true, ttlMs: 5_000 }, undefined);
    expect(res).toMatchObject({ success: true, data: { hidden: true, ttlMs: 5_000 } });
    expect(textHidden()).toBe(true);
    const shown = await handlers.textVisibility({ hidden: false });
    expect(shown).toMatchObject({ success: true, data: { restore: { verified: true } } });
    expect(document.body.innerHTML).toBe(PAGE);
  });

  it('a tab that has not opted in answers a typed failure, never a 2xx', async () => {
    const { handlers } = relayToThisPage();
    const res = await handlers.textVisibility({ hidden: true });
    expect(res.success).toBe(false);
    expect(res.code).toBe('capability_unavailable_in_build');
    expect(res.data).toMatchObject(REFUSAL);
    expect(document.body.innerHTML).toBe(PAGE);
  });
});

describe('the Node-side direct handlers', () => {
  it('answer capability_unavailable_in_build even with the realm opted in', async () => {
    enableDevControls('explicit');
    const registry = new UIBridgeRegistry();
    const handlers = createHandlers(registry, createActionExecutor(registry));
    const res = await handlers.textVisibility({ hidden: true });
    expect(res.success).toBe(false);
    expect(res.code).toBe('UB-CAPABILITY-UNAVAILABLE');
    expect(res.data).toMatchObject({
      code: 'capability_unavailable_in_build',
      reason: 'no_browser_context',
    });
    expect(document.body.innerHTML).toBe(PAGE);
  });
});

describe('the injected runtime', () => {
  it('opts in by itself and serves the control through its execute()', async () => {
    await import('../injected/bootstrap');
    const api = window.__uiBridgeInjected!;
    expect(api.ready).toBe(true);
    expect(await api.execute('textVisibility', { hidden: true })).toMatchObject({
      success: true,
      hidden: true,
    });
    expect(textHidden()).toBe(true);
    expect(await api.execute('textVisibility', { hidden: false })).toMatchObject({
      success: true,
      restore: { verified: true },
    });
    expect(document.body.innerHTML).toBe(PAGE);
    delete window.__uiBridgeInjected;
  });
});
