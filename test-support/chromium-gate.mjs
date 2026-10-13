/**
 * THE gate for every real-Chromium test in this repo.
 *
 * Each such test file writes `describe.skipIf(!chromiumAvailable())`: with no
 * Playwright Chromium installed the block skips, which is right on a developer
 * box, in ci.yml's lint-and-test job and on the .qontinui/ci.toml lane, none of
 * which install a browser.
 *
 * Under UI_BRIDGE_REQUIRE_CHROMIUM=1, which ONLY ci.yml's browser-smokes job
 * sets, a missing Chromium THROWS instead. The file then fails to load and the
 * job fails, rather than passing with every browser test skipped -- the job
 * exists to run them. `assert-no-skipped-tests.mjs` beside this file catches a
 * test that skips for any other reason in that job.
 *
 * Plain .mjs with a .d.mts beside it, so a type-checked test inside a package
 * whose rootDir is `src` (ui-bridge-headless) can import it.
 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

/** The flag browser-smokes sets. */
export const REQUIRE_CHROMIUM_ENV = 'UI_BRIDGE_REQUIRE_CHROMIUM';

/** True when a Playwright Chromium is installed; under the flag, throws when it is not. */
export function chromiumAvailable() {
  let executable = '<unresolved>';
  let present = false;
  try {
    executable = chromium.executablePath();
    present = existsSync(executable);
  } catch {
    present = false;
  }
  if (!present && process.env[REQUIRE_CHROMIUM_ENV] === '1') {
    throw new Error(
      `${REQUIRE_CHROMIUM_ENV}=1, but there is no Playwright Chromium at ${executable}: ` +
        `every real-Chromium test would skip, and this run exists to execute them. ` +
        `Install it with \`npx playwright install chromium\`.`
    );
  }
  return present;
}
