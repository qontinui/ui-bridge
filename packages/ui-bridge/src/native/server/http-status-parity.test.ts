/**
 * The two React Native surfaces must map error codes to the same statuses.
 *
 * This repo publishes React Native support twice: `@qontinui/ui-bridge-native`
 * (its own package) and `@qontinui/ui-bridge/native` (a subpath of the web
 * package). qontinui/ui-bridge#175 gave the first an honest status mapping and
 * left the second on a blanket 400, and its PR body flagged the consequence in
 * so many words — "the two surfaces now answer differently". Porting the map
 * closes today's divergence; nothing stops tomorrow's.
 *
 * The packages cannot import each other — `@qontinui/ui-bridge` is an OPTIONAL
 * peer of `@qontinui/ui-bridge-native`, which is exactly why the map is
 * duplicated rather than shared (the same reason `NativeVisibilityReason` is
 * duplicated in `ui-bridge-native`'s `core/registry.ts`). So the two copies are
 * compared as SOURCE, the way `public-surface.remediation.test.ts` checks a
 * barrel it cannot import.
 *
 * If this file cannot find the sibling, it FAILS rather than skips: a
 * keep-in-sync check that quietly disengages is worth less than no check.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Pull the `ERROR_CODE_HTTP_STATUS` entries out of a source file.
 *
 * Parsed from source, not imported: the sibling's module reaches its own
 * package graph, and importing across package roots under vitest is exactly
 * the coupling this repo avoids.
 */
function parseStatusMap(source: string, label: string): Array<[string, number]> {
  const block = /ERROR_CODE_HTTP_STATUS\s*=\s*new Map<string, number>\(\[([\s\S]*?)\]\)/.exec(
    source
  );
  if (!block) {
    throw new Error(`${label}: no ERROR_CODE_HTTP_STATUS Map literal found`);
  }

  // Counted PERMISSIVELY first, then parsed strictly, and the two counts must
  // agree. A strict-only parse silently DROPS an entry it cannot read — a code
  // containing a digit, a lowercase letter, or double quotes — and a dropped
  // entry is invisible on both sides, so adding `['GONE_410', 410]` to one
  // package alone would leave both parses equal and this whole file green
  // while the divergence it exists to prevent shipped.
  const bracketed = block[1].match(/\[[^\]]*\]/g) ?? [];

  const entries: Array<[string, number]> = [];
  const entryPattern = /\[\s*'([A-Z_]+)'\s*,\s*(\d{3})\s*\]/g;
  let match: RegExpExecArray | null;
  while ((match = entryPattern.exec(block[1])) !== null) {
    entries.push([match[1], Number(match[2])]);
  }
  if (entries.length !== bracketed.length) {
    throw new Error(
      `${label}: ERROR_CODE_HTTP_STATUS has ${bracketed.length} entries but ` +
        `${entries.length} parsed — an entry uses a shape this check cannot read, ` +
        `so parity cannot be asserted. Widen the pattern rather than ignoring this.`
    );
  }
  if (entries.length === 0) {
    throw new Error(`${label}: ERROR_CODE_HTTP_STATUS parsed to zero entries`);
  }
  return entries.sort(([a], [b]) => a.localeCompare(b));
}

/**
 * The body of `httpStatusForResponse`, whitespace-normalised.
 *
 * The map data is only half the contract: the `success → 200` short-circuit and
 * the `?? 400` fallback live in the function, and either could drift on one
 * side with every map assertion still passing.
 */
function parseStatusFunctionBody(source: string, label: string): string {
  const fn =
    /function httpStatusForResponse\(response: APIResponse\): number \{([\s\S]*?)\n\}/.exec(source);
  if (!fn) {
    throw new Error(`${label}: no httpStatusForResponse declaration found`);
  }
  return fn[1].replace(/\s+/g, ' ').trim();
}

function read(path: string): string {
  // `process.cwd()` under vitest is this package's root; the sibling package
  // sits beside it in the workspace.
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('the two native HTTP surfaces share one status vocabulary', () => {
  const parentSource = read('src/native/server/http-server.ts');
  const siblingSource = read('../ui-bridge-native/src/server/http-server.ts');

  const parent = parseStatusMap(parentSource, '@qontinui/ui-bridge/native');
  const sibling = parseStatusMap(siblingSource, '@qontinui/ui-bridge-native');

  it('maps the same codes to the same statuses', () => {
    expect(parent).toEqual(sibling);
  });

  it('derives the status the same way, not just from the same table', () => {
    expect(parseStatusFunctionBody(parentSource, '@qontinui/ui-bridge/native')).toBe(
      parseStatusFunctionBody(siblingSource, '@qontinui/ui-bridge-native')
    );
  });

  it('carries the three codes the mapping exists for', () => {
    expect(parent).toEqual([
      ['METHOD_NOT_ALLOWED', 405],
      ['NOT_FOUND', 404],
      ['NOT_SUPPORTED', 501],
    ]);
  });

  it('maps no resource-level miss — those stay 400 on both surfaces', () => {
    // `ELEMENT_NOT_FOUND` / `COMPONENT_NOT_FOUND` / `WORKFLOW_NOT_FOUND` /
    // `MODAL_NOT_FOUND` name an argument that resolved to nothing, not a route
    // that does not exist. Mapping them to 404 would re-merge the two meanings
    // this table exists to separate.
    const codes = parent.map(([code]) => code);
    for (const resourceMiss of [
      'ELEMENT_NOT_FOUND',
      'COMPONENT_NOT_FOUND',
      'WORKFLOW_NOT_FOUND',
      'MODAL_NOT_FOUND',
    ]) {
      expect(codes).not.toContain(resourceMiss);
    }
  });
});
