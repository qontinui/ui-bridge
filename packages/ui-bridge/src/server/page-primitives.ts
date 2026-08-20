/**
 * Shared page-primitive implementations for the app-agnostic interaction
 * endpoints: `readValue`, `findByText`, `clickByText`, `clickBySelector`,
 * `typeInto`, and `sendKeysToPage`.
 *
 * These operations are dispatched from TWO places that must stay in
 * lockstep:
 *   - the standalone server handlers (`server/handlers.ts`), and
 *   - the React relay command dispatcher (`react/commandHandlers.ts`).
 * Historically each carried its own private copy of these bodies, so every
 * change — including the §4.6 redaction gates — had to land twice and could
 * silently drift. This module is the single implementation both dispatchers
 * call, so the redaction gate (and everything else) exists exactly once.
 *
 * Zero-dependency / browser-safe: like `./component-not-found`, it imports
 * only the DOM-finder helpers (`./dom-fallback`) and the redaction predicates
 * (`../core/redaction`), never the Node-leaning `server/handlers` module
 * graph. The browser relay bundle (`react/commandHandlers.ts`, the injected
 * runtime) can therefore pull it in without dragging that graph along — the
 * same constraint that already forced `buildComponentNotFoundError` out of
 * `server/handlers.ts` (see the comment near `server/handlers.ts` re
 * `./component-not-found`).
 *
 * The two dispatch paths differ ONLY in their side-effect adapters:
 *   - click mechanism: `el.click()` (standalone server) vs `dispatchRealClick`
 *     (React relay), and
 *   - fill mechanism:  inline value mutation + input/change events (standalone
 *     server) vs `reactAwareFill` (React relay).
 * Each primitive takes that adapter as a callback. ALL validation, element
 * resolution, §4.6 redaction gating, and echo construction live here, once;
 * the dispatchers supply only their thin adapter and wrap the result in their
 * own response shape (`success(...)` / `error(...)` for the standalone server,
 * a bare data object / `{ success: false, error }` for the relay).
 *
 * Cross-link: plans/2026-07-20-ui-bridge-structural-redaction-enforcement.md
 * (Phase 1 — de-duplicate handlers.ts ↔ commandHandlers.ts).
 */

import {
  REDACTED_VALUE,
  isValueRedacted,
  isContentRedacted,
  readScrubbedValue,
  readScrubbedText,
} from '../core/redaction';
import {
  findElementsByText,
  findElementBySelector,
  findAllElementsBySelector,
  findElementByLabel,
} from './dom-fallback';
import {
  normalizeKeyDescriptors,
  dispatchKeySequence,
  resolveKeyTarget,
  type KeyDispatchOutcome,
  type KeyDispatchTarget,
} from '../core/key-events';

/**
 * Neutral result of a page primitive. The dispatchers map this onto their own
 * response envelope:
 *   - standalone server: `ok ? success(data) : error(error, code)`
 *   - React relay:       `ok ? data : { success: false, error }` (code dropped,
 *     matching the relay's historical shape).
 * The `code` is the canonical internal error code the standalone handler used
 * before extraction (`INVALID_PARAMS`, `ELEMENT_NOT_FOUND`), preserved so the
 * server path's diagnostics are unchanged.
 */
export type PrimitiveResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string };

/** One hit from `findByText`. */
export interface FindByTextHit {
  index: number;
  tag: string;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
  disabled: boolean;
  visible: boolean;
}

/** The echoed element for a click primitive. */
export interface ClickEcho {
  tag: string;
  text: string;
  rect: DOMRect;
}

/** The echoed element for `typeInto`. */
export interface TypeEcho {
  tag: string;
  value: string | null;
}

/**
 * Build the redaction-safe element echo returned by the click primitives.
 * §4.6: don't echo the text of a boundary-redacted element.
 */
