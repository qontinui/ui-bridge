/**
 * The `/control/visibility` occlusion sweep — ONE implementation, two callers.
 *
 * `handlers.ts` (in-page, live registry) and `relay-handlers.ts` (relay, cached
 * snapshot) both answer this route. They used to carry hand-duplicated copies of
 * the sweep, and the copies drifted: the relay's comment claimed the in-page
 * handler "runs both arms" and that relay findings were "a SUBSET" of it, while
 * the in-page handler ran exactly the same single arm. Nothing structurally
 * forced them to agree, so nothing caught it.
 *
 * They now agree by construction. The two surfaces differ only in where their
 * inputs come from:
 *
 * - in-page — `registry.getAllElements()` + `registry.getModalContext()` +
 *   `registry.getCanvasCoverage()`
 * - relay   — `snapshot.elements` + `snapshot.modalStack` +
 *   `snapshot.canvasCoverage`
 *
 * Both feed the same shape into {@link buildVisibilityReport}, so a change to
 * the sweep lands on both at once.
 *
 * ## Which arm this is, and why it is the only one
 *
 * The sweep is sourced entirely from the registry's `elementFromPoint`
 * hit-test (`state.occludedBy` / `occludedPct`, computed in
 * `computeVisibilityVerdict`, core/registry.ts).
 *
 * That is deliberate, and not a reduced version of something better.
 * ui-bridge-auto's `computeVisibility` models stacking geometrically, but
 * ui-bridge-auto DEPENDS ON THIS PACKAGE — importing it here would make the
 * two mutually dependent, which is why it is not imported. The geometric arm
 * stays available to ui-bridge-auto's own consumers, on the correct side of
 * the layering.
 *
 * The hit-test is also the stronger signal of the two: it observes what the
 * compositor actually painted, so it sees `clip-path`, transformed ancestors
 * and scroll clipping that a bounding-box model cannot derive.
 *
 * On the relay side the hit-test survives the trip because the page already
 * ran it and stamped `occludedBy` / `occludedPct` onto each element's state —
 * a projection of a measurement, not a re-derivation of one.
 *
 * ## §4.6 redaction disposition
 *
 * The response echoes `text`, which is the covered element's
 * `state.textContent`. That field is minted through `scrubContentByVerdict` in
 * `getElementState` (core/registry.ts), so a redacted element reaches this
 * module already scrubbed and no additional scrubbing happens — or is needed —
 * here. Echoing the text is the point: "something is covered" is not
 * actionable, "the string `Zone 8: qontinui-web` is covered" is.
 */

import type {
  VisibilityOcclusionEntry,
  VisibilityReport,
  VisibilityTextSource,
} from './types';
import type { SnapshotModalContext } from '../modal/types';
import type { CanvasCoverage } from '../core/types';

/** Default `minRatio` — filters hairline overlaps. */
export const DEFAULT_VISIBILITY_MIN_RATIO = 0.02;

/**
 * The per-element input the sweep needs, normalized across the live registry
 * and the relay's cached snapshot.
 */
export interface VisibilityElementInput {
  id: string;
  label?: string;
  occludedBy?: string;
  occludedPct?: number;
  textContent?: string;
  /** `state.paintsText` — the element's text is painted, not in the DOM. */
  paintsText?: boolean;
}

export interface BuildVisibilityReportInput {
  elements: VisibilityElementInput[];
  /**
   * The tracked modal stack, or `undefined` when no `modalDetector` enricher
   * is registered.
   *
   * `undefined` is NOT "no modals are open" — it is "nobody is watching for
   * them", and the report says which one it is via
   * `expectedOverlayDetection`.
   */
  modalContext?: SnapshotModalContext;
  /**
   * The canvas census, or `unavailable` with the reason it could not be taken.
   * Required: each caller knows WHY a census is missing (the in-page accessor
   * threw, the relay's page SDK predates it), and the report must say so.
   */
  canvasCoverage: CanvasCoverage;
  minRatio?: number;
  includeExpected?: boolean;
}

