/**
 * Verifies that `exposeProviderOnWindow` publishes the SDK build version
 * onto `window.__UI_BRIDGE__.version`. Sourced from `package.json`'s
 * `version` field via tsup's `define` (mirrored by vitest's `define`).
 *
 * Why this matters: external automation drivers — headless CLIs, the
 * Chrome extension, manual-testing scripts — need to know which SDK
 * build a runner is consuming so a missing 0.3.X feature can be
 * distinguished from "the runner is on an older SDK". See
 * `plans/manual-test-remediation-2026-05-10.md` Item 1.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exposeProviderOnWindow, type UIBridgeInternals } from './UIBridgeProviderInit';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require('../../package.json') as { version: string };

describe('exposeProviderOnWindow · version reflection', () => {
  beforeEach(() => {
    // Start each test from a clean slate so version assertion is unambiguous.
    delete (window as unknown as Record<string, unknown>).__UI_BRIDGE__;
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__UI_BRIDGE__;
  });

  it('publishes window.__UI_BRIDGE__.version matching package.json', () => {
    // We pass a deliberately-minimal internals stub: the version-reflection
    // path doesn't read any tracker fields, only assigns them. Other tests
    // cover the tracker exposure surface.
    const stub = {} as unknown as UIBridgeInternals;
    exposeProviderOnWindow(stub);

    const root = (window as unknown as { __UI_BRIDGE__?: { version?: string } })
      .__UI_BRIDGE__;
    expect(root).toBeDefined();
    expect(root?.version).toBe(pkg.version);
    // Also assert the literal current shape so a regression where the field
    // stops being a string is caught (e.g. a future refactor that forgets
    // to JSON.stringify the define value would surface as `undefined`).
    expect(typeof root?.version).toBe('string');
    expect(root?.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('preserves an existing __UI_BRIDGE__ object when assigning version', () => {
    // Simulate diagnostic flags written by useAutoRegister before the
    // provider's exposeProviderOnWindow runs (real init order).
    (window as unknown as Record<string, unknown>).__UI_BRIDGE__ = {
      autoRegisterActive: true,
    };
    const stub = {} as unknown as UIBridgeInternals;
    exposeProviderOnWindow(stub);

    const root = (window as unknown as {
      __UI_BRIDGE__?: { version?: string; autoRegisterActive?: boolean };
    }).__UI_BRIDGE__;
    expect(root?.autoRegisterActive).toBe(true);
    expect(root?.version).toBe(pkg.version);
  });
});
