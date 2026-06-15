/**
 * @qontinui/ui-bridge-headless
 *
 * Programmatic Playwright-backed launcher for UI Bridge testing. Spins up
 * a real Chromium instance that loads your app, registers with the UI
 * Bridge relay like any normal browser tab, and stays connected until
 * stopped. Lets tests and CI drive UI Bridge against web apps without
 * a human-opened browser window.
 *
 * Primary consumer: `ui-bridge-tab` CLI (see `cli.ts`).
 *
 * Example (programmatic):
 *
 * ```ts
 * import { launchHeadlessTab } from '@qontinui/ui-bridge-headless';
 *
 * const tab = await launchHeadlessTab({
 *   url: 'http://localhost:3001/vga/builder',
 *   headless: false, // watch it if you want to debug
 *   uiBridgeBase: 'http://localhost:3001/api/ui-bridge',
 *   waitForUiBridgeMs: 30_000,
 * });
 *
 * // ... run UI Bridge commands against uiBridgeBase ...
 *
 * await tab.close();
 * ```
 */

export {
  launchHeadlessTab,
  type HeadlessTab,
  type LaunchHeadlessTabOptions,
  type LaunchHeadlessTabResult,
} from './launcher.js';

export {
  SESSION_STORAGE_KEY,
  mergeSessionStorageIntoArtifact,
  splitSessionStorageArtifact,
  restoreSessionStorageInitScript,
  type SessionStorageKV,
  type SessionStorageMap,
  type StorageStateArtifact,
} from './storage-state.js';