/**
 * True when some visible canvas may hold text the sweep did not check: the
 * census lists an unattributed canvas, or there is no census at all.
 */
function canvasUnswept(coverage: CanvasCoverage): boolean {
  if (coverage.state === 'unavailable') return true;
  return coverage.unattributed.length > 0;
}

/**
 * The D3 verdict order (plan 2026-10-22-occlusion-sweep-is-blind-to-canvas-
 * painted-text). `unavailable` coverage withholds `clear` on purpose — unlike
 * a missing modal stack, which only disables a filter, a missing canvas census
 * loses the ability to say "nothing is covered" truthfully. Do not soften it
 * to match `expectedOverlayDetection`.
 */
function decideVerdict(
  elementCount: number,
  occlusionCount: number,
  input: BuildVisibilityReportInput
): VisibilityReport['verdict'] {
  if (elementCount === 0) return 'unknown_empty_registry';
  if (occlusionCount > 0) return 'occlusions_found';
  if (canvasUnswept(input.canvasCoverage)) return 'unknown_canvas';
  return 'clear';
}

/**
 * Identifiers by which a tracked modal can be recognised in an `occludedBy`
 * string.
 *
 * `occludedBy` is produced by `describeOccluder` (core/registry.ts) and is one
 * of: a ui-bridge registry id (when the occluder or an ancestor carries
 * `data-ui-bridge-id`), `tag#domId`, `tag[data-testid="x"]` (only for a
 * blocking dialog with neither), `tag.firstClass`, or a bare `tag`.
 *
 * `ModalInfo.id` is NOT used: it is the DOM id, else the `data-testid`, else a
 * generated `modal-N`, so `tag#<id>` against it would let an unrelated
 * `<aside id="sidebar">` pass for a dialog whose testid is `sidebar`. Each
 * kind of identity is matched only against its own kind:
 *
 * - `occludedBy === modal.bridgeId` — the occluder is the registered modal
 *   (registry ids match only here)
 * - `occludedBy === "<tag>#<modal.domId>"` — named by the dialog's real DOM id
 * - `occludedBy === "<tag>[data-testid=\"<modal.testId>\"]"` — the testid form
 *   `describeOccluder` gives a blocking dialog with no stamp and no DOM id
 *
 * Only a modal the ELEMENT itself declares blocking (`blockingSource ===
 * 'element'`: an `alertdialog`, `[role=dialog][aria-modal=true]`, or a
 * `<dialog>` matching `:modal`) contributes identities. The detector also
 * reports UI it matched by a library or custom selector (a docked
 * `.MuiDrawer-root`, an open Headless UI menu, a non-modal Radix popover),
 * and its backdrop heuristic marks some of them blocking from a class
 * substring on a neighbour. Once registered, such a node's own stamp names
 * whatever unregistered child of it was hit, and admitting it would mark a
 * real occlusion "expected". A backdrop-only verdict, `blocking: false`, or a
 * missing `blockingSource` (a page SDK older than the field, over the relay)
 * is not admitted. `blockingSource: 'element'` is decided by
 * `isBlockingDialog`, the predicate `describeOccluder` names a dialog by.
 * Consequence, accepted: a modal that only a backdrop
 * marks as blocking (a Radix/shadcn Dialog, which sets no aria-modal) is not
 * filtered and over-reports.
 *
 * Class and bare-tag descriptors are deliberately NOT matched. They are not
 * identities, and a false positive here is expensive: an entry marked expected
 * is dropped from the default response, so a loose rule would hide the genuine
 * occlusion regressions this endpoint exists to surface. Under-claiming costs
 * a caller one extra entry to look at; over-claiming costs them the bug.
 */
interface ModalIdentities {
  bridgeIds: Set<string>;
  domIds: Set<string>;
  testIds: Set<string>;
}

function modalIdentities(modalContext: SnapshotModalContext): ModalIdentities {
  const ids: ModalIdentities = { bridgeIds: new Set(), domIds: new Set(), testIds: new Set() };
  for (const modal of modalContext.modals ?? []) {
    if (modal?.blockingSource !== 'element') continue;
    if (modal.bridgeId) ids.bridgeIds.add(modal.bridgeId);
    if (modal.domId) ids.domIds.add(modal.domId);
    if (modal.testId) ids.testIds.add(modal.testId);
  }
  return ids;
}

