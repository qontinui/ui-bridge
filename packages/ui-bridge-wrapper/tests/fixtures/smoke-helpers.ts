/**
 * A helper that calls the real-Chromium gate for whichever test file imports
 * it: the indirection review case (i). Its own path says "smoke", which must
 * not admit an importer that `test:smoke` does not run. chromium-gate.test.ts
 * imports it and expects the import to fail. Not a test file itself.
 */
import { chromiumAvailable } from '../../../../test-support/chromium-gate.mjs';

export const PLAYWRIGHT_AVAILABLE = chromiumAvailable();
