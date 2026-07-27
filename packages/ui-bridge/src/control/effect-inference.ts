/**
 * D3 Effect Calculus — Phase 4: Signature Inference from Recording History
 *
 * Phases 1–3b predict effects from hand-authored {@link EffectSignature}s. This
 * phase derives signatures *statistically* from a recorded interaction history
 * ({@link CooccurrenceExportData}): for each `(action, targetFingerprint)` it
 * counts which consequence fingerprints reliably appeared / disappeared, and —
 * when a consequence clears both a support floor (K occurrences) and a
 * confidence floor — emits it as a predicted {@link IRElementCriteria}.
 *
 * The crucial honesty constraint (plan §7): the recorded consequence is a
 * fingerprint *hash*, which is NOT matchable in a live snapshot — the Phase 1
 * containment matcher ({@link ./effect-containment}) matches on role + text, not
 * on a recording hash. So each kept consequence is reduced from its
 * {@link ElementFingerprintData} to a `{ role, textContains }` criterion the
 * live matcher can actually satisfy at verify time. The inferred prediction is a
 * *static aggregate* (it ignores the live pre-snapshot) — that is fine and
 * honest; it simply asserts "this consequence tends to follow this action".
 *
 * Purely functional + data-only: no DOM, no recording-runtime coupling. The
 * input is the already-exported {@link CooccurrenceExportData}.
 */

import type { IRElementCriteria } from '../react/ir-types';
import type { ElementFingerprintData } from '../core/element-fingerprint';
import type { CooccurrenceExportData } from '../recording/types';
import { truncateCodePoints } from '../core/text';

// ---------------------------------------------------------------------------
// Flat effect records — one per recorded transition
// ---------------------------------------------------------------------------

/**
 * A single recorded transition flattened into the shape the frequency analysis
 * consumes. One {@link EffectRecord} per {@link CooccurrenceExportData.transitions}
 * entry.
 */
export interface EffectRecord {
  /** The action that triggered the transition (`TransitionRecordData.actionType`). */
  action: string;
  /** Fingerprint hash of the element the action targeted, if any. */
  targetFingerprint: string | null;
  /** Fingerprint hashes that appeared in the after-snapshot. */
  appeared: string[];
  /** Fingerprint hashes that disappeared in the after-snapshot. */
  disappeared: string[];
}

/**
 * Adapt a recording export into flat {@link EffectRecord}s (one per transition,
 * preserving order). Pure projection — no aggregation yet.
 */
export function cooccurrenceToEffectRecords(data: CooccurrenceExportData): EffectRecord[] {
  return data.transitions.map((t) => ({
    action: t.actionType,
    targetFingerprint: t.targetFingerprint,
    appeared: [...t.appearedFingerprints],
    disappeared: [...t.disappearedFingerprints],
  }));
}

// ---------------------------------------------------------------------------
// Inference options + outputs
// ---------------------------------------------------------------------------

export interface InferenceOptions {
  /**
   * Min fraction of `(action, target)` occurrences in which a consequence
   * fingerprint must appear to be predicted. Default 0.5.
   */
  minConfidence?: number;
  /**
   * Min number of recorded `(action, target)` occurrences before inferring at
   * all (the "K" in the plan). Default 3.
   */
  minSupport?: number;
}

/** A per-consequence inferred fact with its measured frequency. */
export interface InferredFact {
  /** Live-matchable criteria reduced from the consequence's fingerprint. */
  criteria: IRElementCriteria;
  /** occurrences-with-this-consequence / support, in 0..1. */
  confidence: number;
  /** Whether the consequence was an appearance or a disappearance. */
  kind: 'appear' | 'disappear';
}

/** One aggregated `(action, targetFingerprint)` group with its kept facts. */
export interface InferredSignatureEntry {
  action: string;
  targetFingerprint: string | null;
  /** Number of recorded occurrences of this `(action, target)` pair. */
  support: number;
  /** Consequences that cleared both the support and confidence floors. */
  facts: InferredFact[];
}

/**
 * Aggregated inferred signature data, keyed by `${action} ${targetFingerprint}`.
 */
export interface InferredSignatureTable {
  bySignatureKey: Map<string, InferredSignatureEntry>;
  /** Build the key the lookup uses. */
  keyFor(action: string, targetFingerprint: string | null): string;
}

// ---------------------------------------------------------------------------
// Fingerprint → live-matchable criteria
// ---------------------------------------------------------------------------

/**
 * Normalize a fingerprint's human text into a short `textContains` token. The
 * recorded `accessibleName` is already normalized + truncated to 50 chars by the
 * fingerprint computer; we trim and cap it again defensively and keep a short
 * leading slice so the substring match stays robust to minor live differences.
 */
function shortText(text: string): string {
  const collapsed = text.trim().replace(/\s+/g, ' ');
  // Cap to a short prefix — long exact text is brittle for a `textContains`
  // substring match; the leading words carry the signal.
  return collapsed.length > 40 ? truncateCodePoints(collapsed, 40).trim() : collapsed;
}

