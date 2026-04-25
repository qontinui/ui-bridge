/**
 * Reference WebSocket-transport wrapper for the qontinui runner.
 *
 * Connects to `ws://<runner-host>:<runner-port>/ui-bridge/ws` via
 * `LiveSessionTransport` from `@qontinui/ui-bridge-wrapper`, registers a
 * representative subset of the relay action vocabulary, and prints every
 * command frame in/out.
 *
 * The runner's retrofitted SDK control routes — e.g. `GET /ui-bridge/sdk/control/snapshot`,
 * `GET /ui-bridge/sdk/control/element/:id`, `POST /ui-bridge/sdk/control/element/:id/action`,
 * `GET /ui-bridge/sdk/control/forms`, `POST /ui-bridge/sdk/control/fill` —
 * call `try_ws_dispatch` (mcp/sdk_client.rs) before falling back to HTTP/IPC.
 * When this wrapper is registered, those routes return whatever the matching
 * handler below emits, proving the WS path fired.
 *
 * Usage:
 *   RUNNER_URL=ws://127.0.0.1:<port>/ui-bridge/ws \
 *   APP_ID=demo-wrapper APP_NAME="Demo Wrapper" \
 *   node --import tsx src/index.ts
 *
 * Or pass flags:
 *   node --import tsx src/index.ts --runner-url ws://... --app-id demo
 */

import WebSocket from 'ws';
import { createTransport, type WrapperTransport } from '@qontinui/ui-bridge-wrapper';

// ---------------------------------------------------------------------------
// CLI / env
// ---------------------------------------------------------------------------
interface CliConfig {
  runnerUrl: string;
  appId: string;
  appName: string;
  appType: string;
}

