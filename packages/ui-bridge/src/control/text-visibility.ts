/**
 * Text visibility — hide the page's glyphs for one frame, then restore exactly.
 *
 * `POST /control/text-visibility {hidden: true}` makes every glyph on the page
 * transparent without moving anything; `{hidden: false}` puts the page back.
 * A caller captures frame A (normal) and frame B (text hidden) against one
 * snapshot: inside each text element's box the two frames differ exactly
 * where glyphs paint, and frame B shows what those glyphs sit on. That is how
 * vision-core measures text over an image on real pixels
 * (`text_over_image_contrast`).
 *
 * Plan 2026-10-13-image-generation-and-visual-judgment, Phase 16 step 1.
 *
 * SCOPE: THE WHOLE DOCUMENT, NOT "TEXT OVER REGISTERED MEDIA"
 *
 * The plan names text over registered media; this hides all text in the
 * document (`document.body` and every open shadow root under it). Reasons:
 *
 *  - It is what the consumer needs. Frame A/B differencing is per text
 *    element's bbox, so hiding text that sits over no image perturbs no
 *    measurement: its bbox is simply not one the analyzer samples.
 *  - A geometric "over media" test is wrong in both directions. Text over a
 *    CSS background, a `<canvas>`, a `<video>` poster or an image the registry
 *    never saw would stay visible and corrupt frame B; a heading whose block
 *    box spans the hero but whose glyphs do not would be hidden anyway. The
 *    injected runtime's registry is DOM-seeded and the embedded one is
 *    app-registered, so "registered" does not even name the same set on the
 *    two paths.
 *  - Nothing about it is less safe: it is a dev control either way, it moves
 *    no layout, and the restore is exact.
 *
 * WHAT IS WRITTEN (inline, `!important`, so no stylesheet rule can win)
 *
 *  - Every element: `color`, `-webkit-text-fill-color`,
 *    `-webkit-text-stroke-color`, `text-decoration-color`,
 *    `text-emphasis-color` and `caret-color` go `transparent`; `text-shadow`
 *    goes `none`; `transition-property` goes `none` — the longhand of
 *    `transition: none`, so a frame is never caught mid-fade and a restore
 *    can hand back exactly the longhand it took.
 *  - SVG text (`<text>`, `<tspan>`, `<textPath>`): `fill` and `stroke` go
 *    `transparent` too.
 *  - Gradient text (`background-clip: text`): its glyphs ARE the background,
 *    so `background-image` goes `none` and `background-color` `transparent`.
 *  - PINNED, so only glyphs change: making `color` transparent also changes
 *    every `currentColor` — default border colours, `fill="currentColor"`
 *    icons, a `background-color: currentColor` mask icon. Those are not text,
 *    and a border inside a button's bbox would read as glyph pixels. So each
 *    element's computed border, outline, column-rule, box-shadow and
 *    background colours (and an SVG graphic's `fill`, `stroke`, `stop-color`,
 *    `flood-color`, `lighting-color`) are read BEFORE anything is written and
 *    written back as the same values. Pseudo-elements and `::placeholder`
 *    inherit the hide from their element; one whose own stylesheet sets
 *    `-webkit-text-fill-color` or `text-shadow` explicitly keeps it (a CSS
 *    limit: an inline style cannot reach a pseudo-element).
 *
 * NOT COVERED, by the same token: a shadow root attached AFTER the hide (no
 * mutation announces `attachShadow`), closed shadow roots (unreachable from
 * outside), and iframes (another document). Text in any of them stays
 * visible in frame B.
 *
 * Elements added while text is hidden are hidden too (counted as
 * `coverage.lateAdded`). Their pins are read with every hidden ancestor's
 * `color` put back for that read, synchronously, so no frame paints it: an
 * inherited `currentColor` would otherwise already read transparent. A body
 * the app swaps in while text is hidden (Turbo, `body.replaceWith`) is hidden
 * on arrival, and a repeated hide re-checks it. An app that rewrites a hidden
 * element's `style` has its new values adopted as the ones to restore, then
 * the hide re-asserted (a `MutationObserver`).
 *
 * GUARANTEES
 *
 *  - Exact restore. Each element's `style` attribute is recorded before the
 *    first write — its exact text, or its absence — and written back byte for
 *    byte, so inline values and their `!important` come back as they were, and
 *    an element that had no `style` attribute has none again. If the app
 *    rewrote the attribute meanwhile, only the properties this control owns
 *    are put back (to the app's newer values where it set them) and the rest
 *    of the app's write is left alone; that restore is reported as
 *    property-level, and a property the app changed after the last re-assert
 *    is left as the app set it and reported as `drift`, never verified.
 *  - An element that left the document while text was hidden (a closed modal,
 *    a pooled list row, a kept-alive panel) is restored and verified all the
 *    same, and counted as `detached`: re-inserted later, it shows its own
 *    style, not the hide.
 *  - The restore is not caught mid-fade either: every value comes back under
 *    `transition-property: none`, styles are flushed, and only then is the
 *    transition itself restored.
 *  - A TTL restores the page by itself, so a caller that dies between the two
 *    frames cannot leave the page with its text hidden.
 *  - Idempotent: hiding hidden text writes nothing and re-arms the TTL;
 *    showing shown text writes nothing and reports the last restore.
 *  - A hide that throws part-way is rolled back before it answers
 *    (`HIDE_FAILED` with `rolledBack`); the state and the TTL are in place
 *    before the first write, so nothing it wrote is left unowned.
 *  - One state per page, not per SDK copy: it lives on `globalThis` under a
 *    `Symbol.for` key, as the dev-controls gate does, so with an app bundle
 *    and the injected runtime in one page a show through either restores a
 *    hide made through the other.
 *
 * It is a DEV CONTROL (`core/dev-controls.ts`): the command handlers answer
 * `capability_unavailable_in_build` unless the realm opted in. That refusal
 * is the dispatcher's, not this module's, so it is not a
 * {@link TextVisibilityErrorCode}. Its OUTER code differs by transport: the
 * relay forwards the tab's own `code` (`capability_unavailable_in_build`),
 * while the Node-side direct handlers, which have no page at all, answer
 * `UB-CAPABILITY-UNAVAILABLE` with `data.code: capability_unavailable_in_build`
 * (the shape the media override's direct handlers already use). Read
 * `data.code` on the direct transport, `code` on the relay.
 *
 * Redaction: no response carries page content — counts, tags and property
 * names only.
 */

