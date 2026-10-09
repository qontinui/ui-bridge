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
 * - every path segment equal to a param value becomes `[name]`;
 * - a run of segments equal to a multi-segment value (a catch-all `string[]`,
 *   or a React Router splat string containing `/`) becomes `[...name]`;
 * - segments are compared after `decodeURIComponent` (inside try/catch) on
 *   BOTH sides, and also in raw form, so an encoded/decoded mismatch between
 *   the router and the URL still substitutes (see `forms`);
 * - POST-CHECK: if any param value still appears as a segment, the result is
 *   `null`;
 * - `matched: false` (a 404 — `useParams()` is `{}` there, so nothing would be
 *   substituted) is `null`.
 *
 * Over-templating (a static segment that happens to equal a param value also
 * becomes `[name]`) is harmless. Under-templating leaks, so it is made
 * impossible: the function returns either a string in which no param value
 * survives as a segment, or `null`.
 *
 * @example
 * ```tsx
 * import { usePathname, useParams } from 'next/navigation';
 * import { routePatternFromParams, useRouteAwareness } from '@qontinui/ui-bridge/react';
 *
 * function RouteAwareness() {
 *   const pathname = usePathname();
 *   const params = useParams();
 *   useRouteAwareness({
 *     pattern: routePatternFromParams(pathname, params, { matched: true }),
 *     patternSource: 'router',
 *   });
 *   return null;
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

/** One param, normalised into the segment run it occupies in a pathname. */
interface ParamRun {
  name: string;
  /** Each segment of the value, as the set of forms it may appear in. */
  pieces: Set<string>[];
  /** `true` → render as `[...name]`, else `[name]`. */
  catchAll: boolean;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Bound on repeated decoding; real routers decode once, this is headroom. */
const MAX_DECODE_PASSES = 4;

/**
 * The forms a segment or value is compared in: raw, plus each successive
 * `decodeURIComponent` of it. Comparing on any shared form is a superset of
 * comparing on the single decoded form, so it can only ADD substitutions —
 * which is the safe direction (an encoded/decoded mismatch, or a doubly
 * encoded segment, still substitutes instead of leaking).
 */
function forms(value: string): Set<string> {
  const out = new Set<string>([value]);
  let current = value;
  for (let i = 0; i < MAX_DECODE_PASSES; i++) {
    const next = safeDecode(current);
    if (next === current) break;
    out.add(next);
    current = next;
  }
  return out;
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const v of a) {
    if (b.has(v)) return true;
  }
  return false;
}

function toRuns(params: RouteParamsInput): ParamRun[] {
  const runs: ParamRun[] = [];
  if (!params) return runs;
  for (const [name, raw] of Object.entries(params)) {
    if (raw === undefined || raw === null) continue;
    const isArray = Array.isArray(raw);
    const segments: string[] = isArray
      ? (raw as readonly string[]).flatMap((v) => String(v).split('/'))
      : String(raw).split('/');
    const nonEmpty = segments.filter((s) => s !== '');
    if (nonEmpty.length === 0) continue;
    runs.push({
      name,
      pieces: nonEmpty.map(forms),
      catchAll: isArray || nonEmpty.length > 1,
    });
  }
  // Longest runs first, so a catch-all claims its whole run before a shorter
  // param could claim one of its segments.
  runs.sort((a, b) => b.pieces.length - a.pieces.length);
  return runs;
}

/** A segment in the working pathname: still concrete, or already templated. */
type Slot = { kind: 'concrete'; raw: string; forms: Set<string> } | { kind: 'token'; text: string };

/**
 * Derive a route pattern from a concrete pathname and the router's RAW params
 * (do not pre-flatten catch-all arrays). Returns `null` when the route did not
 * match, or when any param value would survive in the result.
 */
export function routePatternFromParams(
  pathname: string | null | undefined,
  params: RouteParamsInput,
  options: RoutePatternFromParamsOptions
): string | null {
  if (!options.matched) return null;
  if (typeof pathname !== 'string') return null;

  const runs = toRuns(params);
  let slots: Slot[] = pathname
    .split('/')
    .map((raw) => ({ kind: 'concrete' as const, raw, forms: forms(raw) }));

  for (const run of runs) {
    const len = run.pieces.length;
    const token = run.catchAll ? `[...${run.name}]` : `[${run.name}]`;
    const next: Slot[] = [];
    let i = 0;
    while (i < slots.length) {
      let hit = i + len <= slots.length;
      for (let k = 0; hit && k < len; k++) {
        const slot = slots[i + k];
        hit = slot.kind === 'concrete' && slot.raw !== '' && intersects(slot.forms, run.pieces[k]);
      }
      if (hit) {
        next.push({ kind: 'token', text: token });
        i += len;
      } else {
        next.push(slots[i]);
        i += 1;
      }
    }
    slots = next;
  }

  const out = slots.map((s) => (s.kind === 'token' ? s.text : s.raw));

  // Post-check: no param value may survive as a segment of the OUTPUT — read
  // off the final string, not off the bookkeeping, so a bug above cannot hide
  // a leak. A token that itself equals a value (a value literally `[id]`) also
  // trips this, which fails closed.
  for (const segment of out) {
    if (segment === '') continue;
    const segForms = forms(segment);
    for (const run of runs) {
      for (const piece of run.pieces) {
        if (intersects(segForms, piece)) return null;
      }
    }
  }

  return out.join('/');
}
