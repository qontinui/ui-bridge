/**
 * The JSON body rule must be the same in both server packages.
 *
 * #319 made `interpretJsonBody` the one rule every reader in a package calls
 * (standalone `parseBody`, Express `jsonBody`, Next.js `readJsonBody`). But the
 * rule still ships twice: here and in `@qontinui/ui-bridge`'s
 * `src/server/request-body.ts`. The two copies are byte-identical today and
 * nothing kept them so: #315, #316 and #318 each had to make their reader fix
 * in both copies by hand.
 *
 * This package cannot import the rule: `@qontinui/ui-bridge` does not export it,
 * and doing so would also need a release and this package's dependency floor
 * (`>=0.29.0`) raised to that release. So the copies are
 * compared as SOURCE, together with their table tests. If the sibling file
 * cannot be found, this test FAILS rather than skips.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(path: string): string {
  // `process.cwd()` under vitest is this package's root; the engine package
  // sits beside it in the workspace.
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('request-body parity with @qontinui/ui-bridge', () => {
  it.each(['request-body.ts', 'request-body.test.ts'])('%s is byte-identical', (file) => {
    expect(read(`src/${file}`)).toBe(read(`../ui-bridge/src/server/${file}`));
  });
});
