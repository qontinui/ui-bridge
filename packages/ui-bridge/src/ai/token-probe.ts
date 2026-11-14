/**
 * Resolve a declared value the way the browser would compute it for an
 * element, without touching the element.
 *
 * Comparing a token's text with an element's computed value fails for most
 * real token values: `1em`, `clamp(…)`, `calc(…)`, `bold`, a quoted font list,
 * `oklch(…)`, a bare `0` all compute to a different serialisation. The probe
 * lets the browser do the conversion: it sets the declaration on a hidden
 * element given the same inherited context as the element, and reads the
 * computed longhands back.
 *
 * Page hygiene: the light DOM sees exactly one insert (a `display: none` host,
 * appended to `<html>` after `<body>`, styled before it is inserted) and one
 * remove per batch; without shadow DOM there is no probe at all. Everything else — the context wrapper (the parent's inherited
 * values), the probe (the element's own) and each declaration — lives in a
 * closed shadow root, where no page rule matches and no page observer looks;
 * each declaration gets a new wrapper and probe there, since an engine may
 * cache an element's computed style.
 * The root element's own style is never touched, so the root-width lock is
 * not involved.
 */

/** The inherited context a declaration resolves in: the parent's values and the element's own. */
export interface ProbeContext {
  /** The parent's computed values of `PROBE_CONTEXT_PROPERTIES`. */
  parent: Readonly<Record<string, string>>;
  /** The element's computed values of `PROBE_CONTEXT_PROPERTIES`. */
  own: Readonly<Record<string, string>>;
}

/** The inherited properties a value can be relative to (`em`, `bolder`, `currentcolor`, …). */
export const PROBE_CONTEXT_PROPERTIES = [
  'font-size',
  'font-family',
  'font-style',
  'font-weight',
  'line-height',
  'color',
  'color-scheme',
  'writing-mode',
  'direction',
] as const;

const HOST_TAG = 'ui-bridge-token-probe';

/**
 * The context properties a declaration's computed value can depend on: the
 * cache keys on those alone, so a context difference that cannot change the
 * result still hits.
 */
function relevantContext(property: string, value: string): readonly string[] {
  const v = value.toLowerCase();
  // Colour is always carried: a value can read it implicitly (a box-shadow or
  // border without a colour computes to currentcolor).
  const fields = new Set<string>(['color']);
  if (
    /[\d.](em|ex|ch|cap|ic|lh|rlh)\b|%/.test(v) ||
    property.startsWith('font') ||
    property === 'line-height'
  ) {
    fields.add('font-size');
  }
  // ex/ch/cap/ic are measured on the font itself.
  if (property.startsWith('font') || /bolder|lighter|inherit|[\d.](ex|ch|cap|ic)\b/.test(v)) {
    fields.add('font-weight').add('font-family').add('font-style');
  }
  if (property === 'line-height' || property === 'font' || /lh\b/.test(v)) {
    fields.add('line-height');
  }
  if (/light-dark|canvas|field|buttonface/.test(v)) fields.add('color-scheme');
  if (/inline|block|start|end/.test(property)) fields.add('writing-mode').add('direction');
  return [...fields];
}

/** Whether `property` sets the context field `field` itself (so it resolves against the parent's). */
function setsField(property: string, field: string): boolean {
  if (property === field) return true;
  return property === 'font' && (field.startsWith('font') || field === 'line-height');
}

export class TokenProbe {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private readonly cache = new Map<string, string[] | null>();

  constructor(private readonly doc: Document) {}

  /**
   * The computed `longhands` of an element whose `property` is declared as
   * `value` (plus any `extra` declarations) in `context`; `null` when the
   * declaration is not valid.
   */
  resolve(
    property: string,
    value: string,
    longhands: readonly string[],
    context: ProbeContext,
    extra: Readonly<Record<string, string>> = {}
  ): string[] | null {
    const relevant = relevantContext(property, value);
    // The cache keys on the values the declaration can read: the parent's for
    // a field the declaration itself sets (`em` in font-size, `bolder`), the
    // element's own otherwise — never the element's own value of the
    // property under test.
    const key = [
      property,
      value,
      longhands.join(','),
      JSON.stringify(extra),
      ...relevant.map((f) => (setsField(property, f) ? context.parent[f] : context.own[f]) ?? ''),
    ].join('\u0000');
    if (this.cache.has(key)) return this.cache.get(key) ?? null;
    let result: string[] | null = null;
    const fresh = this.fresh();
    if (fresh) {
      const { wrapper, probe } = fresh;
      for (const p of relevant) {
        if (context.parent[p]) wrapper.style.setProperty(p, context.parent[p], 'important');
        // The element's own value; the declaration under test then replaces
        // any of them it sets.
        if (context.own[p]) probe.style.setProperty(p, context.own[p]);
      }
      for (const [p, v] of Object.entries(extra)) probe.style.setProperty(p, v);
      // An invalid value is dropped, which would leave the context value set
      // above in place: validate on a blank declaration block first.
      const check = this.doc.createElement('div').style;
      check.setProperty(property, value);
      const accepted =
        check.getPropertyValue(property) !== '' ||
        longhands.some((l) => check.getPropertyValue(l) !== '');
      probe.style.setProperty(property, value);
      if (accepted) {
        const computed = (this.doc.defaultView ?? window).getComputedStyle(probe);
        result = longhands.map((l) => computed.getPropertyValue(l).trim());
      }
    }
    this.cache.set(key, result);
    return result;
  }

  /** Remove the probe from the document. */
  dispose(): void {
    this.host?.remove();
    this.host = null;
    this.shadow = null;
  }

  /**
   * A new context wrapper and probe in the shadow root, replacing the last
   * ones: an engine may cache computed styles per element, so each
   * declaration is read from an element that never had another.
   */
  private fresh(): { wrapper: HTMLElement; probe: HTMLElement } | null {
    const shadow = this.ensure();
    if (!shadow) return null;
    const wrapper = this.doc.createElement('div');
    const probe = this.doc.createElement('div');
    wrapper.appendChild(probe);
    shadow.replaceChildren(wrapper);
    return { wrapper, probe };
  }

  private ensure(): ShadowRoot | null {
    if (this.shadow) return this.shadow;
    const root = this.doc.documentElement;
    if (!root) return null;
    const host = this.doc.createElement(HOST_TAG);
    // Without shadow DOM every declaration would mutate the light DOM: no
    // probe, and the comparison reports `unverified`.
    if (typeof host.attachShadow !== 'function') return null;
    // Styled and filled before it is inserted: one light-DOM mutation.
    host.setAttribute('aria-hidden', 'true');
    host.setAttribute('data-ui-bridge-internal', 'token-probe');
    host.style.setProperty('display', 'none', 'important');
    const shadow = host.attachShadow({ mode: 'closed' });
    // Appended after <body>, as the last child of <html>: between <head> and
    // <body> it would break `head + body` / `head ~ body`; as the last child
    // it can only affect `body:last-child` and `:nth-last-child()` on body,
    // which pages rarely style.
    root.appendChild(host);
    this.host = host;
    this.shadow = shadow;
    // Backstop: a caller that never disposes still leaves no probe behind.
    setTimeout(() => this.dispose(), 0);
    return shadow;
  }
}
