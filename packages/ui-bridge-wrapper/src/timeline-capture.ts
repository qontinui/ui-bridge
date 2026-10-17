/**
 * `captureTimeline` — a timed multi-frame capture of the page over time.
 *
 * Plan 2026-10-13-image-generation-and-visual-judgment, Phase 18 step 3: the
 * `/visual-audit` image arm operates the loading-to-loaded timeline of a slot
 * (what the user sees while a candidate arrives over a slow network, whether
 * the placeholder holds its box) instead of looking only at the settled page.
 * A lockstep frame (`./frame-capture.js`) refuses a moving layout by design; a
 * timeline is the opposite instrument — it RECORDS the movement, one frame
 * every `intervalMs`, each stamped with its offset from the start.
 *
 * `during: {action, payload}` runs one in-page action CONCURRENTLY with the
 * frames — `mediaOverride` is the case it exists for: the override itself still
 * waits for decode and confirms `currentSrc` before IT answers, while the
 * frames record what the user saw as the candidate arrived (under `--throttle`,
 * the slot's slow-network arrival). The action's own result rides on the
 * timeline result, and a failed action fails the step.
 *
 * `reload: true` starts the clock at a fresh navigation commit, so frame 1 is
 * the page before anything painted. A reload re-runs the injected runtime and
 * drops any media override the page held (the DOM is new), so the action waits
 * for the runtime to be ready again before it answers — the next exec step
 * finds a drivable page.
 *
 * Every frame records what was MEASURED: the PNG's own dimensions and the
 * instant the screenshot was requested. A frame that could not be taken is a
 * per-frame `error` and makes the action answer `success: false` (exit 1),
 * never a gap silently closed up.
 */

import { readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { InjectCliArgError } from './inject-cli-errors.js';
import {
  ensurePrivateDir,
  pngDimensions,
  readPageMetrics,
  writePrivateFile,
  type FrameColorScheme,
  type FramePage,
} from './frame-capture.js';

/** The CLI-side action id. No in-page action is named this. */
export const CAPTURE_TIMELINE_ACTION = 'captureTimeline';

export const MAX_TIMELINE_FRAMES = 120;
export const MAX_TIMELINE_INTERVAL_MS = 10_000;
export const DEFAULT_TIMELINE_READY_TIMEOUT_MS = 30_000;

export interface CaptureTimelinePayload {
  /** Directory the frames go into; must be empty or not exist yet. */
  dir: string;
  frames: number;
  intervalMs: number;
  reload: boolean;
  readyTimeoutMs: number;
  /** An in-page action run concurrently with the frames; absent or null for none. */
  during?: { action: string; payload: unknown } | null;
}

function asRecord(payload: unknown): Record<string, unknown> {
  if (payload === undefined || payload === null) return {};
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new InjectCliArgError(`${CAPTURE_TIMELINE_ACTION} payload must be a JSON object`);
  }
  return payload as Record<string, unknown>;
}

function intIn(raw: unknown, field: string, min: number, max: number, fallback?: number): number {
  if (raw === undefined && fallback !== undefined) return fallback;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max) {
    throw new InjectCliArgError(
      `${CAPTURE_TIMELINE_ACTION} '${field}' must be an integer in ${min}..${max} ` +
        `(got ${JSON.stringify(raw)})`
    );
  }
  return raw;
}

