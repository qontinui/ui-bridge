/**
 * IR Type Re-declarations
 *
 * These are local TYPE-ONLY mirrors of the canonical IR shapes published at
 * `@qontinui/shared-types/ui-bridge-ir`
 * (qontinui-schemas/ts/src/ui-bridge-ir/). They are duplicated here so that
 * `@qontinui/ui-bridge` does not need to take a runtime dependency on
 * `@qontinui/shared-types` just to expose IR-emitting metadata fields on its
 * existing hooks.
 *
 * KEEP IN SYNC with `qontinui-schemas/ts/src/ui-bridge-ir/`. If you change
 * an IR field there, mirror it here. The prompt for Phase 4 of the UI
 * Bridge Redesign — Section 1 Foundations — explicitly authorizes this
 * arrangement: build plugins emit IR using the canonical types; the SDK
 * accepts structurally identical shapes.
 *
 * @see https://github.com/qontinui/qontinui-schemas (ui-bridge-ir module)
 */

// ---------------------------------------------------------------------------
// Provenance — where an IR declaration came from
// ---------------------------------------------------------------------------

/**
 * Origin of an IR node. Set by the build plugin when extracting JSX wrappers,
 * by hand when authoring a JSON IR file directly, or by a generation pipeline.
 */
export interface IRProvenance {
  /** How this declaration was authored. */
  source: 'hand-authored' | 'build-plugin' | 'ai-generated' | 'migrated';
  /** Source file (relative to the build root). */
  file?: string;
  /** Line number in the source file (1-based). */
  line?: number;
  /** Column in the source file (1-based). */
  column?: number;
  /** Build-plugin version that produced this node, if applicable. */
  pluginVersion?: string;
}

// ---------------------------------------------------------------------------
// Metadata — semantic context routed through the useUIAnnotation store at
// runtime. Aligns with the existing ElementAnnotation shape so the SDK can
// write straight into the global annotation store without parallel
// infrastructure.
// ---------------------------------------------------------------------------

/**
 * Human-authored semantic context for an IR node. Aligns with the existing
 * ElementAnnotation shape (../annotations/types.ts).
 */
export interface IRMetadata {
  /** Short human-readable description of what this state/transition represents. */
  description?: string;
  /** What this state/transition is for, intent-wise. */
  purpose?: string;
  /** Tags for grouping, filtering, and search. */
  tags?: string[];
  /** IDs of related elements/states/transitions. */
  relatedElements?: string[];
  /** Free-form notes for nuance that doesn't fit description/purpose. */
  notes?: string;
}

// ---------------------------------------------------------------------------
// Effect — side-effect annotation on transitions
// ---------------------------------------------------------------------------

/**
 * `IREffect` — "read" | "write" | "destructive". Whether a transition (or, since
 * Phase 4, an SDK action) is read-only, mutating, or destructive. Drives
 * counterfactual analysis (section 6) and gates auto-regression generation
 * (section 9): destructive transitions are excluded from automatic walks.
 *
 * **MOVED 2026-08-22** (plan `2026-08-20-ui-bridge-action-declaration-shape`,
 * Phase 4). The declaration now lives one layer down, in `core/types.ts`,
 * because `ComponentAction` / `CustomAction` carry it too and `core` cannot
 * import from `react` without inverting the layering. This file re-exports it
 * so the IR-facing name and the action-facing name are the **same type**,
 * rather than a second inlined copy of the literal union — which is the drift
 * this plan exists to fix.
 *
 * The type-only-mirror policy stated at the top of this file is unchanged; the
 * KEEP-IN-SYNC obligation with
 * `qontinui-schemas/ts/src/ui-bridge-ir/primitives.ts` moved to `core/types.ts`
 * along with the declaration and is restated there in full.
 */
export type { IREffect } from '../core/types';

// ---------------------------------------------------------------------------
// Element criteria — IR's canonical element-matching shape
// ---------------------------------------------------------------------------

/**
 * Minimal criteria to identify a DOM element.
 *
 * Mirrors `ElementCriteria` from `ui-bridge-auto/src/types/match.ts:20`.
 */
export interface IRElementCriteria {
  /** ARIA role or inferred role. */
  role?: string;
  /** Exact text content (trimmed). */
  text?: string;
  /** Substring match on text content (case-insensitive). */
  textContains?: string;
  /** ARIA label (case-insensitive substring match). */
  ariaLabel?: string;
  /** Element ID (exact string or pattern-source string). */
  id?: string;
  /** HTML attributes to check (exact string match). */
  attributes?: Record<string, string>;
}