// ============================================================================
// Contract
// ============================================================================

/** Body of `POST /control/text-visibility`. */
export interface TextVisibilityRequest {
  /** `true` hides the page's glyphs, `false` restores them. */
  hidden: boolean;
  /**
   * Auto-restore after this many ms (hide only; a repeated hide re-arms it;
   * ignored, not validated, on a show). Default
   * {@link DEFAULT_TEXT_VISIBILITY_TTL_MS}.
   */
  ttlMs?: number;
}

/**
 * Typed failure codes this engine answers. The dev-controls refusal
 * (`capability_unavailable_in_build`) is the dispatcher's; see the module doc.
 */
export type TextVisibilityErrorCode =
  | 'INVALID_REQUEST'
  /** No `document.body` to hide text in. */
  | 'NO_DOCUMENT'
  /** A write threw part-way through the hide; what it wrote was rolled back. */
  | 'HIDE_FAILED';

export interface TextVisibilityFailure {
  success: false;
  code: TextVisibilityErrorCode;
  error: string;
  /** On `HIDE_FAILED`: the rollback of what the hide had written. */
  rolledBack?: TextVisibilityRestore;
  timestamp: number;
}

/** What one hide covers. */
export interface TextVisibilityCoverage {
  /** Always the whole document — see the module doc for why. */
  scope: 'document';
  /** Elements carrying the hide. */
  elements: number;
  /** Of those, SVG `<text>`/`<tspan>`/`<textPath>`. */
  svgText: number;
  /** Of those, gradient text (`background-clip: text`). */
  backgroundClipText: number;
  /** Elements whose currentColor-derived paint was pinned. */
  pinned: number;
  /** Open shadow roots walked. */
  shadowRoots: number;
  /** Of `elements`, those added to the page after the hide (hidden on arrival). */
  lateAdded: number;
}

export interface TextVisibilityHideSuccess {
  success: true;
  hidden: true;
  /** False when text was already hidden: nothing was written, the TTL was re-armed. */
  changed: boolean;
  coverage: TextVisibilityCoverage;
  hiddenAt: number;
  ttlMs: number;
  expiresAt: number;
  timestamp: number;
}