/** Validate a `captureTimeline` payload. Exported so the grammar is unit-tested. */
export function parseCaptureTimelinePayload(payload: unknown): CaptureTimelinePayload {
  const o = asRecord(payload);
  if (typeof o.dir !== 'string' || o.dir.trim().length === 0) {
    throw new InjectCliArgError(`${CAPTURE_TIMELINE_ACTION} payload requires a non-empty 'dir'`);
  }
  if (o.reload !== undefined && typeof o.reload !== 'boolean') {
    throw new InjectCliArgError(`${CAPTURE_TIMELINE_ACTION} 'reload' must be a boolean`);
  }
  let during: CaptureTimelinePayload['during'] = null;
  if (o.during !== undefined) {
    const d = o.during as Record<string, unknown> | null;
    if (
      d === null ||
      typeof d !== 'object' ||
      Array.isArray(d) ||
      typeof d.action !== 'string' ||
      d.action.length === 0
    ) {
      throw new InjectCliArgError(
        `${CAPTURE_TIMELINE_ACTION} 'during' must be {"action":"<in-page action>","payload":{...}}`
      );
    }
    if (d.action === CAPTURE_TIMELINE_ACTION || d.action.startsWith('__')) {
      throw new InjectCliArgError(
        `${CAPTURE_TIMELINE_ACTION} 'during' takes an in-page action, not ${JSON.stringify(d.action)}`
      );
    }
    if (o.reload === true) {
      throw new InjectCliArgError(
        `${CAPTURE_TIMELINE_ACTION} cannot combine 'during' with 'reload': the reload replaces ` +
          `the document the action would act on`
      );
    }
    during = { action: d.action, payload: d.payload ?? {} };
  }
  return {
    dir: o.dir,
    frames: intIn(o.frames, 'frames', 1, MAX_TIMELINE_FRAMES),
    intervalMs: intIn(o.intervalMs, 'intervalMs', 0, MAX_TIMELINE_INTERVAL_MS),
    reload: o.reload === true,
    readyTimeoutMs: intIn(
      o.readyTimeoutMs,
      'readyTimeoutMs',
      1,
      600_000,
      DEFAULT_TIMELINE_READY_TIMEOUT_MS
    ),
    during,
  };
}

/** One frame of the timeline. */
export interface TimelineFrame {
  index: number;
  /** Absolute path of the PNG, or null when the frame failed. */
  path: string | null;
  /** ms from the timeline's start (the reload commit, or the action start). */
  offsetMs: number;
  capturedAt: string;
  width: number | null;
  height: number | null;
  error?: string;
}

export interface TimelineResult {
  success: boolean;
  dir: string;
  reloaded: boolean;
  intervalMs: number;
  /** ISO instant the clock started. */
  startedAt: string;
  frames: TimelineFrame[];
  /** The page's own rendering metrics at the end of the timeline. */
  devicePixelRatio: number;
  cssViewport: { width: number; height: number };
  colorScheme: FrameColorScheme;
  /** After a reload: the injected runtime came back ready. `null` without a reload. */
  runtimeReady: boolean | null;
  /** The concurrent action's own result (`during`), with ms from t0 to its answer. */
  during?: { action: string; result: unknown; answeredAtMs: number; failed: boolean };
  error?: string;
}

/** The slice of a Playwright `Page` the timeline needs. */
export interface TimelinePage extends FramePage {
  reload(options: { waitUntil: 'commit'; timeout: number }): Promise<unknown>;
  waitForFunction(
    fn: () => unknown,
    arg: undefined,
    options: { timeout: number }
  ): Promise<unknown>;
}

