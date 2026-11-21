/**
 * `getScreenshot` over a transport. NODE-FREE by contract (no Node builtin,
 * no `Buffer`, no `process`): the browser-safe `./live` entry exports it, and
 * the live transport imports it. `frame-capture.ts` re-exports all of it.
 */

import { WrapperTransportError } from './types.js';
import { pngDimensions, readPageMetrics, type FramePage, type PageMetrics } from './frame-page.js';

/**
 * ---------------------------------------------------------------------------
 * `getScreenshot` over a transport (plan
 * 2026-11-21-vision-capture-cannot-frame-a-websocket-transport-app, Phase 3)
 * ---------------------------------------------------------------------------
 *
 * The runner's vision routes capture a WebSocket-transport app by relaying
 * {@link SCREENSHOT_ACTION} over the app's socket, and only to an app whose
 * register frame advertises {@link SCREENSHOT_CAPABILITY}. The client takes
 * the frame with the page handle it owns: the runner holds none.
 *
 * The reply is the React Native HTTP provider's body shape,
 * `{ screenshot: <base64 png>, width: <CSS px>, height: <CSS px> }`
 * (`ui-bridge-native/src/server/http-server.ts`), so the runner decodes both
 * with one decoder (`frame_from_screenshot_json`).
 */

/**
 * The capability string a client advertises when it answers
 * {@link SCREENSHOT_ACTION}. The runner refuses a WebSocket capture target that
 * does not advertise it (`422 FRAME_SOURCE_UNSUPPORTED`). Advertise it ONLY by
 * registering the handler — {@link registerScreenshotCapture} and
 * `LiveTransportOptions.screenshotPage` do both together, so the advertisement
 * cannot drift from the behaviour.
 */
export const SCREENSHOT_CAPABILITY = 'screenshot';

/** The action the runner relays to capture a frame: the native handler's name. */
export const SCREENSHOT_ACTION = 'getScreenshot';

/** The capture bound: the native provider's 10 s screenshot timeout. */
export const SCREENSHOT_TIMEOUT_MS = 10_000;

/**
 * Chromium's refusal to screenshot a document that has no compositor frame
 * yet — CDP `Page.captureScreenshot` answering `Unable to capture screenshot`,
 * measured on frame 1 right after a reload commit. The only screenshot error
 * that is retried; every other one is final at once.
 */
export const NO_COMPOSITOR_FRAME = /Unable to capture screenshot/;

/** The wait between attempts at a frame Chromium refused: about one 60 Hz frame. */
export const NO_COMPOSITOR_FRAME_RETRY_MS = 16;

/** The `getScreenshot` reply body. */
export interface ScreenshotReply {
  /** The PNG, base64 (no data-URL prefix). */
  screenshot: string;
  /** CSS-pixel viewport width (`innerWidth`) the frame covers. */
  width: number;
  /** CSS-pixel viewport height (`innerHeight`) the frame covers. */
  height: number;
}

/** Anything a `getScreenshot` handler can be registered on (a transport or its registry). */
export interface ScreenshotRegistrar {
  register(actionId: string, fn: (params: unknown, ctx: unknown) => unknown): void;
}

/** Tuning for {@link registerScreenshotCapture}; the defaults are the contract. */
export interface ScreenshotCaptureOptions {
  /** Overall bound on one capture, retries included. Default {@link SCREENSHOT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Wait between attempts after a no-compositor-frame refusal. Default {@link NO_COMPOSITOR_FRAME_RETRY_MS}. */
  retryMs?: number;
}

/**
 * Base64 with no Node `Buffer`: `btoa` is a global in browsers and in Node 16+
 * (this package requires Node 20), so one code path serves both. Built in
 * chunks so a multi-MB frame never spreads millions of arguments at once.
 */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Take one `getScreenshot` reply off `page`, bounded by `timeoutMs` overall.
 *
 * Errors are typed so the runner can carry the code to the caller:
 * `SCREENSHOT_TIMEOUT` (retryable) when the bound is spent, and
 * `SCREENSHOT_FAILED` for a refused or unreadable screenshot — retryable only
 * when the last refusal was Chromium's no-compositor-frame one.
 */
export async function captureScreenshotReply(
  page: FramePage,
  options: ScreenshotCaptureOptions = {}
): Promise<ScreenshotReply> {
  const timeoutMs = options.timeoutMs ?? SCREENSHOT_TIMEOUT_MS;
  const retryMs = options.retryMs ?? NO_COMPOSITOR_FRAME_RETRY_MS;
  const deadline = Date.now() + timeoutMs;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const attempt = async (): Promise<ScreenshotReply> => {
    let metrics: PageMetrics;
    try {
      metrics = await readPageMetrics(page);
    } catch (err) {
      throw new WrapperTransportError(
        'SCREENSHOT_FAILED',
        `could not read the page's viewport: ${errorText(err)}`,
        { cause: err }
      );
    }
    for (;;) {
      let png: Uint8Array;
      try {
        png = await page.screenshot({ type: 'png', scale: 'device', fullPage: false });
      } catch (err) {
        const text = errorText(err);
        const noFrameYet = NO_COMPOSITOR_FRAME.test(text);
        if (noFrameYet && !timedOut && Date.now() + retryMs < deadline) {
          await new Promise((r) => setTimeout(r, retryMs));
          if (timedOut) throw err;
          continue;
        }
        throw new WrapperTransportError('SCREENSHOT_FAILED', `screenshot failed: ${text}`, {
          retryable: noFrameYet,
          cause: err,
        });
      }
      try {
        pngDimensions(png);
      } catch (err) {
        throw new WrapperTransportError(
          'SCREENSHOT_FAILED',
          `the screenshot is unreadable: ${errorText(err)}`,
          { cause: err }
        );
      }
      return { screenshot: toBase64(png), width: metrics.innerWidth, height: metrics.innerHeight };
    }
  };

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(
        new WrapperTransportError(
          'SCREENSHOT_TIMEOUT',
          `screenshot did not complete within ${timeoutMs}ms`,
          { retryable: true }
        )
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([attempt(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Register a {@link SCREENSHOT_ACTION} handler that captures `page` — the
 * page-backed counterpart of inject-cli's `registerFrameCapture`, reusable by
 * any transport that owns a page. The caller that advertises
 * {@link SCREENSHOT_CAPABILITY} must call this (the live transport does both
 * from `LiveTransportOptions.screenshotPage`).
 */
export function registerScreenshotCapture(
  registrar: ScreenshotRegistrar,
  page: FramePage,
  options: ScreenshotCaptureOptions = {}
): void {
  registrar.register(SCREENSHOT_ACTION, () => captureScreenshotReply(page, options));
}
