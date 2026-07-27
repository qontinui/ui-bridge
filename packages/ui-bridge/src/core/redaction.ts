/**
 * §4.6 redaction predicates — the minimal, self-contained split that the
 * structural-enforcement plan adopts wholesale.
 *
 * This module is the Phase-0 seed of the eventual `core/redaction.ts` choke
 * point (plan `2026-07-20-ui-bridge-structural-redaction-enforcement.md`). It
 * carries ONLY what the arbitrary-selector-bypass fix needs so it can land
 * standalone, ahead of the large structural refactor: two predicates plus a
 * re-export of the existing `REDACTED_VALUE` sentinel. When the structural
 * work lands, the predicates below are the ones it moves here verbatim.
 *
 * The two-predicate split is load-bearing for capability, not decoration:
 *   - `isValueRedacted`  — `<input type="password">` OR a `data-bridge-redact`
 *     boundary. The stricter gate: a password field's *value* is always
 *     hidden. Used for value/echo projections.
 *   - `isContentRedacted` — a `data-bridge-redact` boundary ONLY. Used for
 *     text/content projections. A password field is NOT content-redacted, so
 *     it stays addressable by label/role — only its value is hidden.
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.6.
 */

// The single canonical redaction sentinel. It lives HERE, in the choke-point
// module, rather than in `core/registry.ts`, so this module is a true leaf:
// `registry.ts` imports the predicates/minters from here, so the sentinel
// must not import back from `registry.ts` (that was a cycle). Consumers that
// assert on the sentinel import it from here (or the package root, which
// surfaces it via this module).
export const REDACTED_VALUE = '[REDACTED]';
import type { ElementState, MediaMetadata } from './types';
import { truncateCodePoints } from './text';

/**
 * The attribute that marks an element (and its subtree) as sensitive. Honored
 * on the element itself OR on any ancestor, so a form can opt its whole
 * subtree in with one attribute.
 */
const BRIDGE_REDACT_ATTR = 'data-bridge-redact';

/**
 * Walk from `el` up through `parentElement` until we hit an ancestor (or `el`
 * itself) carrying `data-bridge-redact="true"`. Returns the matched element,
 * or `null` if none.
 *
 * Null-tolerant by design: a `null`/`undefined` start (or a detached node
 * whose `parentElement` chain runs out) simply returns `null` rather than
 * throwing, so every caller can pass a possibly-missing element without a
 * guard. The truthy check accepts the exact string `"true"` — NOT `""` /
 * `"false"` / `"yes"` — so a typo can't silently disable redaction.
 */
export function closestRedactionBoundary(el: HTMLElement | null | undefined): HTMLElement | null {
  let cursor: HTMLElement | null = el ?? null;
  while (cursor) {
    if (cursor.getAttribute(BRIDGE_REDACT_ATTR) === 'true') return cursor;
    cursor = cursor.parentElement;
  }
  return null;
}

/** `true` when `el` is an `<input type="password">`. Realm-safe (checks
 * `tagName` rather than `instanceof`, which fails across document realms). */
function isPasswordInput(el: HTMLElement): boolean {
  return el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'password';
}

/**
 * §4.6 VALUE verdict — the stricter gate. `true` when the element's *value*
 * must be hidden: it is a password input (unconditional, no opt-in required)
 * OR it sits inside a `data-bridge-redact` boundary. Use this for anything
 * that echoes or reads an element's value.
 */
export function isValueRedacted(el: HTMLElement | null | undefined): boolean {
  if (!el) return false;
  if (isPasswordInput(el)) return true;
  return closestRedactionBoundary(el) !== null;
}

/**
 * §4.6 CONTENT verdict — boundary only. `true` when the element sits inside a
 * `data-bridge-redact` boundary. Use this for text/content projections. A
 * password field is deliberately NOT content-redacted: its value is hidden by
 * `isValueRedacted`, but the element itself stays findable/addressable.
 */
export function isContentRedacted(el: HTMLElement | null | undefined): boolean {
  if (!el) return false;
  return closestRedactionBoundary(el) !== null;
}

