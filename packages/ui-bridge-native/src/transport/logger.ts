/**
 * Minimal logger for the UI Bridge Native transport layer.
 *
 * Wraps console so callers go through a single controlled point. Log output
 * can be suppressed globally by setting:
 *
 *   import { transportLogger } from './logger';
 *   transportLogger.silent = true;
 *
 * In production builds you can also tree-shake the verbose log() calls by
 * checking `__DEV__` in your Metro bundler config, but the silent flag is
 * simpler and works without build-time configuration.
 */

export interface TransportLogger {
  log(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  /** Set to true to suppress all log output (warn/error are always emitted). */
  silent: boolean;
}

function createTransportLogger(): TransportLogger {
  return {
    silent: false,
    log(message: string, ...args: unknown[]): void {
      if (!this.silent) {
        console.log(message, ...args);
      }
    },
    warn(message: string, ...args: unknown[]): void {
      console.warn(message, ...args);
    },
    error(message: string, ...args: unknown[]): void {
      console.error(message, ...args);
    },
  };
}

/** Shared logger instance for the transport layer. */
export const transportLogger = createTransportLogger();
