/**
 * The debug inspector's own info-panel root marker.
 *
 * Lives in `core/` rather than `debug/` because the package's DOM observers
 * must recognise the panel without importing the React inspector. The panel
 * is the inspector's own UI, never page activity: its root's `pointer-events`
 * toggle around each state read (plan
 * `2026-11-23-ui-bridge-element-state-collapse-follow-ups`, D3) and its own
 * re-renders (a live Bounds readout rewrites its text every frame while the
 * selected element moves). So every page-activity observer drops each record
 * whose target is a panel root or anything inside one:
 * `idle/dom-settling.ts`, `idle/element-settling.ts`,
 * `injected/seed-registry.ts`, `react/useAutoRegister.ts`,
 * `render-log/dom-capture.ts` (`DOMChangeObserver`), `ai/change-tracker.ts`
 * and `react/commandHandlers.ts` (the change buffer and `waitForChange`).
 * A record on the panel's parent (the panel mounting or unmounting) is kept.
 */

/** Attribute carried by the inspector's info-panel root. */
export const INSPECTOR_PANEL_ATTR = 'data-ui-bridge-inspector';

/**
 * True when a mutation record's target is an inspector panel root or lies
 * inside one: any attribute, text or child-list change of the panel's own DOM,
 * its root's `pointer-events` toggle included.
 */
export function isInspectorPanelRecord(record: MutationRecord): boolean {
  const node = record.target;
  const element =
    node.nodeType === 1 /* Node.ELEMENT_NODE */ ? (node as Element) : node.parentElement;
  return !!element?.closest(`[${INSPECTOR_PANEL_ATTR}]`);
}

/** `records` without any record of the inspector panel's own DOM. */
export function withoutInspectorPanelRecords(records: MutationRecord[]): MutationRecord[] {
  return records.filter((record) => !isInspectorPanelRecord(record));
}
