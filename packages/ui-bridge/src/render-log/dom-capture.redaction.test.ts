import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { captureDOMSnapshot } from './dom-capture';

/**
 * §4.6 Gap B — the render-log `getElementState` is the third parallel
 * `getElementState`-shaped builder (alongside `core/registry.ts` and
 * `control/action-executor.ts`). Those two stamp the shared `elementRedaction`
 * provenance onto `state.redaction`; this one did not, so a DOM-less consumer
 * that later called `verdictFromState` on a render-log `state` would read "not
 * redacted" on both axes even for a boundary/password element. This test locks
 * the stamp in.
 *
 * Plan: plans/2026-07-20-ui-bridge-structural-redaction-enforcement.md (Layer 3 follow-on)
 */
describe('render-log capture stamps §4.6 redaction provenance', () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement('div');
    root.innerHTML = `
      <div data-bridge-redact="true">
        <button id="secret-btn" aria-label="Reveal SSN">123-45-6789</button>
      </div>
      <input id="pw" type="password" value="hunter2" />
      <button id="plain">Save order</button>
    `;
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
  });

  function stateOf(id: string) {
    const snap = captureDOMSnapshot({ root, includeHidden: true });
    const el = snap.elements.find(
      (e) => (e as { identifier?: { htmlId?: string } }).identifier?.htmlId === id
    );
    return el?.state;
  }

  it('stamps content+value for an element inside a data-bridge-redact boundary', () => {
    const state = stateOf('secret-btn');
    expect(state?.redaction).toEqual({ content: true, value: true });
  });

  it('stamps value-only for a password input outside any boundary', () => {
    const state = stateOf('pw');
    // Password hides its value but stays addressable (content NOT redacted).
    expect(state?.redaction).toEqual({ value: true });
  });

  it('omits the provenance field entirely for a non-redacted element', () => {
    const state = stateOf('plain');
    expect(state?.redaction).toBeUndefined();
  });
});
