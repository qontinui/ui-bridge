/**
 * `ui-bridge-inject` — drive UI Bridge's injected transport against a page
 * that ships ZERO UI Bridge code.
 *
 * This is a thin CLI: it constructs `createTransport({ kind: 'injected', ... })`
 * and drives the existing `InjectedTransport` lifecycle. It re-implements NONE
 * of the browser launch, bundle injection, init-script ordering, the
 * `window.__uiBridgeInjected.ready` gate, or relay registration — the transport
 * (a subclass of `HeadlessTransport`) already owns all of that. The CLI adds
 * only generic argument plumbing, a one-shot exec path (Variant A), and a
 * stay-alive relay loop (Variant B).
 *
 * Two modes:
 *   - Variant A (one-shot exec): `--exec '<action> <json>'` (repeatable) or
 *     `--exec-stdin` (NDJSON on stdin). Each action runs against the in-page
 *     runtime; one JSON result line per action is written to stdout, then exit.
 *   - Variant B (relay, DEFAULT): no exec actions → register as a relay tab
 *     (requires `--relay`) and stay alive until SIGINT/SIGTERM.
 *
 * The arg parsing, validation, option building, and mode selection are exported
 * pure functions so they can be unit-tested without spawning a browser or
 * calling `main()`.
 */

import { fileURLToPath } from 'node:url';
import { createTransport } from './create-transport.js';
import { consumeValue } from './cli-args.js';
import { WrapperTransportError } from './types.js';

export const USAGE = `ui-bridge-inject — drive UI Bridge's injected transport against a UI-Bridge-free page

Required:
  --url <pageUrl>              Page to open. Must start with http:// or https://
                               (maps to the transport's options.targetUrl)

Relay (Variant B — the default mode; --relay is REQUIRED in this mode):
  --relay <uiBridgeBase>       UI Bridge relay base; the injected runtime registers
                               as a relay tab. Example: http://localhost:3001/api/ui-bridge
  --auth-token <T>             Bearer token for an auth-gated relay
  --registration-metadata <json>
                               JSON {"userId":"...","sessionId":"..."} for per-user
                               tab-scoping on relay heartbeats
  --app-id <id>                App id reported to the relay registry
  --app-name <name>            Display name reported to the relay registry
  --tab-id <id>                Stable per-tab id override

Exec (Variant A — one-shot; presence of any --exec/--exec-stdin selects this mode):
  --exec '<action> <json>'     Run one action (repeatable). The value is an action
                               id, a space, then a JSON payload (payload optional →
                               defaults {}). Example: --exec 'find {"text":"Sign in"}'
  --exec-stdin                 Read NDJSON lines from stdin; each line is
                               {"action":"...","payload":{...}}

Optional:
  --storage-state <path>       Seed the browser context from a Playwright storageState
                               JSON file (cookies + localStorage) produced by
                               'ui-bridge-login-web --storage-state-out <path>'. This
                               carries a saved authenticated session past a login wall,
                               so you can drive a login-walled page (e.g. an /admin
                               wizard) WITHOUT re-driving the hosted-UI login each run.
  --headed                     Launch with a visible window (default: headless)
  --ready-timeout <ms>         Max wait for the injected runtime ready/settle gate (default 30000)
  --no-settle                  Gate ready on the runtime being live only, NOT on the DOM
                               settling. By default the launcher waits for the page to paint
                               + go quiet (so a client-rendered SPA is drivable immediately),
                               which is almost always what you want.
  --settle-quiet <ms>          Quiet window with no DOM re-seed before settled (default 500)
  --settle-timeout <ms>        Hard cap before settling regardless of mutations (default 10000)
  --expect-selector <css>      Don't settle until an element matching this CSS selector
                               exists — use when the target control (e.g. a login form)
                               mounts lazily after unrelated chrome. If it never appears
                               before --settle-timeout, ready() fails with a BLOCKED error
                               instead of returning a control-less page.
  --viewport <WxH>             Viewport size, e.g. 1280x720
  --launch-arg <arg>           Extra Chromium command-line argument (repeatable),
                               passed through to chromium.launch({ args }).
                               NOTE: when --url is https and --relay resolves to a
                               loopback host, the LNA-disable flags
                               (--disable-features=LocalNetworkAccessChecks,...) are
                               auto-appended — Chromium otherwise blocks the
                               https-page → loopback-relay fetch (Local Network Access).
  --quiet                      Suppress human-readable logs (JSON results still print)
  --help, -h                   Print this help and exit

Examples:
  # Variant B: register an injected tab against a relay and stay alive
  ui-bridge-inject --url https://example.com/login \\
    --relay http://localhost:3001/api/ui-bridge --app-name "example login"

  # Variant A: snapshot the controls on a page, then exit
  ui-bridge-inject --url https://example.com/login \\
    --exec 'getControlSnapshot {}'

  # Variant A: find a control and act on it
  ui-bridge-inject --url https://example.com/login \\
    --exec 'find {"text":"Sign in"}'

  # Reuse a saved login: drive a login-walled page with a captured auth artifact
  ui-bridge-login-web --url "https://qontinui.io/login?next=%2Fadmin" \\
    --success /admin --storage-state-out auth.json
  ui-bridge-inject --url https://qontinui.io/admin \\
    --storage-state auth.json --exec 'getControlSnapshot {}'
`;

