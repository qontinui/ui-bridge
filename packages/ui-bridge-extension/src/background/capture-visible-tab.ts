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
 * PERMISSION — PENDING A PROBE. `manifest.json` grants
 * `"host_permissions": ["<all_urls>"]`. That grant follows Chrome's
 * `tabs.captureVisibleTab` documentation, which names `<all_urls>` (or
 * `activeTab`, granted only on a user gesture) as what allows a capture; a
 * per-scheme pattern such as `https://*\/*` is not listed as sufficient. The
 * plan's D6 falsification probe — a headed Chromium, `captureVisibleTab` on an
 * opted-in `https://` tab with no gesture under `https://*\/*` alone — has NOT
 * been run. Until it is, `<all_urls>` stands on the documentation alone. If the
 * probe shows the narrower grant suffices, replace it with
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
 * (about two calls a second per extension) allows: a later call succeeds.
 */
const CAPTURE_QUOTA = /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/;

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
      retryable: false,
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
