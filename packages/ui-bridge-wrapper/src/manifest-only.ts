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
  process.stdout.write(
    `[${logName}] ready (transport=${opts.transport.kind}); press Ctrl+C to exit.\n`
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
