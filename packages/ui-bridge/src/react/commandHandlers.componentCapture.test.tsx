/**
 * The in-page relay dispatcher's `getComponentCapture` / `getElementCapture`
 * arms (plan 2026-11-13-ui-bridge-matches-isolated-render-assertion, Phase 2):
 * the capture is answered through `executeCommand` against the global
 * registry, props stay `null` unless the payload opts in with `props: true`,
 * and a refusal carries its reason in the message the relay keeps.
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { executeCommand, type BridgeAccess } from './commandHandlers';
import { getGlobalRegistry } from '../core/registry';
import type { ComponentCapture } from '../control/component-capture';

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

const g = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let savedAct: boolean | undefined;
beforeAll(() => {
  savedAct = g.IS_REACT_ACT_ENVIRONMENT;
  g.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  g.IS_REACT_ACT_ENVIRONMENT = savedAct;
});

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
  getGlobalRegistry().clear();
});

function Toolbar({ tone }: { tone: string }) {
  return <button type="button" className="tb" data-tone={tone} />;
}

function mount(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Toolbar tone="warn" />));
  const button = container.querySelector('button.tb') as HTMLElement;
  const registry = getGlobalRegistry();
  registry.registerElement('tb', button, { type: 'button' });
  registry.registerComponent('toolbar', { name: 'Toolbar', elementIds: ['tb'] });
  return button;
}

describe('executeCommand getElementCapture / getComponentCapture', () => {
  it.each(['getElementCapture', 'getComponentCapture'] as const)(
    '%s answers props null by default',
    async (action) => {
      mount();
      const id = action === 'getElementCapture' ? 'tb' : 'toolbar';
      const capture = (await executeCommand(action, { id }, emptyBridge)) as ComponentCapture;
      expect(capture.schemaVersion).toBe(1);
      expect(capture.target).toEqual({
        kind: action === 'getElementCapture' ? 'element' : 'component',
        id,
      });
      expect(capture.nodes[0].tag).toBe('button');
      expect(capture.props).toBeNull();
    }
  );

  it.each(['getElementCapture', 'getComponentCapture'] as const)(
    '%s reads the props when the payload carries props: true',
    async (action) => {
      mount();
      const id = action === 'getElementCapture' ? 'tb' : 'toolbar';
      const capture = (await executeCommand(
        action,
        { id, props: true },
        emptyBridge
      )) as ComponentCapture;
      expect(capture.props).toEqual({ tone: 'warn' });
      // Anything but the boolean `true` (the relay normalises it) stays off.
      const loose = (await executeCommand(
        action,
        { id, props: 'true' },
        emptyBridge
      )) as ComponentCapture;
      expect(loose.props).toBeNull();
    }
  );

  it('answers a refusal whose message encodes the reason', async () => {
    const result = (await executeCommand(
      'getComponentCapture',
      { id: 'missing' },
      emptyBridge
    )) as Record<string, unknown>;
    expect(result).toMatchObject({
      success: false,
      reason: 'not_found',
      code: 'UB-ELEM-NOT-FOUND',
    });
    expect(String(result.error)).toMatch(/^component_capture_refused:not_found: /);
  });
});
