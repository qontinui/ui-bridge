import type { ExtensionMessage, StatusResponse } from '../shared/messages';
import {
  STORAGE_KEYS,
  DEFAULT_SERVER_URL,
  DEFAULT_LIVE_RELAY_RUNNER_URL,
} from '../shared/constants';

/** DOM element references */
const statusDot = document.getElementById('status-dot') as HTMLSpanElement;
const serverUrlInput = document.getElementById('server-url') as HTMLInputElement;
const elementCountEl = document.getElementById('element-count') as HTMLSpanElement;
const annotationCountEl = document.getElementById('annotation-count') as HTMLSpanElement;
const btnInspector = document.getElementById('btn-inspector') as HTMLButtonElement;
const btnSidePanel = document.getElementById('btn-sidepanel') as HTMLButtonElement;
const liveRelayCheckbox = document.getElementById('live-relay-enabled') as HTMLInputElement;
const liveRelayUrlInput = document.getElementById('live-relay-runner-url') as HTMLInputElement;

/** Send a message to the service worker */
function sendMessage(message: ExtensionMessage): Promise<unknown> {
  return chrome.runtime.sendMessage(message);
}

/** Update the status dot CSS class based on connection status */
function updateStatusDot(status: string): void {
  statusDot.className = 'status-dot';
  if (status === 'connected') {
    statusDot.classList.add('connected');
  } else if (status === 'connecting') {
    statusDot.classList.add('connecting');
  } else {
    statusDot.classList.add('disconnected');
  }
}

/** Fetch and display current status from the content script */
async function refreshStatus(): Promise<void> {
  try {
    const response = (await sendMessage({ type: 'GET_STATUS' })) as StatusResponse | null;
    if (response && 'connection' in response) {
      updateStatusDot(response.connection);
      elementCountEl.textContent = `${response.elementCount} elements`;
      annotationCountEl.textContent = `${response.annotationCount} annotations`;
    } else {
      updateStatusDot('disconnected');
      elementCountEl.textContent = '0 elements';
      annotationCountEl.textContent = '0 annotations';
    }
  } catch {
    updateStatusDot('disconnected');
  }
}

/** Load saved server URL from storage */
async function loadServerUrl(): Promise<void> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.serverUrl);
  const savedUrl = result[STORAGE_KEYS.serverUrl] as string | undefined;
  serverUrlInput.value = savedUrl ?? DEFAULT_SERVER_URL;
}

/** Save server URL to storage (debounced) */
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

function onServerUrlChange(): void {
  if (saveTimeout !== null) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => {
    const url = serverUrlInput.value.trim();
    if (url) {
      sendMessage({ type: 'SET_SERVER_URL', url });
    }
  }, 500);
}

/** Handle Toggle Inspector button click */
function onToggleInspector(): void {
  sendMessage({ type: 'TOGGLE_INSPECTOR' });
}

/** Handle Open Side Panel button click */
function onOpenSidePanel(): void {
  sendMessage({ type: 'OPEN_SIDE_PANEL' });
}

// ── Live wrapper relay ──────────────────────────────────────────────

/** Load saved relay enabled / runner URL into the popup form. */
async function loadLiveRelaySettings(): Promise<void> {
  const result = await chrome.storage.local.get([
    STORAGE_KEYS.liveRelayEnabled,
    STORAGE_KEYS.liveRelayRunnerUrl,
  ]);
  const enabled = result[STORAGE_KEYS.liveRelayEnabled] === true;
  const runnerUrl =
    (result[STORAGE_KEYS.liveRelayRunnerUrl] as string | undefined) ??
    DEFAULT_LIVE_RELAY_RUNNER_URL;
  liveRelayCheckbox.checked = enabled;
  liveRelayUrlInput.value = runnerUrl;
}

/**
 * Broadcast a `live-relay-toggle` message to every tab. Existing
 * annotator content scripts ignore this message; the new
 * `live-relay.js` content script reacts to it. Failures per-tab are
 * silently swallowed (some tabs lack content scripts — chrome:// pages,
 * the Web Store, etc.).
 */
async function broadcastLiveRelayToggle(enabled: boolean): Promise<void> {
  let tabs: chrome.tabs.Tab[];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'live-relay-toggle', enabled });
    } catch {
      // Tab has no listener; expected for restricted URLs and
      // tabs that haven't loaded the relay script yet.
    }
  }
}

async function onLiveRelayToggle(): Promise<void> {
  const enabled = liveRelayCheckbox.checked;
  await chrome.storage.local.set({ [STORAGE_KEYS.liveRelayEnabled]: enabled });
  await broadcastLiveRelayToggle(enabled);
}

let liveRelayUrlSaveTimer: ReturnType<typeof setTimeout> | null = null;

function onLiveRelayUrlChange(): void {
  if (liveRelayUrlSaveTimer !== null) {
    clearTimeout(liveRelayUrlSaveTimer);
  }
  liveRelayUrlSaveTimer = setTimeout(() => {
    const url = liveRelayUrlInput.value.trim();
    if (url) {
      void chrome.storage.local.set({ [STORAGE_KEYS.liveRelayRunnerUrl]: url });
    }
  }, 500);
}

/** Initialize popup */
document.addEventListener('DOMContentLoaded', () => {
  loadServerUrl();
  loadLiveRelaySettings();
  refreshStatus();

  serverUrlInput.addEventListener('input', onServerUrlChange);
  btnInspector.addEventListener('click', onToggleInspector);
  btnSidePanel.addEventListener('click', onOpenSidePanel);
  liveRelayCheckbox.addEventListener('change', () => {
    void onLiveRelayToggle();
  });
  liveRelayUrlInput.addEventListener('input', onLiveRelayUrlChange);
});

export {};
