/** The flag ci.yml's browser-smokes job sets; see chromium-gate.mjs. */
export declare const REQUIRE_CHROMIUM_ENV: 'UI_BRIDGE_REQUIRE_CHROMIUM';
/** The file filters a `test:smoke` script hands `vitest run`. */
export declare function smokeFilters(script: string | undefined): string[];
/** Whether `npm run test:smoke` runs this test file, by vitest's own filter rule. */
export declare function smokeSelection(testFile: string): {
  packageDir: string | null;
  relativePath: string;
  filters: string[];
  selected: boolean;
};
/**
 * True when a Playwright Chromium is installed. Throws when the calling test file
 * (pass its `import.meta.url`) is not one `test:smoke` selects, and, under the flag,
 * when Chromium is missing.
 */
export declare function chromiumAvailable(callerUrl: string): boolean;
