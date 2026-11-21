/**
 * Native `/design/audit`: the web SDK's shared audit core over registered
 * React Native elements.
 *
 * The web transports answer `/design/audit` with `designAuditOf`, a DOM
 * adapter over the pure `auditDesign` (`@qontinui/ui-bridge/specs`,
 * `specs/design-audit-core.ts`, 0.58.0 or later). This file is the second
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
 * - An element with no layout yet, or a collapsed 0x0 one, has no size to
 *   judge, so its touch target is not measured — never read as 0x0, which
 *   would be a confident false finding.
 *
 * The package's `src/` imports nothing from the optional peer, and
 * `NativeDesignHandlers` is a public export, so the core's types are mirrored
 * here. `design-audit-native.test-d.ts` pins the mirror to the SDK's own:
 * the response, the heuristic input, the coverage declaration and the style
 * guide exactly; the adapter member by member (the same keys both ways, each
 * method's parameters exactly, each return exactly — records' assignable,
 * since a native record omits `stateVariations` — and the whole adapter
 * assignable to the SDK's); and the SDK's `auditDesign` as assignable to
 * `DesignAuditCoreModule['auditDesign']`, a property, so that check is strict
 * under `strictFunctionTypes` — narrowing any of the SDK's parameters fails it.
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

/** Design tokens (mirrors `DesignTokens`). */
export interface NativeDesignTokens {
  colors: Record<string, string>;
  typography: {
    fontFamilies: Record<string, string>;
    fontSizes: Record<string, string>;
    fontWeights: Record<string, string>;
    lineHeights: Record<string, string>;
    letterSpacings: Record<string, string>;
  };
  spacing: Record<string, string>;
  borderRadius: Record<string, string>;
  shadows: Record<string, string>;
  breakpoints: Record<string, number>;
}

/** A quality metric id (mirrors `QualityMetricId`). */
export type NativeQualityMetricId =
  | 'contentOverflow'
  | 'aboveFoldRatio'
  | 'informationDensity'
  | 'containerEfficiency'
  | 'viewportUtilization'
  | 'elementDensity'
  | 'whitespaceRatio'
  | 'localDensityBalance'
  | 'horizontalBalance'
  | 'verticalBalance'
  | 'alignmentConsistency'
  | 'spacingScaleAdherence'
  | 'spacingConsistency'
  | 'lineHeightRatio'
  | 'interGroupSpacingRatio'
  | 'uniqueColorCount'
  | 'wcagContrastCompliance'
  | 'colorHarmony'
  | 'saturationConsistency'
  | 'typeScaleAdherence'
  | 'fontWeightConsistency'
  | 'headingHierarchy'
  | 'fontFamilyCount'
  | 'buttonConsistency'
  | 'cardConsistency'
  | 'inputConsistency'
  | 'touchTargetCompliance'
  | 'customPropertyConsistency';

/** A quality context a style guide declares (mirrors `QualityContext`). */
export interface NativeQualityContext {
  name: string;
  description: string;
  metrics: Partial<
    Record<
      NativeQualityMetricId,
      { enabled: boolean; weight: number; thresholds: { good: number; warning: number } }
    >
  >;
}

/** A style rule (mirrors `StyleRule`). */
export interface NativeStyleRule {
  id: string;
  description?: string;
  selector?: string;
  elementType?: string;
  constraints: NativeStyleConstraint[];
  severity?: 'error' | 'warning' | 'info';
}

/**
 * A style guide (mirrors `StyleGuideConfig`). `/design/style-guide/load`
 * stores the body's guide as this type without validating it, as the web
 * transports' `loadStyleGuide` does; a guide in an audit request is checked by
 * the core.
 */
export interface NativeStyleGuideConfig {
  version: string;
  name: string;
  description?: string;
  tokens: NativeDesignTokens;
  rules: NativeStyleRule[];
  qualityContexts?: Record<string, NativeQualityContext>;
  pageOverrides?: Record<string, Partial<NativeStyleGuideConfig>>;
}

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

/**
 * What native hands the core's style-guide audit: its design data without
 * `stateVariations`. Native interaction states are React Native's (`focused`
 * where the web says `focus`), the style validator never reads them, and
 * without them a native record is a web `ElementDesignData`.
 */
export type NativeAuditRecord = Omit<ElementDesignData, 'stateVariations'>;

/** What a transport supplies to the core (mirrors `DesignAuditAdapter`). */
export interface NativeDesignAuditAdapter<T extends { id: string }, R extends T = T> {
  isReadable(el: T): el is R;
  records(kept: R[], guide: NativeStyleGuideConfig): NativeAuditRecord[];
  heuristicInput(el: R): NativeHeuristicInput;
  defaultRootFontSizePx(): number;
  heuristicCoverage: Readonly<
    Partial<Record<NativeHeuristicId, { status: NativeHeuristicCoverageStatus; note?: string }>>
  >;
}

/** The shared audit core native calls (`@qontinui/ui-bridge/specs`, 0.58.0 or later). */
export interface DesignAuditCoreModule {
  // A property, not a method, so its parameters are checked strictly against
  // the SDK's `auditDesign` (`design-audit-native.test-d.ts`).
  auditDesign: <T extends { id: string }, R extends T = T>(
    elements: readonly T[],
    request: unknown,
    loadedGuide: NativeStyleGuideConfig | null | undefined,
    adapter: NativeDesignAuditAdapter<T, R>
  ) => NativeDesignAuditResponse;
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

/**
 * What each heuristic can read on React Native (see the file header). Every
 * heuristic the mirror names is declared, so none falls to the core's
 * undeclared default.
 */
const NATIVE_HEURISTIC_COVERAGE: Readonly<
  Record<NativeHeuristicId, { status: NativeHeuristicCoverageStatus; note: string }>
> = {
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
    note: 'an element with no layout yet, or a collapsed 0x0 one, counts in notMeasured, never as 0x0',
  },
};

function nativeAuditRecord(el: RegisteredNativeElement): NativeAuditRecord {
  const { stateVariations: _states, ...record } = getNativeElementDesignData(
    el.id,
    el.label,
    el.type,
    el.flatStyle,
    el.getState().layout
  );
  return record;
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
    // No layout yet, or a 0x0 one (collapsed / `display: 'none'`): no size
    // to judge, so not measured — never a 0x0 touch-target finding.
    rect:
      layout && (layout.width > 0 || layout.height > 0)
        ? { width: layout.width, height: layout.height }
        : null,
  };
}

const nativeAdapter: NativeDesignAuditAdapter<RegisteredNativeElement> = {
  isReadable: (_el): _el is RegisteredNativeElement => true,
  // The element's own `type` travels unchanged: the core's style validator
  // matches a rule's `elementType` through the SDK's named-type families, so
  // a web `button` rule matches a native `pressable` or `touchable`.
  records: (kept) => kept.map(nativeAuditRecord),
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
  loadedGuide: NativeStyleGuideConfig | null | undefined,
  core: DesignAuditCoreModule
): NativeDesignAuditResponse {
  return core.auditDesign(registry.getAllElements(), request, loadedGuide, nativeAdapter);
}
