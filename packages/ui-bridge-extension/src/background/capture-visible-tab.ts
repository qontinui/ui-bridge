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
 * PERMISSION. Without a user gesture (`activeTab` is granted only on one),
 * Chrome's `tabs.captureVisibleTab` documentation names the `<all_urls>` host
 * permission as what allows the capture; a per-scheme pattern such as
 * `https://*\/*` is not listed as sufficient. `manifest.json` therefore grants
 * `"host_permissions": ["<all_urls>"]`. The plan's falsification probe (a
 * headed Chromium, `captureVisibleTab` on an opted-in `https://` tab with no
 * gesture under `https://*\/*` alone) has NOT been run yet: if it shows the
 * narrower grant suffices, replace `<all_urls>` with
 * `["http://localhost:*\/*", "http://127.0.0.1:*\/*", "https://*\/*"]`
 * (the content scripts' match set) — the narrowest grant the probe proves.
 */

import type { CaptureVisibleTabResponse } from '../shared/messages';

/** The slice of `chrome.tabs` this needs; injectable for tests. */
export interface TabsCaptureApi {
  query(queryInfo: { active: boolean; windowId: number }): Promise<Array<{ id?: number }>>;
  captureVisibleTab(windowId: number, options: { format: 'png' }): Promise<string>;
}

const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';

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
    };
  }
  const windowId = tab.windowId;

  let active: { id?: number } | undefined;
  try {
    [active] = await tabs.query({ active: true, windowId });
  } catch (err) {
    return {
      success: false,
      code: 'CAPTURE_FAILED',
      error: `could not read the active tab of window ${windowId}: ${errorText(err)}`,
    };
  }
  if (!active || active.id !== tab.id) {
    return {
      success: false,
      code: 'TAB_NOT_VISIBLE',
      error: `tab ${tab.id} is not the active tab of window ${windowId}, so it is not the tab captureVisibleTab would capture`,
    };
  }

  let dataUrl: string;
  try {
    dataUrl = await tabs.captureVisibleTab(windowId, { format: 'png' });
  } catch (err) {
    return {
      success: false,
      code: 'CAPTURE_FAILED',
      error: `captureVisibleTab failed: ${errorText(err)}`,
    };
  }
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
    return {
      success: false,
      code: 'CAPTURE_FAILED',
      error: 'captureVisibleTab did not return a PNG data URL',
    };
  }
  return { success: true, data: { screenshot: dataUrl.slice(PNG_DATA_URL_PREFIX.length) } };
}