/** Refuse a non-empty directory: frames from a previous run would be indistinguishable. */
function assertEmptyDir(dir: string): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    throw new InjectCliArgError(
      `${CAPTURE_TIMELINE_ACTION}: ${dir} is not a usable directory (${code})`
    );
  }
  if (entries.length > 0) {
    throw new InjectCliArgError(
      `${CAPTURE_TIMELINE_ACTION}: ${dir} is not empty; pass an empty directory or one that does ` +
        `not exist yet (frames are never overwritten)`
    );
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Run one timeline against `page`. */
export async function captureTimeline(
  page: TimelinePage,
  payload: CaptureTimelinePayload,
  now: () => number = Date.now,
  execute?: (action: string, payload: unknown) => Promise<unknown>
): Promise<TimelineResult> {
  const concurrent = payload.during ?? null;
  if (concurrent !== null && !execute) {
    throw new InjectCliArgError(
      `${CAPTURE_TIMELINE_ACTION} 'during' needs the transport's in-page execute, which this ` +
        `context does not expose`
    );
  }
  const dir = resolve(payload.dir);
  assertEmptyDir(dir);
  ensurePrivateDir(dir);

  if (payload.reload) await page.reload({ waitUntil: 'commit', timeout: payload.readyTimeoutMs });
  const t0 = now();
  const frames: TimelineFrame[] = [];
  const duringRun =
    concurrent !== null && execute
      ? (async () => {
          const { action, payload: p } = concurrent;
          try {
            const result = await execute(action, p);
            const failed =
              typeof result === 'object' &&
              result !== null &&
              (result as { success?: unknown }).success === false;
            return { action, result, answeredAtMs: now() - t0, failed };
          } catch (err) {
            return {
              action,
              result: { success: false, error: err instanceof Error ? err.message : String(err) },
              answeredAtMs: now() - t0,
              failed: true,
            };
          }
        })()
      : null;
  for (let k = 1; k <= payload.frames; k++) {
    const due = t0 + (k - 1) * payload.intervalMs;
    // A timer can fire a millisecond early; sleep again until the frame is due,
    // so an offset never reads shorter than the interval asked for.
    for (let wait = due - now(); wait > 0; wait = due - now()) await sleep(wait);
    const at = now();
    const capturedAt = new Date(at).toISOString();
    try {
      const png = await page.screenshot({ type: 'png', scale: 'device', fullPage: false });
      const { width, height } = pngDimensions(png);
      const path = join(dir, `frame-${k}.png`);
      writePrivateFile(path, png);
      frames.push({ index: k, path, offsetMs: at - t0, capturedAt, width, height });
    } catch (err) {
      frames.push({
        index: k,
        path: null,
        offsetMs: at - t0,
        capturedAt,
        width: null,
        height: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const during = duringRun ? await duringRun : undefined;
  let runtimeReady: boolean | null = null;
  let error: string | undefined;
  if (during?.failed) error = `the concurrent ${during.action} failed`;
  if (payload.reload) {
    try {
      await page.waitForFunction(
        () =>
          (window as unknown as { __uiBridgeInjected?: { settled?: boolean } }).__uiBridgeInjected
            ?.settled === true,
        undefined,
        { timeout: payload.readyTimeoutMs }
      );
      runtimeReady = true;
    } catch (err) {
      runtimeReady = false;
      error =
        `the injected runtime did not settle within ${payload.readyTimeoutMs} ms after the ` +
        `reload: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  const metrics = await readPageMetrics(page);
  const failed = frames.filter((f) => f.error !== undefined).length;
  if (failed > 0 && error === undefined) error = `${failed} of ${frames.length} frames failed`;
  return {
    success: failed === 0 && runtimeReady !== false && !during?.failed,
    dir,
    reloaded: payload.reload,
    intervalMs: payload.intervalMs,
    startedAt: new Date(t0).toISOString(),
    frames,
    devicePixelRatio: metrics.devicePixelRatio,
    cssViewport: { width: metrics.innerWidth, height: metrics.innerHeight },
    colorScheme: metrics.colorScheme,
    runtimeReady,
    ...(during ? { during } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}

/**
 * Register `captureTimeline` on `registrar`, against the transport context's
 * Playwright page. A relative `dir` resolves under `baseDir` when one is given
 * (the capture matrix's cell directory), else under the working directory.
 * `network` is stamped on every result, so a frame series is never read as
 * unthrottled when it was throttled (or the reverse).
 */
export function registerTimelineCapture(
  registrar: { register(action: string, fn: (params: unknown, ctx: unknown) => unknown): void },
  network: () => unknown,
  baseDir?: string
): void {
  registrar.register(CAPTURE_TIMELINE_ACTION, async (params: unknown, ctx: unknown) => {
    const parsed = parseCaptureTimelinePayload(params);
    // In the capture matrix a relative `dir` lands inside the cell's own
    // directory, so one plan yields one timeline per cell instead of N cells
    // fighting over one directory.
    const payload =
      baseDir !== undefined && !isAbsolute(parsed.dir)
        ? { ...parsed, dir: join(baseDir, parsed.dir) }
        : parsed;
    const c = ctx as {
      page?: TimelinePage;
      execute?: (a: string, p?: unknown) => Promise<unknown>;
    } | null;
    const page = c?.page;
    if (!page || typeof page.screenshot !== 'function' || typeof page.reload !== 'function') {
      throw new InjectCliArgError(
        `${CAPTURE_TIMELINE_ACTION} needs the transport's page handle, which this context does not expose`
      );
    }
    const execute = c?.execute;
    const result = await captureTimeline(
      page,
      payload,
      Date.now,
      typeof execute === 'function' ? (a, p) => execute(a, p) : undefined
    );
    return { ...result, network: network() };
  });
}
