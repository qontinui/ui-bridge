/**
 * HMR Capture Sub-module
 *
 * Intercepts HMR connections to Next.js dev server endpoints and emits
 * compilation errors/warnings into the unified event pipeline.
 *
 * Next.js 15+ uses WebSocket for HMR (at ws://host/_next/webpack-hmr).
 * Older versions (≤14) used EventSource (at /_next/webpack-hmr).
 * Turbopack variants use /__turbopack_hmr or /_next/turbopack-hmr.
 *
 * Strategy: Wrap the WebSocket and EventSource constructors so any HMR
 * connection created by the bundler is automatically intercepted.
 */

import type { AnyCapturedEvent, HmrCapturedEvent } from '../browser-capture-types';

type Emit = (event: AnyCapturedEvent) => void;

// Path patterns that identify HMR connections (used for both WS and SSE)
const HMR_PATH_PATTERNS = ['/_next/webpack-hmr', '/__turbopack_hmr', '/_next/turbopack-hmr'];

function isHmrUrl(url: string): boolean {
  return HMR_PATH_PATTERNS.some((p) => url.includes(p));
}

function makeEvent(
  level: HmrCapturedEvent['level'],
  message: string,
  moduleName?: string,
  loc?: string
): HmrCapturedEvent {
  return {
    type: 'hmr',
    level,
    message,
    moduleName,
    loc,
    timestamp: Date.now(),
    url: typeof window !== 'undefined' ? window.location.href : '',
  };
}

/**
 * Parse an HMR message (JSON string) and emit any errors/warnings.
 * Handles both Next.js webpack format and turbopack format.
 */
function processHmrMessage(data: string, emit: Emit): void {
  try {
    const msg = JSON.parse(data);

    // Next.js webpack format (action: "sync" or "built"):
    // { action: "sync"|"built", errors: CompilationError[], warnings: CompilationError[] }
    // CompilationError: { message, moduleName, details, moduleTrace, stack }
    if (Array.isArray(msg.errors)) {
      for (const err of msg.errors) {
        emit(
          makeEvent(
            'error',
            typeof err === 'string' ? err : (err.message ?? String(err)),
            err.moduleName ?? err.moduleIdentifier,
            err.loc ? String(err.loc) : undefined
          )
        );
      }
    }
    if (Array.isArray(msg.warnings)) {
      for (const warn of msg.warnings) {
        emit(
          makeEvent(
            'warning',
            typeof warn === 'string' ? warn : (warn.message ?? String(warn)),
            warn.moduleName ?? warn.moduleIdentifier,
            warn.loc ? String(warn.loc) : undefined
          )
        );
      }
    }

    // Next.js serverError format: { action: "serverError", errorJSON: "..." }
    if (msg.action === 'serverError' && msg.errorJSON) {
      try {
        const err = JSON.parse(msg.errorJSON);
        emit(makeEvent('error', err.message ?? String(err)));
      } catch {
        emit(makeEvent('error', msg.errorJSON));
      }
    }

    // Turbopack format: { type: "turbopack-message", data: { diagnostics: [...] } }
    if (
      (msg.action === 'turbopack-message' || msg.type === 'turbopack-message') &&
      msg.data?.diagnostics
    ) {
      for (const diag of msg.data.diagnostics) {
        emit(
          makeEvent(
            diag.category === 'warning' ? 'warning' : 'error',
            diag.message ?? String(diag),
            diag.filePath,
            diag.line != null ? `${diag.line}:${diag.column ?? 0}` : undefined
          )
        );
      }
    }
  } catch {
    // Not JSON or unexpected format — ignore
  }
}

// ---------------------------------------------------------------------------
// WebSocket interception (Next.js 15+)
// ---------------------------------------------------------------------------

function installWebSocketCapture(emit: Emit, cleanups: (() => void)[]): void {
  if (!window.WebSocket) return;

  const OriginalWebSocket = window.WebSocket;
  const trackedSockets: WebSocket[] = [];

  // Wrap WebSocket constructor to intercept HMR connections
  const PatchedWebSocket = function (
    this: WebSocket,
    url: string | URL,
    protocols?: string | string[]
  ) {
    const ws = new OriginalWebSocket(url, protocols);
    const urlStr = typeof url === 'string' ? url : url.toString();

    if (isHmrUrl(urlStr)) {
      ws.addEventListener('message', (event: MessageEvent) => {
        if (typeof event.data === 'string') {
          processHmrMessage(event.data, emit);
        }
      });
      trackedSockets.push(ws);
    }

    return ws;
  } as unknown as typeof WebSocket;

  PatchedWebSocket.prototype = OriginalWebSocket.prototype;
  Object.defineProperty(PatchedWebSocket, 'CONNECTING', { value: OriginalWebSocket.CONNECTING });
  Object.defineProperty(PatchedWebSocket, 'OPEN', { value: OriginalWebSocket.OPEN });
  Object.defineProperty(PatchedWebSocket, 'CLOSING', { value: OriginalWebSocket.CLOSING });
  Object.defineProperty(PatchedWebSocket, 'CLOSED', { value: OriginalWebSocket.CLOSED });

  window.WebSocket = PatchedWebSocket;

  cleanups.push(() => {
    window.WebSocket = OriginalWebSocket;
    for (const ws of trackedSockets) {
      ws.close();
    }
    trackedSockets.length = 0;
  });
}

// ---------------------------------------------------------------------------
// EventSource interception (Next.js ≤14 / fallback)
// ---------------------------------------------------------------------------

function installEventSourceCapture(emit: Emit, cleanups: (() => void)[]): void {
  if (!window.EventSource) return;

  const OriginalEventSource = window.EventSource;
  const trackedSources: EventSource[] = [];

  const messageHandler = (event: MessageEvent) => {
    if (typeof event.data === 'string') {
      processHmrMessage(event.data, emit);
    }
  };

  // Wrap EventSource constructor to intercept HMR connections
  const PatchedEventSource = function (
    this: EventSource,
    url: string | URL,
    init?: EventSourceInit
  ) {
    const es = new OriginalEventSource(url, init);
    const urlStr = typeof url === 'string' ? url : url.toString();

    if (isHmrUrl(urlStr)) {
      es.addEventListener('message', messageHandler);
      trackedSources.push(es);
    }

    return es;
  } as unknown as typeof EventSource;

  PatchedEventSource.prototype = OriginalEventSource.prototype;
  Object.defineProperty(PatchedEventSource, 'CONNECTING', {
    value: OriginalEventSource.CONNECTING,
  });
  Object.defineProperty(PatchedEventSource, 'OPEN', { value: OriginalEventSource.OPEN });
  Object.defineProperty(PatchedEventSource, 'CLOSED', { value: OriginalEventSource.CLOSED });

  window.EventSource = PatchedEventSource;

  cleanups.push(() => {
    window.EventSource = OriginalEventSource;
    for (const es of trackedSources) {
      es.close();
    }
    trackedSources.length = 0;
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function installHmrCapture(emit: Emit): () => void {
  if (typeof window === 'undefined') return () => {};

  const cleanups: (() => void)[] = [];

  // Install both transports — the one matching the bundler will intercept
  installWebSocketCapture(emit, cleanups); // Next.js 15+
  installEventSourceCapture(emit, cleanups); // Next.js ≤14 / other bundlers

  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}
