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
 * Three modes:
 *   - Variant A (one-shot exec): `--exec '<action> <json>'` (repeatable) or
 *     `--exec-stdin` (NDJSON on stdin). Each action runs against the in-page
 *     runtime; one JSON result line per action is written to stdout, then exit.
 *     An action that FAILS — whether it threw or merely returned
 *     `{ success: false }` — puts a `{ code, message, source, details }` object
 *     on that line's `error` key and makes the process exit 1. See
 *     `./action-outcome.js` for why the returned case needs saying out loud.
 *     With `--screenshot <path>`, every `getControlSnapshot` action is captured
 *     in lockstep with a PNG frame (`./frame-capture.js`).
 *   - Variant B (relay, DEFAULT): no exec actions → register as a relay tab
 *     (requires `--relay`) and stay alive until SIGINT/SIGTERM.
 *   - Capture matrix (`--capture-matrix <dir>`): the Variant-A plan, run once
 *     per viewport × DPR × colour-scheme combination, storing every
 *     frame-and-snapshot pair with its provenance (`./capture-matrix.js`).
 *
 * The arg parsing, validation, option building, and mode selection are exported
 * pure functions so they can be unit-tested without spawning a browser or
 * calling `main()`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createTransport } from './create-transport.js';
import { consumeValue } from './cli-args.js';
import { InjectCliArgError } from './inject-cli-errors.js';
import {
  applyNetworkEmulation,
  parseThrottle,
  type NetworkEmulation,
  type NetworkProfile,
  type ThrottlePage,
} from './network-throttle.js';
import {
  parseCaptureTimelinePayload,
  registerTimelineCapture,
  CAPTURE_TIMELINE_ACTION,
} from './timeline-capture.js';
import { returnedFailureError, thrownError, type CliActionError } from './action-outcome.js';
import {
  captureFrameInLockstep,
  ensurePrivateDir,
  expandFramePath,
  FRAME_INDEX_TOKEN,
  frameTokenInDirectory,
  frameTokenInFileName,
  writePrivateFile,
  type FrameColorScheme,
  type FrameError,
  type FramePage,
  type FrameRecord,
  type LockstepCapture,
} from './frame-capture.js';
import {
  cellId,
  expandMatrix,
  manifestPath,
  type MatrixCell,
  type MatrixCellReport,
  type MatrixManifest,
  type MatrixPair,
  type MatrixViewport,
} from './capture-matrix.js';

