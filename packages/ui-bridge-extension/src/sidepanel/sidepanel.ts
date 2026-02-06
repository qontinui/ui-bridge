import type {
  ExtensionMessage,
  ElementsResponse,
  CoverageResponse,
  ContentResponse,
} from '../shared/messages';
import type { ElementSummary, CoverageStats } from '../shared/types';

/** DOM element references */
const coverageFill = document.getElementById('coverage-fill') as HTMLDivElement;
const coverageText = document.getElementById('coverage-text') as HTMLSpanElement;
const filterStatus = document.getElementById('filter-status') as HTMLSelectElement;
const filterSearch = document.getElementById('filter-search') as HTMLInputElement;
const elementList = document.getElementById('element-list') as HTMLDivElement;
const btnRefresh = document.getElementById('btn-refresh') as HTMLButtonElement;
const btnExport = document.getElementById('btn-export') as HTMLButtonElement;
const btnImport = document.getElementById('btn-import') as HTMLButtonElement;

/** Current state */
let allElements: ElementSummary[] = [];

/** Send a message to the service worker */
function sendMessage(message: ExtensionMessage): Promise<unknown> {
  return chrome.runtime.sendMessage(message);
}

/** Fetch elements from the content script via background */
async function fetchElements(): Promise<void> {
  try {
    const response = (await sendMessage({ type: 'GET_ELEMENTS' })) as
      | (ContentResponse & { data?: ElementsResponse })
      | null;

    if (response && 'success' in response && response.success && response.data) {
      const data = response.data as ElementsResponse;
      allElements = data.elements ?? [];
    } else {
      allElements = [];
    }
  } catch {
    allElements = [];
  }
  renderElements();
}

/** Fetch coverage stats from the content script via background */
async function fetchCoverage(): Promise<void> {
  try {
    const response = (await sendMessage({ type: 'GET_COVERAGE' })) as
      | (ContentResponse & { data?: CoverageResponse })
      | null;

    if (response && 'success' in response && response.success && response.data) {
      const data = response.data as CoverageResponse;
      updateCoverageBar(data.coverage);
    } else {
      updateCoverageBar({ total: 0, annotated: 0, percent: 0 });
    }
  } catch {
    updateCoverageBar({ total: 0, annotated: 0, percent: 0 });
  }
}

/** Update the coverage bar UI */
function updateCoverageBar(coverage: CoverageStats): void {
  const percent = Math.round(coverage.percent);
  coverageFill.style.width = `${percent}%`;
  coverageText.textContent = `${percent}% annotated (${coverage.annotated}/${coverage.total})`;
}

/** Get filtered elements based on current filter state */
function getFilteredElements(): ElementSummary[] {
  const statusFilter = filterStatus.value;
  const searchTerm = filterSearch.value.toLowerCase().trim();

  return allElements.filter((el) => {
    // Status filter
    if (statusFilter === 'annotated' && !el.hasAnnotation) return false;
    if (statusFilter === 'unannotated' && el.hasAnnotation) return false;

    // Search filter
    if (searchTerm) {
      const matchesId = el.id.toLowerCase().includes(searchTerm);
      const matchesType = el.type.toLowerCase().includes(searchTerm);
      const matchesLabel = el.label?.toLowerCase().includes(searchTerm) ?? false;
      if (!matchesId && !matchesType && !matchesLabel) return false;
    }

    return true;
  });
}

/** Render the element list */
function renderElements(): void {
  const filtered = getFilteredElements();
  elementList.innerHTML = '';

  if (filtered.length === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.style.textAlign = 'center';
    emptyEl.style.color = '#9ca3af';
    emptyEl.style.padding = '24px';
    emptyEl.style.fontSize = '13px';
    emptyEl.textContent =
      allElements.length === 0
        ? 'No elements detected. Is the content script active?'
        : 'No elements match the current filters.';
    elementList.appendChild(emptyEl);
    return;
  }

  for (const el of filtered) {
    const item = document.createElement('div');
    item.className = `element-item ${el.hasAnnotation ? 'annotated' : 'unannotated'}`;
    item.addEventListener('click', () => onElementClick(el.id));

    const infoDiv = document.createElement('div');

    const idSpan = document.createElement('div');
    idSpan.className = 'element-id';
    idSpan.textContent = el.label ?? el.id;
    infoDiv.appendChild(idSpan);

    const typeSpan = document.createElement('div');
    typeSpan.className = 'element-type';
    typeSpan.textContent = el.type;
    infoDiv.appendChild(typeSpan);

    const badge = document.createElement('span');
    badge.className = `element-badge ${el.hasAnnotation ? 'has-annotation' : 'no-annotation'}`;
    badge.textContent = el.hasAnnotation ? 'Annotated' : 'Needs annotation';

    item.appendChild(infoDiv);
    item.appendChild(badge);
    elementList.appendChild(item);
  }
}

/** Handle clicking on an element in the list */
function onElementClick(elementId: string): void {
  sendMessage({ type: 'HIGHLIGHT_ELEMENT', elementId });
}

/** Handle export button: download annotations as JSON */
async function onExport(): Promise<void> {
  try {
    const response = (await sendMessage({ type: 'EXPORT_ANNOTATIONS' })) as
      | (ContentResponse & { data?: unknown })
      | null;

    if (response && 'success' in response && response.success && response.data) {
      const json = JSON.stringify(response.data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `ui-bridge-annotations-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    console.error('Export failed:', err);
  }
}

/** Handle import button: open file picker and import JSON */
function onImport(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const config = JSON.parse(text);

      await sendMessage({ type: 'IMPORT_ANNOTATIONS', config });

      // Refresh after import
      await refresh();
    } catch (err) {
      console.error('Import failed:', err);
    }
  });

  input.click();
}

/** Refresh all data */
async function refresh(): Promise<void> {
  await Promise.all([fetchElements(), fetchCoverage()]);
}

/** Initialize the side panel */
function init(): void {
  // Fetch initial data
  refresh();

  // Event listeners
  btnRefresh.addEventListener('click', () => refresh());
  btnExport.addEventListener('click', onExport);
  btnImport.addEventListener('click', onImport);

  filterStatus.addEventListener('change', renderElements);
  filterSearch.addEventListener('input', renderElements);
}

// Start on load
init();

export {};