/** `tag#id`, as `describeDomNode` writes it. */
const TAG_ID_FORM = /^[a-z][a-z0-9-]*#(.+)$/;
/** `tag[data-testid="x"]`, as `describeOccluder` names a testid-only dialog. */
const TAG_TESTID_FORM = /^[a-z][a-z0-9-]*\[data-testid="(.*)"\]$/;

function isTrackedOverlay(occludedBy: string, modalIds: ModalIdentities): boolean {
  if (modalIds.bridgeIds.has(occludedBy)) return true;
  const testId = TAG_TESTID_FORM.exec(occludedBy);
  if (testId) return modalIds.testIds.has(testId[1]);
  const domId = TAG_ID_FORM.exec(occludedBy);
  return domId !== null && modalIds.domIds.has(domId[1]);
}

/**
 * Build the `/control/visibility` report.
 *
 * `includeExpected` (default `false`) drops occlusions whose occluder is a
 * tracked modal from the response: an open dialog covering the page it opened
 * over is the UI working, not a layout regression. Pass `true` to see them.
 *
 * When no modal stack is available nothing can be classified, so nothing is
 * filtered and `expectedOverlayDetection` reports `unavailable` — the caller
 * is told the knob had no input rather than being handed a clean-looking list.
 */
export function buildVisibilityReport(
  input: BuildVisibilityReportInput
): VisibilityReport {
  const minRatio = input.minRatio ?? DEFAULT_VISIBILITY_MIN_RATIO;
  const includeExpected = input.includeExpected ?? false;

  const detectionAvailable = input.modalContext !== undefined;
  const modalIds = detectionAvailable
    ? modalIdentities(input.modalContext as SnapshotModalContext)
    : { bridgeIds: new Set<string>(), domIds: new Set<string>(), testIds: new Set<string>() };

  const occlusions: VisibilityOcclusionEntry[] = [];
  let expectedOverlaysFiltered = 0;

  for (const el of input.elements) {
    if (!el?.occludedBy) continue;
    const ratio = (el.occludedPct ?? 0) / 100;
    if (ratio < minRatio) continue;

    const isExpectedOverlay = detectionAvailable
      ? isTrackedOverlay(el.occludedBy, modalIds)
      : false;

    if (isExpectedOverlay && !includeExpected) {
      expectedOverlaysFiltered++;
      continue;
    }

    const text = typeof el.textContent === 'string' ? el.textContent.trim() : '';
    // A `paintsText` element's text is canvas pixels: `textContent` says
    // nothing about it, and covering the element covers its text.
    const textSource: VisibilityTextSource | undefined = el.paintsText
      ? 'painted'
      : text.length > 0
        ? 'dom'
        : undefined;
    occlusions.push({
      element: el.id,
      label: el.label,
      text: text || undefined,
      occludedBy: el.occludedBy,
      ratio,
      isExpectedOverlay,
      hidesText: textSource !== undefined,
      ...(textSource !== undefined ? { textSource } : {}),
      source: 'hit-test',
    });
  }

  // Worst first, and text-hiding occlusions outrank blank ones: a covered
  // label destroys information the reader cannot recover.
  occlusions.sort(
    (a, b) => Number(b.hidesText) - Number(a.hidesText) || b.ratio - a.ratio
  );

  const elementCount = input.elements.length;

  return {
    occlusions,
    elementCount,
    minRatio,
    includeExpected,
    expectedOverlayDetection: detectionAvailable ? 'modal-stack' : 'unavailable',
    expectedOverlaysFiltered,
    canvasCoverage: input.canvasCoverage,
    // An empty list is UNKNOWN, not "nothing is covered", when the registry
    // was empty or a canvas went unswept — say which one this is.
    verdict: decideVerdict(elementCount, occlusions.length, input),
  };
}
