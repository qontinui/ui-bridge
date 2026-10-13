/** The flag ci.yml's browser-smokes job sets; see chromium-gate.mjs. */
export declare const REQUIRE_CHROMIUM_ENV: 'UI_BRIDGE_REQUIRE_CHROMIUM';
/** True when a Playwright Chromium is installed; under the flag, throws when it is not. */
export declare function chromiumAvailable(): boolean;
