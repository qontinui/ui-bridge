/**
 * Resolve a declared value the way the browser would compute it for an
 * element, without touching the element.
 *
 * Comparing a token's text with an element's computed value fails for most
 * real token values: `1em`, `clamp(…)`, `calc(…)`, `bold`, a quoted font list,
 * `oklch(…)`, a bare `0` all compute to a different serialisation. The probe
 * lets the browser do the conversion: it sets the declaration on a hidden
 * element given the same font-size and colour context, and reads the computed
 * longhands back.
 *
 * The probe is one `display: none` host appended to `<html>` (never the root
 * element's own style, so the root-width lock is not involved) with the probe
 * element in a closed shadow root, so no page rule matches it. It is created
 * on the first comparison of a batch and removed by `dispose()` (and, as a
 * backstop, on the next task). A value the probe does not resolve to an
 * absolute serialisation (`%` on a box without layout) comes back as it was,
 * and the caller treats a comparison across kinds as unverified.
 */

/** The font-size and colour context a declaration resolves in. */
export interface ProbeContext {
  /** The element's parent's computed font-size (`em` in `font-size` is relative to it). */
  parentFontSize: string;
  /** The element's computed font-size (`em` elsewhere is relative to it). */
  fontSize: string;
  /** The element's parent's computed colour (`currentcolor` in `color`). */
  parentColor: string;
  /** The element's computed colour (`currentcolor` elsewhere). */
  color: string;
}

const HOST_TAG = 'ui-bridge-token-probe';

export class TokenProbe {
  private host: HTMLElement | null = null;
  private probe: HTMLElement | null = null;
  private readonly cache = new Map<string, string[] | null>();

  constructor(private readonly doc: Document) {}

  /**
   * The computed `longhands` of an element whose `property` is declared as
   * `value` in `context`; `null` when the declaration is not valid.
   */
  resolve(
    property: string,
    value: string,
    longhands: readonly string[],
    context: ProbeContext
  ): string[] | null {
    const key = [property, value, longhands.join(','), ...Object.values(context)].join('\u0000');
    if (this.cache.has(key)) return this.cache.get(key) ?? null;
    let result: string[] | null = null;
    const probe = this.ensure();
    if (probe && this.host) {
      const inFontContext = property === 'font-size' || property === 'font';
      const inColorContext = property === 'color';
      this.host.style.setProperty('font-size', context.parentFontSize);
      this.host.style.setProperty('color', context.parentColor);
      probe.removeAttribute('style');
      if (!inFontContext) probe.style.setProperty('font-size', context.fontSize);
      if (!inColorContext) probe.style.setProperty('color', context.color);
      probe.style.setProperty(property, value);
      // An invalid value leaves the declaration (and every longhand) unset.
      const accepted =
        probe.style.getPropertyValue(property) !== '' ||
        longhands.some((l) => probe.style.getPropertyValue(l) !== '');
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
    this.probe = null;
  }

  private ensure(): HTMLElement | null {
    if (this.probe) return this.probe;
    const root = this.doc.documentElement;
    if (!root) return null;
    const host = this.doc.createElement(HOST_TAG);
    host.setAttribute('aria-hidden', 'true');
    host.setAttribute('data-ui-bridge-internal', 'token-probe');
    host.style.setProperty('display', 'none', 'important');
    const probe = this.doc.createElement('div');
    if (typeof host.attachShadow === 'function') {
      host.attachShadow({ mode: 'closed' }).appendChild(probe);
    } else {
      host.appendChild(probe);
    }
    root.appendChild(host);
    this.host = host;
    this.probe = probe;
    // Backstop: a caller that never disposes still leaves no probe behind.
    setTimeout(() => this.dispose(), 0);
    return probe;
  }
}
