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
});