// ===========================================================================
// Structural-enforcement machinery (plan Phase 2)
// ---------------------------------------------------------------------------
// Everything below is TYPE-ONLY at runtime except the minters, which return
// exactly the bytes they always did — the brands erase at compile. No wire
// shape changes. The value is compile-time: a raw DOM string cannot be assigned
// into a branded wire field (Phase 3), and a redaction verdict cannot be
// hand-forged. These symbols are ADDED here; Phase 3/4 wires them into the
// projection builders. Leaving them uncalled for now is intentional.
// ===========================================================================

/**
 * Opaque brand marking a string (or record) that has passed through this
 * module's §4.6 scrub. A raw `string` is NOT assignable to `Scrubbed<string>`
 * — that is the whole point: once Phase 3 declares the content-bearing fields
 * on the wire types as `Scrubbed<string>`, assigning un-scrubbed DOM content
 * into one becomes a compile error (`TS2322`). The brand can be minted ONLY by
 * the factories in this module — the branding key is a module-private
 * `unique symbol`, so it is unforgeable and un-castable from outside.
 */
declare const scrubbed: unique symbol;
export type Scrubbed<T> = T & { readonly [scrubbed]: true };

/**
 * Opaque §4.6 verdict token. Carries both predicates, but is deliberately NOT
 * hand-constructible: a caller cannot write `{ value: false, content: false }`
 * to fake a "not redacted" verdict and slip an unscrubbed value past a
 * verdict-taking minter (the bare-boolean bypass a plain `{value,content}`
 * signature would permit). Obtainable ONLY from `verdictOf` (live element) or
 * `verdictFromState` (the DOM-less wire arms). The `__verdict` key is a
 * module-private `unique symbol`, so the object can be minted only here.
 */
declare const __verdict: unique symbol;
export interface RedactionVerdict {
  readonly value: boolean;
  readonly content: boolean;
  readonly [__verdict]: true;
}

/** The sole mint point for a verdict — the cast is confined to this module. */
function mintVerdict(value: boolean, content: boolean): RedactionVerdict {
  return { value, content } as RedactionVerdict;
}

/**
 * A both-axes-redacted verdict for FAIL-CLOSED sites: a form-library adapter
 * whose `domField` is `null` (field registered in the store but not mounted)
 * has no element to test, so the framework-store value would otherwise ship
 * un-gated. Redact instead — over-redacting an invisible field is the accepted
 * cost of failing closed (plan §"What cannot be guaranteed" #9).
 */
export function verdictFailClosed(): RedactionVerdict {
  return mintVerdict(true, true);
}

/**
 * Compute the §4.6 verdict for a live element. `value` = password OR boundary
 * (the stricter gate); `content` = boundary only. This is the DOM entry point
 * to every minter.
 */
export function verdictOf(el: HTMLElement | null | undefined): RedactionVerdict {
  return mintVerdict(isValueRedacted(el), isContentRedacted(el));
}

/**
 * Recover the verdict from a state blob's `redaction` provenance field, for the
 * DOM-less wire arms (`DiscoveredElement` crosses the wire with no element
 * ref, so it cannot recompute the predicate). A state that never stamped
 * `redaction` reads as "not redacted" on both axes — which is precisely why
 * every state builder MUST stamp it (see `elementRedaction`): a missing stamp
 * is indistinguishable from "genuinely not redacted", so the enforcement is
 * that a DOM-less arm cannot mint a `Scrubbed<string>` without a verdict, and
 * cannot obtain a verdict without either a live element or a stamped state.
 */
export function verdictFromState(state: Pick<ElementState, 'redaction'>): RedactionVerdict {
  const r = state.redaction;
  return mintVerdict(r?.value === true, r?.content === true);
}

/**
 * Build the `ElementState.redaction` provenance for `el`, or `undefined` when
 * neither axis applies — so the field is OMITTED (absent === "not redacted"),
 * never emitted as an empty `{}`. This is the single shared stamper that every
 * `getElementState`-shaped builder uses, so the provenance is derived one way,
 * in one place.
 */
export function elementRedaction(el: HTMLElement | null | undefined): ElementState['redaction'] {
  const v = verdictOf(el);
  if (!v.value && !v.content) return undefined;
  const out: { content?: true; value?: true } = {};
  if (v.content) out.content = true;
  if (v.value) out.value = true;
  return out;
}