export const USAGE = `ui-bridge-inject — drive UI Bridge's injected transport against a UI-Bridge-free page

Required:
  --url <pageUrl>              Page to open. Must start with http:// or https://
                               (maps to the transport's options.targetUrl)

Relay (Variant B — the default mode; --relay is REQUIRED in this mode):
  --relay <uiBridgeBase>       UI Bridge relay base; the injected runtime registers
                               as a relay tab. Example: http://localhost:3001/api/ui-bridge
  --auth-token <T>             Bearer token for an auth-gated relay. Puts the token on THIS
                               process's command line, which any local process/user can read
                               (Task Manager, /proc, WMI) for the process's whole lifetime —
                               prefer --auth-token-file or $UI_BRIDGE_AUTH_TOKEN instead.
  --auth-token-file <path>     Read the bearer token from a file (trimmed) instead of argv.
                               Takes priority over $UI_BRIDGE_AUTH_TOKEN, loses to --auth-token.
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

  Waiting BETWEEN exec steps (CLI-side actions, not in-page ones):
    Exec steps run back to back with nothing between them, so state that
    arrives AFTER ready()/settle — a row fetched by a request the previous
    step kicked off, a panel that mounts a tick later — cannot be awaited.
    Two action ids are handled by the CLI itself for exactly that:

      waitForSelector {"selector":"<css>","timeoutMs":10000,"state":"attached"}
        Wait until the selector reaches 'state' in the page. 'state' is one of
        attached (DEFAULT — the same "exists in the DOM" test --expect-selector
        applies) | visible | hidden | detached. 'timeoutMs' defaults to 10000.
        On timeout the step FAILS like any other: an "error" line on stdout and
        exit 1 at the end.
        Result: {"waited":true,"selector":..,"state":..,"elapsedMs":..}

      sleep {"ms":250}
        Unconditional pause. 'ms' is required, 0..600000. Prefer
        waitForSelector — a sleep encodes a guess, not a condition.
        Result: {"slept":250}

    Both go through the same one-line-per-action channel as an in-page action,
    so an N-step run still prints N lines in order. Neither shadows an in-page
    action id — the injected dispatcher defines neither.

  A timed multi-frame capture (CLI-side too):

      captureTimeline {"dir":"<dir>","frames":8,"intervalMs":250,"reload":false}
        Screenshot the page 'frames' times (1..120), one every 'intervalMs'
        (0..10000), into <dir>/frame-<k>.png — the loading-to-loaded timeline
        of a slot, NOT a lockstep pair (it records movement on purpose). <dir>
        must be empty or not exist. With "reload":true the clock starts at a
        fresh navigation commit, so frame 1 is the page before it painted; the
        reload drops any media override, and the action waits for the injected
        runtime to settle again ('readyTimeoutMs', default 30000) so the next
        step finds a drivable page. In --capture-matrix a relative <dir> lands
        inside each cell's directory.
        Result: {"success","dir","reloaded","intervalMs","startedAt",
                 "frames":[{"index","path","offsetMs","capturedAt","width","height"}],
                 "devicePixelRatio","cssViewport","colorScheme","runtimeReady","network"}
        A frame that could not be taken carries "error" and fails the step.
        "during":{"action":"mediaOverride","payload":{...}} runs that in-page
        action CONCURRENTLY with the frames, so the timeline shows the candidate
        ARRIVING (under --throttle, its slow-network load) while the override
        still confirms decode before it answers; its result rides on the line
        as "during" and a failed action fails the step. Not with "reload".

  Swapping an image in place (dev control, served by the injected runtime):

      mediaOverride {"slotId":"hero","src":"/candidate.png"}
      mediaOverride {"elementId":"img-logo","srcset":"/c-1x.avif 1x, /c-2x.avif 2x"}
      mediaOverride {"slotId":"hero","src":"/c.png","sources":[{"type":"image/avif","srcset":"/c.avif"}]}
      mediaOverride {"slotId":"banner","backgroundImage":"/c.png","ttlMs":60000}
        Swap one slot's image, wait for decode() and confirm currentSrc before
        answering (an override that cannot be confirmed is rolled back and
        fails). Inside a <picture> every <source srcset> is replaced too.
      mediaOverrideRestore {"overrideId":"mo-…"}   (or {} for all)
        Put the originals back and verify each attribute reads back.
      mediaOverrideList {}
        What is still overridden — the proof the page ended restored.

  Hiding text for one frame (dev control, served by the injected runtime):

      textVisibility {"hidden":true,"ttlMs":30000}
        Make every glyph on the page transparent (colour, text fill, SVG text
        fill, text-shadow), with transitions off so the frame is not caught
        mid-fade; nothing moves, and currentColor borders and icons keep their
        colour. Capture frame A before and frame B after: inside a text
        element's box the two differ exactly where its glyphs paint. A TTL
        (default 30000 ms) restores the page if the run dies.
      textVisibility {"hidden":false}
        Restore exactly (the style attributes read back byte for byte);
        "restore":{"verified":true} is a clean restore.

  Exec output & exit code:
    One JSON line per action, in order, on stdout — ALWAYS one line per action,
    including failures. An action that succeeded prints {"action":..,"result":..}.
    An action that FAILED additionally carries an "error" key:
      {"action":..,"result":..,"error":{"code":..,"message":..,"source":"returned",
                                        "details":{..}}}
    A failure is EITHER thrown by the transport (source "thrown") OR returned by
    the in-page handler as {"success":false,...} (source "returned") — a missing,
    invisible or disabled element is the RETURNED kind, so "result" alone never
    tells you whether the action did anything. Branch on "error"; "error.code" is
    the handler's own errorCode (ELEMENT_NOT_FOUND / ELEMENT_NOT_VISIBLE /
    ELEMENT_NOT_ENABLED / ...) and "error.details" is its full failureDetails,
    unflattened.

    A failed action does NOT abort the actions after it. Every action runs, each
    gets its line, and the process exits 1 at the end if ANY action failed (0 if
    all succeeded). This is the pre-existing behaviour of a thrown failure, kept
    for a returned one so there is one convention rather than two — and it is
    what keeps the one-line-per-action contract intact for a caller that pairs
    N actions with N lines. A caller that wants stop-on-first-failure gets it by
    running one action per invocation and checking the exit code.

Frames (Variant A):
  --screenshot <path>          Capture a PNG frame IN LOCKSTEP with every
                               getControlSnapshot action: snapshot, frame, snapshot
                               again, retried until both snapshots agree on every
                               element's box. That action's line gains a "frame":
                                 {"path","format":"png","width","height",
                                  "devicePixelRatio","cssViewport":{"width","height"},
                                  "colorScheme","capturedAt",
                                  "lockstep":{"verified","attempts","changedElements"}}
                               every field read off the page or the PNG at capture
                               time, never copied from the flags. ${FRAME_INDEX_TOKEN} in the FILE
                               NAME of <path> is replaced by the action's 1-based
                               position (= its output line) and is REQUIRED when the
                               run takes more than one snapshot; ${FRAME_INDEX_TOKEN} in a directory
                               name is refused. A frame that cannot be produced leaves
                               "frame":null plus "frameError":{"code","message"} on the
                               line — the snapshot still stands — and exit 1.
                               A frame is RAW PIXELS of the page: data-bridge-redact
                               masks elements in snapshots and over the relay, never
                               in a screenshot, so a frame shows whatever the page
                               showed. Directories created for frames are 0700 and
                               the files 0600.
  --dpr <n>                    Device pixel ratio of the browser context, e.g. 2 or
                               2.625 (Chromium's --force-device-scale-factor does NOT
                               reach the page; this does). Default 1.
  --color-scheme <dark|light>  prefers-color-scheme of the browser context.
                               Default: no override (light).
                               Both are read back from the page after launch; a page
                               that reports anything else fails the run
                               (EMULATION_NOT_APPLIED) instead of being measured as if.

Network (every mode; applied to the page once it is ready, before any action):
  --throttle <profile>         Emulate a slow network on the page (CDP
                               Network.emulateNetworkConditions). <profile> is
                               slow-3g (2000 ms, 400/400 kbit/s), fast-3g (563 ms,
                               1475/675 kbit/s), or latency=<ms>,down=<kbps>,up=<kbps>.
                               It persists across reloads of the page, so a
                               captureTimeline {"reload":true} loads throttled.
  --no-cache                   Disable the HTTP cache too (Network.setCacheDisabled):
                               a warm cache would let a "slow" reload paint at once.
                               What was applied is stamped as "network" on every
                               captureTimeline result, each capture-matrix cell, and
                               the relay info line; CDP has no getter, so the stamp
                               says what Chromium ACCEPTED, and a refused command
                               fails the run rather than measuring unthrottled.

Capture matrix (its own mode):
  --capture-matrix <dir>       Run the plan once per --viewport × --dpr × --color-scheme
                               combination, each a fresh browser context, and store
                               every frame-and-snapshot pair with its provenance:
                                 <dir>/<cell>/frame-<n>.png, snapshot-<n>.json,
                                 results.ndjson, and <dir>/matrix.json for all cells.
                               In this mode those three flags take comma-separated
                               lists (or repeat): --viewport 390x844,1280x720
                               --dpr 1,2 --color-scheme light,dark. An axis left out
                               stays at the browser default and is named so in the
                               cell id (e.g. 390x844_dpr-default_dark). --exec /
                               --exec-stdin give the per-cell plan (default: one
                               'getControlSnapshot {}'); a frame is captured beside
                               every getControlSnapshot in it. Prints one JSON line
                               per cell; exits 1 if any cell is not "captured".
                               Takes no --relay and no --screenshot. <dir> must be
                               empty or not exist yet: a non-empty one is refused,
                               never cleared. Directories it creates are 0700 and
                               every frame, snapshot and manifest 0600 — frames are
                               raw pixels that data-bridge-redact does not scrub.

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
  --viewport <WxH>             Viewport size in CSS pixels, e.g. 1280x720 (default 1280x720).
                               Each side 1..8192 CSS pixels.
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

  # Variant B against an auth-gated relay, without putting the token on argv
  ui-bridge-inject --url https://qontinui.io/admin/coord/fleet \\
    --relay https://qontinui.io/api/ui-bridge --auth-token-file "$HOME/.idtok"

  # Variant A: snapshot the controls on a page, then exit
  ui-bridge-inject --url https://example.com/login \\
    --exec 'getControlSnapshot {}'

  # Variant A: find a control and act on it
  ui-bridge-inject --url https://example.com/login \\
    --exec 'find {"text":"Sign in"}'

  # Variant A: wait for a late-arriving row, THEN read it (no --expect-selector)
  ui-bridge-inject --url https://example.com/account \
    --exec 'waitForSelector {"selector":"[data-row=account]","timeoutMs":15000}' \
    --exec 'discover {}'

  # A frame in lockstep with the snapshot, at a Retina DPR in dark mode
  ui-bridge-inject --url http://127.0.0.1:3000/ --viewport 1280x720 --dpr 2 \\
    --color-scheme dark --screenshot ./frame.png --exec 'getControlSnapshot {}'

  # Before/after a click: {n} names each frame by its action's position
  ui-bridge-inject --url http://127.0.0.1:3000/ --screenshot './frame-{n}.png' \\
    --exec 'getControlSnapshot {}' \\
    --exec 'executeElementAction {"id":"open","request":{"action":"click"}}' \\
    --exec 'getControlSnapshot {}'

  # A candidate in its real slot, its slow-network load timeline, then restored
  ui-bridge-inject --url http://127.0.0.1:3000/ --throttle slow-3g --no-cache \
    --exec 'mediaOverride {"slotId":"hero","src":"http://127.0.0.1:8080/cand.png"}' \
    --exec 'captureTimeline {"dir":"./tl","frames":6,"intervalMs":200}' \
    --exec 'mediaOverrideRestore {}' --exec 'mediaOverrideList {}'

  # Capture matrix: 2 breakpoints x 2 schemes x 2 DPRs = 8 frame-and-snapshot pairs
  ui-bridge-inject --url http://127.0.0.1:3000/ --capture-matrix ./matrix \\
    --viewport 390x844,1280x720 --color-scheme light,dark --dpr 1,2

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
  /** Path to a file holding the bearer token (trimmed on read); see --auth-token-file. */
  authTokenFile: string | null;
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
  /**
   * `--viewport` values in the order given. At most one outside
   * `--capture-matrix`, where it is the one viewport; inside, it is an axis.
   */
  viewports: MatrixViewport[];
  /** `--dpr` values (device scale factors). Same one-vs-axis rule as `viewports`. */
  dprs: number[];
  /** `--color-scheme` values. Same one-vs-axis rule as `viewports`. */
  colorSchemes: FrameColorScheme[];
  /** `--screenshot` path template (may carry `{n}`), or null. Variant A only. */
  screenshot: string | null;
  /** `--capture-matrix` output directory, or null. Selects matrix mode. */
  captureMatrix: string | null;
  /** Path to a Playwright storageState JSON file to seed the context (from --storage-state). */
  storageState: string | null;
  /** `--throttle` network profile, or null. */
  throttle: NetworkProfile | null;
  /** `--no-cache`: also disable the HTTP cache. */
  noCache: boolean;
  /** Extra Chromium launch args collected from --launch-arg flags (in order). */
  launchArgs: string[];
  /** Variant-A actions collected from --exec flags (in order). */
  execActions: ExecAction[];
  /** True if --exec-stdin was given (read NDJSON from stdin in Variant A). */
  execStdin: boolean;
  quiet: boolean;
  help: boolean;
}

export { InjectCliArgError };

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
 * Upper bound on `--dpr`. A typo such as `--dpr 20` would otherwise ask
 * Chromium for a 25600-pixel-wide frame; the densest shipping displays are
 * well under this.
 */
export const MAX_DPR = 8;

/** Split one flag occurrence's value on commas, refusing an empty item (`1,,2`). */
function splitList(flag: string, raw: string): string[] {
  const items = raw.split(',').map((s) => s.trim());
  if (items.some((s) => s.length === 0)) {
    throw new InjectCliArgError(
      `${flag} has an empty item in its list (got ${JSON.stringify(raw)})`
    );
  }
  return items;
}

/**
 * Upper bound on each `--viewport` side, in CSS pixels. Above it a typo (one
 * zero too many) would ask Chromium for a page wider than any display, and at
 * a DPR of 2 or more a frame past Chromium's 16384-pixel screenshot limit.
 */
export const MAX_VIEWPORT_SIDE = 8192;

/** Parse one `WxH` viewport in CSS pixels: each side an integer in 1..{@link MAX_VIEWPORT_SIDE}. */
export function parseViewport(raw: string): MatrixViewport {
  const match = raw.match(/^([1-9]\d*)x([1-9]\d*)$/);
  if (!match) {
    throw new InjectCliArgError(`--viewport expects WxH in CSS pixels, e.g. 1280x720 (got ${raw})`);
  }
  const width = Number.parseInt(match[1]!, 10);
  const height = Number.parseInt(match[2]!, 10);
  if (width > MAX_VIEWPORT_SIDE || height > MAX_VIEWPORT_SIDE) {
    throw new InjectCliArgError(
      `--viewport sides are at most ${MAX_VIEWPORT_SIDE} CSS pixels (got ${raw})`
    );
  }
  return { width, height };
}

/**
 * Parse one `--dpr` value: a plain decimal in (0, {@link MAX_DPR}]. A decimal
 * pattern rather than `Number()` alone, which would also accept `0x2` and `1e1`.
 */
export function parseDpr(raw: string): number {
  const n = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n) || n <= 0 || n > MAX_DPR) {
    throw new InjectCliArgError(
      `--dpr expects a device pixel ratio in (0, ${MAX_DPR}], e.g. 1, 2 or 2.625 (got ${raw})`
    );
  }
  return n;
}

/** Parse one `--color-scheme` value. */
export function parseColorScheme(raw: string): FrameColorScheme {
  if (raw === 'dark' || raw === 'light') return raw;
  throw new InjectCliArgError(`--color-scheme expects dark or light (got ${raw})`);
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
    authTokenFile: null,
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
    viewports: [],
    dprs: [],
    colorSchemes: [],
    screenshot: null,
    captureMatrix: null,
    storageState: null,
    throttle: null,
    noCache: false,
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
      case '--auth-token-file': {
        const raw = consumeValue('--auth-token-file', argv[++i], mkError);
        if (raw === null || raw.length === 0) {
          throw new InjectCliArgError(
            `--auth-token-file expects a path to a file holding the bearer token (got <missing>)`
          );
        }
        args.authTokenFile = raw;
        break;
      }
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
      // The three capture axes. Each occurrence may carry a comma-separated
      // list and every occurrence appends; `validateArgs` then allows more than
      // one value only under --capture-matrix, where they are an axis.
      case '--viewport': {
        const raw = consumeValue('--viewport', argv[++i], mkError);
        if (raw === null) throw new InjectCliArgError(`--viewport expects WxH (got <missing>)`);
        for (const item of splitList('--viewport', raw)) args.viewports.push(parseViewport(item));
        break;
      }
      case '--dpr': {
        const raw = consumeValue('--dpr', argv[++i], mkError);
        if (raw === null) throw new InjectCliArgError(`--dpr expects a number (got <missing>)`);
        for (const item of splitList('--dpr', raw)) args.dprs.push(parseDpr(item));
        break;
      }
      case '--color-scheme': {
        const raw = consumeValue('--color-scheme', argv[++i], mkError);
        if (raw === null) {
          throw new InjectCliArgError(`--color-scheme expects dark or light (got <missing>)`);
        }
        for (const item of splitList('--color-scheme', raw)) {
          args.colorSchemes.push(parseColorScheme(item));
        }
        break;
      }
      case '--screenshot': {
        const raw = consumeValue('--screenshot', argv[++i], mkError);
        if (raw === null || raw.length === 0) {
          throw new InjectCliArgError(`--screenshot expects a PNG path (got <missing>)`);
        }
        args.screenshot = raw;
        break;
      }
      case '--throttle': {
        const raw = consumeValue('--throttle', argv[++i], mkError);
        if (raw === null)
          throw new InjectCliArgError('--throttle expects a profile (got <missing>)');
        if (args.throttle !== null) throw new InjectCliArgError('--throttle given twice');
        args.throttle = parseThrottle(raw);
        break;
      }
      case '--no-cache':
        args.noCache = true;
        break;
      case '--capture-matrix': {
        const raw = consumeValue('--capture-matrix', argv[++i], mkError);
        if (raw === null || raw.length === 0) {
          throw new InjectCliArgError(
            `--capture-matrix expects an output directory (got <missing>)`
          );
        }
        args.captureMatrix = raw;
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
  const mode = selectMode(args);
  if (mode === 'matrix') {
    // An axis value given twice would make two cells with one id, the second
    // silently overwriting the first's frames.
    const dup = <T>(flag: string, values: T[], key: (v: T) => string): void => {
      const seen = new Set<string>();
      for (const v of values) {
        const k = key(v);
        if (seen.has(k)) throw new InjectCliArgError(`${flag} lists ${k} twice`);
        seen.add(k);
      }
    };
    dup('--viewport', args.viewports, (v) => `${v.width}x${v.height}`);
    dup('--dpr', args.dprs, (v) => String(v));
    dup('--color-scheme', args.colorSchemes, (v) => v);
    if (args.relay) {
      throw new InjectCliArgError(
        '--capture-matrix captures and exits; it does not register relay tabs. Drop --relay.'
      );
    }
    if (args.screenshot) {
      throw new InjectCliArgError(
        '--capture-matrix names its own frame files (<dir>/<cell>/frame-<n>.png). Drop --screenshot.'
      );
    }
    return;
  }
  // Outside the matrix each axis is ONE value: a list there would be silently
  // narrowed to its first item, measuring a page the caller did not ask for.
  for (const [flag, count] of [
    ['--viewport', args.viewports.length],
    ['--dpr', args.dprs.length],
    ['--color-scheme', args.colorSchemes.length],
  ] as const) {
    if (count > 1) {
      throw new InjectCliArgError(
        `${flag} takes one value unless --capture-matrix is given (got ${count})`
      );
    }
  }
  if (mode === 'relay' && args.screenshot) {
    throw new InjectCliArgError(
      '--screenshot captures beside getControlSnapshot actions, which only Variant A (--exec / ' +
        '--exec-stdin) runs. A relay tab takes no frame.'
    );
  }
  if (mode === 'relay' && !args.relay) {
    throw new InjectCliArgError(
      'Variant B (relay) is the default mode and requires --relay. ' +
        'Either pass --relay <uiBridgeBase>, or pass --exec/--exec-stdin for one-shot exec (Variant A).'
    );
  }
}

/**
 * Mode selection: `--capture-matrix` → the capture matrix; else any
 * `--exec`/`--exec-stdin` → one-shot exec (Variant A); otherwise relay
 * registration (Variant B, the default).
 */
export function selectMode(args: InjectCliArgs): 'exec' | 'relay' | 'matrix' {
  if (args.captureMatrix) return 'matrix';
  return args.execActions.length > 0 || args.execStdin ? 'exec' : 'relay';
}

/** The actions `--screenshot` / the capture matrix pair a frame with. */
export const SNAPSHOT_ACTIONS: ReadonlySet<string> = new Set(['getControlSnapshot']);

/**
 * Validate `--screenshot` against the full action list, which with
 * `--exec-stdin` is known only after stdin is read — so this runs then, before
 * the browser launches, rather than inside `parseArgs`.
 *
 * Refuses a run with no snapshot action (the flag would do nothing, silently)
 * and a fixed path over several snapshots (each frame would overwrite the last).
 */
export function validateFramePlan(actions: readonly ExecAction[], screenshot: string | null): void {
  if (screenshot === null) return;
  if (frameTokenInDirectory(screenshot)) {
    throw new InjectCliArgError(
      `--screenshot ${screenshot} has ${FRAME_INDEX_TOKEN} in a directory name, where it is not ` +
        `replaced. Put it in the file name (e.g. frames/frame-${FRAME_INDEX_TOKEN}.png).`
    );
  }
  const snapshots = actions.filter((a) => SNAPSHOT_ACTIONS.has(a.action)).length;
  if (snapshots === 0) {
    throw new InjectCliArgError(
      `--screenshot captures a frame beside each getControlSnapshot action, and this run has ` +
        `none. Add --exec 'getControlSnapshot {}'.`
    );
  }
  if (snapshots > 1 && !frameTokenInFileName(screenshot)) {
    throw new InjectCliArgError(
      `--screenshot ${screenshot} names one file but the run takes ${snapshots} snapshots, so ` +
        `each frame would overwrite the last. Put ${FRAME_INDEX_TOKEN} in the file name ` +
        `(e.g. frame-${FRAME_INDEX_TOKEN}.png); it becomes the action's position.`
    );
  }
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
export function buildLaunchArgs(args: Pick<InjectCliArgs, 'url' | 'relay' | 'launchArgs'>): {
  launchArgs: string[];
  lnaAutoAppended: boolean;
} {
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
 * Resolve the effective bearer token from, in priority order: an explicit
 * `--auth-token` (unchanged for backward compat), `--auth-token-file` (read via
 * `readFile`, trimmed), then the `UI_BRIDGE_AUTH_TOKEN` env var. Returns `null`
 * when none apply. `readFile` and `env` are injected so this stays testable
 * without touching the real filesystem/environment.
 */
export function resolveAuthToken(
  args: Pick<InjectCliArgs, 'authToken' | 'authTokenFile'>,
  env: Readonly<Record<string, string | undefined>>,
  readFile: (path: string) => string
): string | null {
  if (args.authToken) return args.authToken;
  if (args.authTokenFile) {
    const raw = readFile(args.authTokenFile).trim();
    if (raw.length === 0) {
      throw new InjectCliArgError(`--auth-token-file '${args.authTokenFile}' is empty`);
    }
    return raw;
  }
  // Trimmed the same way as the file branch above: secret-injection tooling
  // (Docker/K8s envFrom, .env loaders, CI secret managers) commonly delivers
  // env values with a trailing newline, which would otherwise reach the
  // WebSocket upgrade's Authorization header and throw a raw "invalid
  // character in header content" error instead of failing cleanly here.
  const fromEnv = env.UI_BRIDGE_AUTH_TOKEN?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : null;
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
  applyCell(options, {
    viewport: args.viewports[0] ?? null,
    dpr: args.dprs[0] ?? null,
    colorScheme: args.colorSchemes[0] ?? null,
  });
  if (args.storageState) options.storageStatePath = args.storageState;
  return options;
}

/** Set one cell's viewport / device scale factor / colour scheme on transport options. */
function applyCell(options: Record<string, unknown>, cell: MatrixCell): void {
  delete options.viewportWidth;
  delete options.viewportHeight;
  delete options.deviceScaleFactor;
  delete options.colorScheme;
  if (cell.viewport) {
    options.viewportWidth = cell.viewport.width;
    options.viewportHeight = cell.viewport.height;
  }
  if (cell.dpr !== null) options.deviceScaleFactor = cell.dpr;
  if (cell.colorScheme !== null) options.colorScheme = cell.colorScheme;
}

/**
 * Transport options for one capture-matrix cell: every non-axis flag exactly as
 * {@link buildTransportOptions} sets it, and the cell's own three axis values.
 */
export function buildCellTransportOptions(
  args: InjectCliArgs,
  cell: MatrixCell
): Record<string, unknown> {
  const options = buildTransportOptions(args);
  applyCell(options, cell);
  return options;
}

/**
 * ---------------------------------------------------------------------------
 * CLI-side wait actions
 * ---------------------------------------------------------------------------
 *
 * Variant A runs its `--exec` steps back to back with nothing in between, and
 * the only wait the CLI had was the one-shot `--expect-selector` gate applied
 * ONCE, before the first step. So a driver could not await anything that
 * arrives after settle — a row fetched by a request an earlier step kicked
 * off, a panel that mounts a tick later. The workaround was to re-invoke the
 * whole CLI (a fresh browser, a fresh page load) per wait, which discards the
 * page state the earlier steps produced.
 *
 * `waitForSelector` and `sleep` close that. They are dispatched through the
 * SAME `transport.dispatch` channel as an in-page action so the
 * one-line-per-action contract and the failure/exit-code convention hold
 * unchanged, but they execute in the CLI process against the Playwright
 * `page` on the transport context rather than in the page realm — no `eval`,
 * no in-page runtime dependency, and a timeout surfaces as a real thrown
 * failure rather than a returned envelope.
 */

/** Action ids the CLI handles itself instead of forwarding to the page. */
export const CLI_WAIT_ACTIONS = ['waitForSelector', 'sleep'] as const;

/** Playwright selector states `waitForSelector` accepts. */
export const WAIT_SELECTOR_STATES = ['attached', 'detached', 'visible', 'hidden'] as const;
export type WaitSelectorState = (typeof WAIT_SELECTOR_STATES)[number];

/** Default bound on `waitForSelector` when the payload omits `timeoutMs`. */
export const DEFAULT_WAIT_SELECTOR_TIMEOUT_MS = 10_000;

/** Upper bound on `sleep`'s `ms` — a longer pause is a wedged run, not a wait. */
export const MAX_SLEEP_MS = 600_000;

/** Validated `waitForSelector` payload. */
export interface WaitForSelectorPayload {
  selector: string;
  timeoutMs: number;
  state: WaitSelectorState;
}

function asRecord(payload: unknown, action: string): Record<string, unknown> {
  if (payload === undefined || payload === null) return {};
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new InjectCliArgError(`${action} payload must be a JSON object`);
  }
  return payload as Record<string, unknown>;
}

