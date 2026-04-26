/**
 * Reference api-transport wrapper for the qontinui UI Bridge.
 *
 * The api transport is the thinnest of the four — no browser, no WebSocket,
 * no runner. It's a pure in-process dispatcher: caller code invokes
 * `transport.dispatch(actionId, params)`, the registered handler runs in Node,
 * and the return value flows back. The use case is wrapping a remote HTTP API
 * (Stripe, GitHub, an internal microservice — here, a stand-in todo list)
 * behind UI Bridge action vocabulary, so the same automation tooling that
 * drives browsers can drive non-browser surfaces too.
 *
 * Adopters should copy this whole package, swap the actions in `src/handlers.ts`
 * for whatever upstream API they want to wrap, and point `TARGET_API_URL` at
 * that service.
 *
 * Env vars:
 *   TARGET_API_URL   — required. Base URL of the upstream HTTP API.
 *   ACTION           — action id to dispatch. Defaults to "listTodos".
 *   PARAMS           — optional JSON string of params for the action.
 *
 * Examples:
 *   # List all todos:
 *   TARGET_API_URL=http://127.0.0.1:4000 npm start
 *
 *   # Create a todo:
 *   TARGET_API_URL=http://127.0.0.1:4000 \
 *     ACTION=createTodo PARAMS='{"title":"buy milk"}' npm start
 *
 *   # Toggle one:
 *   TARGET_API_URL=http://127.0.0.1:4000 \
 *     ACTION=toggleTodo PARAMS='{"id":1}' npm start
 */

import { createTransport, type WrapperTransport } from '@qontinui/ui-bridge-wrapper';
import {
  createApiClient,
  registerHandlers,
  REGISTERED_ACTIONS,
  type RegisteredAction,
} from './handlers.js';

interface CliConfig {
  targetApiUrl: string;
  action: RegisteredAction;
  params: unknown;
}

function parseEnv(env: NodeJS.ProcessEnv): CliConfig {
  const targetApiUrl = env['TARGET_API_URL'];
  if (!targetApiUrl) {
    throw new Error(
      'TARGET_API_URL is required. Example: TARGET_API_URL=http://127.0.0.1:4000 npm start'
    );
  }
  const actionRaw = env['ACTION'] ?? 'listTodos';
  if (!REGISTERED_ACTIONS.includes(actionRaw as RegisteredAction)) {
    throw new Error(`Unknown ACTION "${actionRaw}". Valid: ${REGISTERED_ACTIONS.join(', ')}`);
  }
  let params: unknown = undefined;
  if (env['PARAMS']) {
    try {
      params = JSON.parse(env['PARAMS']);
    } catch (err) {
      throw new Error(
        `PARAMS is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return {
    targetApiUrl,
    action: actionRaw as RegisteredAction,
    params,
  };
}

function ts(): string {
  return new Date().toISOString();
}

function log(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(`[${ts()}]`, ...args);
}

async function main(): Promise<void> {
  const cfg = parseEnv(process.env);
  log(`kind=api target=${cfg.targetApiUrl} action=${cfg.action}`);

  // The api transport carries no I/O of its own — `ApiTransport` just owns
  // a HandlerRegistry and routes dispatches through it. Use the public
  // `createTransport` factory so adopters see the idiomatic entry point.
  const transport: WrapperTransport = createTransport({ kind: 'api' });
  const apiClient = createApiClient(cfg.targetApiUrl);

  transport.onStatusChange((status) => log(`status: ${status}`));
  registerHandlers(transport, apiClient);

  try {
    await transport.ready();
    log('transport ready; dispatching action');

    const result = await transport.dispatch(cfg.action, cfg.params);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ action: cfg.action, params: cfg.params, result }, null, 2));
  } finally {
    log('closing transport');
    try {
      await transport.close();
    } catch (err) {
      log('error during close:', err instanceof Error ? err.message : String(err));
    }
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`[${ts()}] fatal:`, err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
