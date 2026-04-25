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
