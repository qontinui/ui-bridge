/**
 * Reference Playwright-transport wrapper for the qontinui UI Bridge.
 *
 * Picks `HeadlessTransport` (default) or `HeadedTransport` based on the
 * `HEADED` env var, launches a real Chromium tab via `@qontinui/ui-bridge-headless`
 * (handled internally by the transport), registers a small set of caller-driven
 * action handlers, dispatches one action, prints the result, and exits.
 *
 * Adopters should copy this whole package, swap the action handlers (see
 * `src/handlers.ts`), and point `TARGET_URL` at the app they want to drive.
 *
 * Env vars:
 *   TARGET_URL       — required. URL the browser should open.
 *   HEADED=1         — flip to `HeadedTransport` (visible window). Default off.
 *   ACTION           — action id to dispatch. Defaults to "getMetrics".
 *   PARAMS           — optional JSON string of params for the action.
 *   VIEWPORT_WIDTH   — optional viewport width override (default 1280).
 *   VIEWPORT_HEIGHT  — optional viewport height override (default 720).
 *
 * Examples:
 *   # CI smoke (headless, no window):
 *   TARGET_URL=https://example.com npm start
 *
 *   # Visible window, drive a fillInput action:
 *   HEADED=1 TARGET_URL=http://localhost:3000 \
 *     ACTION=fillInput PARAMS='{"value":"a@b.c"}' npm start
 */

import { createTransport, type WrapperTransport } from '@qontinui/ui-bridge-wrapper';
import { registerHandlers, REGISTERED_ACTIONS, type RegisteredAction } from './handlers.js';

interface CliConfig {
  targetUrl: string;
  headed: boolean;
  action: RegisteredAction;
  params: unknown;
  viewportWidth?: number;
  viewportHeight?: number;
}

function parseEnv(env: NodeJS.ProcessEnv): CliConfig {
  const targetUrl = env['TARGET_URL'];
  if (!targetUrl) {
    throw new Error('TARGET_URL is required. Example: TARGET_URL=https://example.com npm start');
  }
  const headed = env['HEADED'] === '1' || env['HEADED']?.toLowerCase() === 'true';
  const actionRaw = env['ACTION'] ?? 'getMetrics';
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
  const viewportWidth = env['VIEWPORT_WIDTH'] ? Number(env['VIEWPORT_WIDTH']) : undefined;
  const viewportHeight = env['VIEWPORT_HEIGHT'] ? Number(env['VIEWPORT_HEIGHT']) : undefined;
  return {
    targetUrl,
    headed,
    action: actionRaw as RegisteredAction,
    params,
    viewportWidth,
    viewportHeight,
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
  log(`kind=${cfg.headed ? 'headed' : 'headless'} target=${cfg.targetUrl} action=${cfg.action}`);

  // Both transports take the same options shape — only `kind` differs.
  // `createTransport` routes to `HeadedTransport` vs `HeadlessTransport`
  // based on `kind`. We use the public factory rather than the classes
  // directly so adopters see the idiomatic entry point.
  const transport: WrapperTransport = createTransport({
    kind: cfg.headed ? 'headed' : 'headless',
    options: {
      targetUrl: cfg.targetUrl,
      ...(cfg.viewportWidth !== undefined ? { viewportWidth: cfg.viewportWidth } : {}),
      ...(cfg.viewportHeight !== undefined ? { viewportHeight: cfg.viewportHeight } : {}),
      // Forward browser console to the Node stderr/stdout — handy when a
      // page error breaks an action and you want to see what happened.
      forwardConsole: true,
    },
  });

  transport.onStatusChange((status) => log(`status: ${status}`));
  registerHandlers(transport);

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