function buildClickEcho(el: HTMLElement): ClickEcho {
  return {
    tag: el.tagName.toLowerCase(),
    // §4.6: reader-minter reads textContent inside the choke point and scrubs on
    // the CONTENT axis (boundary → REDACTED_VALUE), so no raw read lives here.
    text: readScrubbedText(el, undefined, { maxLen: 200 }) ?? '',
    rect: el.getBoundingClientRect(),
  };
}

/** One element's value in a `readValue({ all: true })` batch read. */
export interface ReadValueHit {
  /** Position in the selector's document-order match set. */
  index: number;
  value: string | null;
  length: number;
}

/**
 * `readValue` result.
 *
 * `value`/`length` describe the SINGLE addressed element (the first match, or
 * the one at `index`) and are always present, so every pre-`all` caller keeps
 * working. `totalMatches` is always reported — a caller that reads one value
 * out of 14 matches deserves to know that, rather than inferring completeness
 * from a shape that cannot express it. `values` is present ONLY for
 * `all: true`.
 */
export interface ReadValueResult {
  value: string | null;
  length: number;
  /** How many elements the selector matched, whether or not `all` was set. */
  totalMatches: number;
  /** Every match's value, in document order. Present iff `all: true`. */
  values?: ReadValueHit[];
}

/**
 * Read one element's value through the §4.6 choke point.
 *
 * The `isValueRedacted` gate is unconditional — it covers password inputs with
 * no opt-in AND any element inside a `data-bridge-redact` boundary. The element
 * stays addressable; only its value is hidden. Applied PER ELEMENT, so a batch
 * read cannot launder a secret through the `all: true` path.
 */
function readGatedValue(el: HTMLElement): { value: string | null; length: number } {
  if (isValueRedacted(el)) {
    return { value: REDACTED_VALUE, length: 0 };
  }
  // el is proven not value-redacted above (password/boundary already returned),
  // so the reader-minters pass the raw content through — routing the read
  // through the choke point instead of touching `.value`/`.textContent` raw.
  const value =
    'value' in el
      ? (readScrubbedValue(el as HTMLInputElement) ?? null)
      : (readScrubbedText(el) ?? null);
  return { value, length: value?.length ?? 0 };
}

/**
 * `readValue` — read the value/text of a caller-supplied selector.
 *
 * `all: true` returns EVERY match in `values[]` (document order). It used to be
 * accepted and silently dropped, so a caller asking for 14 values got one with
 * no signal that the parameter had been ignored — an answer that looks complete
 * and is not. `all` is now honoured; a non-boolean `all`, or `all` combined
 * with the singular `index`, is REJECTED by name rather than reinterpreted.
 *
 * A selector matching nothing is `ELEMENT_NOT_FOUND` in BOTH modes, so the
 * endpoint has one rule for "no match" regardless of `all`.
 */
export function readValuePrimitive(
  selector: string | undefined,
  index?: number,
  options?: { all?: unknown }
): PrimitiveResult<ReadValueResult> {
  if (!selector?.trim()) {
    return { ok: false, error: 'selector is required and must not be empty', code: 'INVALID_PARAMS' };
  }

  const all = options?.all;
  if (all !== undefined && typeof all !== 'boolean') {
    return {
      ok: false,
      error: `'all' must be a boolean (got ${typeof all})`,
      code: 'INVALID_PARAMS',
    };
  }
  if (all === true && index !== undefined) {
    return {
      ok: false,
      error:
        "'all' and 'index' are mutually exclusive — 'all' returns every match, 'index' selects one. Drop one of them.",
      code: 'INVALID_PARAMS',
    };
  }

  const matches = findAllElementsBySelector(selector);
  const totalMatches = matches.length;

  if (all === true) {
    if (totalMatches === 0) {
      return {
        ok: false,
        error: `No element found for selector "${selector}"`,
        code: 'ELEMENT_NOT_FOUND',
      };
    }
    const values = matches.map((el, i) => ({ index: i, ...readGatedValue(el) }));
    // Destructured, not read as `values[0].value`: every entry is already
    // through the §4.6 gate, and the Layer-2 lint rightly cannot tell a
    // scrubbed carrier from a raw DOM read at a computed index.
    const { value, length } = values[0];
    return { ok: true, data: { value, length, totalMatches, values } };
  }

  const el = findElementBySelector(selector, index);
  if (!el) {
    return { ok: false, error: `No element found for selector "${selector}"`, code: 'ELEMENT_NOT_FOUND' };
  }
  return { ok: true, data: { ...readGatedValue(el), totalMatches } };
}

