/**
 * `{{PACKAGE_NAME}}` — Node entry point.
 *
 * Spins up a single transport instance, registers action handlers via
 * `registerHandlers(transport)`, and parks the event loop until SIGINT.
 * Use this shape for CI runners, daemonized wrappers, and anywhere
 * React is unwanted.
 */
{{#IF_WS_DEP}}
import WebSocketCtor from 'ws';
{{/IF_WS_DEP}}
import { createTransport } from '@qontinui/ui-bridge-wrapper';
import { registerHandlers } from './handlers.js';

const transport = createTransport({
  kind: '{{DEFAULT_TRANSPORT}}',
  {{RUNNER_URL_FIELD}}
  appId: 'wrapper-{{NAME}}',
  appName: '{{DISPLAY_NAME}}',
  {{#IF_WS_DEP}}options: { webSocketCtor: WebSocketCtor },{{/IF_WS_DEP}}
});

registerHandlers(transport);

async function main(): Promise<void> {
  await transport.ready();
  process.stdout.write(
    `[{{NAME}}] ready (transport=${transport.kind}); press Ctrl+C to exit.\n`
  );

  const shutdown = async (signal: NodeJS.Signals): Promise<never> => {
    process.stdout.write(`[{{NAME}}] received ${signal}, closing transport...\n`);
    await transport.close();
    process.exit(0);
  };
  process.on('SIGINT', (s) => {
    void shutdown(s);
  });
  process.on('SIGTERM', (s) => {
    void shutdown(s);
  });
}

void main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`[{{NAME}}] fatal: ${msg}\n`);
  process.exit(1);
});

export { transport };
