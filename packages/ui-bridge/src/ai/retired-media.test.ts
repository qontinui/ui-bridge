/**
 * The retired media analysis surface stays retired.
 *
 * Plan 2026-10-13-image-generation-and-visual-judgment, Phase 6, retired it
 * without a successor (D6, delete-over-deprecate):
 * - `ai/media-analysis.ts` (`analyzeMediaElement`, `analyzeMediaBatch`,
 *   `analyzeMediaPage`);
 * - the four media find-request builders;
 * - `compareMediaSnapshots` and its `MediaComparisonResult`.
 *
 * The Phase 5 branch rewrote `media-analysis.ts` while this phase deleted it,
 * so merging the two is a modify/delete conflict. Keeping Phase 5's copy would
 * pass every other gate. Once the `./ai` barrel stops exporting the file,
 * nothing imports it, so the compiler, the linter and the rest of the suite
 * never read it, and D6 is silently undone. This file fails that resolution,
 * and any export or declaration of a retired name.
 *
 * Not every retired name was unconsumed. ui-bridge-auto re-exports
 * `MediaComparisonResult` (`src/visual/types.ts`, `src/visual/index.ts`) from
 * the 0.3.x line it pins, and drops that re-export in its own follow-up before
 * it moves to this release.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as ai from './index';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '..');

const RETIRED_VALUES = [
  'analyzeMediaElement',
  'analyzeMediaBatch',
  'analyzeMediaPage',
  'createMediaFindRequest',
  'createBrokenImagesFindRequest',
  'createMissingAltFindRequest',
  'createOversizedImagesFindRequest',
  'compareMediaSnapshots',
];
const RETIRED_CODE = new RegExp(
  `\\b(?:${[...RETIRED_VALUES, 'MediaComparisonResult'].join('|')})\\b|/media-analysis['"]`
);

/** Every production TypeScript file under `src/`, test files excluded. */
function productionSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : productionSources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Source text with comments removed, so prose about a retired name does not count. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('the retired media analysis surface', () => {
  it('has no module file', () => {
    // The directory resolves: a module that stays is found there.
    expect(existsSync(join(here, 'media-queries.ts'))).toBe(true);
    expect(existsSync(join(here, 'media-analysis.ts'))).toBe(false);
  });

  it('exports none of its names from ./ai', () => {
    // The barrel loaded: it exports the media names that stay.
    expect(typeof ai.captureMediaSnapshot).toBe('function');
    expect(typeof ai.buildAccessibilityAudit).toBe('function');
    expect(RETIRED_VALUES.filter((name) => name in ai)).toEqual([]);
  });

  it('no production source declares, exports or imports a retired name', () => {
    const sources = productionSources(srcRoot);
    expect(sources.length).toBeGreaterThan(100);
    const offenders = sources
      .filter((path) => RETIRED_CODE.test(code(path)))
      .map((path) => relative(srcRoot, path));
    expect(offenders).toEqual([]);
  });
});