/**
 * Presence-preserving scrub — the ONE scrub shape in the package (there must
 * never be two; a second, divergent scrub is exactly the drift §4.6 keeps
 * re-growing). Every minter below shares this contract:
 *
 *   - falsy in (`undefined` OR `''`) → `undefined` out. The empty string is
 *     treated as ABSENT, not "present-but-empty": a projection field that is
 *     `''` and one that is missing are indistinguishable to every downstream
 *     consumer, so emitting `''` only adds noise. The one accepted consequence
 *     is `<img alt="">` (a deliberately-empty alt, the valid a11y signal for a
 *     decorative image) collapses to `undefined` rather than surviving as `''`.
 *     Accepted: the §4.6 guarantee (no secret leaks) dominates the marginal
 *     loss of a decorative-image hint, and a consumer that genuinely needs
 *     "alt present but empty" can read the raw attribute itself.
 *   - truthy in + redacted (on the relevant axis) → `REDACTED_VALUE`.
 *   - truthy in + not redacted → the raw string, now BRANDED so it can flow
 *     into a `Scrubbed<string>` wire field.
 *
 * The cast to `Scrubbed<string>` lives ONLY in these two `*ByVerdict` roots.
 */
export function scrubValueByVerdict(
  raw: string | undefined,
  v: RedactionVerdict
): Scrubbed<string> | undefined {
  // VALUE diverges from CONTENT on the empty string: an empty INPUT VALUE is a
  // MEANINGFUL state (a field cleared to ""), not "absent" — so `''` is
  // PRESERVED here (only `undefined` maps to `undefined`). CONTENT (alt/label)
  // keeps the collapse-empty-to-undefined rule (`<img alt="">` → undefined).
  // An empty value carries no secret, so it is never redacted to the sentinel.
  if (raw === undefined) return undefined;
  if (raw === '') return '' as Scrubbed<string>;
  return (v.value ? REDACTED_VALUE : raw) as Scrubbed<string>;
}

export function scrubContentByVerdict(
  raw: string | undefined,
  v: RedactionVerdict
): Scrubbed<string> | undefined {
  if (!raw) return undefined;
  return (v.content ? REDACTED_VALUE : raw) as Scrubbed<string>;
}

/** Scrub a VALUE-bearing field (input value, echoes) against a live element. */
export function scrubValue(
  raw: string | undefined,
  el: HTMLElement | null | undefined
): Scrubbed<string> | undefined {
  return scrubValueByVerdict(raw, verdictOf(el));
}

/** Scrub a CONTENT-bearing field (text, labels, alt) against a live element. */
export function scrubContent(
  raw: string | undefined,
  el: HTMLElement | null | undefined
): Scrubbed<string> | undefined {
  return scrubContentByVerdict(raw, verdictOf(el));
}

// ===========================================================================
// Reader-minters — read raw DOM content AND scrub in one step
// ---------------------------------------------------------------------------
// `core/redaction.ts` (with `core/a11y.ts`) is the only module the §4.6 CI
// guard permits to read `.value` / `.textContent` raw. A projection module that
// needs a scrubbed input value or element text calls one of these instead of
// open-coding `scrubValue(el.value, el)` — which would itself trip the guard's
// raw-`.value`-read ban at the call site. The raw read happens HERE, inside the
// sanctioned reader, so the call site holds no raw DOM content read at all.
// ===========================================================================

/**
 * Read an `<input>`/`<textarea>`/`<select>` VALUE and scrub it (VALUE axis:
 * password OR boundary). Pass a precomputed `verdict` when the caller already
 * has one (avoids a second boundary walk); otherwise it is derived from `el`.
 */
export function readScrubbedValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null | undefined,
  verdict?: RedactionVerdict
): Scrubbed<string> | undefined {
  if (!el) return undefined;
  return scrubValueByVerdict(el.value, verdict ?? verdictOf(el));
}

/**
 * Read an element's `textContent` and scrub it (CONTENT axis: boundary only).
 * `opts.normalizeWhitespace` collapses whitespace runs; `opts.maxLen` truncates
 * — both applied to the RAW text BEFORE scrubbing, so a redacted read collapses
 * to the sentinel rather than a truncated sentinel. Falsy/empty text → undefined
 * (the presence-preserving CONTENT contract).
 */
