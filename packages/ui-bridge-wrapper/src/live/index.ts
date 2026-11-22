/**
 * `@qontinui/ui-bridge-wrapper/live` — the BROWSER-SAFE entry.
 *
 * Everything a browser (an extension content script, a page) needs to be a
 * live wrapper instance on the runner's `/ui-bridge/ws`: the live transport,
 * its handler registry and error type, and the `getScreenshot` contract.
 *
 * NODE-FREE by contract. Nothing reachable from this file may import a Node
 * builtin (`node:fs`, `module`, …), `playwright`, `inject-cli` or
 * `InjectedTransport`, or touch `Buffer` / `process` / `require`. The package
 * root (`.`) re-exports Node-only transports, so a bundle of it carries
 * top-level `require("module")`-style calls that throw in a content script;
 * this entry exists so a browser bundle never walks that graph.
 * `ui-bridge-extension`'s `tests/content-bundle-node-free.test.ts` fails the
 * build output if that ever regresses.
 *
 * SHARED CLASSES. This entry and the package root are built with code
 * splitting, so within ONE module format they share a single copy of
 * `WrapperTransportError`, `HandlerRegistry` and `LiveSessionTransport`: a
 * `./live` error thrown through a root registry keeps its code
 * (`tests/live-entry-shared.test.ts`). Across formats they do NOT — the CJS
 * build (`require`) and the ESM build (`import`) are separate copies, the
 * usual dual-package hazard — so do not mix a `require` of one entry with an
 * `import` of the other in one process.
 */

export { WrapperTransportError } from '../types.js';
export type {
  WrapperTransport,
  WrapperTransportKind,
  WrapperTransportStatus,
  TransportConfig,
  CommandResponse,
} from '../types.js';
export { HandlerRegistry, type WrapperHandler } from '../handler-registry.js';
export {
  LiveSessionTransport,
  type LiveContext,
  type LiveTransportOptions,
} from '../transports/live.js';
export {
  SCREENSHOT_CAPABILITY,
  SCREENSHOT_ACTION,
  SCREENSHOT_TIMEOUT_MS,
  registerScreenshotCapture,
  captureScreenshotReply,
  type ScreenshotReply,
  type ScreenshotRegistrar,
  type ScreenshotCaptureOptions,
} from '../screenshot-capture.js';
export type { FramePage } from '../frame-page.js';
