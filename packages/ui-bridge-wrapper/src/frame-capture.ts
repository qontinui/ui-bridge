/**
 * Frame capture in lockstep with a control snapshot.
 *
 * WHY LOCKSTEP. The vision analyzers trust the snapshot they are handed: an
 * element's bbox says WHERE on the frame its pixels are, and nothing re-checks
 * it (`rust-vision-core/src/element_snapshot.rs`, `ElementSnapshot`: "Caller is
 * responsible for capturing this in lockstep with the Frame that will be used
 * in the same analyze/assert call"). A frame taken while the layout is still
 * moving pairs every box with the wrong pixels, and the analyzer cannot tell.
 *
 * So the pairing is MEASURED, not assumed: snapshot, frame, snapshot again. If
 * the two snapshots agree on every element's box and visibility, the frame sat
 * between two identical layouts and the pair is `lockstep.verified: true`. If
 * they disagree the round is retried, and after the last attempt the pair is
 * still returned — with `verified: false` and how many elements moved — rather
 * than passed off as a clean pairing.
 *
 * Geometry, not text, decides it: a ticking clock changes the pixels inside its
 * own box but not where the box is, and where-is-each-box is what a bbox → pixel
 * mapping depends on.
 *
 * WHAT THE FRAME SAYS ABOUT ITSELF. Every field of {@link FrameRecord} is read
 * off the page or the PNG at capture time — the device pixel ratio the page
 * reports, the CSS viewport it covers, the colour scheme it rendered in — never
 * copied from the flags that asked for them. A flag that silently failed to
 * apply (Phase 1 of plan 2026-10-13-image-generation-and-visual-judgment
 * measured exactly that for a Chromium DPR launch flag) therefore cannot be
 * stamped onto a frame as if it had.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** The `prefers-color-scheme` a page rendered in. */
export type FrameColorScheme = 'dark' | 'light';

/** Whether a snapshot describes the geometry its frame shows. */
export interface LockstepRecord {
  /**
   * True when the snapshots taken immediately before and after the frame agree
   * on every element's box and visibility.
   */
  verified: boolean;
  /** Snapshot → frame → snapshot rounds taken; `1` is verified first time. */
  attempts: number;
  /**
   * Elements whose box or visibility differed between the two snapshots of the
   * LAST round, counting ones present in only one of them. `0` when verified.
   * `null` when either snapshot carried no element list, so nothing could be
   * compared — UNKNOWN, never a pass.
   */
  changedElements: number | null;
}

/** The frame-side half of a frame-and-snapshot pair, stamped into the CLI's JSON. */
export interface FrameRecord {
  /** Absolute path of the PNG written. */
  path: string;
  format: 'png';
  /** Frame pixel dimensions, read from the PNG header. */
  width: number;
  height: number;
  /**
   * `window.devicePixelRatio` when the frame was taken: frame pixels per CSS
   * pixel, i.e. the scale an analyzer maps a CSS-pixel bbox through.
   */
  devicePixelRatio: number;
  /** The CSS-pixel viewport (`innerWidth` × `innerHeight`) the frame covers. */
  cssViewport: { width: number; height: number };
  /** The `prefers-color-scheme` the page reported. */
  colorScheme: FrameColorScheme;
  /** ISO-8601 UTC instant the screenshot was requested. */
  capturedAt: string;
  lockstep: LockstepRecord;
}

/** Why a requested frame was not produced. The snapshot beside it still stands. */
export interface FrameError {
  code: 'FRAME_CAPTURE_FAILED' | 'FRAME_SCALE_MISMATCH';
  message: string;
}

/** What the page says about how it is being rendered. */
export interface PageMetrics {
  devicePixelRatio: number;
  innerWidth: number;
  innerHeight: number;
  colorScheme: FrameColorScheme;
}

/** The slice of a Playwright `Page` frame capture needs. */
export interface FramePage {
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
  screenshot(options: { type: 'png'; scale: 'device'; fullPage: false }): Promise<Uint8Array>;
}