/**
 * Validate a `waitForSelector` payload. Exported so the grammar is unit-tested
 * without launching a browser.
 */
export function parseWaitForSelectorPayload(payload: unknown): WaitForSelectorPayload {
  const obj = asRecord(payload, 'waitForSelector');
  const selector = obj['selector'];
  if (typeof selector !== 'string' || selector.trim().length === 0) {
    throw new InjectCliArgError(`waitForSelector payload requires a non-empty 'selector' string`);
  }
  let timeoutMs = DEFAULT_WAIT_SELECTOR_TIMEOUT_MS;
  if (obj['timeoutMs'] !== undefined) {
    const raw = obj['timeoutMs'];
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
      throw new InjectCliArgError(
        `waitForSelector 'timeoutMs' must be a non-negative number (got ${JSON.stringify(raw)})`
      );
    }
    timeoutMs = raw;
  }
  let state: WaitSelectorState = 'attached';
  if (obj['state'] !== undefined) {
    const raw = obj['state'];
    if (typeof raw !== 'string' || !WAIT_SELECTOR_STATES.includes(raw as WaitSelectorState)) {
      throw new InjectCliArgError(
        `waitForSelector 'state' must be one of ${WAIT_SELECTOR_STATES.join(' | ')} ` +
          `(got ${JSON.stringify(raw)})`
      );
    }
    state = raw as WaitSelectorState;
  }
  return { selector: selector.trim(), timeoutMs, state };
}

