/**
 * routePatternFromParams — derive a route PATTERN from a concrete pathname and
 * the router's raw params, failing closed.
 *
 * Why this exists: `useRouteAwareness({ pattern })` is consumed as a route
 * TEMPLATE (e.g. the runner's journey ledger stores it as `pathnameTemplate`,
 * which must never carry user input). Next.js exposes no route manifest at
 * runtime, so an app cannot ask "which segments are dynamic?" — it only has
 * `usePathname()` and `useParams()`. Passing `pathname` as the pattern leaks
 * every dynamic segment (`/search/<what the user typed>`).
 *
 * The derivation is VALUE substitution:
 *
 * - a segment equal to a param value becomes `[name]` (a value containing `/`
 *   — React Router decodes `%2F` inside a `:param` — may match one segment
 *   whole);
 * - a run of segments equal to a multi-segment value (a catch-all `string[]`,
 *   or a React Router splat string containing `/`) becomes `[...name]`, and
 *   so does any match of an array param;
 * - segments and values are compared raw and after each successive
 *   `decodeURIComponent` (inside try/catch), on BOTH sides.
 *
 * Then it fails closed — the result is `null` when:
 *
 * - `matched` is `false`;
 * - `pathname` is not a string, or carries a `?` or `#` (it is not a bare
 *   pathname, so a query or fragment would ride along);
 * - any segment or value has not reached a decoding fixed point within
 *   `MAX_DECODE_PASSES` (its fully decoded form is unknown, so containment
 *   cannot be checked);
 * - POST-CHECK, by CONTAINMENT: any decoded form of any non-template segment
 *   of the output CONTAINS any decoded form of any param value or of any of
 *   its `/`-separated pieces. This catches a value sharing a segment with
 *   static text (`/files/abc.json` for `:id.json`). Short values will null
 *   some legitimate paths (`{ id: '1' }` nulls `/v1/items/1`); that is the
 *   intended direction.
 *
 * GUARANTEE, and its precondition: a non-null result contains no param value
 * the caller passed, as a substring of any segment in any decoded form. It
 * says nothing about text the router did NOT report as a param — so it holds
 * for user input only when `params` is the router's complete, raw params for
 * the route it actually matched, and `matched` is `false` whenever no route
 * matched (a 404 has `useParams() == {}`, so with `matched: true` the
 * concrete path would come back unchanged). Reporting `matched` correctly is
 * the caller's job; see `useRouteAwareness` for the not-found signal.
 *
 * @example
 * ```tsx
 * import { usePathname, useParams } from 'next/navigation';
 * import { routePatternFromParams } from '@qontinui/ui-bridge/react';
 *
 * function usePattern(matched: boolean) {
 *   const pathname = usePathname();
 *   const params = useParams();
 *   return routePatternFromParams(pathname, params, { matched });
 * }
 * ```
 */

/** Raw router params: a value per name, an array for a catch-all. */
export type RouteParamsInput =
  | Readonly<Record<string, string | readonly string[] | undefined>>
  | null
  | undefined;

export interface RoutePatternFromParamsOptions {
  /**
   * Whether the router matched a route for this pathname. `false` (a 404 /
   * not-found render) always yields `null`: the params are empty there, so
   * nothing could be substituted and the concrete path would leak.
   */
  matched: boolean;
}

/** Bound on repeated decoding. Not reaching a fixed point within it is null. */
const MAX_DECODE_PASSES = 4;

/** A string's comparison forms: raw plus each successive decode. */
interface Forms {
  all: Set<string>;
  /** `false` when decoding was still changing the string after the bound. */
  settled: boolean;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function forms(value: string): Forms {
  const all = new Set<string>([value]);
  let current = value;
  for (let i = 0; i < MAX_DECODE_PASSES; i++) {
    const next = safeDecode(current);
    if (next === current) return { all, settled: true };
    all.add(next);
    current = next;
  }
  return { all, settled: safeDecode(current) === current };
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const v of a) {
    if (b.has(v)) return true;
  }
  return false;
}

/** One param, normalised for matching. */
interface ParamRun {
  name: string;
  /** The unsplit value (array values joined with `/`). */
  whole: Forms;
  /** Each `/`-separated piece of the value. */
  pieces: Forms[];
  /** An array (catch-all) param always renders as `[...name]`. */
  isArray: boolean;
}