/** An element whose style the app changed after the last re-assert. */
export interface TextVisibilityDrift {
  tag: string;
  /** The owned properties left as the app set them. */
  properties: string[];
}

export interface TextVisibilityRestore {
  /** `rollback`: a hide that threw part-way, undone before it answered. */
  trigger: 'request' | 'ttl' | 'rollback';
  /** Elements the hide covered. */
  elements: number;
  /** Restored with the `style` attribute byte-identical to the original. */
  exact: number;
  /** Restored property by property, because the app rewrote the attribute meanwhile. */
  propertyLevel: number;
  /**
   * Of `elements`, those out of the document at restore time. They are
   * restored and verified like the rest, so one re-inserted later shows its
   * own style.
   */
  detached: number;
  /** Elements with drift, at most {@link DRIFT_REPORT_LIMIT} listed. */
  drift: TextVisibilityDrift[];
  driftCount: number;
  /**
   * True only when every recorded element — in the document or not — reads
   * back exactly as recorded: a byte-identical attribute, or every owned
   * property back with nothing drifted.
   */
  verified: boolean;
  restoredAt: number;
}

export interface TextVisibilityShowSuccess {
  success: true;
  hidden: false;
  /** False when text was not hidden: nothing was written. */
  changed: boolean;
  /** This call's restore; when `changed` is false, the last restore (a TTL one, say), or null. */
  restore: TextVisibilityRestore | null;
  timestamp: number;
}

export type TextVisibilityResult =
  | TextVisibilityHideSuccess
  | TextVisibilityShowSuccess
  | TextVisibilityFailure;

export const DEFAULT_TEXT_VISIBILITY_TTL_MS = 30_000;
export const MIN_TEXT_VISIBILITY_TTL_MS = 1_000;
export const MAX_TEXT_VISIBILITY_TTL_MS = 600_000;
export const DRIFT_REPORT_LIMIT = 20;

// ============================================================================
// Validation
// ============================================================================

export interface ValidatedTextVisibility {
  hidden: boolean;
  /** The hide's TTL; on a show, the default (a show has no TTL to validate). */
  ttlMs: number;
}

/**
 * Validate a raw request body. Returns the validated request or an error
 * message. Pure — a host that fronts this control (the qontinui-runner) can
 * mirror these rules for an early 400; this copy is the authority.
 */
export function validateTextVisibilityRequest(raw: unknown): ValidatedTextVisibility | string {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return 'body must be a JSON object';
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.hidden !== 'boolean') {
    return `hidden must be a boolean (got ${JSON.stringify(r.hidden)})`;
  }
  const ttl = r.ttlMs;
  // A show has no TTL: whatever a caller sent along is ignored, not refused.
  if (!r.hidden || ttl === undefined)
    return { hidden: r.hidden, ttlMs: DEFAULT_TEXT_VISIBILITY_TTL_MS };
  if (
    typeof ttl !== 'number' ||
    !Number.isInteger(ttl) ||
    ttl < MIN_TEXT_VISIBILITY_TTL_MS ||
    ttl > MAX_TEXT_VISIBILITY_TTL_MS
  ) {
    return (
      `ttlMs must be an integer in ${MIN_TEXT_VISIBILITY_TTL_MS}..${MAX_TEXT_VISIBILITY_TTL_MS} ` +
      `(got ${JSON.stringify(ttl)})`
    );
  }
  return { hidden: r.hidden, ttlMs: ttl };
}

// ============================================================================
// What is written
// ============================================================================

const IMPORTANT = 'important';
const TRANSITION = 'transition-property';

/** Written on every element. */
const GLYPH_VALUES: ReadonlyArray<readonly [string, string]> = [
  ['color', 'transparent'],
  ['-webkit-text-fill-color', 'transparent'],
  ['-webkit-text-stroke-color', 'transparent'],
  ['text-decoration-color', 'transparent'],
  ['text-emphasis-color', 'transparent'],
  ['caret-color', 'transparent'],
  ['text-shadow', 'none'],
  [TRANSITION, 'none'],
];

/** Written on SVG text content elements, on top of {@link GLYPH_VALUES}. */
const SVG_TEXT_VALUES: ReadonlyArray<readonly [string, string]> = [
  ['fill', 'transparent'],
  ['stroke', 'transparent'],
];

