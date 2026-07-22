import { describe, it, expect } from 'vitest';
import { UI_BRIDGE_ROUTES } from './types';
import manifest from '../../redaction-surface.manifest.json';

/**
 * §4.6 Layer-3 enumeration test — the in-suite twin of
 * `scripts/check-redaction-surface.cjs`. It fails when the live route surface
 * drifts from the committed manifest, so a new client-reachable route can never
 * land without a conscious redaction disposition (regenerate + commit via
 * `npm run redaction:surface:update`). The script parses `UI_BRIDGE_ROUTES`
 * from source with a TS AST; this test imports the real runtime value — if the
 * two ever disagree the AST parser has a bug.
 *
 * Plan: plans/2026-07-20-ui-bridge-structural-redaction-enforcement.md (Layer 3)
 */
function liveRouteSurface(): string[] {
  const seen = new Set<string>();
  for (const r of UI_BRIDGE_ROUTES) {
    seen.add(`${r.method} ${r.path} -> ${r.handler}`);
  }
  return [...seen].sort();
}

describe('§4.6 redaction surface manifest', () => {
  it('routes match the committed manifest (add a route ⇒ update the manifest)', () => {
    expect(liveRouteSurface()).toEqual(manifest.routes);
  });

  it('records the Layer-2 projection modules', () => {
    // The manifest is the committed record of the guarded surface; the script
    // cross-checks it against eslint.config.js. Here we just assert it is
    // populated so a stripped manifest is caught by the suite too.
    expect(manifest.projectionModules.length).toBeGreaterThan(0);
    expect(manifest.projectionModules).toContain('packages/ui-bridge/src/server/dom-fallback.ts');
  });

  it('records the guard exemption lists (the ratchet on the escape hatches)', () => {
    // Layer-1 `ignores` — everything here sits OUTSIDE every §4.6 lint rule.
    // The sanctioned readers must be present (they ARE the choke point), and a
    // stripped list would mean the exemption ratchet is dead.
    expect(manifest.packageGuardExemptions).toContain('packages/ui-bridge/src/core/redaction.ts');
    expect(manifest.packageGuardExemptions).toContain('packages/ui-bridge/src/core/a11y.ts');
    // Layer-2 `ignores` — only test globs may exempt a projection module from
    // the raw-read ban. A non-test entry here is a silent guard-disable; the
    // script diffs the exact list, this asserts the invariant shape.
    expect(manifest.projectionModuleIgnores.length).toBeGreaterThan(0);
    for (const entry of manifest.projectionModuleIgnores) {
      // Anchored: a `__tests__` path segment or a `.test.ts(x)` suffix —
      // `foo.test.helpers/reader.ts` must NOT satisfy the invariant.
      expect(entry, `non-test exemption in Layer-2 ignores: ${entry}`).toMatch(
        /\/__tests__\/|\.test\.tsx?$/
      );
    }
  });
});
