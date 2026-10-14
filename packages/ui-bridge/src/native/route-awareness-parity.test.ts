/**
 * The two React Native surfaces must report routes identically.
 *
 * Route awareness ships twice: in `@qontinui/ui-bridge-native` (#243) and in
 * this package's `@qontinui/ui-bridge/native` twin (#245). #245 copied the hook
 * and the router helpers byte-for-byte, changing only the `@example` import
 * specifier, and `ui-bridge-native` declares its own `RouteInfo` as a mirror of
 * the web type. Nothing kept any of those copies equal afterwards. The
 * contract they carry is a privacy one — a helper that starts leaking a
 * concrete path on one surface only is the divergence this file exists to stop.
 *
 * The packages cannot import each other (`@qontinui/ui-bridge` is only an
 * OPTIONAL peer of `@qontinui/ui-bridge-native`), so the copies are compared
 * as SOURCE, the way `server/http-status-parity.test.ts` compares the status
 * maps. If a sibling file cannot be found this FAILS rather than skips.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(path: string): string {
  // `process.cwd()` under vitest is this package's root; the sibling package
  // sits beside it in the workspace.
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

/**
 * The one sanctioned difference: each copy's `@example` names its own package.
 * Normalized to a placeholder ON DOC-COMMENT LINES ONLY, so a real `import`
 * naming either package still has to match byte for byte.
 */
function normalizeSpecifier(source: string): string {
  return source
    .split('\n')
    .map((line) =>
      /^\s*\*/.test(line)
        ? line.replace(/'@qontinui\/ui-bridge(?:-native|\/native)'/g, "'<native-package>'")
        : line
    )
    .join('\n');
}

/**
 * The member lines of `export interface RouteInfo { ... }`, comments dropped.
 * Every non-comment line counts, so a member this parse cannot read still
 * shows up as a difference instead of being skipped on both sides.
 */
function routeInfoMembers(source: string, label: string): string[] {
  const block = /^export interface RouteInfo \{\n([\s\S]*?)^\}/m.exec(source);
  if (!block) {
    throw new Error(`${label}: no \`export interface RouteInfo\` block found`);
  }
  const members = block[1]
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => line.length > 0);
  if (members.length === 0) {
    throw new Error(`${label}: RouteInfo has no members — parity cannot be asserted`);
  }
  return members;
}

describe('the two native route-awareness surfaces stay identical', () => {
  for (const file of ['react/routePattern.ts', 'react/useRouteAwareness.ts']) {
    it(`${file} differs only in its example import specifier`, () => {
      const parent = read(`src/native/${file}`);
      const sibling = read(`../ui-bridge-native/src/${file}`);
      expect(normalizeSpecifier(parent)).toBe(normalizeSpecifier(sibling));
    });
  }

  it("ui-bridge-native's RouteInfo mirrors the web RouteInfo member for member", () => {
    const web = routeInfoMembers(read('src/navigation/types.ts'), '@qontinui/ui-bridge');
    const native = routeInfoMembers(
      read('../ui-bridge-native/src/core/types.ts'),
      '@qontinui/ui-bridge-native'
    );
    expect(native).toEqual(web);
  });
});