/** Written on gradient text (`background-clip: text`), whose glyphs are its background. */
const CLIP_TEXT_VALUES: ReadonlyArray<readonly [string, string]> = [
  ['background-image', 'none'],
  ['background-color', 'transparent'],
];

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TEXT_TAGS = new Set(['text', 'tspan', 'textPath']);
const SVG_PAINT_PINS = ['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color'];
const BORDER_SIDES = ['top', 'right', 'bottom', 'left'];
/** Nothing these render is text a frame shows. */
const SKIPPED_TAGS = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'link',
  'meta',
  'title',
  'base',
  'head',
]);

function isTransparentColor(v: string): boolean {
  const s = v.replace(/\s+/g, '').toLowerCase();
  return s === '' || s === 'transparent' || s === 'rgba(0,0,0,0)';
}

function styleOf(el: Element): CSSStyleDeclaration | null {
  const style = (el as Partial<ElementCSSInlineStyle>).style;
  return style && typeof style.setProperty === 'function' ? style : null;
}

/** An inline value as the CSSOM reports it; `value: ''` means absent. */
interface InlineValue {
  value: string;
  priority: string;
}

function readInline(style: CSSStyleDeclaration, prop: string): InlineValue {
  return { value: style.getPropertyValue(prop), priority: style.getPropertyPriority(prop) };
}

function writeInline(style: CSSStyleDeclaration, prop: string, v: InlineValue): void {
  if (v.value === '') style.removeProperty(prop);
  else style.setProperty(prop, v.value, v.priority);
}

function sameInline(a: InlineValue, b: InlineValue): boolean {
  return a.value === b.value && a.priority === b.priority;
}

/** The values one element gets, decided from its computed style before any write. */
function planFor(
  el: Element,
  computed: CSSStyleDeclaration | null
): {
  values: Array<[string, string]>;
  svgText: boolean;
  clipText: boolean;
  pinned: boolean;
} {
  const values: Array<[string, string]> = [];
  let pinned = false;
  const pin = (prop: string): void => {
    const v = computed?.getPropertyValue(prop) ?? '';
    if (v === '' || v === 'none') return;
    values.push([prop, v]);
    pinned = true;
  };

  const isSvg = el.namespaceURI === SVG_NS;
  const svgText = isSvg && SVG_TEXT_TAGS.has(el.localName);
  // Both spellings: an engine that keeps the prefixed one separate reports
  // `text` only there.
  const clip = computed
    ? `${computed.getPropertyValue('background-clip')} ${computed.getPropertyValue('-webkit-background-clip')}`
    : '';
  const clipText = /\btext\b/.test(clip);

  if (computed) {
    for (const side of BORDER_SIDES) {
      const style = computed.getPropertyValue(`border-${side}-style`);
      if (style !== '' && style !== 'none' && style !== 'hidden') pin(`border-${side}-color`);
    }
    const outline = computed.getPropertyValue('outline-style');
    if (outline !== '' && outline !== 'none') pin('outline-color');
    const rule = computed.getPropertyValue('column-rule-style');
    if (rule !== '' && rule !== 'none' && rule !== 'hidden') pin('column-rule-color');
    pin('box-shadow');
    if (!clipText && !isTransparentColor(computed.getPropertyValue('background-color'))) {
      pin('background-color');
    }
    if (isSvg && !svgText) for (const p of SVG_PAINT_PINS) pin(p);
  }

  values.push(...GLYPH_VALUES.map(([p, v]) => [p, v] as [string, string]));
  if (svgText) values.push(...SVG_TEXT_VALUES.map(([p, v]) => [p, v] as [string, string]));
  if (clipText) values.push(...CLIP_TEXT_VALUES.map(([p, v]) => [p, v] as [string, string]));
  return { values, svgText, clipText, pinned };
}

// ============================================================================
// State
// ============================================================================

interface ElementRecord {
  el: Element;
  /** The element's inline style object (live; the same object for its lifetime). */
  style: CSSStyleDeclaration;
  /** The `style` attribute before the first write; `undefined` once the app rewrote it. */
  originalAttr: string | null | undefined;
  /** The attribute as this control last left it; `null` until its writes finished. */
  written: string | null;
  /** The values this control writes, by property. */
  values: Map<string, string>;
  /** Each owned property's inline value before the hide (or the app's newer one). */
  originals: Map<string, InlineValue>;
  /** Each owned property's inline value as read back after this control wrote it. */
  ours: Map<string, InlineValue>;
}

