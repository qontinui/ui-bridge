/**
 * `CAPTURE_VISIBLE_TAB` — the service-worker half of the live relay's
 * `getScreenshot` (plan
 * 2026-11-21-vision-capture-cannot-frame-a-websocket-transport-app, Phase 4).
 *
 * `chrome.tabs.captureVisibleTab` runs only here, and captures whatever tab is
 * VISIBLE in a window — not necessarily the one that asked. So before it
 * captures, this checks that the sender's tab is the active tab of its own
 * window; otherwise it answers `TAB_NOT_VISIBLE` rather than handing one tab's
 * pixels to another tab's capture request.
 *
 * The active-tab check runs TWICE, before and after the capture: the two are
 * separated by awaits, so the user can switch tabs in between, and a frame
 * taken after a switch shows another tab. A frame whose window no longer has
 * the sender as its active tab is discarded and answered `TAB_NOT_VISIBLE`.
 *
 * RESIDUAL WINDOW (A->B->A). Two reads bracket the capture; they cannot see
 * what happened between them. If the user switches from the sender's tab A to
 * tab B and back to A while captureVisibleTab is running, both reads see A
 * active and the frame — which may show B — is returned as A's. Chrome offers
 * no capture-by-tab-id that would close this. The window is the time between
 * the two `tabs.query` reads (the capture itself sits between them), and an
 * undetected wrong frame needs two tab switches inside it.
 *
 * PERMISSION — PENDING A PROBE. `manifest.json` grants
 * `"host_permissions": ["<all_urls>"]`. Chrome's own `chrome.tabs` page
 * disagrees with itself about what a no-gesture capture needs: the
 * `captureVisibleTab` method reference names `<all_urls>` or `activeTab`
 * (granted only on a user gesture), while the page's "Host permissions"
 * section says host permissions allow `captureVisibleTab`, with an
 * http/https pattern as its example. Because the documentation does not
 * settle it, the plan's D6 falsification probe decides — a headed Chromium,
 * `captureVisibleTab` on an opted-in `https://` tab with no gesture under
 * `https://*\/*` alone — and it has NOT been run. Until it is, `<all_urls>`
 * (the grant both readings accept) stands. If the probe shows the narrower
 * grant suffices, replace it with
 * `["http://localhost:*\/*", "http://127.0.0.1:*\/*", "https://*\/*"]` (the
 * content scripts' match set); tests/live-relay-screenshot.test.ts asserts the
 * property (https origins and http localhost are covered), not the literal.
 */

import type { CaptureVisibleTabResponse } from '../shared/messages';

/** The slice of `chrome.tabs` this needs; injectable for tests. */
export interface TabsCaptureApi {
  query(queryInfo: { active: boolean; windowId: number }): Promise<Array<{ id?: number }>>;
  captureVisibleTab(windowId: number, options: { format: 'png' }): Promise<string>;
}

const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';

/**
 * Chrome's refusal when captureVisibleTab is called more often than its quota
 * (Chrome documents two calls a second) allows: a later call succeeds.
 */
const CAPTURE_QUOTA = /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/;

/**
 * Refusals that the same request cannot outgrow: a missing permission, or a
 * page Chrome will never let an extension read (chrome://, the Web Store).
 * Every other captureVisibleTab refusal is treated as retryable — a window
 * mid-transition, a tab still loading — since retrying costs one request.
 */
export const CAPTURE_FINAL_PATTERNS: readonly RegExp[] = [
  /permission is required/i, // "Either the '<all_urls>' or 'activeTab' permission is required."
  /Cannot access contents of/i, // "Cannot access contents of url "…". Extension manifest must request permission…"
  /cannot be scripted/i, // "The extensions gallery cannot be scripted."
  /chrome:\/\//i, // "Cannot access a chrome:// URL"
  /extensions gallery/i, // the Web Store, in its own wording
  /Cannot access a /i, // "Cannot access a chrome-extension:// URL of different extension"
];

function isFinalRefusal(text: string): boolean {
  return CAPTURE_FINAL_PATTERNS.some((p) => p.test(text));
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Capture the sender's tab, refusing unless it is the active tab of its window. */
export async function captureSenderTab(
  sender: { tab?: { id?: number; windowId?: number } },
  tabs: TabsCaptureApi = chrome.tabs as unknown as TabsCaptureApi
): Promise<CaptureVisibleTabResponse> {
  const tab = sender.tab;
  if (!tab || tab.id === undefined || tab.windowId === undefined) {
    return {
      success: false,
      code: 'TAB_NOT_VISIBLE',
      error: 'CAPTURE_VISIBLE_TAB must come from a tab; the sender carries no tab',
      retryable: false,
    };
  }
  const windowId = tab.windowId;

  const notActive = (when: string): CaptureVisibleTabResponse => ({
    success: false,
    code: 'TAB_NOT_VISIBLE',
    error: `tab ${tab.id} is not the active tab of window ${windowId} ${when}, so it is not the tab captureVisibleTab would capture`,
    retryable: true,
  });
  const activeIsSender = async (): Promise<boolean | string> => {
    try {
      const [active] = await tabs.query({ active: true, windowId });
      return active?.id === tab.id;
    } catch (err) {
      return `could not read the active tab of window ${windowId}: ${errorText(err)}`;
    }
  };

  const before = await activeIsSender();
  if (typeof before === 'string') {
    return { success: false, code: 'CAPTURE_FAILED', error: before, retryable: true };
  }
  if (!before) return notActive('before the capture');

  let dataUrl: string;
  try {
    dataUrl = await tabs.captureVisibleTab(windowId, { format: 'png' });
  } catch (err) {
    const text = errorText(err);
    if (CAPTURE_QUOTA.test(text)) {
      return {
        success: false,
        code: 'CAPTURE_RATE_LIMITED',
        error: `captureVisibleTab refused by Chrome's per-second quota: ${text}`,
        retryable: true,
      };
    }
    return {
      success: false,
      code: 'CAPTURE_FAILED',
      error: `captureVisibleTab failed: ${text}`,
      retryable: !isFinalRefusal(text),
    };
  }

  // The tab may have been switched while the capture ran: the frame then shows
  // whichever tab became active, so it is discarded, never returned.
  const after = await activeIsSender();
  if (typeof after === 'string') {
    return {
      success: false,
      code: 'CAPTURE_FAILED',
      error: `${after}; the frame was discarded because its tab could not be confirmed`,
      retryable: true,
    };
  }
  if (!after) return notActive('after the capture (the tab was switched; the frame was discarded)');

  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
    return {
      success: false,
      code: 'CAPTURE_FAILED',
      error: 'captureVisibleTab did not return a PNG data URL',
      retryable: false,
    };
  }
  return { success: true, data: { screenshot: dataUrl.slice(PNG_DATA_URL_PREFIX.length) } };
}
