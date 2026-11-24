// @vitest-environment node
/**
 * Public-entry contract for the density core's `./density` subpath (plan
 * 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change,
 * Phase 2, D-B).
 *
 * A consumer reaches the core through `@qontinui/ui-bridge/density`, never the
 * root barrel (the core's verbs are generic names). This pins three things that
 * must move together, so that a subpath which resolves to nothing, or to a
 * different surface, fails here rather than in a consumer's install:
 *   - the `exports` key names the three built files of one tsup entry;
 *   - the tsup declaration-emitting block builds that entry from the core's
 *     index;
 *   - the entry module carries exactly the core's published runtime names.
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
    const start = config.indexOf('defineConfig([');
    const dts = config.indexOf('dts: {');
    // Both anchors must be found, or the slice below would span the whole file.
    expect(start).toBeGreaterThanOrEqual(0);
    expect(dts).toBeGreaterThan(start);
    expect(config.slice(start, dts)).toContain("'density/index': 'src/density/index.ts'");
  });

  it('the entry carries exactly the runtime surface the core publishes', () => {
    // A literal list: adding, dropping or renaming a public value changes the
    // subpath's contract, and must change this test with it.
    expect(Object.keys(density).sort()).toEqual([
      'DENSITY_AFFORDANCE_KINDS',
      'DENSITY_AFFORDANCE_LIST_CAP',
      'DENSITY_AFFORDANCE_RULES',
      'DENSITY_ANSWERED_AT_KS',
      'DENSITY_ANSWER_ITEM_CAP',
      'DENSITY_BLOCK_LIST_CAP',
      'DENSITY_BLOCK_TAGS',
      'DENSITY_BOUND_LIST_CAP',
      'DENSITY_CAPTURE_SCHEMA',
      'DENSITY_CHAR_WIDTH_EM',
      'DENSITY_GRID_PX',
      'DENSITY_KIND_BASES',
      'DENSITY_LEDGER_KINDS',
      'DENSITY_MAX_COORDINATE_PX',
      'DENSITY_MIN_TEXT_PX',
      'DENSITY_PRODUCER_ID',
      'DENSITY_REPEAT_LIST_CAP',
      'DENSITY_REPEAT_MIN_ROWS',
      'DENSITY_REPEAT_SCOPE_LEVELS',
      'DENSITY_REPEAT_TOLERANCE_PX',
      'DENSITY_SHAPE_RULES',
      'DENSITY_TARGETS_SCHEMA',
      'DensityHashError',
      'boundDensityItem',
      'canonicalDensityJson',
      'captureDensityFromSnapshot',
      'classifyDensityItems',
      'collectDensityTextMatchers',
      'densityAffordances',
      'densityAnsweredWithin',
      'densityAskAnswer',
      'densityAskReach',
      'densityAsksHash',
      'densityBlocks',
      'densityBounds',
      'densityCentreY',
      'densityChildren',
      'densityDeclaresAnotherRepeat',
      'densityForeignPx',
      'densityHeadingLevel',
      'densityInnermostRepeats',
      'densityIntervalUnion',
      'densityItemReach',
      'densityLeaves',
      'densityLedger',
      'densityMatcherKey',
      'densityNavPrefix',
      'densityNearestRepeats',
      'densityPinnedIds',
      'densityPins',
      'densityPlacedRects',
      'densityReachContext',
      'densityRepeatScopes',
      'densityRepeatTargets',
      'densityRepeats',
      'densitySameColumn',
      'densityShapeOf',
      'densitySubtree',
      'densityTakesSpace',
      'densityTargetsHash',
      'densityTextHash',
      'densityTextSatisfies',
      'densityUnattributedChars',
      'evaluateDensityTextMatchers',
      'hashDensityCanonical',
      'isDensityChrome',
      'isDensityFilterControl',
      'isDensityFinderControl',
      'isDensityHeaderToggle',
      'isDensityHeading',
      'isDensityMedia',
      'isDensityNavControl',
      'measureDensity',
      'parseDensityCapture',
      'parseDensityTargets',
      'resolveDensityMatcher',
      'resolveDensityMatchers',
      'resolveDensityStructure',
      'sha256DensityHex',
      'summarizeDensityAffordances',
      'summarizeDensityRepeats',
      'summarizeDensityStructure',
    ]);
    expect(density.DENSITY_PRODUCER_ID).toBe('sdk/density');
    expect(density.DENSITY_CAPTURE_SCHEMA).toBe('ui-bridge/density-capture@1');
    // The entry re-exports the modules' own bindings (no wrapper in between).
    expect(density.captureDensityFromSnapshot).toBe(captureDensityFromSnapshot);
    expect(density.parseDensityTargets).toBe(parseDensityTargets);
    expect(density.parseDensityCapture).toBe(parseDensityCapture);
    expect(density.densityAsksHash).toBe(densityAsksHash);
    expect(density.sha256DensityHex).toBe(sha256DensityHex);
  });

  it('the root barrel does not re-export the core', () => {
    expect('captureDensityFromSnapshot' in root).toBe(false);
    expect('parseDensityTargets' in root).toBe(false);
  });
});
