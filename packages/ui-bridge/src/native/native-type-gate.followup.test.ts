/**
 * Post-merge follow-up to qontinui/ui-bridge#164 — the type gate the plan
 * `2026-08-20-ui-bridge-action-declaration-shape` named as its own open item:
 *
 *   > `packages/ui-bridge/src/native/**` is type-checked by NOTHING.
 *   > tsup disables DTS for those entries and `tsconfig.json` lists
 *   > `"src/native/**"` in `exclude`. Six published subpath exports, no type
 *   > gate. It already carries 2-3 pre-existing errors.
 *
 * `tsconfig.native.json` closes it and `packages/ui-bridge`'s `typecheck`
 * script now runs both projects, so CI fails on a type error in this subtree
 * for the first time.
 *
 * `tsconfig.native.json` itself carries no prose: the repo's `check-json`
 * pre-commit hook parses every `.json` strictly, so JSONC comments are not an
 * option there and this file is the gate's documentation instead. Two choices
 * in it are load-bearing and both are asserted below:
 *
 * - **A second PROJECT, not a widened `include`.** The main config emits
 *   declarations; the React Native surface deliberately ships none (its
 *   ambient RN shim, `src/native/react-native.d.ts`, stands in for types the
 *   SDK does not depend on), which is exactly why tsup sets `dts: false` for
 *   those entries.
 * - **`src/**\/*.d.ts` in the include is not decoration.** `src/native/**`
 *   reaches web `core` modules transitively, and those rely on ambient
 *   declarations that live beside them (`src/core/dom-accessibility-api.d.ts`).
 *   An ambient file has to be a ROOT of the program, not merely reachable from
 *   one, so narrowing the include to `src/native/**` alone re-raises a TS7016
 *   the main project does not have — which would look like a real error and
 *   isn't.
 *
 * These are the RUNTIME halves of the two defects that gate then surfaced —
 * both were emitting data that contradicted their declared type, which is the
 * same class the plan's Phase 1 had to fix on the wire. A test that only
 * asserted "the config file exists" would prove nothing about either, so each
 * is pinned against a hand-written literal instead.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type React from 'react';
import { NativeUIBridgeRegistry, resetGlobalRegistry } from './core/registry';
import type { NativeElementRef } from './core/types';

function makeRef(): React.RefObject<NativeElementRef> {
  return { current: null } as React.RefObject<NativeElementRef>;
}

describe('the native subtree has a type gate at all', () => {
  it('tsconfig.native.json includes src/native and the ambient declarations', () => {
    // Parsed as STRICT JSON on purpose: the repo's `check-json` pre-commit
    // hook does the same, so a JSONC comment slipped in here would fail the
    // commit rather than this test. Keep them in agreement.
    const config = JSON.parse(
      readFileSync(resolve(process.cwd(), 'tsconfig.native.json'), 'utf8')
    ) as { include: string[]; exclude: string[] };

    expect(config.include).toContain('src/native/**/*');
    // Without this the transitively-reached `src/core/a11y.ts` re-raises a
    // TS7016 the main project does not have: an ambient `.d.ts` has to be a
    // ROOT of the program, not merely reachable from one.
    expect(config.include).toContain('src/**/*.d.ts');
  });

  it('the package typecheck script actually runs it', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')
    ) as { scripts: Record<string, string> };

    // The gate is worthless if only a human runs it by hand. CI invokes the
    // root `npm run typecheck`, which fans out to this script.
    expect(pkg.scripts.typecheck).toContain('tsconfig.native.json');
  });
});

describe('NativeBridgeSnapshot emits the under-registration diagnostics it declares', () => {
  let registry: NativeUIBridgeRegistry;

  beforeEach(() => {
    registry = new NativeUIBridgeRegistry();
  });

  afterEach(() => {
    resetGlobalRegistry();
  });

  it('reports registeredCount alongside the elements array', () => {
    registry.registerElement('btn-1', makeRef(), { type: 'button', label: 'Submit' });
    registry.registerElement('btn-2', makeRef(), { type: 'button', label: 'Cancel' });

    const snapshot = registry.createSnapshot();

    expect(snapshot.registeredCount).toBe(2);
    expect(snapshot.elements).toHaveLength(2);
  });

  it('reports zero on an empty registry rather than omitting the field', () => {
    const snapshot = registry.createSnapshot();

    // `undefined` here would be the defect the type gate caught: the field was
    // emitted by `createSnapshot` while `NativeBridgeSnapshot` denied it
    // existed, so nothing could have caught it drifting away again.
    expect(snapshot.registeredCount).toBe(0);
    expect(typeof snapshot.totalInteractiveInDOM).toBe('number');
  });
});