interface HiddenState {
  records: Map<Element, ElementRecord>;
  coverage: TextVisibilityCoverage;
  hiddenAt: number;
  ttlMs: number;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  observer: MutationObserver | null;
  /** The `document.body` the hide last covered; a different one gets covered too. */
  body: HTMLElement;
}

interface TextVisibilitySlot {
  state: HiddenState | null;
  lastRestore: TextVisibilityRestore | null;
}

const SLOT_KEY = Symbol.for('@qontinui/ui-bridge/text-visibility');

/**
 * The page's one hide state. On `globalThis` under a `Symbol.for` key, like
 * the dev-controls gate, so two copies of the SDK in one page (an app bundle
 * and the injected runtime) share it: a show through either restores a hide
 * made through the other.
 */
function slot(): TextVisibilitySlot {
  const holder = globalThis as unknown as Record<symbol, TextVisibilitySlot | undefined>;
  let s = holder[SLOT_KEY];
  if (!s) {
    s = { state: null, lastRestore: null };
    holder[SLOT_KEY] = s;
  }
  return s;
}

// ============================================================================
// Hide
// ============================================================================

/**
 * Every element under `root` that can paint text, descending into open shadow
 * roots, in document order. Iterative (no recursion depth limit on a deep
 * tree); an element already in `seen` is skipped with its subtree, so one
 * batch never yields an element twice.
 */
function collectElements(
  root: Element,
  out: Element[],
  shadowRoots: ShadowRoot[],
  seen: Set<Element>
): void {
  const stack: Element[] = [root];
  while (stack.length > 0) {
    const el = stack.pop() as Element;
    if (seen.has(el) || SKIPPED_TAGS.has(el.localName)) continue;
    seen.add(el);
    out.push(el);
    const children = Array.from(el.children);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i] as Element);
    const shadow = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (shadow) {
      shadowRoots.push(shadow);
      const inner = Array.from(shadow.children);
      for (let i = inner.length - 1; i >= 0; i--) stack.push(inner[i] as Element);
    }
  }
}

/** The element's computed style, or null where the engine cannot give one (no pins then). */
function computedStyleOf(view: Window | null, el: Element): CSSStyleDeclaration | null {
  if (!view) return null;
  try {
    return view.getComputedStyle(el);
  } catch {
    return null;
  }
}

/** The parent element, or the host of the shadow root `el` sits in. */
function parentOrHost(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const parent = el.parentNode as (Node & { host?: Element }) | null;
  return parent && parent.nodeType === 11 && parent.host ? parent.host : null;
}

/**
 * Run `read` with every hidden ancestor of `elements` showing its original
 * `color`, then put the hide back byte for byte. An element added while text
 * is hidden inherits `currentColor` from hidden ancestors, so its pins would
 * otherwise read transparent. All of it is synchronous, so no frame paints
 * the revealed colour.
 */
function withAncestorColoursRevealed<T>(
  elements: Element[],
  records: Map<Element, ElementRecord>,
  read: () => T
): T {
  const revealed = new Set<ElementRecord>();
  for (const el of elements) {
    for (let p = parentOrHost(el); p; p = parentOrHost(p)) {
      const rec = records.get(p);
      if (!rec) continue;
      if (revealed.has(rec)) break; // its ancestors are in already
      revealed.add(rec);
    }
  }
  for (const rec of revealed) {
    writeInline(rec.style, 'color', rec.originals.get('color') ?? emptyInline());
  }
  try {
    return read();
  } finally {
    for (const rec of revealed) if (rec.written !== null) rec.el.setAttribute('style', rec.written);
  }
}

/**
 * Hide `elements`, recording each one first. All computed reads happen before
 * any write: hiding a parent changes its children's `currentColor`, so a pin
 * read after it would pin the hidden value. An element seen twice (a node
 * moved twice, or a parent and child appended in one task) is planned once:
 * a second plan would read the first one's hide as the element's original.
 */
