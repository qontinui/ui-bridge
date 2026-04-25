/**
 * `createTransport` factory
 *
 * Pulls the transport class out of `TransportConfig.kind` and wires it up.
 * Kept as a separate module so tree-shaking can drop unused transports
 * (e.g. an api-only wrapper won't bundle headless / live code paths if the
 * user imports `ApiTransport` directly instead of routing through
 * `createTransport`).
 */

import { ApiTransport } from './transports/api.js';
import { HeadlessTransport } from './transports/headless.js';
import { HeadedTransport } from './transports/headed.js';
import { LiveSessionTransport } from './transports/live.js';
import type { TransportConfig, WrapperTransport } from './types.js';
import { WrapperTransportError } from './types.js';

export function createTransport(config: TransportConfig): WrapperTransport {
  switch (config.kind) {
    case 'api':
      return new ApiTransport(config);
    case 'headless':
      return new HeadlessTransport(config);
    case 'headed':
      return new HeadedTransport(config);
    case 'live': {
      // Allow Node wrappers to pass `ws` via `options.webSocketCtor` without
      // constructing `LiveSessionTransport` directly. In the browser, leave
      // undefined so the transport picks up `globalThis.WebSocket`.
      const opts = (config.options ?? {}) as { webSocketCtor?: unknown };
      const injected =
        typeof opts.webSocketCtor === 'function'
          ? { webSocketCtor: opts.webSocketCtor as never }
          : undefined;
      return new LiveSessionTransport(config, undefined, injected);
    }
    default: {
      const kind = (config as { kind?: string }).kind ?? '<missing>';
      throw new WrapperTransportError('UNKNOWN_TRANSPORT', `Unknown transport kind '${kind}'`);
    }
  }
}
