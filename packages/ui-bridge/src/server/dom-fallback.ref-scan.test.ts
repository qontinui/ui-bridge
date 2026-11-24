/**
 * The ref-only DOM-fallback scan and the capped fallback text — plan
 * `2026-11-23-ui-bridge-element-state-collapse-follow-ups`, review round 5.
 *
 * 1. `scanDOMForInteractiveElementRefs` (what the injected seeder re-runs on
 *    every debounced re-seed) yields exactly the full scan's id, label and
 *    element for every row, in the same order, and builds no element state.
 * 2. A fallback row's `state.textContent` is the canonical text capped at 500
 *    code points with the sentinel-safe cut. For an element with text that is
 *    exactly the scrubbed capped read the scan used to build. For an element
 *    with none (an icon-only button) it is the canonical fallback, the
 *    scrubbed `aria-label` or `title`, where the old read gave "". The
 *    top-level `label` (the canonical accessible name since plan
 *    `2026-11-24-ui-bridge-find-visibility-and-fallback-label-read-the-canonical-verdicts`)
 *    is a separate value and keeps its own reading.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  scanDOMForInteractiveElementRefs,
  scanDOMForInteractiveElementsWithRefs,
} from './dom-fallback';
import { BRIDGE_REDACT_ATTR, REDACTED_VALUE, readScrubbedText, verdictOf } from '../core/redaction';

function fixture(): void {
  const long = 'x'.repeat(498);
  document.body.innerHTML = `
    <button data-testid="save">Save</button>
    <button>Duplicate</button>
    <button>Duplicate</button>
    <a href="/help" aria-label="Help centre">?</a>
    <label for="email">Email address</label>
    <input id="email" type="text" value="ada@example.test" />
    <input type="password" value="hunter2" placeholder="Password" />
    <div ${BRIDGE_REDACT_ATTR}="true"><button>Token sk-secret</button></div>
    <button id="long">${long}<span ${BRIDGE_REDACT_ATTR}="true">secret</span>tail</button>
    <button id="very-long">${'y'.repeat(700)}</button>
    <div role="button" tabindex="0"></div>
    <details><summary>More</summary></details>
    <button id="close" aria-label="Close"><svg></svg></button>
    <button id="menu" title="Menu"><svg></svg></button>
    <div ${BRIDGE_REDACT_ATTR}="true"><button id="reveal" aria-label="Reveal sk-secret"><svg></svg></button></div>
  `;
}

beforeEach(() => {
  fixture();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('scanDOMForInteractiveElementRefs', () => {
  it('yields the same id, label and element tuples as the full scan', () => {
    const full = scanDOMForInteractiveElementsWithRefs().map(({ id, label, element }) => ({
      id,
      label,
      element,
    }));
    const refs = scanDOMForInteractiveElementRefs();
    expect(refs.length).toBeGreaterThan(8);
    expect(refs).toEqual(full);
    refs.forEach((ref, i) => expect(ref.element).toBe(full[i].element));
  });

  it('builds no element state (reads no box)', () => {
    let boxReads = 0;
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      const real = el.getBoundingClientRect.bind(el);
      el.getBoundingClientRect = () => {
        boxReads++;
        return real();
      };
    }
    scanDOMForInteractiveElementRefs();
    expect(boxReads).toBe(0);
  });
});

describe('fallback state.checked', () => {
  it('is the canonical value: absent on a text input, set on a checkbox and an aria-checked switch', () => {
    document.body.innerHTML = `
      <input id="name" type="text" />
      <input id="agree" type="checkbox" checked />
      <div id="wifi" role="switch" aria-checked="true" tabindex="0">Wi-Fi</div>
    `;
    const rows = scanDOMForInteractiveElementsWithRefs();
    const byId = (id: string) => rows.find((r) => r.identifiers.htmlId === id)!;
    expect(byId('name').state.checked).toBeUndefined();
    expect(byId('agree').state.checked).toBe(true);
    expect(byId('wifi').state.checked).toBe(true);
  });
});

describe('fallback state.textContent', () => {
  it('equals the scrubbed read capped at 500 code points for an element with text', () => {
    const rows = scanDOMForInteractiveElementsWithRefs();
    const withText = rows.filter(
      (row) => readScrubbedText(row.element, verdictOf(row.element)) !== undefined
    );
    expect(withText.length).toBe(8);
    for (const row of withText) {
      const expected = readScrubbedText(row.element, verdictOf(row.element), { maxLen: 500 }) ?? '';
      expect(row.state.textContent).toBe(expected);
    }
    const byId = (id: string) => rows.find((r) => r.identifiers.htmlId === id)!;
    // The boundary below sits past the cut and is dropped whole, never split.
    expect(byId('long').state.textContent).not.toContain('secret');
    expect(byId('long').state.textContent).not.toContain('[R');
    expect(byId('very-long').state.textContent).toHaveLength(500);
    const insideBoundary = rows.find((r) => r.element.closest(`[${BRIDGE_REDACT_ATTR}]`))!;
    expect(insideBoundary.state.textContent).toBe(REDACTED_VALUE);
  });

  it('reads the aria-label or title of an element with no text; the label is unchanged', () => {
    const rows = scanDOMForInteractiveElementsWithRefs();
    const byId = (id: string) => rows.find((r) => r.identifiers.htmlId === id)!;

    expect(byId('close').state.textContent).toBe('Close');
    expect(byId('close').label).toBe('Close');
    expect(byId('menu').state.textContent).toBe('Menu');
    expect(byId('menu').label).toBe('Menu');
    // Inside a redaction boundary the fallback is the sentinel, never the label.
    expect(byId('reveal').state.textContent).toBe(REDACTED_VALUE);
    expect(byId('reveal').label).toBe(REDACTED_VALUE);
  });
});
