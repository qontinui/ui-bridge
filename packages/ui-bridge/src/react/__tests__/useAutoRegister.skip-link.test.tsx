/**
 * A skip link that stays hidden until it is focused, made addressable with
 * `data-ui-bridge-persist="true"` (plan
 * 2026-11-09-ui-bridge-relay-evaluates-vision-assertions-in-the-tab, Phase 3;
 * documented in COOKBOOK.md beside `data-ui-bridge-content`).
 *
 * Auto-registration runs with `includeHidden: false`, so an element that does
 * not look visible right now is skipped — and a skip link's whole design is to
 * not look visible until a keyboard user tabs to it. The attribute already
 * bypasses that gate (`useAutoRegister.ts`, `shouldRegister`); no new
 * registration path is added. These tests pin that it does for a skip link
 * styled the usual way (Tailwind's `sr-only` box, `opacity-0` until focus), and
 * that the registered link is then an operand like any other: its state and
 * attributes read, a find returns it, and an assertion takes it as a target.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { getGlobalRegistry, resetGlobalRegistry, type UIBridgeRegistry } from '../../core/registry';
import { useAutoRegister } from '../useAutoRegister';
import type { UIBridgeContextValue } from '../UIBridgeProvider';
import { createHandlers, type RegistryLike } from '../../server/handlers';
import { createActionExecutor } from '../../control/action-executor';
import { executeCommand, type BridgeAccess } from '../commandHandlers';

let mockBridge: UIBridgeContextValue | null = null;
vi.mock('../UIBridgeProvider', () => ({
  useUIBridgeOptional: () => mockBridge,
}));

/** Tailwind's `sr-only`, plus the `opacity-0` the link drops on `:focus`. */
const SKIP_LINK_STYLE =
  'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;' +
  'clip:rect(0,0,0,0);white-space:nowrap;border-width:0;opacity:0';

function AutoRegisterHarness() {
  // The production defaults that matter: the visibility gate is ON
  // (`includeHidden` unset), and nothing is persisted globally.
  useAutoRegister({
    enabled: true,
    debounceMs: 0,
    contentDiscovery: { enabled: false },
    mediaDiscovery: { enabled: false },
  });
  return null;
}

/** A skip link with the box a real engine gives `sr-only` (1×1), which jsdom does not lay out. */
function skipLink(persist: boolean): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = '#main';
  link.textContent = 'Skip to content';
  link.setAttribute('style', SKIP_LINK_STYLE);
  if (persist) link.setAttribute('data-ui-bridge-persist', 'true');
  link.getBoundingClientRect = () => new DOMRect(0, 0, 1, 1);
  document.body.appendChild(link);
  return link;
}

describe('a skip link hidden until focused', () => {
  let registry: UIBridgeRegistry;

  // The global registry: the relay's in-page dispatcher reads that one, as an
  // app's AutoRegisterProvider writes it.
  beforeEach(() => {
    resetGlobalRegistry();
    registry = getGlobalRegistry();
    mockBridge = { registry } as unknown as UIBridgeContextValue;
  });

  afterEach(() => {
    cleanup();
    mockBridge = null;
    resetGlobalRegistry();
    document.body.innerHTML = '';
  });

  it('[negative control] is skipped by the visibility gate without the attribute', async () => {
    const link = skipLink(false);
    render(<AutoRegisterHarness />);
    await new Promise((r) => setTimeout(r, 5));

    expect(link.getAttribute('data-ui-bridge-id')).toBeNull();
    expect(registry.getAllElements().some((e) => e.element === link)).toBe(false);
  });

  it('registers with data-ui-bridge-persist="true", and is addressable like any element', async () => {
    const link = skipLink(true);
    render(<AutoRegisterHarness />);
    await new Promise((r) => setTimeout(r, 5));

    const id = link.getAttribute('data-ui-bridge-id');
    expect(id).toBeTruthy();
    expect(registry.getElement(id!)?.element).toBe(link);

    // Addressable on the in-process transport: a find returns it, and its
    // element state reads its attributes.
    const registryLike: RegistryLike = {
      getAllElements: () => registry.getAllElements(),
      getElement: (elementId) => registry.getElement(elementId),
      getAllComponents: () => registry.getAllComponents(),
      getComponent: (componentId) => registry.getComponent(componentId),
      createSnapshot: () => registry.createSnapshot() as ReturnType<RegistryLike['createSnapshot']>,
    };
    const handlers = createHandlers(registryLike, createActionExecutor(registry));
    const found = await handlers.find({ skipSettle: true, text: 'Skip to content' });
    expect(found.success, found.error).toBe(true);
    expect(found.data!.elements.map((e) => e.id)).toEqual([id]);

    const state = await handlers.getElementState(id!, undefined, { attributes: 'href' });
    expect(state.success, state.error).toBe(true);
    expect(state.data).toMatchObject({
      id,
      projection: { attributes: { href: '#main' }, unmeasured: [] },
    });

    // Addressable through the relay's in-page dispatcher: as an assertion
    // operand, by the id the registration stamped (a structured target, which
    // the relay now passes through as an object).
    const bridge: BridgeAccess = {
      elements: registry.getAllElements(),
      getElement: (elementId) => registry.getElement(elementId),
      components: [],
      workflows: [],
    };
    const asserted = (await executeCommand(
      'aiAssert',
      { target: { idPattern: id }, type: 'attribute', attributeName: 'href', expected: '#main' },
      bridge
    )) as { outcome?: string; actual?: unknown };
    expect(asserted).toMatchObject({ outcome: 'passed', actual: '#main' });
  });
});
