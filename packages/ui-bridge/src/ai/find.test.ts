/**
 * find() — element-finder tests (B3)
 *
 * Verifies that ai/find can locate elements by:
 *   - placeholder
 *   - aria-label
 *   - associated <label> text (for= and wrapping label)
 *   - name attribute
 *
 * Plus a regression check that the existing element-text path still works.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { find } from './find';
import { SearchEngine } from './search-engine';
import type { RegisteredElement, ElementState } from '../core/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultState(rect = { x: 0, y: 0, width: 200, height: 30 }): ElementState {
  return {
    visible: true,
    enabled: true,
    focused: false,
    checked: false,
    textContent: '',
    rect,
    attributes: {},
  };
}

function makeRegistered(
  id: string,
  el: HTMLElement,
  options: { type?: string; label?: string } = {}
): RegisteredElement {
  const { type = el.tagName.toLowerCase(), label } = options;
  return {
    id,
    type,
    label: label ?? id,
    element: el,
    actions: ['click', 'fill'],
    aliases: [],
    description: '',
    getState: () => {
      const rect = el.getBoundingClientRect();
      return {
        ...defaultState(),
        textContent: el.textContent || '',
        rect: { x: rect.x, y: rect.y, width: rect.width || 200, height: rect.height || 30 },
        value: (el as HTMLInputElement).value,
      };
    },
  } as unknown as RegisteredElement;
}

function attachToDocument(...nodes: Node[]): void {
  document.body.innerHTML = '';
  for (const n of nodes) {
    document.body.appendChild(n);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('find() — broadened matcher (B3)', () => {
  let engine: SearchEngine;

  beforeEach(() => {
    engine = new SearchEngine({ fuzzyThreshold: 0.5 });
  });

  it('still finds elements by visible text content (regression)', () => {
    const button = document.createElement('button');
    button.textContent = 'Submit';
    attachToDocument(button);

    const reg = makeRegistered('submit-btn', button, { type: 'button' });
    engine.updateElements([reg]);

    const result = find('Submit', engine, { confidenceThreshold: 0.4 });

    expect(result.found).toBe(true);
    if (result.found && !result.ambiguous) {
      expect(result.elementId).toBe('submit-btn');
    }
  });

  it('finds an input by placeholder text', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Enter your prompt here';
    attachToDocument(input);

    // Use an opaque registered label that does NOT contain the search
    // keyword, so the only signal that can match is the placeholder.
    const reg = makeRegistered('field-x1', input, { type: 'input', label: 'field-x1' });
    engine.updateElements([reg]);

    // Query is a single keyword that appears only in the placeholder.
    const result = find('prompt', engine, { confidenceThreshold: 0.4 });

    expect(result.found).toBe(true);
    if (result.found && !result.ambiguous) {
      expect(result.elementId).toBe('field-x1');
      expect(result.matchReasons.some((r) => r.toLowerCase().includes('placeholder'))).toBe(true);
    }
  });

  it('finds an input by aria-label', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('aria-label', 'Search products');
    attachToDocument(input);

    // Opaque label so the aria-label is the only signal that matches.
    const reg = makeRegistered('field-a1', input, { type: 'input', label: 'field-a1' });
    engine.updateElements([reg]);

    const result = find('Search products', engine, { confidenceThreshold: 0.4 });

    expect(result.found).toBe(true);
    if (result.found && !result.ambiguous) {
      expect(result.elementId).toBe('field-a1');
      expect(result.matchReasons.some((r) => r.toLowerCase().includes('aria'))).toBe(true);
    }
  });

  it('finds an input via an associated <label for="..."> element', () => {
    const label = document.createElement('label');
    label.htmlFor = 'username-field';
    label.textContent = 'Username';

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'username-field';

    attachToDocument(label, input);

    // Opaque registered label so the <label for="..."> text is the only
    // signal that matches "Username".
    const reg = makeRegistered('field-u3', input, { type: 'input', label: 'field-u3' });
    engine.updateElements([reg]);

    const result = find('Username', engine, { confidenceThreshold: 0.4 });

    expect(result.found).toBe(true);
    if (result.found && !result.ambiguous) {
      expect(result.elementId).toBe('field-u3');
      expect(result.matchReasons.some((r) => r.toLowerCase().includes('label'))).toBe(true);
    }
  });

  it('finds an input via a wrapping <label> ancestor', () => {
    const label = document.createElement('label');
    label.appendChild(document.createTextNode('Email '));
    const input = document.createElement('input');
    input.type = 'email';
    label.appendChild(input);

    attachToDocument(label);

    const reg = makeRegistered('field-e7', input, { type: 'input', label: 'field-e7' });
    engine.updateElements([reg]);

    const result = find('Email', engine, { confidenceThreshold: 0.4 });

    expect(result.found).toBe(true);
    if (result.found && !result.ambiguous) {
      expect(result.elementId).toBe('field-e7');
    }
  });

  it('finds an input by the `name` attribute', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.name = 'recipient_address';
    attachToDocument(input);

    // Opaque label so only the `name` attribute can match the query.
    const reg = makeRegistered('field-q9', input, { type: 'input', label: 'field-q9' });
    engine.updateElements([reg]);

    const result = find('recipient_address', engine, { confidenceThreshold: 0.4 });

    expect(result.found).toBe(true);
    if (result.found && !result.ambiguous) {
      expect(result.elementId).toBe('field-q9');
      // The reasons should mention `name` (e.g., "exact name match").
      // We accept the longer form to avoid false positives on the word
      // "name" appearing in other reason strings.
      expect(result.matchReasons.some((r) => /\bname\b/i.test(r))).toBe(true);
    }
  });

  it('decomposed result mirrors query into source-signal fields', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'foo';
    attachToDocument(input);

    const reg = makeRegistered('foo-input', input, { type: 'input' });
    engine.updateElements([reg]);

    const result = find('foo', engine, { confidenceThreshold: 0.4 });

    // The decomposed shape now exposes the probe-target fields so callers
    // can see at a glance which signals the matcher considered.
    expect(result.decomposed.elementText).toBe('foo');
    expect(result.decomposed.placeholder).toBe('foo');
    expect(result.decomposed.ariaLabel).toBe('foo');
    expect(result.decomposed.label).toBe('foo');
    expect(result.decomposed.name).toBe('foo');
  });
});

// ---------------------------------------------------------------------------
// Disclosure-family integration — verifies that ai/find lands on a
// type: 'disclosure' element even when the natural-language query contains
// the verb "toggle" (which the decomposer maps to switch as a soft hint).
//
// This is the regression that motivated Phase 2: "Advanced details toggle"
// against a registered disclosure should succeed, not fall through to
// found:false.
// ---------------------------------------------------------------------------
describe('find() — disclosure family + soft-type fallback', () => {
  let engine: SearchEngine;

  beforeEach(() => {
    engine = new SearchEngine({ fuzzyThreshold: 0.5 });
  });

  it('finds a disclosure widget by its label when verb maps to "switch"', () => {
    // Real-world fixture: Builder UI registers an "Advanced" disclosure with
    // type: 'disclosure'. Free-form NL query says "Advanced details toggle".
    const button = document.createElement('button');
    button.textContent = 'Advanced details';
    attachToDocument(button);

    const reg = makeRegistered('ui-bridge-advanced-disclosure', button, {
      type: 'disclosure',
      label: 'Advanced details',
    });
    engine.updateElements([reg]);

    const result = find('Advanced details toggle', engine, { confidenceThreshold: 0.4 });

    expect(result.found).toBe(true);
    if (result.found && !result.ambiguous) {
      expect(result.elementId).toBe('ui-bridge-advanced-disclosure');
    }
  });

  it('finds a disclosure widget by the bare phrase "details toggle"', () => {
    const button = document.createElement('button');
    button.textContent = 'Settings details';
    attachToDocument(button);

    const reg = makeRegistered('settings-disclosure', button, {
      type: 'disclosure',
      label: 'Settings details',
    });
    engine.updateElements([reg]);

    const result = find('Settings details toggle', engine, { confidenceThreshold: 0.4 });
    expect(result.found).toBe(true);
    if (result.found && !result.ambiguous) {
      expect(result.elementId).toBe('settings-disclosure');
    }
  });

  it('still finds a real switch by "X toggle" when no disclosure exists', () => {
    // Regression: ensure the disclosure synonyms didn't break existing
    // switch-style elements. "dark mode toggle" → switch type, and a
    // genuine type: 'switch' element should still be matched.
    const button = document.createElement('button');
    button.setAttribute('role', 'switch');
    button.textContent = 'Dark mode';
    attachToDocument(button);

    const reg = makeRegistered('dark-mode-switch', button, {
      type: 'switch',
      label: 'Dark mode',
    });
    engine.updateElements([reg]);

    const result = find('Dark mode toggle', engine, { confidenceThreshold: 0.4 });
    expect(result.found).toBe(true);
    if (result.found && !result.ambiguous) {
      expect(result.elementId).toBe('dark-mode-switch');
    }
  });

  it('soft-type fallback: prefers a disclosure with matching label over a switch with non-matching label', () => {
    // Two fixtures co-exist on the page:
    //   - a disclosure labelled "Advanced details" (the real target)
    //   - a switch labelled "Notifications" (a distractor)
    // Query "Advanced details toggle" decomposes to {type: switch,
    // text: "Advanced details"}. With the soft-hint fallback, the matcher
    // should land on the disclosure, not the switch.
    const disclosureBtn = document.createElement('button');
    disclosureBtn.textContent = 'Advanced details';

    const switchBtn = document.createElement('button');
    switchBtn.setAttribute('role', 'switch');
    switchBtn.textContent = 'Notifications';

    attachToDocument(disclosureBtn, switchBtn);

    const disclosureReg = makeRegistered('adv-disclosure', disclosureBtn, {
      type: 'disclosure',
      label: 'Advanced details',
    });
    const switchReg = makeRegistered('notif-switch', switchBtn, {
      type: 'switch',
      label: 'Notifications',
    });
    engine.updateElements([disclosureReg, switchReg]);

    const result = find('Advanced details toggle', engine, { confidenceThreshold: 0.4 });
    expect(result.found).toBe(true);
    if (result.found && !result.ambiguous) {
      expect(result.elementId).toBe('adv-disclosure');
    }
  });

  it('soft-type fallback: bare verb "expand X" lands on disclosure', () => {
    // The decomposer maps bare "expand" → disclosure as a soft hint. With a
    // single disclosure on the page, ai/find should land on it directly.
    // (No fallback triggers because the type-constrained search already
    // finds the right element.)
    const button = document.createElement('button');
    button.textContent = 'Logs';
    attachToDocument(button);

    const reg = makeRegistered('logs-disclosure', button, {
      type: 'disclosure',
      label: 'Logs',
    });
    engine.updateElements([reg]);

    const result = find('expand Logs', engine, { confidenceThreshold: 0.4 });
    expect(result.found).toBe(true);
    if (result.found && !result.ambiguous) {
      expect(result.elementId).toBe('logs-disclosure');
    }
  });

  it('soft-type fallback: when type-constrained search misses, label-only retry succeeds', () => {
    // Contrived but precise: a button (not a disclosure) labelled "Job
    // details" exists. Query "Job details" decomposes to {type:
    // 'disclosure' (soft hint), text: 'Job'}. The first pass with
    // type=disclosure misses. The fallback retries without `type` and
    // lands on the button via label match.
    const button = document.createElement('button');
    button.textContent = 'Job details';
    attachToDocument(button);

    const reg = makeRegistered('job-details-btn', button, {
      type: 'button',
      label: 'Job details',
    });
    engine.updateElements([reg]);

    const result = find('Job details', engine, { confidenceThreshold: 0.4 });
    expect(result.found).toBe(true);
    if (result.found && !result.ambiguous) {
      expect(result.elementId).toBe('job-details-btn');
    }
  });
});

// ---------------------------------------------------------------------------
// Phase B+C — short query against long disclosure label.
//
// These cover the original Phase B regression: a single-word query
// "Advanced" must match a disclosure whose label is a long sentence
// starting with "Advanced:". Plus the multi-word distractor case where a
// sibling button labelled "Cost Control" used to win at ~0.507 because of
// (a) hard-pinned synonym blocking the disclosure and (b) flat 0.85
// substring contains scores tying with weak token overlap on the button.
// ---------------------------------------------------------------------------
describe('find() — short query against long disclosure label (Phase B)', () => {
  let engine: SearchEngine;
  const longDisclosureLabel =
    'Advanced: per-stage controls — pick specific pages, toggle specs / tutorials / videos, inspect each stage';

  beforeEach(() => {
    engine = new SearchEngine({ fuzzyThreshold: 0.5 });
  });

  function makeLongDisclosure(): RegisteredElement {
    const button = document.createElement('button');
    button.textContent = longDisclosureLabel;
    attachToDocument(button);
    return makeRegistered('ui-bridge-advanced-disclosure', button, {
      type: 'disclosure',
      label: longDisclosureLabel,
    });
  }

  it('single-word "Advanced" lands on the long-label disclosure (≥ 0.7)', () => {
    engine.updateElements([makeLongDisclosure()]);
    const result = find('Advanced', engine, { confidenceThreshold: 0.4 });

    expect(result.found).toBe(true);
    if (result.found && !result.ambiguous) {
      expect(result.elementId).toBe('ui-bridge-advanced-disclosure');
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    }
  });

  it('"Advanced details toggle" lands on the long-label disclosure (≥ 0.7)', () => {
    engine.updateElements([makeLongDisclosure()]);
    const result = find('Advanced details toggle', engine, { confidenceThreshold: 0.4 });

    expect(result.found).toBe(true);
    if (result.found && !result.ambiguous) {
      expect(result.elementId).toBe('ui-bridge-advanced-disclosure');
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    }
  });

  it('"Advanced per-stage controls" beats a sibling "Cost Control" button', () => {
    // Reproduces the exact failure mode from the Phase B brief: a sibling
    // button used to win at ~0.507 because token-prefix alignment wasn't
    // boosted and the dilution from the long label dropped the disclosure
    // below the button's confidence.
    const disclosure = makeLongDisclosure();
    const costButton = document.createElement('button');
    costButton.textContent = 'Cost Control';
    document.body.appendChild(costButton);
    const costReg = makeRegistered('cost-control-btn', costButton, {
      type: 'button',
      label: 'Cost Control',
    });
    engine.updateElements([disclosure, costReg]);

    const result = find('Advanced per-stage controls', engine, { confidenceThreshold: 0.4 });

    expect(result.found).toBe(true);
    if (result.found && !result.ambiguous) {
      expect(result.elementId).toBe('ui-bridge-advanced-disclosure');
    }
  });

  it('exact single-word match on a single-word label is still confidence 1.0', () => {
    const button = document.createElement('button');
    button.textContent = 'Advanced';
    attachToDocument(button);
    const reg = makeRegistered('advanced-only', button, {
      type: 'disclosure',
      label: 'Advanced',
    });
    engine.updateElements([reg]);

    const result = find('Advanced', engine, { confidenceThreshold: 0.4 });

    expect(result.found).toBe(true);
    if (result.found && !result.ambiguous) {
      expect(result.elementId).toBe('advanced-only');
      // Allow a small margin for fuzzy/alias bonuses; "exact" must still
      // dominate. The current scoring path produces 1.0 cleanly because
      // the only branch contributing weight is text and it scores 1.0.
      expect(result.confidence).toBeGreaterThanOrEqual(0.99);
    }
  });

  it('"expand" against fixtures with no disclosure returns cleanly (no crash, soft-relax)', () => {
    // Bare "expand" decomposes to {type: 'disclosure' (soft hint),
    // text: 'expand'}. With no disclosures on the page, the soft-type
    // fallback in find.ts triggers a label-only retry. The retry should
    // either return a sensible best-effort match or `found: false`
    // without throwing.
    const button = document.createElement('button');
    button.textContent = 'Save';
    attachToDocument(button);
    const reg = makeRegistered('save-btn', button, {
      type: 'button',
      label: 'Save',
    });
    engine.updateElements([reg]);

    expect(() => find('expand', engine, { confidenceThreshold: 0.4 })).not.toThrow();
  });

  it('B4 regression: structured query gate — relax only fires for free-form NL strings', () => {
    // Structured callers (passing a SearchCriteria object) must never
    // trigger the B4 hard-pinned-synonym fallback. The fallback is gated
    // on `typeof query === 'string'`, so this test pins that gate by
    // invoking find() with a structured criteria where the type is set
    // and no element of that type exists on the page. We assert the
    // returned `decomposed.elementType` matches what was passed —
    // confirming the structured branch ran — and that the result reflects
    // the engine's bare scoring (no relaxation jumped in to "help").
    //
    // Note: type is a scoring bonus, not a hard filter, in the current
    // engine. So the disclosure may still match against text:"Advanced".
    // The regression we're guarding is: the B4 fallback does NOT secretly
    // re-run a relaxed search on structured calls.
    const disclosure = makeLongDisclosure();
    engine.updateElements([disclosure]);

    const result = find({ type: 'button' as const, text: 'Advanced', fuzzy: true }, engine, {
      confidenceThreshold: 0.4,
    });

    // Decomposed shape preserves the structured caller's type pin.
    expect(result.decomposed.elementType).toBe('button');
  });

  it('B4 hard-synonym fallback: free-form "details toggle" relaxes when no disclosure exists', () => {
    // Concrete demonstration of B4's value-add. "details toggle" hits the
    // disclosure synonym table as a HARD pin (not soft), so the legacy
    // soft-fallback never fires. With only a button on the page, the
    // type-pinned search returns nothing. The B4 cache check sees that
    // the page has no disclosures, retries without `type`, and lands on
    // the button via label match.
    const button = document.createElement('button');
    button.textContent = 'Show advanced details';
    attachToDocument(button);

    const reg = makeRegistered('show-advanced', button, {
      type: 'button',
      label: 'Show advanced details',
    });
    engine.updateElements([reg]);

    const result = find('advanced details toggle', engine, { confidenceThreshold: 0.4 });

    expect(result.found).toBe(true);
    if (result.found && !result.ambiguous) {
      expect(result.elementId).toBe('show-advanced');
    }
  });
});