function hideElements(elements: Element[], s: HiddenState, late: boolean): void {
  const view = typeof window !== 'undefined' ? window : null;
  const planned = new Set<Element>();
  const targets: Array<{ el: Element; style: CSSStyleDeclaration }> = [];
  for (const el of elements) {
    if (s.records.has(el) || planned.has(el)) continue;
    const style = styleOf(el);
    if (!style) continue;
    planned.add(el);
    targets.push({ el, style });
  }
  if (targets.length === 0) return;
  const read = () =>
    targets.map((t) => ({ ...t, plan: planFor(t.el, computedStyleOf(view, t.el)) }));
  // `plans` holds strings read off the computed styles, so the writes below
  // cannot change what was planned.
  const plans = late
    ? withAncestorColoursRevealed(
        targets.map((t) => t.el),
        s.records,
        read
      )
    : read();
  for (const { el, style, plan } of plans) {
    const record: ElementRecord = {
      el,
      style,
      originalAttr: el.getAttribute('style'),
      written: null,
      values: new Map(),
      originals: new Map(),
      ours: new Map(),
    };
    for (const [prop, value] of plan.values) {
      record.values.set(prop, value);
      if (!record.originals.has(prop)) record.originals.set(prop, readInline(style, prop));
    }
    // Owned before the first write, so a write that throws leaves nothing a
    // rollback cannot reach.
    s.records.set(el, record);
    for (const [prop, value] of record.values) {
      style.setProperty(prop, value, IMPORTANT);
      record.ours.set(prop, readInline(style, prop));
    }
    record.written = el.getAttribute('style');
    s.coverage.elements += 1;
    if (late) s.coverage.lateAdded += 1;
    if (plan.svgText) s.coverage.svgText += 1;
    if (plan.clipText) s.coverage.backgroundClipText += 1;
    if (plan.pinned) s.coverage.pinned += 1;
  }
}

/**
 * The app rewrote a hidden element's `style`: adopt each owned property it
 * changed as the value to restore, then write the hide again. The original
 * attribute text no longer describes the page, so its restore becomes
 * property-level.
 */
function reassert(record: ElementRecord): void {
  if (record.el.getAttribute('style') === record.written) return;
  const style = record.style;
  for (const [prop, ours] of record.ours) {
    const now = readInline(style, prop);
    if (!sameInline(now, ours)) record.originals.set(prop, now);
  }
  record.originalAttr = undefined;
  for (const [prop, value] of record.values) {
    style.setProperty(prop, value, IMPORTANT);
    record.ours.set(prop, readInline(style, prop));
  }
  record.written = record.el.getAttribute('style');
}

/**
 * Cover `body` (a body the app swapped in) and watch it. Idempotent: what is
 * already recorded is skipped.
 */
function coverBody(s: HiddenState, body: HTMLElement): void {
  const elements: Element[] = [];
  const shadowRoots: ShadowRoot[] = [];
  collectElements(body, elements, shadowRoots, new Set());
  hideElements(elements, s, true);
  s.body = body;
  if (s.observer) {
    for (const root of [body, ...shadowRoots]) watch(s.observer, root);
    s.observer.takeRecords();
  }
  s.coverage.shadowRoots += shadowRoots.length;
}

function observe(s: HiddenState, roots: Array<Node>): MutationObserver | null {
  if (typeof MutationObserver === 'undefined') return null;
  const observer = new MutationObserver((mutations) => {
    if (slot().state !== s) return;
    const added: Element[] = [];
    const newShadowRoots: ShadowRoot[] = [];
    const seen = new Set<Element>();
    for (const m of mutations) {
      if (m.type === 'attributes') {
        const rec = s.records.get(m.target as Element);
        if (rec) reassert(rec);
      } else {
        for (const node of Array.from(m.addedNodes)) {
          if (node.nodeType === 1 && (node as Element).isConnected) {
            // Already-recorded elements are walked (a moved subtree can carry
            // new children) and skipped by hideElements.
            collectElements(node as Element, added, newShadowRoots, seen);
          }
        }
      }
    }
    if (added.length > 0) hideElements(added, s, true);
    for (const root of newShadowRoots) watch(observer, root);
    s.coverage.shadowRoots += newShadowRoots.length;
    // A body swapped in (Turbo, body.replaceWith) was hidden above; watch it.
    if (typeof document !== 'undefined' && document.body && document.body !== s.body) {
      coverBody(s, document.body);
    }
    // Drop the records this callback's own writes queued.
    observer.takeRecords();
  });
  for (const root of roots) watch(observer, root);
  // The <html> element's children, so a replaced <body> is seen arriving.
  if (typeof document !== 'undefined' && document.documentElement) {
    observer.observe(document.documentElement, { childList: true });
  }
  return observer;
}