/** Validate a `sleep` payload. Exported for the same reason. */
export function parseSleepPayload(payload: unknown): { ms: number } {
  const obj = asRecord(payload, 'sleep');
  const raw = obj['ms'];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > MAX_SLEEP_MS) {
    throw new InjectCliArgError(
      `sleep payload requires 'ms' as a number in 0..${MAX_SLEEP_MS} (got ${JSON.stringify(raw)})`
    );
  }
  return { ms: raw };
}

/**
 * Validate the payload of every CLI-side wait action in `actions`, throwing
 * {@link InjectCliArgError} on the first bad one.
 *
 * Runs BEFORE the browser launches: a typo in a `waitForSelector` payload
 * should cost an argument error, not a Chromium launch followed by a failed
 * step several actions into the run.
 */
export function validateWaitActions(actions: readonly ExecAction[]): void {
  for (const { action, payload } of actions) {
    if (action === 'waitForSelector') parseWaitForSelectorPayload(payload);
    else if (action === 'sleep') parseSleepPayload(payload);
    else if (action === CAPTURE_TIMELINE_ACTION) parseCaptureTimelinePayload(payload);
  }
}

/** The minimal slice of the transport context the wait actions need. */
interface PageLike {
  waitForSelector(
    selector: string,
    options: { state: WaitSelectorState; timeout: number }
  ): Promise<unknown>;
}