/**
 * Reduce an {@link ElementFingerprintData} to an {@link IRElementCriteria} the
 * live containment matcher can satisfy. Preference order (per plan):
 *   1. `{ role, textContains }` — both role and human text present.
 *   2. `{ textContains }` — human text only (no usable role).
 *   3. `{ role }` — role only (no human text).
 *   4. `{ attributes }` — last resort, keyed off the structural path so the
 *      criterion is still a (loose) constraint rather than an empty match-all.
 *
 * `role` matches the diff's `type`/`semanticType`; `textContains` matches the
 * diff's `description` (case-insensitive). The fingerprint hash itself is never
 * emitted — it is not present on a live {@link ElementChange}.
 */
export function fingerprintToCriteria(fp: ElementFingerprintData | undefined): IRElementCriteria {
  if (fp === undefined) {
    // No details for this hash — emit a non-matching-by-id-only empty criterion
    // is useless; fall back to a harmless attribute marker so the fact is still
    // distinguishable but effectively unconstrained.
    return { attributes: { 'data-fingerprint': 'unknown' } };
  }

  const role = fp.role && fp.role.trim().length > 0 ? fp.role.trim() : undefined;
  const rawText = fp.accessibleName ?? fp.landmarkLabel;
  const textContains =
    rawText && rawText.trim().length > 0 ? shortText(rawText) : undefined;

  if (role !== undefined && textContains !== undefined) {
    return { role, textContains };
  }
  if (textContains !== undefined) {
    return { textContains };
  }
  if (role !== undefined) {
    return { role };
  }
  // No role and no text — fall back to the structural path as an attribute so
  // the criterion carries *some* signal rather than matching everything.
  return { attributes: { 'data-structural-path': fp.structuralPath } };
}

// ---------------------------------------------------------------------------
// Frequency analysis
// ---------------------------------------------------------------------------

function keyFor(action: string, targetFingerprint: string | null): string {
  return `${action} ${targetFingerprint ?? 'null'}`;
}

/** Mutable per-group accumulator during the single pass over records. */
interface GroupAccumulator {
  action: string;
  targetFingerprint: string | null;
  support: number;
  /** consequence hash → count of occurrences in which it appeared. */
  appearCounts: Map<string, number>;
  /** consequence hash → count of occurrences in which it disappeared. */
  disappearCounts: Map<string, number>;
}

/**
 * Frequency analysis (plan §7). Accumulate appeared / disappeared consequence
 * hashes per `(action, targetFingerprint)`, divide each consequence's count by
 * the group's support, and keep the consequences whose frequency ≥
 * `minConfidence` when the group's support ≥ `minSupport`. Each kept consequence
 * hash is reduced to a live-matchable {@link IRElementCriteria} from
 * `details[hash]` (role + textContains, NOT the raw hash).
 *
 * Within a single occurrence a consequence hash is counted at most once per kind
 * (de-duplicated) so confidence is a true "fraction of occurrences", never > 1.
 */
export function inferSignatures(
  records: EffectRecord[],
  details: CooccurrenceExportData['fingerprintDetails'],
  opts?: InferenceOptions,
): InferredSignatureTable {
  const minConfidence = opts?.minConfidence ?? 0.5;
  const minSupport = opts?.minSupport ?? 3;

  const groups = new Map<string, GroupAccumulator>();

  for (const rec of records) {
    const k = keyFor(rec.action, rec.targetFingerprint);
    let group = groups.get(k);
    if (group === undefined) {
      group = {
        action: rec.action,
        targetFingerprint: rec.targetFingerprint,
        support: 0,
        appearCounts: new Map(),
        disappearCounts: new Map(),
      };
      groups.set(k, group);
    }
    group.support += 1;

    // De-dup within this single occurrence so a hash appearing twice in one
    // transition still contributes only one occurrence-count.
    for (const hash of new Set(rec.appeared)) {
      group.appearCounts.set(hash, (group.appearCounts.get(hash) ?? 0) + 1);
    }
    for (const hash of new Set(rec.disappeared)) {
      group.disappearCounts.set(hash, (group.disappearCounts.get(hash) ?? 0) + 1);
    }
  }

  const bySignatureKey = new Map<string, InferredSignatureEntry>();

  for (const [k, group] of groups) {
    if (group.support < minSupport) continue;

    const facts: InferredFact[] = [];

    for (const [hash, count] of group.appearCounts) {
      const confidence = count / group.support;
      if (confidence >= minConfidence) {
        facts.push({
          criteria: fingerprintToCriteria(details[hash]),
          confidence,
          kind: 'appear',
        });
      }
    }
    for (const [hash, count] of group.disappearCounts) {
      const confidence = count / group.support;
      if (confidence >= minConfidence) {
        facts.push({
          criteria: fingerprintToCriteria(details[hash]),
          confidence,
          kind: 'disappear',
        });
      }
    }

    // A group with support but no consequence clearing the confidence floor
    // still records its support (so callers can see it was observed) but with no
    // facts → it predicts nothing.
    bySignatureKey.set(k, {
      action: group.action,
      targetFingerprint: group.targetFingerprint,
      support: group.support,
      facts,
    });
  }

  return { bySignatureKey, keyFor };
}