function watch(observer: MutationObserver, root: Node): void {
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['style'],
  });
}

function armTtl(s: HiddenState, ttlMs: number): void {
  if (s.timer !== null) clearTimeout(s.timer);
  s.ttlMs = ttlMs;
  s.expiresAt = Date.now() + ttlMs;
  s.timer = setTimeout(() => {
    if (slot().state !== s) return;
    restore('ttl');
  }, ttlMs);
}

function hideFailed(e: unknown): TextVisibilityFailure {
  const rolledBack = restore('rollback');
  return {
    success: false,
    code: 'HIDE_FAILED',
    error:
      `the hide threw part-way (${e instanceof Error ? e.message : String(e)}); everything ` +
      `it had written was restored (see rolledBack)`,
    rolledBack,
    timestamp: Date.now(),
  };
}

function hide(ttlMs: number): TextVisibilityHideSuccess | TextVisibilityFailure {
  const current = slot().state;
  if (current) {
    let changed = false;
    if (typeof document !== 'undefined' && document.body && document.body !== current.body) {
      // The app replaced <body> since the hide (and no observer saw it).
      const before = current.coverage.elements;
      try {
        coverBody(current, document.body);
      } catch (e) {
        return hideFailed(e);
      }
      changed = current.coverage.elements !== before;
    }
    armTtl(current, ttlMs);
    return hideSuccess(current, changed);
  }
  if (typeof document === 'undefined' || !document.body) {
    return failure('NO_DOCUMENT', 'there is no document.body to hide text in');
  }
  const s: HiddenState = {
    records: new Map(),
    coverage: {
      scope: 'document',
      elements: 0,
      svgText: 0,
      backgroundClipText: 0,
      pinned: 0,
      shadowRoots: 0,
      lateAdded: 0,
    },
    hiddenAt: Date.now(),
    ttlMs,
    expiresAt: 0,
    timer: null,
    observer: null,
    body: document.body,
  };
  // The state and the TTL are in place BEFORE the first write: a hide that
  // throws part-way is rolled back below, and one whose caller vanished is
  // restored by the TTL.
  slot().state = s;
  armTtl(s, ttlMs);
  try {
    const elements: Element[] = [];
    const shadowRoots: ShadowRoot[] = [];
    collectElements(document.body, elements, shadowRoots, new Set());
    s.coverage.shadowRoots = shadowRoots.length;
    hideElements(elements, s, false);
    s.observer = observe(s, [document.body, ...shadowRoots]);
  } catch (e) {
    return hideFailed(e);
  }
  return hideSuccess(s, true);
}

function hideSuccess(s: HiddenState, changed: boolean): TextVisibilityHideSuccess {
  return {
    success: true,
    hidden: true,
    changed,
    coverage: { ...s.coverage },
    hiddenAt: s.hiddenAt,
    ttlMs: s.ttlMs,
    expiresAt: s.expiresAt,
    timestamp: Date.now(),
  };
}

// ============================================================================
// Restore
// ============================================================================

function writeAttr(el: Element, value: string | null): void {
  if (value === null) {
    // Chromium serializes an inline style into the attribute lazily: removing
    // the attribute while a CSSOM write is still unserialized leaves
    // `style=""` behind. Reading it first settles the attribute, so the
    // remove takes it away entirely (measured in the real-Chromium smoke).
    el.getAttribute('style');
    el.removeAttribute('style');
  } else el.setAttribute('style', value);
}

type Decision =
  | { kind: 'exact'; record: ElementRecord; connected: boolean; original: string | null }
  | { kind: 'property'; record: ElementRecord; connected: boolean; drifted: Set<string> };

/**
 * How one element is restored. An element out of the document is restored
 * the same way as one in it: writing a style attribute on a disconnected
 * node is fine, and it is what it will carry when it is re-inserted.
 */
function decide(record: ElementRecord): Decision {
  const connected = record.el.isConnected;
  // `written === null`: a hide that threw while writing this element. Nothing
  // but that synchronous hide can have touched it, so its original attribute
  // goes back as it was.
  if (
    record.originalAttr !== undefined &&
    (record.written === null || record.el.getAttribute('style') === record.written)
  ) {
    return { kind: 'exact', record, connected, original: record.originalAttr };
  }
  const drifted = new Set<string>();
  for (const [prop, ours] of record.ours) {
    if (!sameInline(readInline(record.style, prop), ours)) drifted.add(prop);
  }
  return { kind: 'property', record, connected, drifted };
}

