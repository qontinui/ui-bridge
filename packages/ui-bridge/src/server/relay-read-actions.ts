/**
 * The relayed actions that only READ the page: the declared read set the
 * relay's failover consults (`mayFailOver` in `./live-answer.ts`, plan
 * 2026-11-08-ui-bridge-relay-and-exec-mode-follow-ups-from-pr-329, D3).
 *
 * ABSENT MEANS WRITE. An action nobody classified is treated as one that
 * changes state: a command whose primary tab timed out is re-sent to another
 * tab only when its action is listed here, because a timeout does not prove
 * the tab did nothing, and running a write twice is not safe. A write listed
 * here by mistake could run twice, so each entry names the dispatcher case
 * (`../react/commandHandlers.ts`, `executeCommand`) it was classified from,
 * and that case was READ and found to change nothing on the page.
 *
 * What "changes nothing" admits: none of these actions runs a settle
 * (`SETTLE_BEFORE_READ_ACTIONS` lists none of them). `getControlSnapshot`,
 * `find` and `getSemanticSnapshot` are in `LABEL_REFRESH_ACTIONS`, and
 * `getElement` re-derives its own element's label
 * (`registry.refreshScrapedTextOf`): each re-reads DOM-scraped labels into the
 * registry, a cache of what the page already shows, and no page state moves.
 * Running one twice answers the same thing twice.
 */
export const RELAY_READ_ACTIONS: ReadonlySet<string> = new Set([
  // `case 'getControlSnapshot':` serializes the registry's elements,
  // components and workflows, the route, visibility and viewport, and runs the
  // snapshot enrichers over the result object it built. Nothing is written.
  'getControlSnapshot',
  // `case 'getElement':` reads one registration (`getElement(parsed.id)`),
  // re-derives that element's scraped label, and returns
  // `serializeRegisteredElement(el)` or a returned `ELEMENT_NOT_FOUND`.
  'getElement',
  // `case 'getElementState':` returns `el.getState()` spread with legacy
  // aliases and an optional read-only projection (`projectElement`); a
  // missing id throws `Element <id> not found`.
  'getElementState',
  // `case 'find':` (shared with `discover`) filters the captured element array
  // through `applyCanonicalFindFilter` and returns the rows, a signature and
  // the registration counts.
  'find',
  // `case 'getConsoleErrors':` reads `browserCapture` (`getConsoleRecent` /
  // `getConsoleSince` / `getRecent` / `getSince`) and groups in a local map.
  // It clears nothing: `clearConsoleErrors` is a separate action, absent here.
  'getConsoleErrors',
  // `case 'getSemanticSnapshot':` builds a throwaway snapshot manager and
  // returns `mgr.createSnapshot(...)` over the captured elements.
  'getSemanticSnapshot',
  // `case 'getRenderLog':` reads `renderLog.getEntries()` /
  // `getRenderLogEntries()` and filters a copy. It clears nothing:
  // `clearRenderLog` is a separate action, absent here.
  'getRenderLog',
]);