export function readScrubbedText(
  el: Element | null | undefined,
  verdict?: RedactionVerdict,
  opts?: { normalizeWhitespace?: boolean; maxLen?: number }
): Scrubbed<string> | undefined {
  if (!el) return undefined;
  let raw = el.textContent?.trim();
  if (!raw) return undefined;
  if (opts?.normalizeWhitespace) raw = raw.replace(/\s+/g, ' ');
  if (opts?.maxLen != null) raw = truncateCodePoints(raw, opts.maxLen);
  return scrubContentByVerdict(raw, verdict ?? verdictOf(el as HTMLElement));
}

/**
 * Required-string variant of the CONTENT scrub, for a wire field typed as a
 * NON-optional `Scrubbed<string>` (e.g. `AIDiscoveredElement.description`).
 * Unlike `scrubContentByVerdict` it never returns `undefined`: an empty input
 * stays the (branded) empty string rather than collapsing to `undefined`,
 * because the destination field must always be present. Content-redacted →
 * the sentinel.
 */
export function scrubContentRequired(raw: string, v: RedactionVerdict): Scrubbed<string> {
  return (v.content ? REDACTED_VALUE : raw) as Scrubbed<string>;
}

/**
 * Required-string variant of the VALUE scrub, for a wire field typed as a
 * NON-optional `Scrubbed<string>` (e.g. `FormFieldState.value`). Value-redacted
 * (password OR boundary) → the sentinel; otherwise the branded raw string.
 */
export function scrubValueRequired(raw: string, v: RedactionVerdict): Scrubbed<string> {
  return (v.value ? REDACTED_VALUE : raw) as Scrubbed<string>;
}

/**
 * Scrub a DOM-DERIVED alias list. §4.6: aliases are generated wholesale from
 * an element's `aria-label` / `placeholder` / `title` / text, so a
 * content-redacted element must contribute NONE — the array collapses to `[]`
 * (mirrors the `redacted ? [] : generateAliases(...)` shape at the choke
 * point). Non-redacted: the raw list, branded. The brand-cast is confined to
 * this module. NOTE: developer-SET aliases are a separate, documented boundary
 * — callers merge those back AFTER this scrub (they are not DOM-derived).
 */
export function scrubAliases(aliases: string[], v: RedactionVerdict): Scrubbed<string>[] {
  return (v.content ? [] : aliases) as Scrubbed<string>[];
}

/**
 * Brand a DEVELOPER-AUTHORED string that is a documented §4.6 boundary
 * exemption — `element.label` / `element.description` / `element.aliases` set
 * EXPLICITLY on the registration, NOT scraped from the DOM. §4.6 protects
 * DOM-DERIVED content; a value the developer hand-wrote onto the registration
 * is their deliberate choice and passes through verbatim (a dev who writes a
 * secret into `aliases` still ships it — out of scope, by design). This is the
 * ONE sanctioned brand-without-scrub, and it exists so those trusted fields can
 * flow into a `Scrubbed<string>` wire slot. It must NEVER wrap a raw DOM read —
 * that is what `scrubContent`/`scrubValue` are for. The cast is confined here.
 */
export function trustDeveloperContent(raw: string): Scrubbed<string>;
export function trustDeveloperContent(raw: string | undefined): Scrubbed<string> | undefined;
export function trustDeveloperContent(
  raw: string | undefined
): Scrubbed<string> | undefined {
  return raw as Scrubbed<string> | undefined;
}

/**
 * Container brand for a `Record<string, string>` attribute payload (plan
 * limit 3: fields inside cannot be branded individually, so the whole map is
 * made constructible only through this factory). CONTENT axis: inside a
 * content-redaction boundary every attribute VALUE collapses to the sentinel
 * while KEYS survive (attribute names are developer-authored, not secrets).
 */
export function scrubRecord(
  rec: Record<string, string>,
  v: RedactionVerdict
): Scrubbed<Record<string, string>> {
  if (!v.content) return rec as Scrubbed<Record<string, string>>;
  const out: Record<string, string> = {};
  for (const key of Object.keys(rec)) out[key] = REDACTED_VALUE;
  return out as Scrubbed<Record<string, string>>;
}

