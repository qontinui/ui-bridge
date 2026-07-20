/**
 * Shared page-primitive implementations for the app-agnostic interaction
 * endpoints: `readValue`, `findByText`, `clickByText`, `clickBySelector`,
 * and `typeInto`.
 *
 * These five operations are dispatched from TWO places that must stay in
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

import { REDACTED_VALUE, isValueRedacted, isContentRedacted } from '../core/redaction';
import {
  findElementsByText,
  findElementBySelector,
  findElementByLabel,
} from './dom-fallback';

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
    text: isContentRedacted(el) ? REDACTED_VALUE : (el.textContent?.trim().slice(0, 200) ?? ''),
    rect: el.getBoundingClientRect(),
  };
}

/**
 * `readValue` — read the value/text of a caller-supplied selector.
 *
 * §4.6: an arbitrary caller-supplied selector must not be able to read a
 * sensitive value in cleartext. The `isValueRedacted` gate is unconditional —
 * it covers password inputs with no opt-in AND any element inside a
 * `data-bridge-redact` boundary. The element stays addressable; only its value
 * is hidden.
 */
export function readValuePrimitive(
  selector: string | undefined,
  index?: number
): PrimitiveResult<{ value: string | null; length: number }> {
  if (!selector?.trim()) {
    return { ok: false, error: 'selector is required and must not be empty', code: 'INVALID_PARAMS' };
  }
  const el = findElementBySelector(selector, index);
  if (!el) {
    return { ok: false, error: `No element found for selector "${selector}"`, code: 'ELEMENT_NOT_FOUND' };
  }
  if (isValueRedacted(el)) {
    return { ok: true, data: { value: REDACTED_VALUE, length: 0 } };
  }
  const value = 'value' in el ? (el as HTMLInputElement).value : (el.textContent ?? null);
  return { ok: true, data: { value, length: value?.length ?? 0 } };
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
        text: el.textContent?.trim().slice(0, 200) ?? '',
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
            ? (el as HTMLInputElement).value
            : el.textContent,
      },
    },
  };
}
