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
 * Elements added while text is hidden are hidden too, and an app that
 * rewrites a hidden element's `style` has its new values adopted as the ones
 * to restore, then the hide re-asserted (a `MutationObserver`).
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
 *  - The restore is not caught mid-fade either: every value comes back under
 *    `transition-property: none`, styles are flushed, and only then is the
 *    transition itself restored.
 *  - A TTL restores the page by itself, so a caller that dies between the two
 *    frames cannot leave the page with its text hidden.
 *  - Idempotent: hiding hidden text writes nothing and re-arms the TTL;
 *    showing shown text writes nothing and reports the last restore.
 *
 * It is a DEV CONTROL (`core/dev-controls.ts`): the command handlers answer
 * `capability_unavailable_in_build` unless the realm opted in.
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
   * Auto-restore after this many ms (hide only; a repeated hide re-arms it).
   * Default {@link DEFAULT_TEXT_VISIBILITY_TTL_MS}.
   */
  ttlMs?: number;
}

/** Typed failure codes. */
export type TextVisibilityErrorCode =
  | 'INVALID_REQUEST'
  /** No `document.body` to hide text in. */
  | 'NO_DOCUMENT'
  | 'capability_unavailable_in_build';

export interface TextVisibilityFailure {
  success: false;
  code: TextVisibilityErrorCode;
  error: string;
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
  trigger: 'request' | 'ttl';
  /** Elements the hide covered. */
  elements: number;
  /** Restored with the `style` attribute byte-identical to the original. */
  exact: number;
  /** Restored property by property, because the app rewrote the attribute meanwhile. */
  propertyLevel: number;
  /** Elements that left the document while hidden (nothing to restore). */
  detached: number;
  /** Elements with drift, at most {@link DRIFT_REPORT_LIMIT} listed. */
  drift: TextVisibilityDrift[];
  driftCount: number;
  /**
   * True only when every element still in the document reads back exactly as
   * recorded: a byte-identical attribute, or every owned property back with
   * nothing drifted.
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
  if (ttl === undefined) return { hidden: r.hidden, ttlMs: DEFAULT_TEXT_VISIBILITY_TTL_MS };
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
  /** The `style` attribute before the first write; `undefined` once the app rewrote it. */
  originalAttr: string | null | undefined;
  /** The attribute as this control last left it. */
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
}

let state: HiddenState | null = null;
let lastRestore: TextVisibilityRestore | null = null;

// ============================================================================
// Hide
// ============================================================================