function parseArgs(argv: readonly string[]): CliConfig {
  const flag = (name: string): string | undefined => {
    const idx = argv.indexOf(`--${name}`);
    if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
    return undefined;
  };
  const runnerUrl =
    flag('runner-url') ?? process.env.RUNNER_URL ?? 'ws://127.0.0.1:9876/ui-bridge/ws';
  const appId = flag('app-id') ?? process.env.APP_ID ?? 'wrapper-live-example';
  const appName = flag('app-name') ?? process.env.APP_NAME ?? 'Wrapper Live Example';
  const appType = flag('app-type') ?? process.env.APP_TYPE ?? 'wrapper';
  return { runnerUrl, appId, appName, appType };
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
function ts(): string {
  return new Date().toISOString();
}

function log(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(`[${ts()}]`, ...args);
}

// ---------------------------------------------------------------------------
// Sample handlers — each returns a realistic-shaped response. Not real data;
// the goal is to exercise the WS dispatch path with the right schema.
// ---------------------------------------------------------------------------

/** Static sample dataset shared by snapshot / element / form handlers so the
 *  reference values line up across calls. */
const SAMPLE_ELEMENTS = [
  {
    id: 'sample.button.submit',
    type: 'button',
    label: 'Submit',
    actions: ['click', 'focus'],
    state: { visible: true, enabled: true, focused: false, hovered: false },
    category: 'interactive' as const,
    kind: 'interactive' as const,
    bbox: { x: 16, y: 64, width: 96, height: 32 },
    visible: true,
  },
  {
    id: 'sample.input.email',
    type: 'input',
    label: 'Email',
    actions: ['focus', 'fill', 'clear'],
    state: { visible: true, enabled: true, focused: false, hovered: false, value: '' },
    category: 'interactive' as const,
    kind: 'interactive' as const,
    bbox: { x: 16, y: 24, width: 240, height: 32 },
    visible: true,
  },
  {
    id: 'sample.label.heading',
    type: 'label',
    label: 'Sign in',
    actions: [],
    state: { visible: true, enabled: true, focused: false, hovered: false },
    category: 'content' as const,
    kind: 'content' as const,
    content: 'Sign in',
    bbox: { x: 16, y: 0, width: 120, height: 24 },
    visible: true,
  },
];

const SAMPLE_FORMS = [
  {
    id: 'sample.form.signin',
    formId: 'sample.form.signin',
    name: 'sign-in',
    fields: [
      { id: 'sample.input.email', name: 'email', type: 'email', value: '' },
      { id: 'sample.input.password', name: 'password', type: 'password', value: '' },
    ],
    submitElementId: 'sample.button.submit',
  },
];

interface RegisterArg {
  transport: WrapperTransport;
  log: (...args: unknown[]) => void;
}

/** Wire up the handlers we want the runner's HTTP routes to dispatch to. */
function registerHandlers({ transport, log: logFn }: RegisterArg): void {
  const wrap =
    <P, R>(action: string, fn: (params: P) => R) =>
    (params: unknown): R => {
      logFn(`<- command  action=${action}`, params ?? {});
      const result = fn(params as P);
      logFn(`-> response action=${action}`, summarize(result));
      return result;
    };

  // GET /ui-bridge/sdk/control/snapshot  → "getControlSnapshot"
  transport.register(
    'getControlSnapshot',
    wrap<{ recency?: string }, unknown>('getControlSnapshot', () => ({
      success: true,
      data: {
        timestamp: Date.now(),
        elements: SAMPLE_ELEMENTS,
        components: [],
        workflows: [],
        states: [],
        url: 'ws-app://wrapper-live-example',
        title: 'Wrapper Live Example',
      },
    }))
  );

  // GET /ui-bridge/sdk/control/element/:id  → "getElement"
  transport.register(
    'getElement',
    wrap<{ id: string }, unknown>('getElement', (params) => {
      const id = params?.id ?? '';
      const found = SAMPLE_ELEMENTS.find((e) => e.id === id);
      if (!found) {
        return { success: false, error: `unknown element id: ${id}` };
      }
      return { success: true, data: found };
    })
  );

  // POST /ui-bridge/sdk/control/element/:id/action  → "executeElementAction"
  transport.register(
    'executeElementAction',
    wrap<{ id: string; request: { action?: string; payload?: unknown } }, unknown>(
      'executeElementAction',
      (params) => {
        const id = params?.id ?? '';
        const actionName = params?.request?.action ?? 'click';
        const found = SAMPLE_ELEMENTS.find((e) => e.id === id);
        if (!found) {
          return { success: false, error: `unknown element id: ${id}` };
        }
        return {
          success: true,
          data: {
            elementId: id,
            action: actionName,
            executedAt: Date.now(),
            // Minimal post-action state so callers can chain assertions.
            state: found.state,
          },
        };
      }
    )
  );

  // GET /ui-bridge/sdk/control/forms  → "getForms"
  transport.register(
    'getForms',
    wrap<undefined, unknown>('getForms', () => ({
      success: true,
      data: { forms: SAMPLE_FORMS },
    }))
  );

  // POST /ui-bridge/sdk/control/fill  → "fillForm"
  transport.register(
    'fillForm',
    wrap<{ formId?: string; values?: Record<string, unknown> }, unknown>('fillForm', (params) => {
      const formId = params?.formId ?? SAMPLE_FORMS[0].formId;
      const values = params?.values ?? {};
      const filled = Object.entries(values).map(([name, value]) => ({ name, value }));
      return {
        success: true,
        data: {
          formId,
          filled,
          filledCount: filled.length,
          filledAt: Date.now(),
        },
      };
    })
  );

  // Bonus mechanical handlers — extra coverage of the relay vocabulary.
  // Each just returns a stub envelope so the WS path is exercised.

  // POST /ui-bridge/sdk/control/discover  → "find"
  transport.register(
    'find',
    wrap<Record<string, unknown>, unknown>('find', (params) => ({
      success: true,
      data: {
        query: params ?? {},
        matches: SAMPLE_ELEMENTS.slice(0, 1),
        total: 1,
      },
    }))
  );

  // GET /ui-bridge/sdk/control/console-errors  → "getConsoleErrors"
  transport.register(
    'getConsoleErrors',
    wrap<Record<string, unknown>, unknown>('getConsoleErrors', () => ({
      success: true,
      data: { errors: [], cursor: null },
    }))
  );
}

/** Compact a handler result into a one-line preview for logs. */
function summarize(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    if (json.length <= 160) return json;
    return `${json.slice(0, 157)}...`;
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const cfg = parseArgs(process.argv.slice(2));
  log(
    `runner-url=${cfg.runnerUrl} app-id=${cfg.appId} app-name=${cfg.appName} app-type=${cfg.appType}`
  );

  // `LiveSessionTransport` accepts an injected WS constructor — we pass
  // `ws.WebSocket` so this works in plain Node without a global WebSocket.
  const transport = createTransport({
    kind: 'live',
    runnerUrl: cfg.runnerUrl,
    appId: cfg.appId,
    appName: cfg.appName,
    options: {
      appType: cfg.appType,
      framework: 'node',
      version: '0.1.0',
      capabilities: [
        'getControlSnapshot',
        'getElement',
        'executeElementAction',
        'getForms',
        'fillForm',
      ],
      // The constructor on `ws` is a class — type-compatible with the
      // `WebSocketCtor` the transport expects.
      webSocketCtor: WebSocket as unknown as new (
        url: string,
        protocols?: string | string[]
      ) => WebSocket,
    },
  });

  transport.onStatusChange((status) => log(`status: ${status}`));

  registerHandlers({ transport, log });

  await transport.ready();
  log('handshake complete; awaiting commands. Press Ctrl+C to quit.');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`received ${signal}; closing transport`);
    try {
      await transport.close();
    } catch (err) {
      log('error during close:', err instanceof Error ? err.message : String(err));
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Stay alive until a signal arrives. The transport keeps the event loop busy
  // via its WS connection, but we add a no-op interval as belt-and-suspenders
  // in case someone closes the transport from outside (tests etc.).
  setInterval(() => {
    /* keepalive */
  }, 1 << 30);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`[${ts()}] fatal:`, err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
