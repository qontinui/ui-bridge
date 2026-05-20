/**
 * Route Aliasing Contract Tests
 *
 * Verifies the canonical-vs-alias relationships baked into UI_BRIDGE_ROUTES.
 * If the source-of-truth route table drifts (e.g. someone removes the
 * `/ai/idle-status` alias without also removing the runner-side alias),
 * these tests flag it before consumers do.
 */

import { describe, it, expect } from 'vitest';
import { UI_BRIDGE_ROUTES } from './types';

describe('UI_BRIDGE_ROUTES idle-status aliasing', () => {
  it('declares both /control/idle-status (canonical) and /ai/idle-status (alias)', () => {
    const control = UI_BRIDGE_ROUTES.find(
      (r) => r.method === 'GET' && r.path === '/control/idle-status'
    );
    const ai = UI_BRIDGE_ROUTES.find(
      (r) => r.method === 'GET' && r.path === '/ai/idle-status'
    );
    expect(control).toBeDefined();
    expect(ai).toBeDefined();
  });

  it('aliases both idle-status routes to the SAME handler (getIdleStatus)', () => {
    const control = UI_BRIDGE_ROUTES.find(
      (r) => r.method === 'GET' && r.path === '/control/idle-status'
    );
    const ai = UI_BRIDGE_ROUTES.find(
      (r) => r.method === 'GET' && r.path === '/ai/idle-status'
    );
    expect(control?.handler).toBe('getIdleStatus');
    expect(ai?.handler).toBe('getIdleStatus');
    expect(control?.handler).toBe(ai?.handler);
  });
});

describe('UI_BRIDGE_ROUTES page-health registration', () => {
  it('declares POST /control/page-health bound to the pageHealth handler', () => {
    const r = UI_BRIDGE_ROUTES.find(
      (entry) => entry.method === 'POST' && entry.path === '/control/page-health'
    );
    expect(r).toBeDefined();
    expect(r?.handler).toBe('pageHealth');
  });
});
