/**
 * `@qontinui/ui-bridge-wrapper`
 *
 * Runtime for building UI Bridge wrapper apps. A wrapper ships the same
 * action code against any of four transports:
 *
 *   - `api`       — handlers call remote APIs directly; no browser/runner.
 *   - `headless`  — Playwright Chromium, no visible window (CI).
 *   - `headed`    — Playwright Chromium, visible window (debugging).
 *   - `live`      — connects to a qontinui runner over WebSocket and
 *                   dispatches the runner's `command` frames locally.
 *
 * Pick a transport with `createTransport({ kind, ... })`, register your
 * action handlers on its `handlerRegistry`, and call `.dispatch(id, params)`
 * to invoke them. React helpers live under the `./react` subpath.
 *
 * @example
 * ```ts
 * import { createTransport, paramSchemaOf } from '@qontinui/ui-bridge-wrapper';
 *
 * const transport = createTransport({
 *   kind: 'headless',
 *   options: { targetUrl: 'http://localhost:3001/vga/builder' },
 * });
 *
 * transport.handlerRegistry.register('login', async (params, ctx) => {
 *   const { email, password } = params as { email: string; password: string };
 *   const { page } = ctx as { page: import('playwright').Page };
 *   await page.fill('#email', email);
 *   await page.fill('#password', password);
 *   await page.click('button[type=submit]');
 * });
 *
 * await transport.ready();
 * await transport.dispatch('login', { email: 'a@b.c', password: '...' });
 * await transport.close();
 * ```
 */

export type {
  WrapperTransport,
  WrapperTransportKind,
  WrapperTransportStatus,
  TransportConfig,
  CommandResponse,
} from './types.js';
export { WrapperTransportError } from './types.js';

export { BaseTransport } from './base-transport.js';
export { HandlerRegistry, type WrapperHandler } from './handler-registry.js';
export { createTransport } from './create-transport.js';

export { ApiTransport, type ApiContext, type ApiFallbackHandler } from './transports/api.js';
export {
  HeadlessTransport,
  type HeadlessContext,
  type HeadlessTransportOptions,
} from './transports/headless.js';
export { HeadedTransport } from './transports/headed.js';
export {
  InjectedTransport,
  type InjectedContext,
  type RegisteredElementDigest,
} from './transports/injected.js';
export {
  LiveSessionTransport,
  type LiveContext,
  type LiveTransportOptions,
} from './transports/live.js';

export { withRetry, type WithRetryOptions } from './helpers/retry.js';
export { withAuthRefresh, type WithAuthRefreshOptions } from './helpers/auth.js';
export { paramSchemaOf } from './helpers/schema.js';

export {
  runWrapperEntrypoint,
  emitManifestOnly,
  type RunWrapperEntrypointOptions,
  type ManifestActionMeta,
  type ManifestOnlyEnvelope,
  type WrapperManifest,
} from './manifest-only.js';