/** A single Variant-A action to execute. */
export interface ExecAction {
  action: string;
  payload: unknown;
}

/** Parsed, validated CLI arguments. */
export interface InjectCliArgs {
  url: string;
  relay: string | null;
  authToken: string | null;
  registrationMetadata: { userId: string; sessionId: string } | null;
  headed: boolean;
  readyTimeoutMs: number | null;
  /** When false (via --no-settle), gate ready() on `ready` only, not `settled`. */
  waitForSettle: boolean;
  settleQuietMs: number | null;
  settleTimeoutMs: number | null;
  expectSelector: string | null;
  appId: string | null;
  appName: string | null;
  tabId: string | null;
  viewportWidth: number | null;
  viewportHeight: number | null;
  /** Path to a Playwright storageState JSON file to seed the context (from --storage-state). */
  storageState: string | null;
  /** Extra Chromium launch args collected from --launch-arg flags (in order). */
  launchArgs: string[];
  /** Variant-A actions collected from --exec flags (in order). */
  execActions: ExecAction[];
  /** True if --exec-stdin was given (read NDJSON from stdin in Variant A). */
  execStdin: boolean;
  quiet: boolean;
  help: boolean;
}

/**
 * Error raised by `parseArgs`/validation. The thin CLI wrapper catches this and
 * calls `die()`; tests assert on it WITHOUT triggering `process.exit`.
 */
export class InjectCliArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InjectCliArgError';
  }
}

/** Split an `--exec` value into `{ action, payload }`. Payload defaults to `{}`. */
function parseExecValue(raw: string): ExecAction {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new InjectCliArgError(`--exec expects '<action> <json-payload>' (got empty value)`);
  }
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) {
    return { action: trimmed, payload: {} };
  }
  const action = trimmed.slice(0, spaceIdx);
  const payloadRaw = trimmed.slice(spaceIdx + 1).trim();
  if (payloadRaw.length === 0) return { action, payload: {} };
  let payload: unknown;
  try {
    payload = JSON.parse(payloadRaw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new InjectCliArgError(
      `--exec payload for action '${action}' is not valid JSON: ${msg} (got ${payloadRaw})`
    );
  }
  return { action, payload };
}

/**
 * Parse `argv` (already sliced past `node script`) into validated args.
 * Throws {@link InjectCliArgError} on bad input (no `process.exit` — testable).
 */
