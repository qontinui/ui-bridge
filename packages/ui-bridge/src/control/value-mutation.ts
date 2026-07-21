/**
 * Value Mutation Helper
 *
 * The SINGLE place where DOM value mutation and its event lifecycle live.
 *
 * Every UI-Bridge value-mutation action (`type` / `setValue` / `clear` / `fill`)
 * across every executor surface (relay/injected command handlers, control-action
 * + AI/NL action executor, and the shared form-fill utility) routes through
 * {@link applyValueMutation}. Previously each surface carried its own divergent
 * copy of the matrix, so a focus-gated input (one that reveals UI on `focus`,
 * e.g. the runner CommandBar dropdown) did NOT react when a driver set its value
 * via `setValue`/`clear`/NL-`type` — those paths never focused and never
 * dispatched a synthetic `FocusEvent`.
 *
 * This helper performs the COMPLETE, correct lifecycle (the union of the good
 * parts of the prior implementations): native focus + synthetic `FocusEvent`,
 * native prototype `value` setter so React controlled inputs update, React
 * `_valueTracker` reset so `old !== new` is detected, native `input` event,
 * a direct `__reactProps$<key>.onChange` invocation (the reliable path in
 * embedded WebViews like Tauri where event delegation may be bypassed), and a
 * native `change` event — with an optional blur at the end.
 */

/** How {@link applyValueMutation} computes the next value from the current one. */
export type ValueMutationMode = 'replace' | 'append' | 'clear' | 'clear-then-append';

/** Options for {@link applyValueMutation}. */
export interface ValueMutationOptions {
  /**
   * The value to apply. Its meaning depends on `mode`:
   * - `replace`: the full next value
   * - `append` / `clear-then-append`: the text appended after any existing/cleared value
   * - `clear`: ignored (the value is always emptied)
   */
  value: string;
  /** How to derive the next value from the current one. */
  mode: ValueMutationMode;
  /** Blur (and dispatch a synthetic `blur` FocusEvent) when done. Default: FALSE — leave the element focused. */
  blur?: boolean;
}

/**
 * Raw live value read for value-mutation/React-tracker mechanics — written back,
 * never emitted to a client (outside §4.6 projection scope). The React
 * `_valueTracker` must compare against the ACTUAL previous cleartext value; a
 * scrubbed read would break selecting/mutating inside a password/boundary field.
 */
export function readLiveValue(
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
): string {
  return el.value;
}

/**
 * Raw live `textContent` read for the contenteditable typing mechanic — the
 * current text is read only to APPEND to it and write it straight back, never
 * emitted to a client (outside §4.6 projection scope). Scrubbing here would
 * corrupt what the user is typing into a contenteditable inside a boundary.
 */
export function readLiveText(el: HTMLElement): string {
  return el.textContent ?? '';
}

/**
 * Apply a value mutation to an input/textarea, emitting the complete focus →
 * input → onChange → change (→ optional blur) lifecycle that both standard
 * browsers and embedded WebViews need.
 */
export function applyValueMutation(
  el: HTMLInputElement | HTMLTextAreaElement,
  opts: ValueMutationOptions
): void {
  // Step 1: focus natively AND dispatch a synthetic FocusEvent. Native focus
  // alone is unreliable in embedded WebViews (which is also why the direct
  // onChange fallback below exists), and focus-gated inputs only reveal their
  // UI when the bubbled `focus` event fires.
  el.focus();
  el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

  // Native prototype value setter: React overrides the `value` property, so
  // assigning `el.value` directly doesn't notify React. The native setter does.
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  const setNativeValue = (next: string): void => {
    if (nativeSetter) {
      nativeSetter.call(el, next);
    } else {
      el.value = next;
    }
  };

  // React 17+ stores props directly on the DOM node under __reactProps$<key>.
  // Resolve once; reused by every notifyReact below.
  const domEl = el as unknown as Record<string, unknown>;
  const reactPropsKey = Object.keys(domEl).find((k) => k.startsWith('__reactProps$'));
  const reactProps = reactPropsKey
    ? (domEl[reactPropsKey] as Record<string, unknown> | undefined)
    : undefined;

  /**
   * Notify React of a value change after the new value is already set:
   * 1. Reset `_valueTracker` to `oldValue` so React detects `old !== new`
   *    (React skips onChange when the tracker value equals the new value).
   * 2. Dispatch a native `input` event — React event delegation picks this up
   *    in standard browser contexts.
   * 3. Directly invoke `__reactProps$.onChange` — the reliable path in embedded
   *    WebViews (Tauri) where event delegation may be bypassed.
   */
  const notifyReact = (oldValue: string): void => {
    const tracker = (el as unknown as { _valueTracker?: { setValue(v: string): void } })
      ._valueTracker;
    if (tracker) tracker.setValue(oldValue);

    el.dispatchEvent(new Event('input', { bubbles: true }));

    if (reactProps?.onChange && typeof reactProps.onChange === 'function') {
      (reactProps.onChange as (e: unknown) => void)({
        target: el,
        currentTarget: el,
        type: 'change',
        bubbles: true,
        preventDefault: () => {},
        stopPropagation: () => {},
        nativeEvent: new Event('input'),
      });
    }
  };

  // Step 2/3/4/5/6: compute + apply the next value per mode, notifying React.
  if (opts.mode === 'clear-then-append') {
    // First clear (native-set '' + reset tracker + input + direct onChange)...
    const beforeClear = el.value;
    setNativeValue('');
    notifyReact(beforeClear);
    // ...then append the new text.
    const beforeAppend = el.value;
    setNativeValue(beforeAppend + opts.value);
    notifyReact(beforeAppend);
  } else {
    const prior = el.value;
    let next: string;
    switch (opts.mode) {
      case 'replace':
        next = opts.value;
        break;
      case 'append':
        next = el.value + opts.value;
        break;
      case 'clear':
        next = '';
        break;
    }
    setNativeValue(next);
    notifyReact(prior);
  }

  // Step 7: native change event.
  el.dispatchEvent(new Event('change', { bubbles: true }));

  // Step 8: optional blur.
  if (opts.blur) {
    el.blur();
    el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  }
}
