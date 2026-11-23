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
 * PERMISSION — `<all_urls>` IS REQUIRED (D6 probe, run 2026-11-23).
 * `manifest.json` grants `"host_permissions": ["<all_urls>"]`, and that grant
 * is load-bearing. Chrome's own `chrome.tabs` page disagrees with itself about
 * what a no-gesture capture needs (the `captureVisibleTab` method reference
 * names `<all_urls>` or `activeTab`; its "Host permissions" section says host
 * permissions allow `captureVisibleTab`), so plan
 * 2026-11-22-vision-capture-websocket-follow-ups Phase 4 ran the D6 probe in a
 * headed Chromium 147.0.7727.15: a service-worker `captureVisibleTab` with no
 * user gesture, on an https tab and on an http 127.0.0.1 tab.
 *   - Under `["<all_urls>"]`: both captured a PNG frame.
 *   - Under `["https://*\/*", "http://localhost:*\/*", "http://127.0.0.1:*\/*"]`
 *     (the content scripts' match set): both were refused with "Either the
 *     '<all_urls>' or 'activeTab' permission is required."
 * That matches the source reading: Chromium's
 * `PermissionsData::CanCaptureVisiblePage` sets `has_all_urls` only when a
 * granted pattern's `match_all_urls()` is true, and otherwise refuses with
 * `kAllURLOrActiveTabNeeded` unless an active-tab grant exists. Do not narrow
 * the grant; tests/live-relay-screenshot.test.ts holds it to `<all_urls>`.
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
 * Refusals that the same request cannot outgrow. Each pattern matches one
 * FAMILY of Chromium refusals (extensions/common/manifest_constants.h and
 * permissions_data.cc); the comment beside each names the constants it covers.
 * The table test in tests/live-relay-screenshot.test.ts holds each row to
 * exactly one pattern, and a negative table holds Chrome's transient capture
 * failures to none.
 *
 * Under the `<all_urls>` grant, a page captureVisibleTab will never read (a
 * chrome:// page, another extension's chrome-extension:// page, a data: URL,
 * the Web Store) is refused by PermissionsData::CanCaptureVisiblePage with
 * kActiveTabPermissionNotGranted, which the second pattern catches. The
 * chrome:// / extension-URL and gallery patterns are reached by this API only
 * rarely (kCannotAccessChromeUrl via chrome://feedback) and are kept as a
 * guard. Every other captureVisibleTab refusal is treated as retryable (a
 * window mid-transition, a view not yet painted), since retrying costs one
 * request.
 */
export const CAPTURE_FINAL_PATTERNS: readonly RegExp[] = [
  // kAllURLOrActiveTabNeeded (also kPageCaptureNeeded)
  /permission is required/i,
  // kActiveTabPermissionNotGranted
  /'activeTab' permission is not in effect/i,
  // kCannotAccessPage / kCannotAccessPageWithUrl
  /Cannot access contents of/i,
  // kCannotScriptGallery, kCannotScriptNtp, kPolicyBlockedScripting
  /cannot be scripted/i,
  // kCannotAccessChromeUrl / kCannotAccessExtensionUrl
  /Cannot access a [a-z-]+:\/\/ URL/i,
  // kErrorBlocked: the user blocked the extension on this site
  /^Blocked$/,
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
