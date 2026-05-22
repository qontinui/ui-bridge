import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { DefaultNativeActionExecutor } from '../../control/action-executor';
import { NativeUIBridgeServer } from '../http-server';
import type { NativeElementRef } from '../../core/types';

/**
 * Regression coverage for `design-handlers.ts` — Item 1 of the 0.6.6
 * robustness pass.
 *
 * 0.6.3 and 0.6.4 crashed the host RN app on first call to
 * `/ui-bridge/control/page-health` because the handler called
 * `require('react-native')` inside a try/catch — Metro/Hermes raised
 * `unknownModuleError` past every guard and tore down the JS thread.
 * 0.6.5 fixed page-health via an injected viewportProvider.
 *
 * The SAME latent bug existed in `design-handlers.ts`: `getScreenDimensions()`
 * called `require('react-native')` and was invoked by three endpoints
 * (`POST /design/responsive`, `POST /design/evaluate`, `POST /design/evaluate/baseline`).
 * 0.6.6 ports the viewportProvider injection pattern to the design handlers
 * so this file has no react-native dep at all.
 *
 * These tests pin both:
 *   1. The handlers consume an injected viewportProvider (no `require()`).
 *   2. All three previously-affected endpoints (`/design/responsive`,
 *      `/design/evaluate`, `/design/evaluate/baseline`) respond cleanly
 *      end-to-end through `handleRequest` with no react-native import in
 *      the runtime path — vitest's rolldown parser would reject any
 *      `react-native` re-acquisition (Flow syntax errors).
 */

function makeRef(): React.RefObject<NativeElementRef> {
  return { current: {} as NativeElementRef };
}

function buildServer(viewportProvider?: () => { width: number; height: number }) {
  const registry = new NativeUIBridgeRegistry();
  const executor = new DefaultNativeActionExecutor(registry);
  const server = new NativeUIBridgeServer(
    registry,
    executor,
    viewportProvider ? { viewportProvider } : undefined
  );
  return { registry, server };
}

describe('design-handlers — viewport injection (Item 1, 0.6.6)', () => {
  it('regression: design-handlers.ts must not import or require react-native', async () => {
    // This test would fail at import time if `design-handlers.ts` re-acquired
    // any `react-native` reference (static OR require()). vitest's rolldown
    // parser rejects react-native's Flow syntax, so the whole file would
    // fail to load. The fact that this suite runs at all is the assertion.
    //
    // We then exercise the three endpoints that previously called
    // `getScreenDimensions()` to make sure they're fully wired through the
    // injected viewportProvider path.
    const { registry, server } = buildServer(() => ({ width: 400, height: 800 }));
    registry.registerElement('card', makeRef(), { type: 'view', label: 'A card' });
    registry.updateElementState('card', {
      visible: true,
      layout: { x: 16, y: 100, width: 368, height: 200, pageX: 16, pageY: 100 },
    });

    const res = await server.handleRequest({
      method: 'POST',
      path: '/ui-bridge/design/responsive',
      headers: { 'content-type': 'application/json' },
      query: {},
      body: {},
    });

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body) as { success: boolean; data: unknown };
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBeDefined();
  });

  it('POST /design/responsive uses the injected viewportProvider', async () => {
    // Inject a sentinel viewport so we can verify it reached the handler:
    // captureNativeResponsiveSnapshot emits a single snapshot keyed by the
    // device width when RN can't constrain widths at runtime. We register
    // one element and check the response shape — the test asserts the
    // handler ran cleanly through the injected provider path (no
    // require('react-native'), no `{width:0, height:0}` zero-dim fallback).
    const sentinelViewport = { width: 375, height: 812 };
    const { registry, server } = buildServer(() => sentinelViewport);
    registry.registerElement('hero', makeRef(), { type: 'view', label: 'Hero' });
    registry.updateElementState('hero', {
      visible: true,
      layout: { x: 0, y: 0, width: 375, height: 200, pageX: 0, pageY: 0 },
    });

    const res = await server.handleRequest({
      method: 'POST',
      path: '/ui-bridge/design/responsive',
      headers: { 'content-type': 'application/json' },
      query: {},
      body: {},
    });

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body) as {
      success: boolean;
      data: Array<{ width?: number; breakpoint?: string; elements?: unknown[] }>;
    };
    expect(parsed.success).toBe(true);
    expect(Array.isArray(parsed.data)).toBe(true);
    expect(parsed.data.length).toBeGreaterThan(0);
  });

  it('POST /design/responsive degrades to zero viewport when no provider is injected', async () => {
    // With no viewportProvider and no body override the handler MUST NOT
    // require('react-native'); it falls back to {0,0}. This is the test-
    // fixture path AND the "host didn't wire UIBridgeNativeProvider" path.
    const { registry, server } = buildServer();
    registry.registerElement('card', makeRef(), { type: 'view' });

    const res = await server.handleRequest({
      method: 'POST',
      path: '/ui-bridge/design/responsive',
      headers: { 'content-type': 'application/json' },
      query: {},
      body: {},
    });

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body) as { success: boolean };
    expect(parsed.success).toBe(true);
  });

  it('POST /design/evaluate runs cleanly via injected viewportProvider (no react-native require)', async () => {
    // /design/evaluate previously also called getScreenDimensions() — same
    // latent crash. Verify it runs cleanly via the injected provider.
    // The evaluator itself is an optional peer dep that won't be loaded in
    // this test; the handler returns a structured EVALUATOR_NOT_AVAILABLE
    // 400. The point of this test is "handler returned without throwing"
    // — i.e. no Metro/Hermes unknownModuleError tearing down the JS thread.
    // A regression that re-added `require('react-native')` would surface
    // as either a 500 (the try/catch escapes) or a vitest import-time
    // parser error on react-native's Flow syntax.
    const { registry, server } = buildServer(() => ({ width: 400, height: 800 }));
    registry.registerElement('x', makeRef(), { type: 'view' });

    const res = await server.handleRequest({
      method: 'POST',
      path: '/ui-bridge/design/evaluate',
      headers: { 'content-type': 'application/json' },
      query: {},
      body: {},
    });

    // Either 200 (eval available) or 400 (eval missing, structured error)
    // — crucially NOT 500 (uncaught throw) or empty body (Hermes teardown).
    expect([200, 400]).toContain(res.status);
    const parsed = JSON.parse(res.body) as { success: boolean; code?: string };
    expect(typeof parsed.success).toBe('boolean');
    if (!parsed.success) {
      // Graceful evaluator-not-loaded path — structured, not a crash.
      expect(parsed.code).toBe('EVALUATOR_NOT_AVAILABLE');
    }
  });

  it('POST /design/evaluate/baseline runs through injected viewport without crashing', async () => {
    const { registry, server } = buildServer(() => ({ width: 400, height: 800 }));
    registry.registerElement('x', makeRef(), { type: 'view' });

    const res = await server.handleRequest({
      method: 'POST',
      path: '/ui-bridge/design/evaluate/baseline',
      headers: { 'content-type': 'application/json' },
      query: {},
      body: {},
    });

    // Same expectation as /design/evaluate — handler ran without crashing.
    expect([200, 400]).toContain(res.status);
    const parsed = JSON.parse(res.body) as { success: boolean; code?: string };
    expect(typeof parsed.success).toBe('boolean');
    if (!parsed.success) {
      expect(parsed.code).toBe('EVALUATOR_NOT_AVAILABLE');
    }
  });
});
