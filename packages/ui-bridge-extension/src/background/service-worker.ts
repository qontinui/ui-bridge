import type { ExtensionMessage, ContentMessage } from '../shared/messages';
import { SHORTCUTS, STORAGE_KEYS } from '../shared/constants';

/** Track which tabs have content scripts injected */
const activeTabs = new Set<number>();

/**
 * Forward a message to the active tab's content script.
 * Returns the content script's response or an error.
 */
async function forwardToContentScript(message: ContentMessage, tabId?: number): Promise<unknown> {
  const targetTabId = tabId ?? (await getActiveTabId());
  if (targetTabId === undefined) {
    return { success: false, error: 'No active tab found' };
  }

  if (!activeTabs.has(targetTabId)) {
    return { success: false, error: 'Content script not active in this tab' };
  }

  try {
    const response = await chrome.tabs.sendMessage(targetTabId, message);
    return response;
  } catch (err) {
    activeTabs.delete(targetTabId);
    return {
      success: false,
      error: `Failed to communicate with content script: ${err}`,
    };
  }
}

/** Get the active tab ID in the current window */
async function getActiveTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

/**
 * Main message listener.
 * Handles messages from popup and sidepanel, forwarding most to the content script.
 */
chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ): boolean => {
    // If message is from a content script, track the tab as active
    if (sender.tab?.id !== undefined) {
      activeTabs.add(sender.tab.id);
    }

    handleMessage(message, sender)
      .then(sendResponse)
      .catch((err) => {
        sendResponse({ success: false, error: String(err) });
      });

    // Return true to indicate async response
    return true;
  }
);

/** Route and handle an extension message */
async function handleMessage(
  message: ExtensionMessage,
  _sender: chrome.runtime.MessageSender
): Promise<unknown> {
  switch (message.type) {
    case 'OPEN_SIDE_PANEL': {
      const tabId = await getActiveTabId();
      if (tabId !== undefined) {
        await chrome.sidePanel.open({ tabId });
      }
      return { success: true };
    }

    case 'TOGGLE_INSPECTOR': {
      return forwardToContentScript({ type: 'TOGGLE_INSPECTOR' });
    }

    case 'GET_STATUS': {
      return forwardToContentScript({ type: 'GET_STATUS' });
    }

    case 'GET_ELEMENTS': {
      return forwardToContentScript({ type: 'GET_ELEMENTS' });
    }

    case 'GET_ANNOTATION': {
      return forwardToContentScript({
        type: 'GET_ANNOTATION',
        elementId: message.elementId,
      });
    }

    case 'SET_ANNOTATION': {
      return forwardToContentScript({
        type: 'SET_ANNOTATION',
        elementId: message.elementId,
        annotation: message.annotation,
      });
    }

    case 'DELETE_ANNOTATION': {
      return forwardToContentScript({
        type: 'DELETE_ANNOTATION',
        elementId: message.elementId,
      });
    }

    case 'GET_COVERAGE': {
      return forwardToContentScript({ type: 'GET_COVERAGE' });
    }

    case 'EXPORT_ANNOTATIONS': {
      return forwardToContentScript({ type: 'EXPORT_ANNOTATIONS' });
    }

    case 'IMPORT_ANNOTATIONS': {
      return forwardToContentScript({
        type: 'IMPORT_ANNOTATIONS',
        config: message.config,
      });
    }

    case 'HIGHLIGHT_ELEMENT': {
      return forwardToContentScript({
        type: 'HIGHLIGHT_ELEMENT',
        elementId: message.elementId,
      });
    }

    case 'SET_SERVER_URL': {
      await chrome.storage.local.set({ [STORAGE_KEYS.serverUrl]: message.url });
      return { success: true };
    }

    default: {
      return {
        success: false,
        error: `Unknown message type: ${(message as { type: string }).type}`,
      };
    }
  }
}

/**
 * Keyboard shortcut handler.
 * Listens for the 'toggle-inspector' command defined in the manifest.
 */
chrome.commands.onCommand.addListener(async (command: string) => {
  if (command === SHORTCUTS.toggleInspector) {
    await forwardToContentScript({ type: 'TOGGLE_INSPECTOR' });
  }
});

/**
 * Track tab removal to clean up active tabs set.
 */
chrome.tabs.onRemoved.addListener((tabId: number) => {
  activeTabs.delete(tabId);
});

/**
 * Track tab navigation to reset content script tracking.
 */
chrome.tabs.onUpdated.addListener((tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
  if (changeInfo.status === 'loading') {
    activeTabs.delete(tabId);
  }
});

export {};
