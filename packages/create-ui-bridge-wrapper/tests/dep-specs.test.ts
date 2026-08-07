import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { satisfies, subset, validRange } from 'semver';
import { REGISTRY_DEP_SPECS, WORKSPACE_DEP_SPEC, depSpecFor } from '../src/dep-specs.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGES = join(HERE, '..', '..');

/** `packages/<dir>` for each package the scaffold writes a dep on. */
const WORKSPACE_DIR: Record<string, string> = {
  '@qontinui/ui-bridge': 'ui-bridge',
  '@qontinui/ui-bridge-wrapper': 'ui-bridge-wrapper',
  '@qontinui/ui-bridge-headless': 'ui-bridge-headless',
};

function workspaceVersion(name: string): string {
  const manifest = join(PACKAGES, WORKSPACE_DIR[name], 'package.json');
  return (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version;
}

// The same rule scripts/check-dep-ranges.cjs applies to every published
// package.json, applied here to the specs the scaffold WRITES. A range is
// bounded above iff it excludes some sufficiently large version; testing
// against a sentinel ceiling rather than `<1.0.0` keeps the rule correct after
// UI Bridge goes 1.x.
const UNREACHABLE_CEILING = '<9999.0.0';

describe('scaffolded dependency specs', () => {
  it('declares a spec for every UI Bridge package the templates import', () => {
    expect(Object.keys(REGISTRY_DEP_SPECS).sort()).toEqual(Object.keys(WORKSPACE_DIR).sort());
  });

  for (const [name, range] of Object.entries(REGISTRY_DEP_SPECS)) {
    describe(name, () => {
      it('is a valid semver range', () => {
        expect(validRange(range), `${name}: ${range}`).not.toBeNull();
      });

      it('is bounded above — a scaffold must not silently accept a breaking major', () => {
        expect(subset(range, UNREACHABLE_CEILING), `${name}: ${range}`).toBe(true);
      });

      it('is not a hand-maintained OR-chain', () => {
        expect(range.includes('||'), `${name}: ${range}`).toBe(false);
      });

      // The regression this file exists for. All three specs were `^0.1.0`
      // long after the packages had moved on, so a standalone scaffold
      // installed @qontinui/ui-bridge@0.1.1 against an engine at 0.22.0 — with
      // templates written against the current APIs. A floor that stops
      // admitting the version it was authored against is stale by definition.
      it('still admits the current workspace version', () => {
        const current = workspaceVersion(name);
        expect(
          satisfies(current, range),
          `${name} is ${current} but scaffold emits "${range}"`
        ).toBe(true);
      });
    });
  }

  it('uses workspace links in --monorepo mode and registry ranges otherwise', () => {
    expect(depSpecFor('@qontinui/ui-bridge', true)).toBe(WORKSPACE_DEP_SPEC);
    expect(depSpecFor('@qontinui/ui-bridge', false)).toBe(
      REGISTRY_DEP_SPECS['@qontinui/ui-bridge']
    );
  });

  it('refuses to emit a spec it has no declaration for', () => {
    expect(() => depSpecFor('@qontinui/not-a-package', false)).toThrow(/no dep spec declared/);
  });
});
