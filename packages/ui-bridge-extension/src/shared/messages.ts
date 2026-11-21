/**
 * Message protocol for communication between extension components.
 *
 * Flow: Popup/SidePanel -> chrome.runtime.sendMessage -> Service Worker
 *       -> chrome.tabs.sendMessage -> Content Script -> HTTP -> UI Bridge Server
 */

import type { Annotation, ConnectionStatus, ElementSummary, CoverageStats } from './types';

// Messages from popup/sidepanel to background
export type ExtensionMessage =
  | { type: 'GET_STATUS' }
  | { type: 'SET_SERVER_URL'; url: string }
  | { type: 'TOGGLE_INSPECTOR' }
  | { type: 'GET_ELEMENTS' }
  | { type: 'GET_ANNOTATION'; elementId: string }
  | { type: 'SET_ANNOTATION'; elementId: string; annotation: Annotation }
  | { type: 'DELETE_ANNOTATION'; elementId: string }
  | { type: 'GET_COVERAGE' }
  | { type: 'EXPORT_ANNOTATIONS' }
  | { type: 'IMPORT_ANNOTATIONS'; config: unknown }
  | { type: 'HIGHLIGHT_ELEMENT'; elementId: string }
  | { type: 'OPEN_SIDE_PANEL' }
  // From the live-relay content script: capture the sender's own tab, which
  // must be the visible (active) tab of its window. Answered with a
  // CaptureVisibleTabResponse.
  | { type: 'CAPTURE_VISIBLE_TAB' };

// Messages from background to content script
export type ContentMessage =
  | { type: 'TOGGLE_INSPECTOR' }
  | { type: 'GET_STATUS' }
  | { type: 'GET_ELEMENTS' }
  | { type: 'GET_ANNOTATION'; elementId: string }
  | { type: 'SET_ANNOTATION'; elementId: string; annotation: Annotation }
  | { type: 'DELETE_ANNOTATION'; elementId: string }
  | { type: 'GET_COVERAGE' }
  | { type: 'EXPORT_ANNOTATIONS' }
  | { type: 'IMPORT_ANNOTATIONS'; config: unknown }
  | { type: 'HIGHLIGHT_ELEMENT'; elementId: string };

// Responses from content script
export type ContentResponse = { success: true; data?: unknown } | { success: false; error: string };

/**
 * Answer to `CAPTURE_VISIBLE_TAB`. `screenshot` is the PNG base64 with the
 * data-URL prefix stripped. `code` is the typed reason the live relay forwards
 * to the runner: `TAB_NOT_VISIBLE` when the sender is not the active tab of its
 * window, `CAPTURE_FAILED` when Chrome refused the capture.
 */
export type CaptureVisibleTabResponse =
  | { success: true; data: { screenshot: string } }
  | { success: false; code: 'TAB_NOT_VISIBLE' | 'CAPTURE_FAILED'; error: string };

// Status response
export interface StatusResponse {
  connection: ConnectionStatus;
  serverUrl: string;
  inspectorActive: boolean;
  elementCount: number;
  annotationCount: number;
}

// Elements response
export interface ElementsResponse {
  elements: ElementSummary[];
}

// Coverage response
export interface CoverageResponse {
  coverage: CoverageStats;
}