/**
 * Register `waitForSelector` + `sleep` on `registrar`.
 *
 * Called BEFORE the exec loop's forward-anything-else fallback, so these ids
 * resolve to the CLI implementations rather than being forwarded into the page
 * (where they are not actions at all and would fail with an unknown-action
 * error). Exported so a test can register against a stub registry.
 */
export function registerWaitActions(registrar: {
  register(action: string, fn: (params: unknown, ctx: unknown) => unknown): void;
}): void {
  registrar.register('sleep', async (params: unknown) => {
    const { ms } = parseSleepPayload(params);
    await new Promise((resolve) => setTimeout(resolve, ms));
    return { slept: ms };
  });

  registrar.register('waitForSelector', async (params: unknown, ctx: unknown) => {
    const { selector, timeoutMs, state } = parseWaitForSelectorPayload(params);
    const page = (ctx as { page?: PageLike } | null | undefined)?.page;
    if (!page || typeof page.waitForSelector !== 'function') {
      throw new InjectCliArgError(
        `waitForSelector needs the transport's page handle, which this context does not expose`
      );
    }
    const startedAt = Date.now();
    await page.waitForSelector(selector, { state, timeout: timeoutMs });
    return { waited: true, selector, state, elapsedMs: Date.now() - startedAt };
  });
}