/**
 * Where a document-scoped key dispatch lands.
 *
 * Re-exported alias of the shared `KeyDispatchTarget`. The vocabulary, the
 * default (`document`) and the resolver live in `core/key-events.ts` so this
 * endpoint, the relay path, and the runner's `POST /ui-bridge/control/key`
 * cannot drift apart about where a key goes.
 */
export type PageKeyTarget = KeyDispatchTarget;

/** Result of `sendKeysToPage`. */
export interface SendKeysToPageResult {
  dispatched: number;
  target: PageKeyTarget;
  /** The normalized `KeyboardEvent.key` values actually dispatched. */
  keys: string[];
  /** Per key: did a listener call `preventDefault()` on the keydown? */
  outcomes: KeyDispatchOutcome[];
}

/**
 * `sendKeysToPage` — dispatch a key sequence at the DOCUMENT level, not scoped
 * to any element.
 *
 * The element-scoped `sendKeys` action can only reach an element that
 * advertises it, so a component whose behavior lives in a
 * `document.addEventListener('keydown', …)` handler — Escape-to-close on
 * dropdowns, modals and command palettes — had no reachable dispatch point and
 * its close branch could regress unnoticed. This primitive closes that gap.
 *
 * `target` selects the dispatch node and is validated: an unrecognized value is
 * an error, never a silent fallback to the default. It defaults to
 * `DEFAULT_KEY_DISPATCH_TARGET` (`document`) — see `core/key-events.ts` for why
 * `document` and not `window`, and note that the runner's sibling route
 * `POST /ui-bridge/control/key` still defaults to `window` until it is wired to
 * this same module.
 */
export async function sendKeysToPagePrimitive(request: {
  keys?: unknown;
  target?: unknown;
  delay?: number;
}): Promise<PrimitiveResult<SendKeysToPageResult>> {
  const normalized = normalizeKeyDescriptors(request?.keys);
  if (!normalized.ok) {
    return { ok: false, error: normalized.error, code: 'INVALID_PARAMS' };
  }

  const resolved = resolveKeyTarget(request?.target);
  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.error,
      code: resolved.reason === 'unknown-target' ? 'INVALID_PARAMS' : 'ELEMENT_NOT_FOUND',
    };
  }
  const { target, node } = resolved;

  const outcomes = await dispatchKeySequence(node, normalized.keys, { delay: request?.delay });
  return {
    ok: true,
    data: {
      dispatched: outcomes.length,
      target,
      keys: normalized.keys.map((k) => k.key),
      outcomes,
    },
  };
}

/**
 * `findByText` — return elements whose visible text matches.
 *
 * §4.6: `findByText` doubles as a confirmation oracle — the caller supplies the
 * text and reads the hit count. Scrubbing the emitted `text` is NOT enough: a
 * redacted element must not be CONFIRMABLE by searching for its content.
 * Exclude boundary-redacted elements from the result set entirely, before
 * building, so the hit count itself carries no signal.
 */