/**
 * Container brand for a React-fiber prop bag (`extractReactState`). VALUE axis
 * — a controlled `<input type="password">`'s `props.value` IS the cleartext
 * secret: inside a value-redaction verdict every prop VALUE collapses to the
 * sentinel while prop KEYS survive (they are source identifiers the developer
 * wrote, useful for orientation and not themselves sensitive).
 */
export function scrubReactProps(
  props: Record<string, unknown>,
  v: RedactionVerdict
): Scrubbed<Record<string, unknown>> {
  if (!v.value) return props as Scrubbed<Record<string, unknown>>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(props)) out[key] = REDACTED_VALUE;
  return out as Scrubbed<Record<string, unknown>>;
}

/**
 * Field-by-field scrub for a `MediaMetadata` payload. CONTENT axis: inside a
 * content-redaction boundary a media element's URL/text fields ARE the
 * rendered secret — a `data:image/...;base64,...` URI can be a QR code or a
 * one-time key, a signed URL carries a token in its query string, and
 * `altText` describes the sensitive image. Those collapse to the sentinel;
 * the STRUCTURAL fields (`mediaType`, dimensions, `format`, `sizes`, loading
 * state, video timing) SURVIVE so oversize / lazy-load / playback audits keep
 * working inside a redacted subtree.
 *
 * `MediaMetadata` is a shared cross-wire interface (registration metadata,
 * snapshot, discover) so its fields are NOT branded individually — this
 * container-scrub is applied at each media projection instead. Returns the
 * input untouched when the content axis does not apply (zero copy on the
 * common path).
 */
export function scrubMediaMetadata(
  meta: MediaMetadata | undefined,
  v: RedactionVerdict
): MediaMetadata | undefined {
  if (!meta || !v.content) return meta;
  return {
    ...meta,
    src: meta.src ? REDACTED_VALUE : meta.src,
    altText: meta.altText ? REDACTED_VALUE : meta.altText,
    srcset: meta.srcset ? REDACTED_VALUE : meta.srcset,
    sources: meta.sources?.map((s) => ({
      ...s,
      srcset: s.srcset ? REDACTED_VALUE : s.srcset,
    })),
    videoState: meta.videoState
      ? {
          ...meta.videoState,
          poster: meta.videoState.poster ? REDACTED_VALUE : meta.videoState.poster,
        }
      : meta.videoState,
  };
}

/**
 * The ONE `<select>` option-list scrub, shared by all three `getElementState`
 * builders (`core/registry.ts`, `control/action-executor.ts`,
 * `render-log/dom-capture.ts`) so the shape — crucially the COUNT-collapse
 * decision — cannot drift between them.
 *
 * VALUE axis. When value-redacted (password OR boundary) the whole option list
 * collapses to a SINGLE synthetic entry, so neither the option COUNT nor the
 * selected-INDEX carries a signal: an env/tenant switcher's option list, and
 * its cardinality, can itself be sensitive. When not redacted, every option's
 * `value`/`label` is minted through the value scrub (a no-op passthrough on the
 * common path) and the real count + `selected` flags survive.
 *
 * Returns the three `ElementState` fields the caller assigns verbatim — there
 * is no per-builder mapping left to diverge.
 */
export function scrubSelectState(
  el: HTMLSelectElement,
  v: RedactionVerdict
): {
  value: Scrubbed<string> | undefined;
  selectedOptions: Scrubbed<string>[];
  availableOptions: Array<{ value: Scrubbed<string>; label: Scrubbed<string>; selected: boolean }>;
} {
  const value = scrubValueByVerdict(el.value, v);
  if (v.value) {
    const sentinel = scrubValueRequired(REDACTED_VALUE, v);
    return {
      value,
      selectedOptions: [sentinel],
      availableOptions: [{ value: sentinel, label: sentinel, selected: false }],
    };
  }
  return {
    value,
    selectedOptions: Array.from(el.selectedOptions)
      .map((opt) => scrubValueByVerdict(opt.value, v))
      .filter((x): x is Scrubbed<string> => x !== undefined),
    availableOptions: Array.from(el.options).map((opt) => ({
      value: scrubValueRequired(opt.value, v),
      label: scrubValueRequired(opt.label || opt.text || opt.value, v),
      selected: opt.selected,
    })),
  };
}