export function parseArgs(argv: string[]): InjectCliArgs {
  const args: InjectCliArgs = {
    url: '',
    relay: null,
    authToken: null,
    registrationMetadata: null,
    headed: false,
    readyTimeoutMs: null,
    waitForSettle: true,
    settleQuietMs: null,
    settleTimeoutMs: null,
    expectSelector: null,
    appId: null,
    appName: null,
    tabId: null,
    viewportWidth: null,
    viewportHeight: null,
    storageState: null,
    launchArgs: [],
    execActions: [],
    execStdin: false,
    quiet: false,
    help: false,
  };

  const mkError = (m: string): InjectCliArgError => new InjectCliArgError(m);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--headed':
        args.headed = true;
        break;
      case '--quiet':
        args.quiet = true;
        break;
      case '--exec-stdin':
        args.execStdin = true;
        break;
      // String value-flags: guard each consumed value against the flag-shaped
      // swallow (`--url --headed` must error, not capture `--headed` as the url).
      case '--url':
        args.url = consumeValue('--url', argv[++i], mkError) ?? '';
        break;
      case '--relay':
        args.relay = consumeValue('--relay', argv[++i], mkError);
        break;
      case '--auth-token':
        args.authToken = consumeValue('--auth-token', argv[++i], mkError);
        break;
      case '--app-id':
        args.appId = consumeValue('--app-id', argv[++i], mkError);
        break;
      case '--app-name':
        args.appName = consumeValue('--app-name', argv[++i], mkError);
        break;
      case '--tab-id':
        args.tabId = consumeValue('--tab-id', argv[++i], mkError);
        break;
      case '--storage-state': {
        const raw = consumeValue('--storage-state', argv[++i], mkError);
        if (raw === null || raw.length === 0) {
          throw new InjectCliArgError(
            `--storage-state expects a path to a storageState JSON file (got <missing>)`
          );
        }
        args.storageState = raw;
        break;
      }
      case '--launch-arg': {
        // consumeValue treats single-dash tokens as values but rejects
        // double-dash flag-shaped tokens — Chromium args ARE double-dash
        // tokens, so read the raw next token instead and only reject a
        // genuinely missing value.
        const raw = argv[++i];
        if (raw === undefined || raw.length === 0) {
          throw new InjectCliArgError(`--launch-arg expects a Chromium argument (got <missing>)`);
        }
        args.launchArgs.push(raw);
        break;
      }
      case '--exec': {
        // consumeValue: `--exec --headed` must error, not dispatch a bogus
        // action literally named '--headed'.
        const raw = consumeValue('--exec', argv[++i], mkError);
        if (raw === null) {
          throw new InjectCliArgError(`--exec expects '<action> <json-payload>' (got <missing>)`);
        }
        args.execActions.push(parseExecValue(raw));
        break;
      }
      case '--registration-metadata': {
        const raw = consumeValue('--registration-metadata', argv[++i], mkError);
        if (raw === null) {
          throw new InjectCliArgError(
            `--registration-metadata expects JSON {"userId","sessionId"} (got <missing>)`
          );
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new InjectCliArgError(`--registration-metadata is not valid JSON: ${msg}`);
        }
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          typeof (parsed as Record<string, unknown>).userId !== 'string' ||
          typeof (parsed as Record<string, unknown>).sessionId !== 'string'
        ) {
          throw new InjectCliArgError(
            `--registration-metadata must be a JSON object with string 'userId' and 'sessionId'`
          );
        }
        const m = parsed as { userId: string; sessionId: string };
        args.registrationMetadata = { userId: m.userId, sessionId: m.sessionId };
        break;
      }
      case '--ready-timeout': {
        const raw = consumeValue('--ready-timeout', argv[++i], mkError);
        const n = raw === null ? NaN : Number.parseInt(raw, 10);
        if (!Number.isFinite(n) || n <= 0) {
          throw new InjectCliArgError(
            `--ready-timeout expects a positive integer (got ${raw ?? '<missing>'})`
          );
        }
        args.readyTimeoutMs = n;
        break;
      }
      case '--no-settle':
        args.waitForSettle = false;
        break;
      case '--settle-quiet': {
        // NOTE: consumeValue treats single-dash tokens (`-1`) as values, so
        // negative numerics still reach the range check below.
        const raw = consumeValue('--settle-quiet', argv[++i], mkError);
        const n = raw === null ? NaN : Number.parseInt(raw, 10);
        if (!Number.isFinite(n) || n < 0) {
          throw new InjectCliArgError(
            `--settle-quiet expects a non-negative integer (got ${raw ?? '<missing>'})`
          );
        }
        args.settleQuietMs = n;
        break;
      }
      case '--settle-timeout': {
        const raw = consumeValue('--settle-timeout', argv[++i], mkError);
        const n = raw === null ? NaN : Number.parseInt(raw, 10);
        if (!Number.isFinite(n) || n <= 0) {
          throw new InjectCliArgError(
            `--settle-timeout expects a positive integer (got ${raw ?? '<missing>'})`
          );
        }
        args.settleTimeoutMs = n;
        break;
      }
      case '--expect-selector': {
        // consumeValue: '--headed' must not be accepted as a CSS selector.
        const raw = consumeValue('--expect-selector', argv[++i], mkError);
        if (raw === null || raw.length === 0) {
          throw new InjectCliArgError(`--expect-selector expects a CSS selector (got <missing>)`);
        }
        args.expectSelector = raw;
        break;
      }
      case '--viewport': {
        const raw = consumeValue('--viewport', argv[++i], mkError);
        const match = raw?.match(/^(\d+)x(\d+)$/);
        if (!match) {
          throw new InjectCliArgError(`--viewport expects WxH (got ${raw ?? '<missing>'})`);
        }
        args.viewportWidth = Number.parseInt(match[1]!, 10);
        args.viewportHeight = Number.parseInt(match[2]!, 10);
        break;
      }
      default:
        if (arg !== undefined && arg.startsWith('--')) {
          throw new InjectCliArgError(`Unknown flag: ${arg}`);
        }
        break;
    }
  }

  validateArgs(args);
  return args;
}

