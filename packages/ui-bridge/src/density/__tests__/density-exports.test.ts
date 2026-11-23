// @vitest-environment node
/**
 * Public-entry contract for the density core's `./density` subpath (plan
 * 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change,
 * Phase 2, D-B).
 *
 * A consumer reaches the core through `@qontinui/ui-bridge/density`, never the
 * root barrel (the core's verbs are generic names). This pins three things that
 * must move together, so that a subpath which resolves to nothing, or to a copy,
 * fails here rather than in a consumer's install:
 *   - the `exports` key names the three built files of one tsup entry;
 *   - the tsup declaration-emitting block builds that entry from the core's
 *     index;
 *   - the entry module hands out the core's own functions, not copies.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as density from '../index';
import * as root from '../../index';
import { captureDensityFromSnapshot } from '../capture-from-snapshot';
import { parseDensityCapture, parseDensityTargets } from '../schema';
import { densityAsksHash, sha256DensityHex } from '../hash';

const PACKAGE_ROOT = join(__dirname, '..', '..', '..');

describe('the ./density subpath', () => {
  it('runs with no DOM', () => {
    expect(typeof document).toBe('undefined');
  });

  it('the manifest maps ./density to the built density/index files', () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    expect(manifest.exports['./density']).toEqual({
      types: './dist/density/index.d.ts',
      import: './dist/density/index.mjs',
      require: './dist/density/index.js',
    });
  });

  it('tsup builds that entry, with declarations, from src/density/index.ts', () => {
    const config = readFileSync(join(PACKAGE_ROOT, 'tsup.config.ts'), 'utf8');
    // The first block of the config is the one that emits declarations; the
    // entry must sit inside it, or `types` names a file no build writes.
    const firstBlock = config.slice(config.indexOf('defineConfig(['), config.indexOf('dts: {'));
    expect(firstBlock).toContain("'density/index': 'src/density/index.ts'");
  });

  it('the entry exports the core itself, not a copy', () => {
    expect(density.captureDensityFromSnapshot).toBe(captureDensityFromSnapshot);
    expect(density.parseDensityTargets).toBe(parseDensityTargets);
    expect(density.parseDensityCapture).toBe(parseDensityCapture);
    expect(density.densityAsksHash).toBe(densityAsksHash);
    expect(density.sha256DensityHex).toBe(sha256DensityHex);
    expect(density.DENSITY_PRODUCER_ID).toBe('sdk/density');
    expect(density.DENSITY_CAPTURE_SCHEMA).toBe('ui-bridge/density-capture@1');
  });

  it('the root barrel does not re-export the core', () => {
    expect('captureDensityFromSnapshot' in root).toBe(false);
    expect('parseDensityTargets' in root).toBe(false);
  });
});
