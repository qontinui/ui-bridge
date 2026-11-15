/**
 * Page-level sentinel ids — THE one resolver for the element ids that name the
 * page itself instead of a registered element.
 *
 * Three sites used to carry their own copy of the check, and they disagreed on
 * case: the relay's `executeElementAction` (`react/commandHandlers.ts`) and the
 * in-process pre-flight (`server/handlers.ts`) matched the ids exactly, while
 * the executor (`control/action-executor.ts`) lowercased them first. All three
 * now ask this module, so the same id resolves the same way on every transport.
 *
 * What a sentinel resolves to depends on what it is resolved FOR:
 *   - `scroll` — the page scroll container. `document`, `body` and `window`
 *     all name `<html>` (`document.documentElement`), whose scroll the action
 *     path then routes to the page's real scroll container.
 *   - `read` — an element read: a style / attribute projection
 *     (`GET /control/element/document/state?properties=…`) or an `ai/assert`
 *     style or attribute check — and the operand of the in-tab vision
 *     evaluator (Phase 1 of plan
 *     2026-11-09-ui-bridge-relay-evaluates-vision-assertions-in-the-tab), which
 *     is why this is exported. Only `document`
 *     names an element here, `<html>`: `window` is no element, and reading
 *     `<body>`'s styles off `<html>` would answer a different element.
 *
 * `<html>` gets NO registry entry: a box that contains the whole page would sit
 * in every snapshot, every find and every hit-test. The sentinel is how a read
 * reaches it instead.
 *
 * Precedence: a REGISTERED element wins. An app that registers an element
 * under one of these ids gets that element; the sentinel answers only an id
 * the registry does not hold. An `ai/assert` target is a search rather than an
 * id, so there any element the assertion's search resolves wins, a near match
 * included, and the sentinel answers only a target that resolves to none
 * (`ai/assertions.ts`).
 */

import {
  projectElement,
  type ElementProjection,
  type ElementProjectionRequest,
} from './element-projection';

/** Every id that names the page for a `scroll`. */
export const PAGE_SENTINEL_IDS = ['document', 'body', 'window'] as const;

/** A page sentinel id (canonical, lower-case spelling). */
export type PageSentinelId = (typeof PAGE_SENTINEL_IDS)[number];

/** What a sentinel is being resolved for — see the module doc. */
export type PageSentinelUse = 'scroll' | 'read';

/** The sentinel ids a `read` accepts. */
const READ_SENTINEL_IDS: ReadonlySet<string> = new Set<PageSentinelId>(['document']);
const SCROLL_SENTINEL_IDS: ReadonlySet<string> = new Set<string>(PAGE_SENTINEL_IDS);

/**
 * Does `id` name the page for `use`? Case-insensitive. Says nothing about
 * precedence: a caller that holds a registry asks it first.
 */
export function isPageSentinelId(id: unknown, use: PageSentinelUse): id is string {
  if (typeof id !== 'string') return false;
  const lc = id.toLowerCase();
  return use === 'scroll' ? SCROLL_SENTINEL_IDS.has(lc) : READ_SENTINEL_IDS.has(lc);
}

/**
 * The element `id` names when it is a page sentinel for `use` — always
 * `document.documentElement` — or `null` when it is not one (or there is no
 * document to resolve it in).
 */
export function resolvePageSentinel(id: unknown, use: PageSentinelUse): HTMLElement | null {
  if (!isPageSentinelId(id, use)) return null;
  if (typeof document === 'undefined') return null;
  return document.documentElement;
}

/**
 * What `GET /control/element/document/state` answers. `<html>` has no
 * registration and therefore no `ElementState`: the read carries the
 * sentinel's identity and the projection it asked for
 * (`?properties=…&attributes=lang,dir`), nothing invented in between.
 */
export interface PageSentinelState {
  /** The id as requested. */
  id: string;
  /** The sentinel it named, in its canonical spelling. */
  sentinel: PageSentinelId;
  /** The element it resolved to. */
  tagName: 'html';
  /** The requested projection, read off `<html>`. Present iff one was asked for. */
  projection?: ElementProjection;
}

/** The element-state answer for a `read` sentinel — the same on every transport. */
export function pageSentinelState(
  id: string,
  node: Element,
  projection: ElementProjectionRequest | undefined
): PageSentinelState {
  return {
    id,
    sentinel: id.toLowerCase() as PageSentinelId,
    tagName: 'html',
    ...(projection ? { projection: projectElement(node, projection) } : {}),
  };
}
