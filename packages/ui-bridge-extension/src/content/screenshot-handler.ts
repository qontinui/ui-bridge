/**
 * The live relay's `getScreenshot` handler (plan
 * 2026-11-21-vision-capture-cannot-frame-a-websocket-transport-app, Phase 4).
 *
 * The runner relays `getScreenshot` over the tab's socket only because the
 * relay advertises the `screenshot` capability (see `live-relay.ts`). The
 * content script cannot capture pixels itself, so it asks the service worker
 * (`CAPTURE_VISIBLE_TAB`), which captures with `chrome.tabs.captureVisibleTab`.
 *
 * Refusals are thrown as the wrapper's `WrapperTransportError` so their code
 * reaches the runner: a plain `throw` is rewrapped `HANDLER_ERROR` by the
 * wrapper's handler registry, losing it.
 */

import {
  CAPTURE_FAILURE_CODES,
  type CaptureFailureCode,
  type ExtensionMessage,
} from '../shared/messages';

/** The action and capability strings — one constant on each side of the wire. */
export const SCREENSHOT_ACTION = 'getScreenshot';
export const SCREENSHOT_CAPABILITY = 'screenshot';

/** The wrapper's `WrapperTransportError` constructor, as the relay loads it. */
export type WrapperTransportErrorCtor = new (
  code: string,
  message: string,
  options?: { retryable?: boolean; cause?: unknown }
) => Error;

export interface ScreenshotHandlerDeps {
  WrapperTransportError: WrapperTransportErrorCtor;
  doc: { readonly visibilityState: DocumentVisibilityState };
  win: { readonly innerWidth: number; readonly innerHeight: number };
  sendMessage: (message: ExtensionMessage) => Promise<unknown>;
}

/** The `getScreenshot` reply: the native provider's shape (CSS-pixel size). */
export interface ScreenshotReply {
  screenshot: string;
  width: number;
  height: number;
}

/** A `CAPTURE_VISIBLE_TAB` reply, read defensively: the service worker is another context. */
type ReadReply =
  | { ok: true; screenshot: string }
  | { ok: false; code: CaptureFailureCode; error: string; retryable: boolean };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Validate the reply's shape. A success must carry `data.screenshot` as a
 * string; a failure's `code` must be a known literal — absent or unknown, it
 * is the typed fallback `CAPTURE_FAILED`, never an undefined code. Anything
 * else is an unreadable reply (`CAPTURE_FAILED`).
 */
export function readCaptureReply(v: unknown): ReadReply {
  const unreadable = (why: string): ReadReply => ({
    ok: false,
    code: 'CAPTURE_FAILED',
    error: `the extension service worker answered CAPTURE_VISIBLE_TAB with an unreadable reply (${why})`,
    retryable: false,
  });
  if (!isRecord(v) || typeof v['success'] !== 'boolean') return unreadable('no boolean `success`');
  if (v['success']) {
    const data = v['data'];
    if (!isRecord(data) || typeof data['screenshot'] !== 'string') {
      return unreadable('success without a string `data.screenshot`');
    }
    return { ok: true, screenshot: data['screenshot'] };
  }
  const raw = v['code'];
  const known = (CAPTURE_FAILURE_CODES as readonly unknown[]).includes(raw);
  const code: CaptureFailureCode = known ? (raw as CaptureFailureCode) : 'CAPTURE_FAILED';
  const text = typeof v['error'] === 'string' ? v['error'] : 'CAPTURE_VISIBLE_TAB failed';
  const error =
    raw === undefined || known ? text : `${text} (unrecognised code ${JSON.stringify(raw)})`;
  const retryable =
    typeof v['retryable'] === 'boolean'
      ? v['retryable']
      : code === 'TAB_NOT_VISIBLE' || code === 'CAPTURE_RATE_LIMITED';
  return { ok: false, code, error, retryable };
}

export function createScreenshotHandler(
  deps: ScreenshotHandlerDeps
): () => Promise<ScreenshotReply> {
  const { WrapperTransportError, doc, win, sendMessage } = deps;
  return async () => {
    // A hidden tab is not what captureVisibleTab would capture — refuse rather
    // than return another tab's pixels. Checked before any message is sent.
    if (doc.visibilityState !== 'visible') {
      throw new WrapperTransportError(
        'TAB_NOT_VISIBLE',
        `the tab is ${doc.visibilityState}; only the visible tab of a window can be captured`,
        { retryable: true }
      );
    }
    let response: unknown;
    try {
      response = await sendMessage({ type: 'CAPTURE_VISIBLE_TAB' });
    } catch (err) {
      throw new WrapperTransportError(
        'CAPTURE_FAILED',
        `the extension service worker did not answer CAPTURE_VISIBLE_TAB: ${err instanceof Error ? err.message : String(err)}`,
        { retryable: true, cause: err }
      );
    }
    const reply = readCaptureReply(response);
    if (!reply.ok) {
      throw new WrapperTransportError(reply.code, reply.error, { retryable: reply.retryable });
    }
    return {
      screenshot: reply.screenshot,
      width: win.innerWidth,
      height: win.innerHeight,
    };
  };
}
