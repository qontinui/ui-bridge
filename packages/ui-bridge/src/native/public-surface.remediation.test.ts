/**
 * The `./native` subpath must actually EXPORT what it ships (pre-PR review
 * #11, qontinui/ui-bridge#163).
 *
 * Plan: `2026-08-20-ui-bridge-action-declaration-shape.md`, Phases 2-4.
 *
 * `packages/ui-bridge/src/native/index.ts` uses an explicit export list and
 * was not updated when Phases 2-4 landed, so the effect helpers, the param
 * validator and the abortable primitive were unreachable from the `./native`
 * subpath a React Native consumer imports. That is the plan's own defect class
 * once more: a shipped feature with no route to the caller.
 *
 * A barrel is exactly the kind of file nothing else checks — `tsc` is happy
 * with a short list, and this subtree is excluded from `tsconfig.json`
 * entirely. So the reachability is asserted here, by name, at runtime.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as nativeCoreSubpath from './core/index';

/**
 * The ROOT `./native` barrel cannot be imported under vitest: it reaches
 * `react-native`, whose entry point is Flow-annotated JavaScript that the test
 * transformer cannot parse. So its export list is checked as source — with
 * comments stripped first, so a name that appears only in prose does not
 * satisfy the check.
 */
function nativeBarrelExports(): string {
  // `process.cwd()` under vitest is the package root, and the barrel's path
  // relative to it is stable — `import.meta.url` is not a file: URL here.
  const path = resolve(process.cwd(), 'src/native/index.ts');
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('the ./native/core barrel exposes the same primitives', () => {
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

describe('the ./native root barrel lists the Phase 2-4 surface', () => {
  const source = nativeBarrelExports();

  it('exports the native verb map and its resolver', () => {
    expect(source).toContain('NATIVE_STANDARD_ACTION_EFFECTS');
    expect(source).toContain('nativeStandardActionEffect');
    expect(source).toContain('resolveActionEffect');
  });

  it('exports the web verb table under its own name', () => {
    expect(source).toContain('STANDARD_ACTION_EFFECTS');
    expect(source).toContain('standardActionEffect');
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
});
