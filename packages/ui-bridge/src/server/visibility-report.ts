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
 * - in-page — `registry.getAllElements()` + `registry.getModalContext()`
 * - relay   — `snapshot.elements` + `snapshot.modalStack`
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
} from './types';
import type { SnapshotModalContext } from '../modal/types';

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
  minRatio?: number;
  includeExpected?: boolean;
}

/**
 * Identifiers by which a tracked modal can be recognised in an `occludedBy`
 * string.
 *
 * `occludedBy` is produced by `describeOccluder` (core/registry.ts) and is one
 * of: a ui-bridge registry id (when the occluder or an ancestor carries
 * `data-ui-bridge-id`), `tag#domId`, `tag.firstClass`, or a bare `tag`.
 * `ModalInfo.id` is the modal element's DOM id, its `data-testid`, or a
 * generated `modal-N`.
 *
 * The two overlap on exactly the identity-bearing forms, and this matcher
 * accepts ONLY those:
 *
 * - `occludedBy === modal.id` — the occluder is registered under the same id
 * - `occludedBy === "<tag>#<modal.id>"` — unregistered occluder, DOM id match
 *
 * Class and bare-tag descriptors are deliberately NOT matched. They are not
 * identities, and a false positive here is expensive: an entry marked expected
 * is dropped from the default response, so a loose rule would hide the genuine
 * occlusion regressions this endpoint exists to surface. Under-claiming costs
 * a caller one extra entry to look at; over-claiming costs them the bug.
 */
function modalIdentities(modalContext: SnapshotModalContext): Set<string> {
  const ids = new Set<string>();
  for (const modal of modalContext.modals ?? []) {
    if (modal?.id) ids.add(modal.id);
  }
  return ids;
}

function isTrackedOverlay(occludedBy: string, modalIds: Set<string>): boolean {
  if (modalIds.has(occludedBy)) return true;
  const hash = occludedBy.indexOf('#');
  if (hash !== -1 && modalIds.has(occludedBy.slice(hash + 1))) return true;
  return false;
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
    : new Set<string>();

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
    occlusions.push({
      element: el.id,
      label: el.label,
      text: text || undefined,
      occludedBy: el.occludedBy,
      ratio,
      isExpectedOverlay,
      hidesText: text.length > 0,
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
    // An empty list from a registry with no elements is UNKNOWN, not
    // "nothing is covered" — say which one this is.
    verdict:
      elementCount === 0
        ? 'unknown_empty_registry'
        : occlusions.length === 0
          ? 'clear'
          : 'occlusions_found',
  };
}
