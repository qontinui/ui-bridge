/**
 * The `@qontinui/ui-bridge-native` root barrel must actually EXPORT what it
 * ships (pre-PR review #11, qontinui/ui-bridge#163).
 *
 * Plan: `2026-08-20-ui-bridge-action-declaration-shape.md`, Phases 2-4.
 *
 * `src/index.ts` uses an explicit export list and was not updated when
 * Phases 2-4 landed, so the effect helpers, the param validator and the
 * abortable primitive were unreachable from the package root a React Native
 * consumer imports (the `./core` subpath had them via `export *`). That is the plan's own defect class
 * once more: a shipped feature with no route to the caller.
 *
 * A barrel is exactly the kind of file nothing else checks — `tsc` is happy
 * with a short list. So the reachability is asserted here, by name.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as nativeCoreSubpath from './core/index';

/**
 * The ROOT barrel cannot be imported under vitest: it reaches
 * `react-native`, whose entry point is Flow-annotated JavaScript that the test
 * transformer cannot parse. So its export list is checked as source — with
 * comments stripped first, so a name that appears only in prose does not
 * satisfy the check.
 */
function nativeBarrelExports(): string {
  // `process.cwd()` under vitest is the package root, and the barrel's path
  // relative to it is stable — `import.meta.url` is not a file: URL here.
  const path = resolve(process.cwd(), 'src/index.ts');
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('the ./core barrel exposes the same primitives', () => {
  it('exports the validator and the abortable primitive', () => {
    expect(typeof nativeCoreSubpath.validateActionParams).toBe('function');
    expect(typeof nativeCoreSubpath.setDefaultParamValidationMode).toBe('function');
    expect(typeof nativeCoreSubpath.runAbortable).toBe('function');
    expect(typeof nativeCoreSubpath.inertAbortSignal).toBe('function');
    expect(typeof nativeCoreSubpath.normalizeActionTimeoutMs).toBe('function');
  });

  it('exports the native verb map', () => {
    expect(nativeCoreSubpath.NATIVE_STANDARD_ACTION_EFFECTS.swipe).toBe('write');
  });
});

describe('the package root barrel lists the Phase 2-4 surface', () => {
  const source = nativeBarrelExports();

  // NOTE: there is no WEB verb table in this package — it cannot import
  // `@qontinui/ui-bridge` (an OPTIONAL peer), so `NativeStandardAction` is the
  // only vocabulary here. The twin test under `@qontinui/ui-bridge`
  // `src/native` checks that its barrel exports BOTH.
  it('exports the native verb map and its resolver', () => {
    expect(source).toContain('NATIVE_STANDARD_ACTION_EFFECTS');
    expect(source).toContain('nativeStandardActionEffect');
    expect(source).toContain('resolveActionEffect');
  });

  it('exports the param validator and its mode controls', () => {
    expect(source).toContain('validateActionParams');
    expect(source).toContain('setDefaultParamValidationMode');
    expect(source).toContain('getDefaultParamValidationMode');
    expect(source).toContain('resetDefaultParamValidationMode');
    expect(source).toContain('formatParamValidationFailure');
    expect(source).toContain('DEFAULT_PARAM_VALIDATION_MODE');
  });

  it('exports the cancellation primitives', () => {
    expect(source).toContain('runAbortable');
    expect(source).toContain('inertAbortSignal');
    expect(source).toContain('normalizeActionTimeoutMs');
    expect(source).toContain('MAX_ACTION_TIMEOUT_MS');
  });

  it('exports the safety-annotation type and the handler options bag', () => {
    expect(source).toContain('type IREffect');
    expect(source).toContain('type ActionHandlerOptions');
  });

  /**
   * qontinui/ui-bridge#175 added the visibility projection to
   * `core/registry.ts` and did not touch this barrel — the same omission, one
   * feature later. A consumer reading `visibility` / `visibilityReason` off a
   * snapshot could not name either union from the package root, and a non-React
   * host could not reproduce a verdict for an element it holds.
   */
  it('exports the visibility projection and its vocabulary', () => {
    expect(source).toContain('computeVisibility');
    expect(source).toContain('pageRectOf');
    expect(source).toContain('intersectRects');
    expect(source).toContain('isEmptyRect');
    // The trailing commas are load-bearing. `toContain('type NativeVisibility')`
    // is satisfied by the `type NativeVisibilityReason,` line, so dropping
    // `NativeVisibility` from the barrel would leave this test green while a
    // root-importing consumer lost the ability to name the union `visibility`
    // holds — the exact defect class this file exists to catch, reproduced
    // inside the check meant to catch it.
    expect(source).toContain('type NativePageRect,');
    expect(source).toContain('type NativeVisibility,');
    expect(source).toContain('type NativeVisibilityReason,');
  });

  it('exports the status mapping the ServerAdapter contract needs', () => {
    expect(source).toContain('httpStatusForResponse');
  });
});

describe('the ./core barrel exposes the visibility projection too', () => {
  it('exports the helpers as callable functions, not just as types', () => {
    expect(typeof nativeCoreSubpath.computeVisibility).toBe('function');
    expect(typeof nativeCoreSubpath.pageRectOf).toBe('function');
    expect(typeof nativeCoreSubpath.intersectRects).toBe('function');
    expect(typeof nativeCoreSubpath.isEmptyRect).toBe('function');
  });

  it('the exported computeVisibility demotes an element scrolled past the fold', () => {
    // Scope, stated so the title cannot over-claim: this drives the exported
    // HELPER directly and asserts nothing about `createSnapshot` wiring it up.
    // The snapshot path is covered by `server/__tests__/snapshot-viewport-clipping.test.ts`;
    // what is checked here is that a consumer calling the newly-reachable
    // export gets the same verdict, which is the point of exporting it.
    const state = {
      mounted: true,
      visible: true,
      enabled: true,
      focused: false,
      layout: { x: 0, y: 900, width: 100, height: 40, pageX: 0, pageY: 900 },
    };
    const viewport = { left: 0, top: 0, right: 390, bottom: 844 };

    expect(nativeCoreSubpath.computeVisibility(state, viewport)).toEqual({
      visibility: 'hidden',
      visibilityReason: 'off-screen',
    });
    // An UNKNOWN clip must never demote — absence of evidence is not evidence
    // of off-screen.
    expect(nativeCoreSubpath.computeVisibility(state, null)).toEqual({ visibility: 'visible' });
  });
});