/**
 * Validate cross-flag invariants. Throws {@link InjectCliArgError} on failure.
 * `--help` short-circuits validation (so `--help` alone is always valid).
 */
export function validateArgs(args: InjectCliArgs): void {
  if (args.help) return;
  if (!args.url) {
    throw new InjectCliArgError('--url is required');
  }
  if (!/^https?:\/\//i.test(args.url)) {
    throw new InjectCliArgError(`--url must start with http:// or https:// (got ${args.url})`);
  }
  if (selectMode(args) === 'relay' && !args.relay) {
    throw new InjectCliArgError(
      'Variant B (relay) is the default mode and requires --relay. ' +
        'Either pass --relay <uiBridgeBase>, or pass --exec/--exec-stdin for one-shot exec (Variant A).'
    );
  }
}

/**
 * Mode selection: any `--exec`/`--exec-stdin` → one-shot exec (Variant A);
 * otherwise relay registration (Variant B, the default).
 */
export function selectMode(args: InjectCliArgs): 'exec' | 'relay' {
  return args.execActions.length > 0 || args.execStdin ? 'exec' : 'relay';
}

/**
 * Chromium feature flags that must be DISABLED for an https page to fetch a
 * loopback (local-network) relay. Chromium's Local Network Access checks
 * otherwise block `https://example.com` → `http://127.0.0.1:<port>` with
 * "Permission was denied for this request to access the 'loopback' address
 * space" (plan 2026-06-12 item 2).
 */
export const LNA_DISABLE_FEATURES = [
  'LocalNetworkAccessChecks',
  'PrivateNetworkAccessSendPreflights',
  'PrivateNetworkAccessRespectPreflightResults',
] as const;

/** True when a URL hostname is a loopback address (localhost / 127/8 / ::1). */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.startsWith('127.') ||
    h === '::1' ||
    h === '[::1]'
  );
}

/**
 * Compute the effective Chromium launch args: the user's `--launch-arg`
 * values, plus the LNA-disable features auto-appended when the target page
 * is https AND the relay resolves to a loopback host (the combination
 * Chromium's Local Network Access checks block). If the user already passed
 * a `--disable-features=` arg, the missing LNA features are merged into it
 * (Chromium does not union repeated `--disable-features` flags).
 *
 * Pure — exported for unit tests.
 */
