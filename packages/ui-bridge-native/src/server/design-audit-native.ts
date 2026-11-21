/**
 * Native `/design/audit`: the web SDK's shared audit core over registered
 * React Native elements.
 *
 * The web transports answer `/design/audit` with `designAuditOf`, a DOM
 * adapter over the pure `auditDesign` (`@qontinui/ui-bridge/specs`,
 * `specs/design-audit-core.ts`, 0.57.0 or later). This file is the second
 * adapter: the core parses the body, selects and bounds the elements, picks
 * the mode and builds both reports, so a native answer has every field a web
 * answer has and cannot drift from it. Plan:
 * 2026-11-21-native-design-audit-answers-like-web-design-audit-of.
 *
 * Where React Native has no such thing, the difference is named here:
 * - Every registered element has a readable flattened style, so none is
 *   unreadable (`unreadableElementCount` is always 0).
 * - There is no root element, so `rem` resolves at 16px unless the request
 *   names `rootFontSizePx` — the figure native style inference uses.
 * - Contrast is read only from an element's OWN style: RN has no cascade, and
 *   a `Text` usually sits on its parent `View`'s background, so an element
 *   that does not set both colours counts as not measured.
 * - There is no `<select>`; pickers are platform widgets.
 * - A font size absent from the style is the platform default, which nothing
 *   reads, so that element counts as not measured.
 * - An element with no layout yet has no size, so its touch target is not
 *   measured — never read as 0x0, which would be a confident false finding.
 *
 * The package's `src/` imports nothing from the optional peer, and
 * `NativeDesignHandlers` is a public export, so the core's types are mirrored
 * here. `design-audit-native.test-d.ts` pins the mirror to the SDK's own.
 */

import type { NativeUIBridgeRegistry } from '../core/registry';
import type { RegisteredNativeElement } from '../core/types';
import type { ElementDesignData } from '../design/design-types';
import {
  getNativeElementDesignData,
  mapNativeStyleToExtended,
} from '../design/design-inspector-native';

// ============================================================================
// The core's types, mirrored (`@qontinui/ui-bridge/specs`)
// ============================================================================

/** A style-guide constraint (mirrors `StyleConstraint`). */
export type NativeStyleConstraint =
  | { type: 'exact'; property: string; value: string }
  | { type: 'oneOf'; property: string; values: string[] }
  | { type: 'tokenRef'; property: string; tokenPath: string }
  | { type: 'range'; property: string; min?: number; max?: number; unit?: string }
  | {
      type: 'responsive';
      property: string;
      breakpoints: Record<string, string | NativeStyleConstraint>;
    };

/** One constraint's verdict (mirrors `StyleConstraintResult`). */
export interface NativeStyleConstraintResult {
  passed: boolean;
  constraint: NativeStyleConstraint;
  actualValue: string;
  expectedValue: string;
  message?: string;
}

/** One rule's verdict on one element (mirrors `StyleValidationResult`). */
export interface NativeStyleValidationResult {
  elementId: string;
  ruleId: string;
  passed: boolean;
  constraintResults: NativeStyleConstraintResult[];
  severity: 'error' | 'warning' | 'info';
}

/** What the request selected and how much of it the audit checked (mirrors `DesignAuditBounds`). */
export interface NativeDesignAuditBounds {
  totalElements: number;
  limit: number;
  truncated: boolean;
  missingElementIds: string[];
  missingElementCount: number;
  unreadableElementIds: string[];
  unreadableElementCount: number;
  checkedElements: number;
}

/** How much of the findings the report lists (mirrors `AuditResultBounds`). */
export interface NativeAuditResultBounds {
  maxResults: number;
  listableResults: number;
  resultsTruncated: boolean;
}

/** The style-guide answer (mirrors `StyleGuideDesignAuditReport`). */
export interface NativeStyleGuideDesignAuditReport
  extends NativeDesignAuditBounds, NativeAuditResultBounds {
  mode: 'style-guide';
  guideName: string;
  totalRules: number;
  passedCount: number;
  failedCount: number;
  results: NativeStyleValidationResult[];
  timestamp: number;
  durationMs: number;
  summary: { errors: number; warnings: number; info: number };
  includePassed: boolean;
}

/** One heuristic finding (mirrors `HeuristicDesignAuditIssue`). */
export interface NativeHeuristicDesignAuditIssue {
  element: string;
  issue: string;
  severity: 'error' | 'warning' | 'info';
  fix?: string;
}

/** The heuristics (mirrors `HeuristicId`). */
export type NativeHeuristicId = 'contrast' | 'select-dark-mode' | 'font-size' | 'touch-target';

/**
 * How completely a heuristic could run (mirrors `HeuristicCoverageStatus`):
 * `measured` — the inputs are read for every element the heuristic applies to,
 * and `notMeasured` counts elements whose values were unreadable or
 * unjudgeable; `partial` — the inputs cannot be read for some class of
 * elements (the row's `note` names it); `not-applicable` — the platform has no
 * such thing.
 */
export type NativeHeuristicCoverageStatus = 'measured' | 'partial' | 'not-applicable';

/** What one heuristic checked (mirrors `HeuristicCoverage`). */
export interface NativeHeuristicCoverage {
  heuristic: NativeHeuristicId;
  status: NativeHeuristicCoverageStatus;
  checked: number;
  notMeasured: number;
  note?: string;
}

