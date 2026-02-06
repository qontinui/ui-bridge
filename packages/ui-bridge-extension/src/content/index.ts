import { DEFAULT_SERVER_URL, STORAGE_KEYS } from '../shared/constants';
import type {
  ContentMessage,
  ContentResponse,
  StatusResponse,
  ElementsResponse,
  CoverageResponse,
} from '../shared/messages';
import type { ConnectionStatus } from '../shared/types';
import { BridgeClient } from './bridge-client';
import { Inspector } from './inspector';
import { Annotator } from './annotator';
import { INSPECTOR_STYLES } from './styles';

/**
 * Content script entry point.
 * Creates a shadow DOM host, initializes the bridge client, inspector,
 * and annotator, then listens for messages from the background script.
 */

// ── Setup shadow DOM host ──

const host = document.createElement('div');
host.id = 'ui-bridge-extension-host';
host.style.cssText =
  'position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none;';
document.documentElement.appendChild(host);

const shadow = host.attachShadow({ mode: 'closed' });

// Inject styles into shadow DOM
const styleEl = document.createElement('style');
styleEl.textContent = INSPECTOR_STYLES;
shadow.appendChild(styleEl);

// Re-enable pointer events on actual interactive elements inside the shadow
// (the host itself has pointer-events: none, but children need to be clickable)
const interactiveContainer = document.createElement('div');
interactiveContainer.style.cssText = 'pointer-events: auto;';
shadow.appendChild(interactiveContainer);

// ── State ──

let connectionStatus: ConnectionStatus = 'disconnected';
let serverUrl: string = DEFAULT_SERVER_URL;
let client: BridgeClient;
let inspector: Inspector;
let annotator: Annotator;

// ── Initialize ──

async function initialize(): Promise<void> {
  // Load server URL from storage
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.serverUrl);
    if (result[STORAGE_KEYS.serverUrl]) {
      serverUrl = result[STORAGE_KEYS.serverUrl];
    }
  } catch {
    // Use default URL
  }

  // Create client
  client = new BridgeClient(serverUrl);

  // Create annotator
  annotator = new Annotator(shadow, client);

  // Create inspector with click handler that opens the annotator
  inspector = new Inspector(shadow, client, (elementId: string) => {
    const el = document.querySelector(`[data-ui-id="${CSS.escape(elementId)}"]`);
    if (el) {
      const rect = el.getBoundingClientRect();
      annotator.open(elementId, rect);
    }
  });

  // Wire up annotator save callback to refresh inspector markers
  annotator.setOnAfterSave(() => {
    inspector.refreshAfterAnnotation();
  });

  // Detect server
  connectionStatus = 'connecting';
  try {
    const detected = await client.detectServer();
    connectionStatus = detected ? 'connected' : 'disconnected';
  } catch {
    connectionStatus = 'error';
  }
}

// ── Message handler ──

chrome.runtime.onMessage.addListener(
  (
    message: ContentMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: ContentResponse) => void
  ) => {
    handleMessage(message)
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) =>
        sendResponse({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        })
      );

    // Return true to indicate async response
    return true;
  }
);

async function handleMessage(message: ContentMessage): Promise<unknown> {
  // Ensure initialized
  if (!client) {
    await initialize();
  }

  switch (message.type) {
    case 'TOGGLE_INSPECTOR': {
      inspector.toggle();
      return { inspectorActive: inspector.isActive };
    }

    case 'GET_STATUS': {
      // Re-check connection if disconnected
      if (connectionStatus === 'disconnected' || connectionStatus === 'error') {
        connectionStatus = 'connecting';
        try {
          const detected = await client.detectServer();
          connectionStatus = detected ? 'connected' : 'disconnected';
        } catch {
          connectionStatus = 'error';
        }
      }

      let elementCount = 0;
      let annotationCount = 0;

      if (connectionStatus === 'connected') {
        try {
          const elements = await client.getElements();
          elementCount = elements.length;
          annotationCount = elements.filter((e) => e.hasAnnotation).length;
        } catch {
          // Counts remain 0
        }
      }

      const status: StatusResponse = {
        connection: connectionStatus,
        serverUrl,
        inspectorActive: inspector?.isActive || false,
        elementCount,
        annotationCount,
      };

      return status;
    }

    case 'GET_ELEMENTS': {
      const elements = await client.getElements();
      const response: ElementsResponse = { elements };
      return response;
    }

    case 'GET_ANNOTATION': {
      const annotation = await client.getAnnotation(message.elementId);
      return annotation;
    }

    case 'SET_ANNOTATION': {
      const result = await client.setAnnotation(message.elementId, message.annotation);
      // Refresh inspector markers after setting annotation
      if (inspector?.isActive) {
        inspector.refreshAfterAnnotation();
      }
      return result;
    }

    case 'DELETE_ANNOTATION': {
      await client.deleteAnnotation(message.elementId);
      // Refresh inspector markers after deleting annotation
      if (inspector?.isActive) {
        inspector.refreshAfterAnnotation();
      }
      return null;
    }

    case 'GET_COVERAGE': {
      const coverage = await client.getCoverage();
      const response: CoverageResponse = { coverage };
      return response;
    }

    case 'EXPORT_ANNOTATIONS': {
      return await client.exportAnnotations();
    }

    case 'IMPORT_ANNOTATIONS': {
      return await client.importAnnotations(message.config);
    }

    case 'HIGHLIGHT_ELEMENT': {
      const el = document.querySelector(
        `[data-ui-id="${CSS.escape(message.elementId)}"]`
      ) as HTMLElement | null;

      if (!el) {
        throw new Error(`Element not found: ${message.elementId}`);
      }

      // Scroll to element
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Use inspector's highlight method
      inspector.highlightElement(message.elementId);

      return null;
    }

    default: {
      const _exhaustive: never = message;
      throw new Error(`Unknown message type: ${(message as { type: string }).type}`);
    }
  }
}

// ── Listen for storage changes (server URL updates) ──

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORAGE_KEYS.serverUrl]) {
    const newUrl = changes[STORAGE_KEYS.serverUrl].newValue;
    if (newUrl && newUrl !== serverUrl) {
      serverUrl = newUrl;
      client.setServerUrl(newUrl);
      connectionStatus = 'disconnected'; // Will re-check on next GET_STATUS
    }
  }
});

// ── Start initialization ──

initialize()
  .then(() => {
    // Notify the background script that this tab has a content script
    chrome.runtime.sendMessage({ type: 'CONTENT_SCRIPT_READY' }).catch(() => {
      // Background may not be listening yet, that's fine
    });
  })
  .catch((err) => {
    console.error('[UI Bridge] Content script initialization failed:', err);
    connectionStatus = 'error';
  });
