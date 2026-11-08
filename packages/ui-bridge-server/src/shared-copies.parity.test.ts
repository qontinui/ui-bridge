/**
 * Files that ship in both server packages must stay byte-identical.
 *
 * `@qontinui/ui-bridge-server` and `@qontinui/ui-bridge`'s `src/server` each
 * carry their own copy of these files, and nothing kept the copies in step:
 * #315 (`request-body.ts`) and the crash-fix commit `20e7c37` (the two
 * robustness tests) each had to write the same change into both packages by
 * hand.
 *
 * - `request-body.ts` and its table test: #319 made `interpretJsonBody` the one
 *   JSON body rule every reader in a package calls (standalone `parseBody`,
 *   Express `jsonBody`, Next.js `readJsonBody`).
 * - `standalone.robustness.test.ts` and `websocket-handler.non-object.test.ts`:
 *   the regression tests for the standalone-server crash fixes (a bad `Host`
 *   header, a `null` WebSocket frame, split UTF-8 bodies, encoded path params).
 *   The implementations they test differ between the packages, but the
 *   contract they pin is the same. Keeping the tests identical means a
 *   robustness fix and its test reach both servers, not just one.
 * - `express.body-limit.test.ts`: the regression test for the Express adapters'
 *   body rules (`b2a9cdb`: the 10 MB limit and JSON refusals; `5c9a6a3`: reading a
 *   body the way the standalone server does). The two copies had drifted only
 *   in the ORDER of two cases. They are kept identical for the same reason as
 *   the robustness tests.
 *
 * This package cannot import these files: `@qontinui/ui-bridge` does not
 * export them. Exporting them would also need a release, and this package's
 * dependency floor (`>=0.29.0`) raised to that release. So the copies are
 * compared as SOURCE. If a sibling file cannot be found, this test FAILS
 * rather than skips.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(path: string): string {
  // `process.cwd()` under vitest is this package's root; the engine package
  // sits beside it in the workspace.
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const SHARED_FILES = [
  'request-body.ts',
  'request-body.test.ts',
  'standalone.robustness.test.ts',
  'websocket-handler.non-object.test.ts',
  'express.body-limit.test.ts',
];

describe('server sources shared with @qontinui/ui-bridge', () => {
  it.each(SHARED_FILES)('%s is byte-identical', (file) => {
    expect(read(`src/${file}`)).toBe(read(`../ui-bridge/src/server/${file}`));
  });
});