export function findByTextPrimitive(
  text: string | undefined,
  options: { tag?: string; exact?: boolean }
): PrimitiveResult<FindByTextHit[]> {
  if (!text?.trim()) {
    return { ok: false, error: 'text is required and must not be empty', code: 'INVALID_PARAMS' };
  }
  const matches = findElementsByText(text, { tag: options.tag, exact: options.exact });
  const results = matches
    .filter((el) => !isContentRedacted(el))
    .map((el, i) => {
      const rect = el.getBoundingClientRect();
      return {
        index: i,
        tag: el.tagName.toLowerCase(),
        // Content-redacted elements are already filtered out above; the reader
        // routes the raw read through the choke point (no-op scrub here).
        text: readScrubbedText(el, undefined, { maxLen: 200 }) ?? '',
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        disabled: 'disabled' in el ? !!(el as HTMLButtonElement).disabled : false,
        visible: el.offsetParent !== null || getComputedStyle(el).position === 'fixed',
      };
    });
  return { ok: true, data: results };
}

/**
 * `clickByText` — click the first element whose visible text matches, then
 * echo a redaction-safe descriptor of it. The caller supplies the click
 * mechanism (`el.click()` for the standalone server, a synthesized real click
 * for the React relay).
 */
export function clickByTextPrimitive(
  text: string | undefined,
  options: { tag?: string; exact?: boolean },
  doClick: (el: HTMLElement) => void
): PrimitiveResult<{ clicked: true; element: ClickEcho }> {
  if (!text?.trim()) {
    return { ok: false, error: 'text is required and must not be empty', code: 'INVALID_PARAMS' };
  }
  const matches = findElementsByText(text, { tag: options.tag, exact: options.exact });
  if (matches.length === 0) {
    return { ok: false, error: `No element found with text "${text}"`, code: 'ELEMENT_NOT_FOUND' };
  }
  const el = matches[0];
  doClick(el);
  return { ok: true, data: { clicked: true, element: buildClickEcho(el) } };
}

/**
 * `clickBySelector` — click a caller-supplied selector, then echo a
 * redaction-safe descriptor. The caller supplies the click mechanism.
 */
export function clickBySelectorPrimitive(
  selector: string | undefined,
  index: number | undefined,
  doClick: (el: HTMLElement) => void
): PrimitiveResult<{ clicked: true; element: ClickEcho }> {
  if (!selector?.trim()) {
    return { ok: false, error: 'selector is required and must not be empty', code: 'INVALID_PARAMS' };
  }
  const el = findElementBySelector(selector, index);
  if (!el) {
    return { ok: false, error: `No element found for selector "${selector}"`, code: 'ELEMENT_NOT_FOUND' };
  }
  doClick(el);
  return { ok: true, data: { clicked: true, element: buildClickEcho(el) } };
}

/**
 * `typeInto` — resolve an input by label or selector, fill it, then echo a
 * redaction-safe descriptor. The caller supplies the fill mechanism
 * (`doFill(el, text, clear)`): inline value mutation + input/change events for
 * the standalone server, `reactAwareFill` for the React relay.
 *
 * §4.6: never echo back the value just typed into a password field or a
 * redacted input.
 */
export function typeIntoPrimitive(
  request: { selector?: string; label?: string; text?: string; clear?: boolean },
  doFill: (el: HTMLElement, text: string, clear: boolean) => void
): PrimitiveResult<{ typed: true; element: TypeEcho }> {
  if (!request.label && !request.selector) {
    return { ok: false, error: 'Either label or selector is required', code: 'INVALID_PARAMS' };
  }
  let el: HTMLElement | null = null;
  if (request.label) {
    el = findElementByLabel(request.label);
  } else if (request.selector) {
    el = findElementBySelector(request.selector);
  }
  if (!el) {
    return {
      ok: false,
      error: `No input found for ${request.label ? 'label "' + request.label + '"' : 'selector "' + request.selector + '"'}`,
      code: 'ELEMENT_NOT_FOUND',
    };
  }
  doFill(el, request.text ?? '', request.clear === true);
  return {
    ok: true,
    data: {
      typed: true,
      element: {
        tag: el.tagName.toLowerCase(),
        value: isValueRedacted(el)
          ? REDACTED_VALUE
          : 'value' in el
            ? (readScrubbedValue(el as HTMLInputElement) ?? null)
            : (readScrubbedText(el) ?? null),
      },
    },
  };
}