/**
 * The private action id the network emulation is applied under, against the
 * transport context's page. A double-underscore id: never an in-page action.
 */
export const APPLY_NETWORK_ACTION = '__inject_cli_apply_network';

/**
 * Register the network emulation (`--throttle` / `--no-cache`) under
 * {@link APPLY_NETWORK_ACTION}. Dispatched once, right after `ready()`, so
 * every exec step and every frame runs under it.
 */
export function registerNetworkEmulation(
  registrar: { register(action: string, fn: (params: unknown, ctx: unknown) => unknown): void },
  args: Pick<InjectCliArgs, 'throttle' | 'noCache'>
): void {
  registrar.register(APPLY_NETWORK_ACTION, async (_params: unknown, ctx: unknown) => {
    const page = (ctx as { page?: ThrottlePage } | null | undefined)?.page;
    if (!page || typeof page.context !== 'function') {
      throw new InjectCliArgError(
        `--throttle/--no-cache need the transport's page handle, which this context does not expose`
      );
    }
    return applyNetworkEmulation(page, args.throttle, args.noCache);
  });
}

/** Apply the requested network emulation to a READY transport; null when none was asked for. */
async function applyNetwork(
  transport: { dispatch(actionId: string, params?: unknown): Promise<unknown> },
  args: Pick<InjectCliArgs, 'throttle' | 'noCache'>
): Promise<NetworkEmulation | null> {
  if (args.throttle === null && !args.noCache) return null;
  return (await transport.dispatch(APPLY_NETWORK_ACTION)) as NetworkEmulation | null;
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

  // The matrix builds one transport PER CELL, so it branches off before the
  // single transport below is constructed.
  if (mode === 'matrix') {
    await runMatrix(args);
    return;
  }

  // authToken is only ever consumed by relay registration (Variant B) — resolve
  // it (with its file/env I/O and possible failure) only in that mode, so a
  // stale/unreadable --auth-token-file never fails an exec-only (Variant A)
  // invocation that was never going to use it.
  let resolvedAuthToken: string | null = args.authToken;
  if (mode === 'relay') {
    try {
      resolvedAuthToken = resolveAuthToken(args, process.env, (p) => readFileSync(p, 'utf8'));
    } catch (err) {
      // A data problem with the token's content ("file is empty"/unreadable),
      // not a CLI-syntax mistake — the ~80-line USAGE block wouldn't help fix
      // it, so skip the usual argument-error USAGE dump.
      if (err instanceof InjectCliArgError) die(err.message);
      const msg = err instanceof Error ? err.message : String(err);
      die(`--auth-token-file '${args.authTokenFile}': cannot read it (${msg})`);
    }
  }

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
  const transport = createTransport({
    kind: 'injected',
    options: buildTransportOptions({ ...args, authToken: resolvedAuthToken }),
  });

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

/** The `--exec` actions followed by the `--exec-stdin` ones, read before any browser launches. */
async function collectActions(args: InjectCliArgs): Promise<ExecAction[]> {
  const actions: ExecAction[] = [...args.execActions];
  if (args.execStdin) {
    const raw = await readStdin();
    actions.push(...parseStdinActions(raw));
  }
  return actions;
}

/**
 * ---------------------------------------------------------------------------
 * Frame-paired snapshots
 * ---------------------------------------------------------------------------
 */

/**
 * The private action id a frame-paired snapshot is dispatched under. A
 * double-underscore id like `__inject_cli_info`: no in-page action is named
 * this, so it can never shadow one.
 */
export const CAPTURE_FRAME_ACTION = '__inject_cli_capture_frame';

/** The slice of the transport the action loop drives. */
export interface ExecTransport {
  readonly handlerRegistry: { has(actionId: string): boolean };
  register(actionId: string, fn: (params: unknown, ctx: unknown) => unknown): void;
  dispatch(actionId: string, params?: unknown): Promise<unknown>;
}

/**
 * Register the lockstep frame capture under {@link CAPTURE_FRAME_ACTION}. It
 * runs in the CLI process against the transport context's `page` (the
 * screenshot) and `execute` (the in-page snapshot) — see `./frame-capture.js`.
 */
export function registerFrameCapture(registrar: Pick<ExecTransport, 'register'>): void {
  registrar.register(CAPTURE_FRAME_ACTION, async (params: unknown, ctx: unknown) => {
    const { action, payload, path } = params as { action: string; payload: unknown; path: string };
    const c = ctx as {
      page?: FramePage;
      execute?: (a: string, p?: unknown) => Promise<unknown>;
    } | null;
    const execute = c?.execute;
    if (!c?.page || typeof execute !== 'function') {
      throw new InjectCliArgError(
        `${action} with a frame needs the transport's page and in-page execute, which this ` +
          `context does not expose`
      );
    }
    return captureFrameInLockstep({
      page: c.page,
      takeSnapshot: () => execute(action, payload),
      path,
    });
  });
}

/**
 * One action's output line: the shape exec mode prints and the capture matrix
 * stores. `action` is always the FIRST key — consumers find result lines by
 * their `{"action":` prefix among forwarded browser output.
 */
export interface ExecLine {
  action: string;
  result?: unknown;
  error?: CliActionError;
  /** Present only on a frame-paired snapshot; `null` when the frame failed. */
  frame?: FrameRecord | null;
  frameError?: FrameError;
}

/**
 * Run `actions` in order against a READY transport, handing one
 * {@link ExecLine} per action to `onLine`. `framePathFor(position, action)`
 * names the frame to pair with an action, or `null` for none.
 *
 * Every action runs whatever happened to the ones before it. Returns `true` if
 * any action failed — thrown or returned — or any requested frame was not
 * produced.
 */
export async function executeActions(
  transport: ExecTransport,
  actions: readonly ExecAction[],
  framePathFor: (position: number, action: string) => string | null,
  onLine: (line: ExecLine, position: number) => void
): Promise<boolean> {
  let anyError = false;
  for (let i = 0; i < actions.length; i++) {
    const { action, payload } = actions[i]!;
    const position = i + 1;
    const framePath = framePathFor(position, action);
    let line: ExecLine;
    try {
      if (framePath !== null) {
        const cap = (await transport.dispatch(CAPTURE_FRAME_ACTION, {
          action,
          payload,
          path: framePath,
        })) as LockstepCapture;
        const returnedError = returnedFailureError(action, cap.snapshot);
        if (returnedError || cap.frameError) anyError = true;
        line = {
          action,
          result: cap.snapshot,
          ...(returnedError ? { error: returnedError } : {}),
          frame: cap.frame,
          ...(cap.frameError ? { frameError: cap.frameError } : {}),
        };
      } else {
        if (!transport.handlerRegistry.has(action)) {
          transport.register(action, (params: unknown, ctx: unknown) =>
            (ctx as { execute(a: string, p?: unknown): Promise<unknown> }).execute(action, params)
          );
        }
        const result = await transport.dispatch(action, payload);
        // A handler that FAILED but returned (rather than threw) still has to
        // reach the error channel — see `returnedFailureError`. `result` is
        // kept verbatim alongside it so this stays additive.
        const returnedError = returnedFailureError(action, result);
        if (returnedError) anyError = true;
        line = returnedError ? { action, result, error: returnedError } : { action, result };
      }
    } catch (err) {
      anyError = true;
      line = { action, error: thrownError(err) };
    }
    onLine(line, position);
  }
  return anyError;
}

/** Variant A: run each action against the in-page runtime, one result line each. */
async function runExec(
  args: InjectCliArgs,
  transport: ReturnType<typeof createTransport>
): Promise<void> {
  // Collect the full action list before launching the browser.
  const actions = await collectActions(args);
  if (actions.length === 0) {
    die('Variant A (exec) selected but no actions were provided');
  }
  try {
    validateWaitActions(actions);
    validateFramePlan(actions, args.screenshot);
  } catch (err) {
    if (err instanceof InjectCliArgError) die(err.message);
    throw err;
  }

  // CLI-side waits must win the id lookup below, which forwards anything
  // unregistered into the page realm.
  let network: NetworkEmulation | null = null;
  registerWaitActions(transport);
  registerFrameCapture(transport);
  registerNetworkEmulation(transport, args);
  registerTimelineCapture(transport, () => network);

  log(args.quiet, `[ui-bridge-inject] launching injected transport (exec mode)`);
  try {
    await transport.ready();
    network = await applyNetwork(transport, args);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[ui-bridge-inject] ready failed: ${msg}\n`);
    await transport.close().catch(() => {});
    process.exit(1);
  }
  if (network) {
    log(args.quiet, `[ui-bridge-inject] network emulation applied: ${JSON.stringify(network)}`);
  }

  const screenshot = args.screenshot;
  let anyError: boolean;
  try {
    anyError = await executeActions(
      transport,
      actions,
      (position, action) =>
        screenshot !== null && SNAPSHOT_ACTIONS.has(action)
          ? expandFramePath(screenshot, position)
          : null,
      (line) => process.stdout.write(`${JSON.stringify(line)}\n`)
    );
  } finally {
    await transport.close().catch(() => {});
  }
  process.exit(anyError ? 1 : 0);
}

/**
 * ---------------------------------------------------------------------------
 * Capture matrix
 * ---------------------------------------------------------------------------
 */

/** This package's own version, for the manifest's provenance; `null` when unreadable. */
function wrapperVersion(): string | null {
  try {
    // `../package.json` from both `src/inject-cli.ts` and `dist/inject-cli.cjs`.
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      name?: unknown;
      version?: unknown;
    };
    return pkg.name === '@qontinui/ui-bridge-wrapper' && typeof pkg.version === 'string'
      ? pkg.version
      : null;
  } catch {
    return null;
  }
}

/**
 * One cell: a fresh transport at the cell's viewport / DPR / colour scheme, the
 * plan run against it, and every snapshot action's pair written under
 * `<dir>/<cell id>/`. Never throws — a cell that cannot be captured is a
 * `failed` report, so one bad cell does not lose the others.
 */
async function runMatrixCell(
  args: InjectCliArgs,
  cell: MatrixCell,
  plan: readonly ExecAction[],
  dir: string
): Promise<MatrixCellReport> {
  const id = cellId(cell);
  const cellDir = join(dir, id);
  const transport = createTransport({
    kind: 'injected',
    options: buildCellTransportOptions(args, cell),
  });
  let network: NetworkEmulation | null = null;
  registerWaitActions(transport);
  registerFrameCapture(transport);
  registerNetworkEmulation(transport, args);
  registerTimelineCapture(transport, () => network, cellDir);
  log(args.quiet, `[ui-bridge-inject] capture matrix: cell ${id}`);

  try {
    ensurePrivateDir(cellDir);
    await transport.ready();
    network = await applyNetwork(transport, args);
  } catch (err) {
    await transport.close().catch(() => {});
    const e = thrownError(err);
    return {
      id,
      requested: cell,
      status: 'failed',
      error: { code: e.code, message: e.message },
      results: null,
      pairs: [],
    };
  }

  const lines: string[] = [];
  const pairs: MatrixPair[] = [];
  try {
    const anyError = await executeActions(
      transport,
      plan,
      (position, action) =>
        SNAPSHOT_ACTIONS.has(action) ? join(cellDir, `frame-${position}.png`) : null,
      (line, position) => {
        lines.push(JSON.stringify(line));
        if (!SNAPSHOT_ACTIONS.has(line.action) || line.result === undefined) return;
        const snapshotPath = join(cellDir, `snapshot-${position}.json`);
        writePrivateFile(snapshotPath, `${JSON.stringify(line.result)}\n`);
        pairs.push({
          position,
          snapshot: manifestPath(dir, snapshotPath),
          frame: line.frame ? { ...line.frame, path: manifestPath(dir, line.frame.path) } : null,
          ...(line.frameError ? { frameError: line.frameError } : {}),
        });
      }
    );
    const resultsPath = join(cellDir, 'results.ndjson');
    writePrivateFile(resultsPath, `${lines.join('\n')}\n`);
    return {
      id,
      requested: cell,
      status: anyError ? 'incomplete' : 'captured',
      results: manifestPath(dir, resultsPath),
      pairs,
      network,
    };
  } catch (err) {
    const e = thrownError(err);
    return {
      id,
      requested: cell,
      status: 'failed',
      error: { code: e.code, message: e.message },
      results: null,
      pairs,
    };
  } finally {
    await transport.close().catch(() => {});
  }
}

/**
 * `--capture-matrix` writes into an EMPTY directory only. Frames from a
 * previous run would otherwise sit beside this run's under the same cell ids,
 * indistinguishable from them, and clearing the directory silently could
 * delete files the caller meant to keep. So a non-empty directory (or a file
 * at that path) is refused before any browser launches; one that does not
 * exist yet is created owner-only.
 */
export function assertEmptyMatrixDir(dir: string): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    if (code === 'ENOTDIR') {
      throw new InjectCliArgError(
        `${dir} is a file, not a directory. Pass an empty directory, or one that does not exist yet.`
      );
    }
    throw err;
  }
  if (entries.length > 0) {
    throw new InjectCliArgError(
      `${dir} is not empty (${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}). Pass an ` +
        `empty directory, or one that does not exist yet; the matrix never clears or overwrites one.`
    );
  }
}

/**
 * Run the capture matrix: every cell in turn into `args.captureMatrix`, then
 * `<dir>/matrix.json`. Returns the manifest it wrote; `onCell` sees each cell's
 * report as it completes. Never exits the process — that is `runMatrix`'s job —
 * so it is callable from a test.
 */
export async function captureMatrix(
  args: InjectCliArgs,
  plan: readonly ExecAction[],
  onCell: (report: MatrixCellReport, cellDir: string) => void = () => {}
): Promise<MatrixManifest> {
  if (!args.captureMatrix)
    throw new InjectCliArgError('captureMatrix needs --capture-matrix <dir>');
  const dir = resolve(args.captureMatrix);
  assertEmptyMatrixDir(dir);
  ensurePrivateDir(dir);
  const cells = expandMatrix({
    viewports: args.viewports,
    dprs: args.dprs,
    colorSchemes: args.colorSchemes,
  });
  const startedAt = new Date().toISOString();
  log(args.quiet, `[ui-bridge-inject] capture matrix: ${cells.length} cell(s) into ${dir}`);

  const reports: MatrixCellReport[] = [];
  for (const cell of cells) {
    const report = await runMatrixCell(args, cell, plan, dir);
    reports.push(report);
    onCell(report, join(dir, report.id));
  }

  const manifest: MatrixManifest = {
    kind: 'ui-bridge-capture-matrix',
    schemaVersion: 1,
    url: args.url,
    producer: {
      name: 'ui-bridge-inject',
      package: '@qontinui/ui-bridge-wrapper',
      version: wrapperVersion(),
    },
    startedAt,
    finishedAt: new Date().toISOString(),
    axes: { viewports: args.viewports, dprs: args.dprs, colorSchemes: args.colorSchemes },
    plan: plan.map((a, i) => ({ position: i + 1, action: a.action, payload: a.payload })),
    cells: reports,
  };
  const manifestFile = join(dir, 'matrix.json');
  writePrivateFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  log(args.quiet, `[ui-bridge-inject] capture matrix: manifest ${manifestFile}`);
  return manifest;
}

/** Capture-matrix mode: validate the plan, run {@link captureMatrix}, one stdout line per cell. */
async function runMatrix(args: InjectCliArgs): Promise<void> {
  const actions = await collectActions(args);
  const plan: ExecAction[] =
    actions.length > 0 ? actions : [{ action: 'getControlSnapshot', payload: {} }];
  try {
    validateWaitActions(plan);
  } catch (err) {
    if (err instanceof InjectCliArgError) die(err.message);
    throw err;
  }
  if (!plan.some((a) => SNAPSHOT_ACTIONS.has(a.action))) {
    die(
      `--capture-matrix stores frame-and-snapshot pairs, and this plan takes no ` +
        `getControlSnapshot. Add --exec 'getControlSnapshot {}', or pass no --exec at all.`
    );
  }

  let manifest: MatrixManifest;
  try {
    manifest = await captureMatrix(args, plan, (report, cellDir) => {
      process.stdout.write(
        `${JSON.stringify({
          cell: report.id,
          status: report.status,
          frames: report.pairs.filter((p) => p.frame !== null).length,
          dir: cellDir,
          ...(report.error ? { error: report.error } : {}),
        })}\n`
      );
    });
  } catch (err) {
    die(`--capture-matrix: ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exit(manifest.cells.every((c) => c.status === 'captured') ? 0 : 1);
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

  registerNetworkEmulation(transport, args);
  let network: NetworkEmulation | null = null;
  try {
    await transport.ready();
    network = await applyNetwork(transport, args);
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
      network,
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

// Execute only when run as the bin (importing this module — e.g. from a unit
// test that exercises `parseArgs` — must stay inert).
//
// tsup emits this entry as CJS ONLY (see tsup.config.ts: the bin config's
// `format: ['cjs']`, and package.json's `"ui-bridge-inject": "./dist/...cjs"`),
// so `require.main === module` is available here and is the symlink-proof
// check. The guard this replaced compared `process.argv[1]` against the
// module's own filename. `process.argv[1]` is the path AS INVOKED and Node
// never resolves symlinks in it, so running through the installed bin symlink
// — `node_modules/.bin/ui-bridge-inject`, which is exactly what
// `npx ... ui-bridge-inject` resolves to — made the two differ: `main()` never
// ran and the process exited 0 having printed nothing at all. Module identity
// is immune to that.
declare const require: NodeRequire | undefined;
declare const module: NodeModule | undefined;
const isMain =
  typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module;

if (isMain) {
  void main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[ui-bridge-inject] fatal: ${msg}\n`);
    process.exit(1);
  });
}
