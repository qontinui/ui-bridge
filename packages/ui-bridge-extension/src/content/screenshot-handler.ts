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

import type { CaptureVisibleTabResponse, ExtensionMessage } from '../shared/messages';

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

function isCaptureResponse(v: unknown): v is CaptureVisibleTabResponse {
  return (
    typeof v === 'object' && v !== null && typeof (v as { success?: unknown }).success === 'boolean'
  );
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
    if (!isCaptureResponse(response)) {
      throw new WrapperTransportError(
        'CAPTURE_FAILED',
        'the extension service worker answered CAPTURE_VISIBLE_TAB with an unreadable reply'
      );
    }
    if (!response.success) {
      throw new WrapperTransportError(response.code, response.error, {
        retryable: response.code === 'TAB_NOT_VISIBLE',
      });
    }
    return {
      screenshot: response.data.screenshot,
      width: win.innerWidth,
      height: win.innerHeight,
    };
  };
}
