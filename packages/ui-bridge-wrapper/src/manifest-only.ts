/**
 * `--manifest-only` mode + Node entrypoint helper.
 *
 * Wrapper packages use `runWrapperEntrypoint` as their `index-node.ts` main
 * loop. The helper covers two modes off the same `process.argv`:
 *
 *   1. Default (no `--manifest-only`): bring the transport up, log readiness,
 *      and park on SIGINT/SIGTERM. Identical to what each wrapper used to
 *      hand-roll.
 *   2. `--manifest-only`: print one line of JSON describing the wrapper's
 *      `qontinui.wrapper` manifest plus the registered actions' paramSchemas
 *      to stdout, close the transport, and `process.exit(0)` without ever
 *      starting the WS server. Used by the runner's WrapperRegistry for
 *      cheap discovery.
 *
 * The helper accepts the manifest object directly (sourced by the caller from
 * its own package.json) so the framework stays agnostic to package layout.
 */
import type { WrapperTransport } from './types.js';

/**
 * Action metadata surfaced to the runner via `--manifest-only`. Each wrapper
 * supplies one of these per registered action so the runner can discover
 * paramSchemas without spawning the WS server.
 */
export interface ManifestActionMeta {
  id: string;
  paramSchema: Record<string, unknown>;
  /**
   * If `true`, the runner's DispatchRouter serializes calls to this action
   * via a per-(wrapper, action) mutex. Defaults to `false`.
   */
  exclusive?: boolean;
}

/** Shape of the `qontinui.wrapper` field in a wrapper's package.json. */
export interface WrapperManifest {
  manifestVersion: 1;
  id: string;
  displayName: string;
  description?: string;
  transport: 'api' | 'headless' | 'headed' | 'live';
  categories?: string[];
  envVars?: Array<{
    name: string;
    required?: boolean;
    secret?: boolean;
    description?: string;
  }>;
  /** Forward-compatible: extra fields are preserved verbatim. */
  [extra: string]: unknown;
}

/** Options accepted by `runWrapperEntrypoint`. */
export interface RunWrapperEntrypointOptions {
  /** Transport produced by `createTransport` and pre-populated with handlers. */
  transport: WrapperTransport;
  /** The wrapper's own `qontinui.wrapper` manifest (already parsed from package.json). */
  manifest: WrapperManifest;
  /** Action metadata. Order is preserved in the emitted JSON. */
  actions: ReadonlyArray<ManifestActionMeta>;
  /**
   * Friendly name used for stdout/stderr log prefixes. Defaults to
   * `manifest.id` so logs are stable across wrappers.
   */
  logName?: string;
  /**
   * Optional override for argv parsing. Defaults to `process.argv.slice(2)`.
   * Lets tests inject a fixed flag list without touching `process`.
   */
  argv?: ReadonlyArray<string>;
}

/** Stable JSON envelope written to stdout in `--manifest-only` mode. */
export interface ManifestOnlyEnvelope {
  manifestVersion: 1;
  manifest: WrapperManifest;
  actions: Array<{
    id: string;
    paramSchema: Record<string, unknown>;
    exclusive: boolean;
  }>;
}

function hasManifestOnlyFlag(argv: ReadonlyArray<string>): boolean {
  return argv.includes('--manifest-only');
}

/**
 * Print the manifest envelope to stdout and tear the transport down. Exits
 * the process with code 0 on success or 1 on transport-close failure.
 *
 * Safe to call before `transport.ready()` — the WS server is never started.
 */
export async function emitManifestOnly(opts: {
  transport: WrapperTransport;
  manifest: WrapperManifest;
  actions: ReadonlyArray<ManifestActionMeta>;
}): Promise<never> {
  const envelope: ManifestOnlyEnvelope = {
    manifestVersion: 1,
    manifest: opts.manifest,
    actions: opts.actions.map((a) => ({
      id: a.id,
      paramSchema: a.paramSchema,
      exclusive: a.exclusive ?? false,
    })),
  };
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
  try {
    await opts.transport.close();
  } catch {
    // Manifest already emitted; close failure shouldn't mask the result.
  }
  process.exit(0);
}