function toRuns(params: RouteParamsInput): ParamRun[] | null {
  const runs: ParamRun[] = [];
  if (!params) return runs;
  for (const [name, raw] of Object.entries(params)) {
    if (raw === undefined || raw === null) continue;
    const isArray = Array.isArray(raw);
    const values: string[] = isArray ? (raw as readonly string[]).map(String) : [String(raw)];
    const nonEmpty = values.flatMap((v) => v.split('/')).filter((s) => s !== '');
    if (nonEmpty.length === 0) continue;
    const whole = forms(values.join('/'));
    const pieces = nonEmpty.map(forms);
    if (!whole.settled || pieces.some((p) => !p.settled)) return null;
    runs.push({ name, whole, pieces, isArray });
  }
  // Longest runs first, so a catch-all claims its whole run before a shorter
  // param could claim one of its segments.
  runs.sort((a, b) => b.pieces.length - a.pieces.length);
  return runs;
}

/** A segment in the working pathname: still concrete, or already templated. */
type Slot = { kind: 'concrete'; raw: string; forms: Forms } | { kind: 'token'; text: string };

function containsAny(haystack: Set<string>, needles: Set<string>): boolean {
  for (const h of haystack) {
    for (const n of needles) {
      if (n !== '' && h.includes(n)) return true;
    }
  }
  return false;
}

/**
 * Derive a route pattern from a concrete pathname and the router's RAW params
 * (do not pre-flatten catch-all arrays). Returns `null` when the route did not
 * match, or when any param value could survive in the result.
 */
export function routePatternFromParams(
  pathname: string | null | undefined,
  params: RouteParamsInput,
  options: RoutePatternFromParamsOptions
): string | null {
  if (!options.matched) return null;
  if (typeof pathname !== 'string') return null;
  if (pathname.includes('?') || pathname.includes('#')) return null;

  const runs = toRuns(params);
  if (runs === null) return null;

  let slots: Slot[] = [];
  for (const raw of pathname.split('/')) {
    const f = forms(raw);
    if (!f.settled) return null;
    slots.push({ kind: 'concrete', raw, forms: f });
  }

  const matchesAt = (i: number, run: ParamRun): number => {
    const first = slots[i];
    if (first.kind !== 'concrete' || first.raw === '') return 0;
    // A whole value as one segment (`c%2Fd` for `c/d`).
    if (intersects(first.forms.all, run.whole.all)) return 1;
    const len = run.pieces.length;
    if (i + len > slots.length) return 0;
    for (let k = 0; k < len; k++) {
      const slot = slots[i + k];
      if (slot.kind !== 'concrete' || slot.raw === '') return 0;
      if (!intersects(slot.forms.all, run.pieces[k].all)) return 0;
    }
    return len;
  };

  for (const run of runs) {
    const next: Slot[] = [];
    let i = 0;
    while (i < slots.length) {
      const consumed = matchesAt(i, run);
      if (consumed > 0) {
        const spread = consumed > 1 || run.isArray;
        next.push({ kind: 'token', text: spread ? `[...${run.name}]` : `[${run.name}]` });
        i += consumed;
      } else {
        next.push(slots[i]);
        i += 1;
      }
    }
    slots = next;
  }

  // Post-check by containment, over the final slots. A template token is
  // checked by equality only (its own `[name]` text is not user input), so a
  // value that is literally `[id]` still fails closed.
  for (const slot of slots) {
    if (slot.kind === 'token') {
      const tokenForms = forms(slot.text).all;
      if (
        runs.some(
          (r) =>
            intersects(tokenForms, r.whole.all) ||
            r.pieces.some((p) => intersects(tokenForms, p.all))
        )
      ) {
        return null;
      }
      continue;
    }
    if (slot.raw === '') continue;
    for (const run of runs) {
      if (containsAny(slot.forms.all, run.whole.all)) return null;
      for (const piece of run.pieces) {
        if (containsAny(slot.forms.all, piece.all)) return null;
      }
    }
  }

  return slots.map((s) => (s.kind === 'token' ? s.text : s.raw)).join('/');
}
