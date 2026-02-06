import type { ExtensionMessage, StatusResponse } from '../shared/messages';
import { STORAGE_KEYS, DEFAULT_SERVER_URL } from '../shared/constants';

/** DOM element references */
const statusDot = document.getElementById('status-dot') as HTMLSpanElement;
const serverUrlInput = document.getElementById('server-url') as HTMLInputElement;
const elementCountEl = document.getElementById('element-count') as HTMLSpanElement;
const annotationCountEl = document.getElementById('annotation-count') as HTMLSpanElement;
const btnInspector = document.getElementById('btn-inspector') as HTMLButtonElement;
const btnSidePanel = document.getElementById('btn-sidepanel') as HTMLButtonElement;

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

/** Initialize popup */
document.addEventListener('DOMContentLoaded', () => {
  loadServerUrl();
  refreshStatus();

  serverUrlInput.addEventListener('input', onServerUrlChange);
  btnInspector.addEventListener('click', onToggleInspector);
  btnSidePanel.addEventListener('click', onOpenSidePanel);
});

export {};
