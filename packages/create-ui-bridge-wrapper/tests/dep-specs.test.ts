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

// The rules scripts/check-dep-ranges.cjs applies to every published
// package.json, applied here to the specs the scaffold WRITES — the one place
// that script cannot see, because these live in TypeScript rather than in a
// manifest.
//
// A range is bounded above iff it excludes some sufficiently large version.
// Testing against a sentinel ceiling rather than `<1.0.0` keeps THIS assertion
// correct after UI Bridge goes 1.x. The declared specs themselves still hard-
// code `<1`, so the `still admits the current workspace version` case below is
// what will fail — deliberately and legibly — on the day ui-bridge cuts 1.0.0,
// which is exactly when a human should re-pick these floors.
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
      // templates written against the current APIs. What this catches is a
      // stale CEILING: a range whose upper bound has fallen behind the version
      // the templates are written against. A generous floor stays passing, and
      // should.
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

// The scaffold writes a wrapper dep and a headless dep into ONE generated
// manifest, and the wrapper declares headless as a peer. So the scaffold's
// headless range is not free: any version it admits that the wrapper's peer
// range rejects is an ERESOLVE failure on the generated project's first
// install. Nothing checked that before — `scripts/check-dep-ranges.cjs` reads
// manifests and these specs live in TypeScript, and the cases above judge each
// spec alone.
describe('scaffolded specs agree with the wrapper they are emitted beside', () => {
  function wrapperPeerRange(name: string): string {
    const manifest = join(PACKAGES, 'ui-bridge-wrapper', 'package.json');
    const peers = (JSON.parse(readFileSync(manifest, 'utf8')) as {
      peerDependencies: Record<string, string>;
    }).peerDependencies;
    const range = peers[name];
    if (!range) throw new Error(`ui-bridge-wrapper declares no peer range for ${name}`);
    return range;
  }

  for (const name of ['@qontinui/ui-bridge', '@qontinui/ui-bridge-headless']) {
    it(`emits a ${name} range the wrapper's peer range accepts whole`, () => {
      const scaffold = REGISTRY_DEP_SPECS[name] as string;
      const peer = wrapperPeerRange(name);
      expect(
        subset(scaffold, peer),
        `scaffold emits "${scaffold}" for ${name}, but @qontinui/ui-bridge-wrapper ` +
          `peers it at "${peer}" — a generated project could resolve a version the ` +
          `wrapper rejects`
      ).toBe(true);
    });
  }

  // The floor itself, pinned by the defect that set it rather than by its
  // number. `@qontinui/ui-bridge-headless` 0.4.1 and everything before it sent
  // every browser console type except error/warning to STDOUT, which corrupts
  // the one-JSON-line-per-action stream all three wrapper bins promise
  // (ui-bridge #219). A peer range that readmits 0.4.1 readmits that bug
  // silently: every rule in check-dep-ranges.cjs is floor-agnostic, so nothing
  // else fails when the floor slips back.
  const HEADLESS_LAST_STDOUT_CORRUPTING = '0.4.1';

  it('keeps the broken headless releases out of both ranges', () => {
    const peer = wrapperPeerRange('@qontinui/ui-bridge-headless');
    const scaffold = REGISTRY_DEP_SPECS['@qontinui/ui-bridge-headless'] as string;
    expect(
      satisfies(HEADLESS_LAST_STDOUT_CORRUPTING, peer),
      `@qontinui/ui-bridge-wrapper peers headless at "${peer}", which admits ` +
        `${HEADLESS_LAST_STDOUT_CORRUPTING} — that release writes browser console ` +
        `lines to stdout and corrupts the bins' result stream`
    ).toBe(false);
    expect(
      satisfies(HEADLESS_LAST_STDOUT_CORRUPTING, scaffold),
      `the scaffold emits "${scaffold}" for headless, which admits ` +
        `${HEADLESS_LAST_STDOUT_CORRUPTING} — see above`
    ).toBe(false);
  });
});