/** Default number of snapshot → frame → snapshot rounds before giving up on verification. */
export const DEFAULT_LOCKSTEP_ATTEMPTS = 3;

/**
 * How far (in frame pixels, per axis) the PNG may differ from
 * `cssViewport × devicePixelRatio`. Chromium rounds a fractional product
 * (390 × 2.625 = 1023.75), so an exact match is not the contract; a frame off
 * by more than this was not taken at the scale the page reports, and mapping a
 * CSS box through that scale would land on the wrong pixels.
 */
export const FRAME_SCALE_TOLERANCE_PX = 2;

/** The placeholder a `--screenshot` path template replaces with the action's position. */
export const FRAME_INDEX_TOKEN = '{n}';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Width and height from a PNG's IHDR chunk. Throws on anything that is not a
 * PNG with an IHDR first — a frame whose size cannot be read cannot be mapped.
 */
export function pngDimensions(buf: Uint8Array): { width: number; height: number } {
  if (buf.length < 24 || PNG_SIGNATURE.some((b, i) => buf[i] !== b)) {
    throw new Error('not a PNG (signature mismatch or truncated header)');
  }
  const chunkType = String.fromCharCode(buf[12]!, buf[13]!, buf[14]!, buf[15]!);
  if (chunkType !== 'IHDR') {
    throw new Error(`PNG does not start with an IHDR chunk (found ${JSON.stringify(chunkType)})`);
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Substitute every `{n}` in a `--screenshot` template with the action's 1-based position. */
export function expandFramePath(template: string, position: number): string {
  return template.split(FRAME_INDEX_TOKEN).join(String(position));
}

/** Read the page's own rendering metrics — never the flags that requested them. */
export async function readPageMetrics(page: Pick<FramePage, 'evaluate'>): Promise<PageMetrics> {
  return page.evaluate(() => ({
    devicePixelRatio: window.devicePixelRatio,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    colorScheme: (window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light') as FrameColorScheme,
  }));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Each element's box and visibility, keyed by id — the part of a control
 * snapshot a bbox → pixel mapping depends on. `null` when the snapshot carries
 * no element array (bare or `{data:{elements}}`-wrapped), so there is nothing
 * to compare.
 */
export function snapshotGeometry(snapshot: unknown): Map<string, string> | null {
  if (!isRecord(snapshot)) return null;
  const data = snapshot['data'];
  const elements = Array.isArray(snapshot['elements'])
    ? snapshot['elements']
    : isRecord(data) && Array.isArray(data['elements'])
      ? data['elements']
      : null;
  if (elements === null) return null;
  const out = new Map<string, string>();
  elements.forEach((el, i) => {
    if (!isRecord(el)) return;
    const id = typeof el['id'] === 'string' ? el['id'] : `#${i}`;
    const b = isRecord(el['bbox']) ? el['bbox'] : null;
    const box = b ? [b['x'], b['y'], b['width'], b['height']].map((v) => String(v)).join(',') : '-';
    out.set(id, `${box}|${String(el['visible'])}`);
  });
  return out;
}

/**
 * How many elements differ between two geometry maps — a changed box or
 * visibility, or an id present in only one. `null` when either side could not
 * be read.
 */
export function geometryDelta(
  before: Map<string, string> | null,
  after: Map<string, string> | null
): number | null {
  if (before === null || after === null) return null;
  let changed = 0;
  for (const [id, key] of before) {
    if (after.get(id) !== key) changed += 1;
  }
  for (const id of after.keys()) {
    if (!before.has(id)) changed += 1;
  }
  return changed;
}

/** The frame-and-snapshot pair one capture produced. */
export interface LockstepCapture {
  /** The control snapshot paired with the frame (the BEFORE snapshot of the last round). */
  snapshot: unknown;
  /** The frame, or `null` when it could not be produced — see `frameError`. */
  frame: FrameRecord | null;
  frameError?: FrameError;
}

export interface CaptureFrameOptions {
  page: FramePage;
  /** Take one control snapshot. Its failure is the ACTION's failure and propagates. */
  takeSnapshot: () => Promise<unknown>;
  /** Where to write the PNG. Resolved to an absolute path; parent dirs are created. */
  path: string;
  maxAttempts?: number;
  /** Injectable clock for tests. */
  now?: () => Date;
}

/**
 * Snapshot → frame → snapshot, retried until the two snapshots agree on
 * geometry or `maxAttempts` rounds are spent. See the module doc.
 *
 * A snapshot failure propagates: no snapshot means no capture at all. A frame
 * failure does NOT: the snapshot is still a valid observation, so it is
 * returned with `frame: null` and a typed `frameError`, and the caller decides
 * what a missing frame costs.
 */
export async function captureFrameInLockstep(opts: CaptureFrameOptions): Promise<LockstepCapture> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? DEFAULT_LOCKSTEP_ATTEMPTS);
  const now = opts.now ?? (() => new Date());
  const path = resolve(opts.path);

  let snapshot: unknown;
  let png: Uint8Array | null = null;
  let metrics: PageMetrics | null = null;
  let capturedAt = '';
  let changed: number | null = null;
  let attempts = 1;

  for (; attempts <= maxAttempts; attempts++) {
    snapshot = await opts.takeSnapshot();
    try {
      metrics = await readPageMetrics(opts.page);
      capturedAt = now().toISOString();
      png = await opts.page.screenshot({ type: 'png', scale: 'device', fullPage: false });
    } catch (err) {
      return {
        snapshot,
        frame: null,
        frameError: {
          code: 'FRAME_CAPTURE_FAILED',
          message: `screenshot failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }
    const after = await opts.takeSnapshot();
    changed = geometryDelta(snapshotGeometry(snapshot), snapshotGeometry(after));
    if (changed === 0) break;
    // An unreadable element list will not become readable by retrying.
    if (changed === null) break;
  }
  attempts = Math.min(attempts, maxAttempts);

  if (png === null || metrics === null) {
    // Unreachable: every loop iteration either assigns both or returns. Kept so
    // the types narrow without a non-null assertion.
    return {
      snapshot,
      frame: null,
      frameError: { code: 'FRAME_CAPTURE_FAILED', message: 'no frame was taken' },
    };
  }

  let size: { width: number; height: number };
  try {
    size = pngDimensions(png);
  } catch (err) {
    return {
      snapshot,
      frame: null,
      frameError: {
        code: 'FRAME_CAPTURE_FAILED',
        message: `the screenshot is unreadable: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  const expectedW = metrics.innerWidth * metrics.devicePixelRatio;
  const expectedH = metrics.innerHeight * metrics.devicePixelRatio;
  if (
    Math.abs(size.width - expectedW) > FRAME_SCALE_TOLERANCE_PX ||
    Math.abs(size.height - expectedH) > FRAME_SCALE_TOLERANCE_PX
  ) {
    return {
      snapshot,
      frame: null,
      frameError: {
        code: 'FRAME_SCALE_MISMATCH',
        message:
          `the screenshot is ${size.width}x${size.height} px, but the page reports a ` +
          `${metrics.innerWidth}x${metrics.innerHeight} CSS viewport at devicePixelRatio ` +
          `${metrics.devicePixelRatio} (expected about ${expectedW}x${expectedH}); a CSS box ` +
          `mapped through that ratio would land on the wrong pixels, so no frame is reported`,
      },
    };
  }

  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, png);
  } catch (err) {
    return {
      snapshot,
      frame: null,
      frameError: {
        code: 'FRAME_CAPTURE_FAILED',
        message: `could not write ${path}: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  return {
    snapshot,
    frame: {
      path,
      format: 'png',
      width: size.width,
      height: size.height,
      devicePixelRatio: metrics.devicePixelRatio,
      cssViewport: { width: metrics.innerWidth, height: metrics.innerHeight },
      colorScheme: metrics.colorScheme,
      capturedAt,
      lockstep: { verified: changed === 0, attempts, changedElements: changed },
    },
  };
}
