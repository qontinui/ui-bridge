/**
 * Arming tests for the text-visibility dev control (plan
 * 2026-10-13-image-generation-and-visual-judgment, Phase 16 step 1).
 *
 * Each enters where the population enters — the in-page dispatcher
 * (`executeCommand`, which the injected runtime and a relay tab run) and the
 * relay handlers (`createRelayHandlers`, the server side) — and imports
 * nothing the change added, so with the change reverted it fails on its
 * assertions, not on an import.
 */

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { executeCommand, type BridgeAccess } from '../react/commandHandlers';
import { enableDevControls, resetDevControlsForTest } from '../core/dev-controls';
import { createRelayHandlers } from '../server/relay-handlers';
import { CommandRelay } from '../server/command-relay';

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

const PAGE = '<p style="color: red !important">Over the hero</p><span>plain</span>';

beforeEach(() => {
  document.body.innerHTML = PAGE;
  enableDevControls('explicit');
});

afterEach(async () => {
  // Restore through the same door, so nothing is left hidden.
  await executeCommand('textVisibility', { hidden: false }, emptyBridge);
  resetDevControlsForTest();
  document.body.innerHTML = '';
});

it('arming: the dispatcher hides every glyph and restores the page exactly', async () => {
  const hidden = (await executeCommand('textVisibility', { hidden: true }, emptyBridge)) as {
    success?: boolean;
    hidden?: boolean;
  };
  expect(hidden).toMatchObject({ success: true, hidden: true });
  const p = document.querySelector('p')!;
  expect(p.style.getPropertyValue('color')).toBe('transparent');
  expect(getComputedStyle(document.querySelector('span')!).color).toBe('rgba(0, 0, 0, 0)');
  const shown = await executeCommand('textVisibility', { hidden: false }, emptyBridge);
  expect(shown).toMatchObject({ success: true, hidden: false, restore: { verified: true } });
  expect(document.body.innerHTML).toBe(PAGE);
});

it('arming: the relay handlers forward textVisibility to the tab and back', async () => {
  const relay = new CommandRelay({ globalPrefix: `__uiBridgeArming_${Date.now()}` });
  vi.spyOn(relay, 'queueCommand').mockImplementation(async (action: string, payload: unknown) =>
    executeCommand(action, payload as Record<string, unknown>, emptyBridge)
  );
  const handlers = createRelayHandlers(relay) as unknown as Record<
    string,
    ((request: unknown) => Promise<{ success: boolean; data?: unknown }>) | undefined
  >;
  const handler = handlers['textVisibility'];
  expect(typeof handler).toBe('function');
  const res = await handler!({ hidden: true });
  expect(res).toMatchObject({ success: true, data: { hidden: true } });
  expect(document.querySelector('p')!.style.getPropertyValue('color')).toBe('transparent');
  expect(await handler!({ hidden: false })).toMatchObject({
    success: true,
    data: { restore: { verified: true } },
  });
  expect(document.body.innerHTML).toBe(PAGE);
});
