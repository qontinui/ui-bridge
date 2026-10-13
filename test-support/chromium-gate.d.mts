/** The flag ci.yml's browser-smokes job sets; see chromium-gate.mjs. */
export declare const REQUIRE_CHROMIUM_ENV: 'UI_BRIDGE_REQUIRE_CHROMIUM';
/**
 * True when a Playwright Chromium is installed. Throws when the test file vitest is
 * collecting is not one `test:smoke` selects, and, under the flag, when Chromium is
 * missing. Takes no argument: the file comes from vitest's runtime.
 */
export declare function chromiumAvailable(): boolean;