/**
 * Single entrypoint helper that branches on `--manifest-only` or runs the
 * standard daemon loop (transport.ready() + SIGINT/SIGTERM). Returns a
 * promise that never resolves in daemon mode (we park on the signal
 * handlers) and never resolves in manifest-only mode either (we
 * `process.exit(0)`). The return type is `Promise<never>` so callers don't
 * accidentally chain code after it.
 */
export async function runWrapperEntrypoint(opts: RunWrapperEntrypointOptions): Promise<never> {
  const argv = opts.argv ?? process.argv.slice(2);
  const logName = opts.logName ?? opts.manifest.id;

  if (hasManifestOnlyFlag(argv)) {
    await emitManifestOnly({
      transport: opts.transport,
      manifest: opts.manifest,
      actions: opts.actions,
    });
    // emitManifestOnly never returns, but TS can't see that.
    throw new Error('unreachable');
  }

  await opts.transport.ready();

  // When the runner spawns the wrapper as a daemon, it expects a tiny
  // HTTP server at `http://127.0.0.1:<WRAPPER_PORT>/dispatch` so it can
  // route action calls to us. The api transport doesn't bind a port on
  // its own (it's a pure in-process dispatcher), so we open one here
  // when WRAPPER_PORT is set in the environment. Skipped silently when
  // unset — that's the "run standalone, no runner" mode used in tests
  // and the `_probe-*.mjs` scripts.
  const wrapperPort = parsePort(process.env['WRAPPER_PORT']);
  if (wrapperPort != null) {
    await startDispatchServer(opts.transport, wrapperPort, logName);
  }

  process.stdout.write(
    `[${logName}] ready (transport=${opts.transport.kind}${
      wrapperPort != null ? `, port=${wrapperPort}` : ''
    }); press Ctrl+C to exit.\n`
  );

  const shutdown = async (signal: NodeJS.Signals): Promise<never> => {
    process.stdout.write(`[${logName}] received ${signal}, closing transport...\n`);
    try {
      await opts.transport.close();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[${logName}] close error: ${msg}\n`);
    }
    process.exit(0);
  };
  process.on('SIGINT', (s) => {
    void shutdown(s);
  });
  process.on('SIGTERM', (s) => {
    void shutdown(s);
  });

  // Park forever; the signal handlers are the only exit path.
  return new Promise<never>(() => {
    /* never resolves */
  });
}

function parsePort(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 65_536 ? n : null;
}

/**
 * Bind a tiny HTTP server on `127.0.0.1:<port>` exposing two endpoints:
 *
 *   - `GET /health` — returns `{ ok: true }` so the runner's manager can
 *     poll for readiness.
 *   - `POST /dispatch` — body `{ action, params }`, dispatches via the
 *     transport's `HandlerRegistry`, and returns
 *     `{ success: true, data: <result> }` on success or
 *     `{ success: false, error: <message> }` on failure.
 *
 * Loopback-only by design — the wrapper's port is meant for the runner
 * to talk to it, never an external client. Uses Node's built-in `http`
 * module to avoid pulling in a framework dep.
 */
async function startDispatchServer(
  transport: WrapperTransport,
  port: number,
  logName: string
): Promise<void> {
  const http = await import('node:http');
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method === 'POST' && req.url === '/dispatch') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => {
        body += chunk;
        // Defensive cap — generous enough for any reasonable params payload.
        if (body.length > 10 * 1024 * 1024) {
          req.destroy();
        }
      });
      req.on('end', () => {
        let parsed: { action?: unknown; params?: unknown };
        try {
          parsed = JSON.parse(body || '{}') as typeof parsed;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: `bad request body: ${msg}` }));
          return;
        }
        const action = typeof parsed.action === 'string' ? parsed.action : '';
        if (!action) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'missing required field: action' }));
          return;
        }
        transport
          .dispatch(action, parsed.params)
          .then((result) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, data: result }));
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: msg }));
          });
      });
      req.on('error', () => {
        // Connection-level errors get logged to stderr; we don't have a
        // response stream to write to once the request errors.
        process.stderr.write(`[${logName}] request error during dispatch\n`);
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'not found' }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}