/** Every element under `root` that can paint text, descending into open shadow roots. */
function collectElements(root: Element, out: Element[], shadowRoots: ShadowRoot[]): void {
  const visit = (el: Element): void => {
    if (SKIPPED_TAGS.has(el.localName)) return;
    out.push(el);
    const shadow = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (shadow) {
      shadowRoots.push(shadow);
      for (const child of Array.from(shadow.children)) visit(child);
    }
    for (const child of Array.from(el.children)) visit(child);
  };
  visit(root);
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

/**
 * Hide `elements`, recording each one first. All computed reads happen before
 * any write: hiding a parent changes its children's `currentColor`, so a pin
 * read after it would pin the hidden value.
 */
function hideElements(
  elements: Element[],
  records: Map<Element, ElementRecord>,
  coverage: TextVisibilityCoverage
): void {
  const view = typeof window !== 'undefined' ? window : null;
  const plans: Array<{
    el: Element;
    style: CSSStyleDeclaration;
    plan: ReturnType<typeof planFor>;
  }> = [];
  for (const el of elements) {
    if (records.has(el)) continue;
    const style = styleOf(el);
    if (!style) continue;
    plans.push({ el, style, plan: planFor(el, computedStyleOf(view, el)) });
  }
  // `plans` holds strings read off the computed styles, so the writes below
  // cannot change what was planned.
  for (const { el, style, plan } of plans) {
    const record: ElementRecord = {
      el,
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
    for (const [prop, value] of record.values) {
      style.setProperty(prop, value, IMPORTANT);
      record.ours.set(prop, readInline(style, prop));
    }
    record.written = el.getAttribute('style');
    records.set(el, record);
    coverage.elements += 1;
    if (plan.svgText) coverage.svgText += 1;
    if (plan.clipText) coverage.backgroundClipText += 1;
    if (plan.pinned) coverage.pinned += 1;
  }
}

/**
 * The app rewrote a hidden element's `style`: adopt each owned property it
 * changed as the value to restore, then write the hide again. The original
 * attribute text no longer describes the page, so its restore becomes
 * property-level.
 */
function reassert(record: ElementRecord): void {
  const style = styleOf(record.el);
  if (!style) return;
  if (record.el.getAttribute('style') === record.written) return;
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

function observe(s: HiddenState, roots: Array<Node>): MutationObserver | null {
  if (typeof MutationObserver === 'undefined') return null;
  const observer = new MutationObserver((mutations) => {
    if (state !== s) return;
    const added: Element[] = [];
    const newShadowRoots: ShadowRoot[] = [];
    for (const m of mutations) {
      if (m.type === 'attributes') {
        const rec = s.records.get(m.target as Element);
        if (rec) reassert(rec);
      } else {
        for (const node of Array.from(m.addedNodes)) {
          if (node.nodeType === 1 && (node as Element).isConnected) {
            collectElements(node as Element, added, newShadowRoots);
          }
        }
      }
    }
    if (added.length > 0) hideElements(added, s.records, s.coverage);
    for (const root of newShadowRoots) watch(observer, root);
    s.coverage.shadowRoots += newShadowRoots.length;
    // Drop the records this callback's own writes queued.
    observer.takeRecords();
  });
  for (const root of roots) watch(observer, root);
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
    if (state !== s) return;
    restore('ttl');
  }, ttlMs);
}

function hide(ttlMs: number): TextVisibilityHideSuccess | TextVisibilityFailure {
  if (state) {
    armTtl(state, ttlMs);
    return hideSuccess(state, false);
  }
  if (typeof document === 'undefined' || !document.body) {
    return failure('NO_DOCUMENT', 'there is no document.body to hide text in');
  }
  const elements: Element[] = [];
  const shadowRoots: ShadowRoot[] = [];
  collectElements(document.body, elements, shadowRoots);
  const s: HiddenState = {
    records: new Map(),
    coverage: {
      scope: 'document',
      elements: 0,
      svgText: 0,
      backgroundClipText: 0,
      pinned: 0,
      shadowRoots: shadowRoots.length,
    },
    hiddenAt: Date.now(),
    ttlMs,
    expiresAt: 0,
    timer: null,
    observer: null,
  };
  hideElements(elements, s.records, s.coverage);
  state = s;
  s.observer = observe(s, [document.body, ...shadowRoots]);
  armTtl(s, ttlMs);
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
  | { kind: 'detached'; record: ElementRecord }
  | { kind: 'exact'; record: ElementRecord; original: string | null }
  | { kind: 'property'; record: ElementRecord; style: CSSStyleDeclaration; drifted: Set<string> };

function decide(record: ElementRecord): Decision {
  const style = styleOf(record.el);
  if (!record.el.isConnected || !style) return { kind: 'detached', record };
  if (record.originalAttr !== undefined && record.el.getAttribute('style') === record.written) {
    return { kind: 'exact', record, original: record.originalAttr };
  }
  const drifted = new Set<string>();
  for (const [prop, ours] of record.ours) {
    if (!sameInline(readInline(style, prop), ours)) drifted.add(prop);
  }
  return { kind: 'property', record, style, drifted };
}

/**
 * Restore every recorded element. Two passes: everything but the transition
 * comes back under `transition-property: none`, styles are flushed, then the
 * transition itself — so the text never fades back in.
 */
function restore(trigger: 'request' | 'ttl'): TextVisibilityRestore {
  const s = state as HiddenState;
  state = null;
  if (s.timer !== null) clearTimeout(s.timer);
  if (s.observer) s.observer.disconnect();

  const decisions = Array.from(s.records.values()).map(decide);

  // Pass 1: every owned value back except the transition, which stays off.
  for (const d of decisions) {
    if (d.kind === 'exact') {
      writeAttr(d.record.el, d.original);
      styleOf(d.record.el)?.setProperty(TRANSITION, 'none', IMPORTANT);
    } else if (d.kind === 'property') {
      for (const [prop, original] of d.record.originals) {
        if (prop === TRANSITION || d.drifted.has(prop)) continue;
        writeInline(d.style, prop, original);
      }
      if (!d.drifted.has(TRANSITION)) d.style.setProperty(TRANSITION, 'none', IMPORTANT);
    }
  }
  // Flush: the restored colours become the computed style with no transition.
  if (typeof document !== 'undefined' && document.body) void document.body.offsetWidth;

  // Pass 2: the transition, and the exact attribute text.
  for (const d of decisions) {
    if (d.kind === 'exact') writeAttr(d.record.el, d.original);
    else if (d.kind === 'property' && !d.drifted.has(TRANSITION)) {
      writeInline(d.style, TRANSITION, d.record.originals.get(TRANSITION) ?? emptyInline());
    }
  }

  // Verify by reading back.
  let exact = 0;
  let propertyLevel = 0;
  let detached = 0;
  let verified = true;
  const drift: TextVisibilityDrift[] = [];
  let driftCount = 0;
  for (const d of decisions) {
    if (d.kind === 'detached') {
      detached += 1;
      continue;
    }
    if (d.kind === 'exact') {
      exact += 1;
      if (d.record.el.getAttribute('style') !== d.original) verified = false;
      continue;
    }
    propertyLevel += 1;
    for (const [prop, original] of d.record.originals) {
      if (d.drifted.has(prop)) continue;
      if (!sameInline(readInline(d.style, prop), original)) verified = false;
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
  lastRestore = result;
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
  if (!state) {
    return {
      success: true,
      hidden: false,
      changed: false,
      restore: lastRestore,
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
  return state !== null;
}

/** Test-only: restore anything hidden and forget the last restore. */
export function resetTextVisibilityForTest(): void {
  if (state) restore('request');
  lastRestore = null;
}
