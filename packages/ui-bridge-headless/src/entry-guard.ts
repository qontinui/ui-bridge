/**
 * Whether the module at `moduleUrl` is the process's entry point, i.e. was run
 * as a bin rather than imported. Shared by every command of this package
 * (`ui-bridge-tab`, `ui-bridge-density`): importing a command's module from a
 * test must not run it.
 *
 * Both bins ship as ESM (`"type": "module"`), so there is no `require.main` to
 * compare against and the check goes through `process.argv[1]`. That is the
 * path AS INVOKED, and Node never resolves symlinks in it: run through the
 * installed bin symlink — `node_modules/.bin/<bin>`, which is exactly what
 * `npx … <bin>` resolves to — a raw comparison against `import.meta.url` was
 * false, so `main()` never ran and the process exited 0 having printed nothing
 * at all. REAL paths are compared, so the symlink collapses.
 *
 * Call it as `isEntryModule(import.meta.url)` from the command's own module.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function isEntryModule(
  moduleUrl: string,
  invokedAs: string | undefined = process.argv[1]
): boolean {
  try {
    if (invokedAs === undefined) return false;
    const here = fileURLToPath(moduleUrl);
    if (invokedAs === here) return true;
    return realpathSync(invokedAs) === realpathSync(here);
  } catch {
    return false;
  }
}