/**
 * Restore every recorded element. Two passes: everything but the transition
 * comes back under `transition-property: none`, styles are flushed, then the
 * transition itself — so the text never fades back in.
 */
function restore(trigger: TextVisibilityRestore['trigger']): TextVisibilityRestore {
  const sl = slot();
  const s = sl.state as HiddenState;
  sl.state = null;
  if (s.timer !== null) clearTimeout(s.timer);
  if (s.observer) s.observer.disconnect();

  const decisions = Array.from(s.records.values()).map(decide);

  // Pass 1: every owned value back except the transition, which stays off.
  for (const d of decisions) {
    if (d.kind === 'exact') {
      writeAttr(d.record.el, d.original);
      d.record.style.setProperty(TRANSITION, 'none', IMPORTANT);
    } else {
      for (const [prop, original] of d.record.originals) {
        if (prop === TRANSITION || d.drifted.has(prop)) continue;
        writeInline(d.record.style, prop, original);
      }
      if (!d.drifted.has(TRANSITION)) d.record.style.setProperty(TRANSITION, 'none', IMPORTANT);
    }
  }
  // Flush: the restored colours become the computed style with no transition.
  if (typeof document !== 'undefined' && document.body) void document.body.offsetWidth;

  // Pass 2: the transition, and the exact attribute text.
  for (const d of decisions) {
    if (d.kind === 'exact') writeAttr(d.record.el, d.original);
    else if (!d.drifted.has(TRANSITION)) {
      writeInline(d.record.style, TRANSITION, d.record.originals.get(TRANSITION) ?? emptyInline());
    }
  }

  // Verify by reading back — every element, in the document or not.
  let exact = 0;
  let propertyLevel = 0;
  let detached = 0;
  let verified = true;
  const drift: TextVisibilityDrift[] = [];
  let driftCount = 0;
  for (const d of decisions) {
    if (!d.connected) detached += 1;
    if (d.kind === 'exact') {
      exact += 1;
      if (d.record.el.getAttribute('style') !== d.original) verified = false;
      continue;
    }
    propertyLevel += 1;
    for (const [prop, original] of d.record.originals) {
      if (d.drifted.has(prop)) continue;
      if (!sameInline(readInline(d.record.style, prop), original)) verified = false;
    }
    if (d.drifted.size > 0) {
      verified = false;
      driftCount += 1;
      if (drift.length < DRIFT_REPORT_LIMIT) {
        drift.push({ tag: d.record.el.localName, properties: Array.from(d.drifted).sort() });
      }
    }
  }

  const result: TextVisibilityRestore = {
    trigger,
    elements: s.records.size,
    exact,
    propertyLevel,
    detached,
    drift,
    driftCount,
    verified,
    restoredAt: Date.now(),
  };
  sl.lastRestore = result;
  return result;
}

function emptyInline(): InlineValue {
  return { value: '', priority: '' };
}

// ============================================================================
// The command
// ============================================================================

function failure(code: TextVisibilityErrorCode, error: string): TextVisibilityFailure {
  return { success: false, code, error, timestamp: Date.now() };
}

/**
 * `POST /control/text-visibility {hidden, ttlMs?}` — hide the page's glyphs
 * (`hidden: true`) or restore them exactly (`hidden: false`). Exported so an
 * embedded host (the qontinui-runner's own webview hook) can serve the same
 * engine the relay dispatcher does.
 */
export function setTextVisibility(raw: unknown): TextVisibilityResult {
  const req = validateTextVisibilityRequest(raw);
  if (typeof req === 'string') return failure('INVALID_REQUEST', req);
  if (req.hidden) return hide(req.ttlMs);
  const sl = slot();
  if (!sl.state) {
    return {
      success: true,
      hidden: false,
      changed: false,
      restore: sl.lastRestore,
      timestamp: Date.now(),
    };
  }
  return {
    success: true,
    hidden: false,
    changed: true,
    restore: restore('request'),
    timestamp: Date.now(),
  };
}

/** True while text is hidden. */
export function textHidden(): boolean {
  return slot().state !== null;
}

/** Test-only: restore anything hidden and forget the last restore. */
export function resetTextVisibilityForTest(): void {
  if (slot().state) restore('request');
  slot().lastRestore = null;
}
