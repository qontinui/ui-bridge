/**
 * HeadedTransport
 *
 * Identical to `HeadlessTransport` except the browser is launched visibly.
 * Kept as its own class so wrappers and docs can refer to the transport
 * kind directly, and so future divergence (e.g. devtools-auto-open for
 * headed) doesn't require refactoring the shared parent.
 */

import { HeadlessTransport } from './headless.js';
import type { HandlerRegistry } from '../handler-registry.js';
import type { TransportConfig } from '../types.js';

export class HeadedTransport extends HeadlessTransport {
  constructor(config: TransportConfig, registry?: HandlerRegistry) {
    super(config, registry, { kind: 'headed', headless: false });
  }
}