export function buildLaunchArgs(
  args: Pick<InjectCliArgs, 'url' | 'relay' | 'launchArgs'>
): { launchArgs: string[]; lnaAutoAppended: boolean } {
  const launchArgs = [...args.launchArgs];
  let lnaAutoAppended = false;

  let relayIsLoopback = false;
  if (args.relay) {
    try {
      relayIsLoopback = isLoopbackHost(new URL(args.relay).hostname);
    } catch {
      relayIsLoopback = false;
    }
  }

  if (/^https:\/\//i.test(args.url) && relayIsLoopback) {
    const prefix = '--disable-features=';
    const existingIdx = launchArgs.findIndex((a) => a.startsWith(prefix));
    if (existingIdx === -1) {
      launchArgs.push(`${prefix}${LNA_DISABLE_FEATURES.join(',')}`);
      lnaAutoAppended = true;
    } else {
      const existing = launchArgs[existingIdx]!.slice(prefix.length).split(',').filter(Boolean);
      const missing = LNA_DISABLE_FEATURES.filter((f) => !existing.includes(f));
      if (missing.length > 0) {
        launchArgs[existingIdx] = `${prefix}${[...existing, ...missing].join(',')}`;
        lnaAutoAppended = true;
      }
    }
  }

  return { launchArgs, lnaAutoAppended };
}

/**
 * Build the `options` object for `createTransport({ kind: 'injected', options })`.
 * Only includes keys the user provided; `targetUrl` is always present.
 */
export function buildTransportOptions(args: InjectCliArgs): Record<string, unknown> {
  const options: Record<string, unknown> = { targetUrl: args.url };
  if (args.relay) options.uiBridgeBase = args.relay;
  const { launchArgs } = buildLaunchArgs(args);
  if (launchArgs.length > 0) options.launchArgs = launchArgs;
  if (args.authToken) options.authToken = args.authToken;
  if (args.registrationMetadata) options.registrationMetadata = args.registrationMetadata;
  if (args.headed) options.headed = true;
  if (args.readyTimeoutMs !== null) options.readyTimeoutMs = args.readyTimeoutMs;
  if (!args.waitForSettle) options.waitForSettle = false;
  if (args.settleQuietMs !== null) options.settleQuietMs = args.settleQuietMs;
  if (args.settleTimeoutMs !== null) options.settleTimeoutMs = args.settleTimeoutMs;
  if (args.expectSelector !== null) options.expectSelector = args.expectSelector;
  if (args.appId) options.appId = args.appId;
  if (args.appName) options.appName = args.appName;
  if (args.tabId) options.tabId = args.tabId;
  if (args.viewportWidth !== null) options.viewportWidth = args.viewportWidth;
  if (args.viewportHeight !== null) options.viewportHeight = args.viewportHeight;
  if (args.storageState) options.storageStatePath = args.storageState;
  return options;
}

function die(msg: string): never {
  process.stderr.write(`${msg}\n`);
  process.exit(2);
}

function log(quiet: boolean, msg: string): void {
  if (!quiet) process.stderr.write(`${msg}\n`);
}

/** Read all of stdin to a string. */
function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

/** Parse NDJSON stdin into a list of exec actions. */
function parseStdinActions(raw: string): ExecAction[] {
  const out: ExecAction[] = [];
  const lines = raw.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new InjectCliArgError(`--exec-stdin line is not valid JSON: ${msg} (got ${trimmed})`);
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new InjectCliArgError(`--exec-stdin line must be a JSON object (got ${trimmed})`);
    }
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.action !== 'string' || obj.action.length === 0) {
      throw new InjectCliArgError(`--exec-stdin line must have a string 'action' (got ${trimmed})`);
    }
    out.push({ action: obj.action, payload: 'payload' in obj ? obj.payload : {} });
  }
  return out;
}

async function main(): Promise<void> {
  let args: InjectCliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof InjectCliArgError) die(`${err.message}\n\n${USAGE}`);
    throw err;
  }

  if (args.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  const mode = selectMode(args);
  const { launchArgs, lnaAutoAppended } = buildLaunchArgs(args);
  if (lnaAutoAppended) {
    log(
      args.quiet,
      `[ui-bridge-inject] https page + loopback relay detected — auto-appending Chromium ` +
        `LNA-disable flags so the page can fetch the relay: ` +
        `--disable-features=${LNA_DISABLE_FEATURES.join(',')} ` +
        `(effective launch args: ${JSON.stringify(launchArgs)})`
    );
  }
  const transport = createTransport({ kind: 'injected', options: buildTransportOptions(args) });

  // The public-surface way to reach the InjectedContext (tabId / registration
  // flag / execute) is to register a handler and dispatch it.
  transport.register('__inject_cli_info', (_p, ctx: unknown) => {
    const c = ctx as { tabId?: string | null; uiBridgeRegistered?: boolean };
    return { tabId: c.tabId ?? null, uiBridgeRegistered: c.uiBridgeRegistered ?? false };
  });

  if (mode === 'exec') {
    await runExec(args, transport);
    return;
  }
  await runRelay(args, transport);
}