/** The heuristic answer (mirrors `HeuristicDesignAuditReport`). */
export interface NativeHeuristicDesignAuditReport
  extends NativeDesignAuditBounds, NativeAuditResultBounds {
  mode: 'heuristic';
  reason: string;
  issues: NativeHeuristicDesignAuditIssue[];
  heuristicCoverage: NativeHeuristicCoverage[];
  timestamp: number;
}

/** The `/design/audit` answer, self-describing by `mode` (mirrors `DesignAuditResponse`). */
export type NativeDesignAuditResponse =
  | NativeStyleGuideDesignAuditReport
  | NativeHeuristicDesignAuditReport;

/** What the heuristics read of one element (mirrors `HeuristicInput`). */
export interface NativeHeuristicInput {
  id: string;
  touchTarget: boolean;
  color: string;
  backgroundColor: string;
  fontSizePx: number | null;
  rect: { width: number; height: number } | null;
  select?: { colorScheme: string; option?: { color: string; backgroundColor: string } };
}

/** What a transport supplies to the core (mirrors `DesignAuditAdapter`). */
export interface NativeDesignAuditAdapter<T extends { id: string }, R extends T = T> {
  isReadable(el: T): el is R;
  records(kept: R[], guide: unknown): ElementDesignData[];
  heuristicInput(el: R): NativeHeuristicInput;
  defaultRootFontSizePx(): number;
  heuristicCoverage: Readonly<
    Record<NativeHeuristicId, { status: NativeHeuristicCoverageStatus; note?: string }>
  >;
}

/** The shared audit core native calls (`@qontinui/ui-bridge/specs`, 0.57.0 or later). */
export interface DesignAuditCoreModule {
  auditDesign<T extends { id: string }, R extends T = T>(
    elements: readonly T[],
    request: unknown,
    loadedGuide: unknown,
    adapter: NativeDesignAuditAdapter<T, R>
  ): NativeDesignAuditResponse;
}

/**
 * The audit core, when the loaded SDK carries it. The peer range admits
 * releases that load but predate it, so availability is decided by the
 * function's presence, not by the `require`.
 */
export function asDesignAuditCore(specs: unknown): DesignAuditCoreModule | null {
  const s = specs as Partial<DesignAuditCoreModule> | null;
  return s && typeof s.auditDesign === 'function' ? (s as DesignAuditCoreModule) : null;
}

// ============================================================================
// The native adapter
// ============================================================================

/** The `NativeElementType`s a person taps, so each must be 44x44 or larger. */
const TOUCH_TARGET_TYPES: ReadonlySet<string> = new Set([
  'button',
  'touchable',
  'pressable',
  'switch',
  'checkbox',
  'radio',
]);

/** What each heuristic can read on React Native (see the file header). */
const NATIVE_HEURISTIC_COVERAGE: NativeDesignAuditAdapter<RegisteredNativeElement>['heuristicCoverage'] =
  {
    contrast: {
      status: 'partial',
      note:
        "React Native has no cascade: contrast is checked only where the element's own style " +
        'sets both color and backgroundColor, and every other element counts in notMeasured; ' +
        'an element with no fontSize is judged against the normal-text threshold (4.5:1)',
    },
    'select-dark-mode': {
      status: 'not-applicable',
      note: 'React Native has no <select>; pickers are platform widgets',
    },
    'font-size': {
      status: 'partial',
      note:
        'checked where the style sets fontSize; elsewhere the platform default applies, which ' +
        'is not read, and the element counts in notMeasured',
    },
    'touch-target': {
      status: 'measured',
      note: 'an element with no layout yet counts in notMeasured, never as 0x0',
    },
  };

function nativeDesignData(el: RegisteredNativeElement): ElementDesignData {
  return getNativeElementDesignData(el.id, el.label, el.type, el.flatStyle, el.getState().layout);
}

function nativeHeuristicInput(el: RegisteredNativeElement): NativeHeuristicInput {
  const styles = mapNativeStyleToExtended(el.flatStyle);
  const fontSizePx = parseFloat(styles.fontSize);
  const layout = el.getState().layout;
  return {
    id: el.id,
    touchTarget: TOUCH_TARGET_TYPES.has(el.type),
    color: styles.color,
    backgroundColor: styles.backgroundColor,
    fontSizePx: Number.isFinite(fontSizePx) ? fontSizePx : null,
    rect: layout ? { width: layout.width, height: layout.height } : null,
  };
}

const nativeAdapter: NativeDesignAuditAdapter<RegisteredNativeElement> = {
  isReadable: (_el): _el is RegisteredNativeElement => true,
  // The element's own `type` travels unchanged: the core's style validator
  // matches a rule's `elementType` through the SDK's named-type families, so
  // a web `button` rule matches a native `pressable` or `touchable`.
  records: (kept) => kept.map(nativeDesignData),
  heuristicInput: nativeHeuristicInput,
  defaultRootFontSizePx: () => 16,
  heuristicCoverage: NATIVE_HEURISTIC_COVERAGE,
};

/**
 * Answer `/design/audit` over the registry's elements through the shared core.
 * Throws the core's request error (its `code` is `INVALID_REQUEST`) for a
 * malformed body.
 */
export function nativeAudit(
  registry: NativeUIBridgeRegistry,
  request: unknown,
  loadedGuide: unknown,
  core: DesignAuditCoreModule
): NativeDesignAuditResponse {
  return core.auditDesign(registry.getAllElements(), request, loadedGuide, nativeAdapter);
}
