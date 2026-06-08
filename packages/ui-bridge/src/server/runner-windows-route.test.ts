/**
 * Phase 2 (plan 2026-06-07-multi-window-sdk-automation) — `listWindows()`
 * discovery method + `/control/runner-windows` route promotion.
 *
 * The route declaration here is the SDK half of the cross-repo ATOMIC change:
 * the runner's `sdk_manifest_routes_are_exposed_by_runner` test scrapes this
 * entry and, once the runner drops it from `runner_only_baseline`, both sides
 * must agree. These unit tests lock the SDK side; the cross-repo consistency is
 * verified in a co-located runner checkout.
 */

import { describe, it, expect } from 'vitest';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';
import { UI_BRIDGE_ROUTES } from './types';
import type { RunnerWindowsList } from './types';

describe('UI_BRIDGE_ROUTES · runner-windows discovery (Phase 2)', () => {
  it('declares GET /control/runner-windows bound to the listWindows handler', () => {
    const route = UI_BRIDGE_ROUTES.find(
      (r) => r.method === 'GET' && r.path === '/control/runner-windows'
    );
    expect(route).toBeDefined();
    expect(route?.handler).toBe('listWindows');
    // No path params, no body — it's a plain discovery GET.
    expect(route?.params).toBeUndefined();
    expect(route?.bodyRequired).toBeUndefined();
  });
});

describe('relay listWindows() — runner-only over the browser-tab relay', () => {
  it('returns a NOT_IMPLEMENTED error (a browser tab has no runner windows)', async () => {
    const relay = new CommandRelay({
      globalPrefix: `__uiBridgeListWindowsTest_${Math.random().toString(36).slice(2, 10)}`,
    });
    const handlers = createRelayHandlers(relay);

    const result = await handlers.listWindows();
    expect(result.success).toBe(false);
    // The relay maps the internal NOT_IMPLEMENTED to its public unsupported code.
    expect(result.code).toBe('UB-UNSUPPORTED-ACTION');
    expect(result.error).toMatch(/runner-only/i);
  });
});

describe('RunnerWindowsList typed shape (Phase 2)', () => {
  it('matches the runner wire shape without remapping', () => {
    // Constructed without casts: tsc enforces the D2 shape at build time.
    const list: RunnerWindowsList = {
      count: 2,
      windows: [
        { label: 'main', kind: 'main', title: 'qontinui' },
        { label: 'term-2', kind: 'secondary', title: null },
      ],
    };
    expect(list.count).toBe(2);
    expect(list.windows[0]!.kind).toBe('main');
    expect(list.windows[1]!.title).toBeNull();
  });
});