/** Variant A: run each action against the in-page runtime, one result line each. */
async function runExec(
  args: InjectCliArgs,
  transport: ReturnType<typeof createTransport>
): Promise<void> {
  // Collect the full action list before launching the browser.
  const actions: ExecAction[] = [...args.execActions];
  if (args.execStdin) {
    const raw = await readStdin();
    actions.push(...parseStdinActions(raw));
  }
  if (actions.length === 0) {
    die('Variant A (exec) selected but no actions were provided');
  }

  log(args.quiet, `[ui-bridge-inject] launching injected transport (exec mode)`);
  try {
    await transport.ready();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[ui-bridge-inject] ready failed: ${msg}\n`);
    await transport.close().catch(() => {});
    process.exit(1);
  }

  let anyError = false;
  try {
    for (const { action, payload } of actions) {
      if (!transport.handlerRegistry.has(action)) {
        transport.register(action, (params: unknown, ctx: unknown) =>
          (ctx as { execute(a: string, p?: unknown): Promise<unknown> }).execute(action, params)
        );
      }
      try {
        const result = await transport.dispatch(action, payload);
        process.stdout.write(`${JSON.stringify({ action, result })}\n`);
      } catch (err) {
        anyError = true;
        if (err instanceof WrapperTransportError) {
          process.stdout.write(
            `${JSON.stringify({ action, error: { code: err.code, message: err.message } })}\n`
          );
        } else {
          const message = err instanceof Error ? err.message : String(err);
          process.stdout.write(
            `${JSON.stringify({ action, error: { code: 'UNKNOWN', message } })}\n`
          );
        }
      }
    }
  } finally {
    await transport.close().catch(() => {});
  }
  process.exit(anyError ? 1 : 0);
}

/** Variant B: register as a relay tab, print one info line, then stay alive. */
async function runRelay(
  args: InjectCliArgs,
  transport: ReturnType<typeof createTransport>
): Promise<void> {
  log(
    args.quiet,
    `[ui-bridge-inject] launching injected transport (relay mode, ${args.headed ? 'headed' : 'headless'})`
  );
  log(args.quiet, `[ui-bridge-inject] url: ${args.url} relay: ${args.relay}`);

  try {
    await transport.ready();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[ui-bridge-inject] ready failed: ${msg}\n`);
    await transport.close().catch(() => {});
    process.exit(1);
  }

  const info = (await transport.dispatch('__inject_cli_info')) as {
    tabId: string | null;
    uiBridgeRegistered: boolean;
  };
  process.stdout.write(
    `${JSON.stringify({
      tabId: info.tabId,
      uiBridgeRegistered: info.uiBridgeRegistered,
      url: args.url,
    })}\n`
  );

  if (!info.uiBridgeRegistered) {
    process.stderr.write(
      `[ui-bridge-inject] WARN: the injected runtime did not report a registered relay tab. ` +
        `Verify the relay at ${args.relay} is reachable and accepts the registration.\n`
    );
  }

  log(args.quiet, `[ui-bridge-inject] ready — press Ctrl+C to exit`);

  // Stay alive until SIGINT/SIGTERM; close the transport on shutdown.
  let shuttingDown = false;
  const shutdown = async (reason: string, exitCode: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(args.quiet, `[ui-bridge-inject] shutting down (${reason})`);
    await transport.close().catch(() => {});
    process.exit(exitCode);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT', 130);
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM', 143);
  });

  // Park the event loop. The process stays alive because of the browser
  // process + signal listeners.
}

const isMain = (() => {
  try {
    return process.argv[1] === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  void main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[ui-bridge-inject] fatal: ${msg}\n`);
    process.exit(1);
  });
}
