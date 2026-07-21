/**
 * §4.6 — `<select>` option-list scrub UNIFORMITY.
 *
 * Two-lens verification found the three `getElementState` builders scrubbed
 * `<select>` options DIFFERENTLY: `core/registry.ts` collapsed the list to ONE
 * synthetic entry (so option COUNT + selected-index carry no signal), while
 * `control/action-executor.ts` and `render-log/dom-capture.ts` mapped every
 * option to a sentinel but PRESERVED count + real `selected` flags — under-
 * redacting cardinality on two live paths (an env/tenant switcher's option
 * count is itself sensitive).
 *
 * The fix hoists the whole scrub — including the collapse-to-one decision —
 * into the single shared `scrubSelectState` in `core/redaction.ts`, called by
 * all three builders. This file proves (a) the helper's contract directly and
 * (b) that the registry + render-log paths now collapse. The executor path is
 * proven in `control/action-executor.redaction.test.ts` ("collapses").
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scrubSelectState, scrubAliases, verdictOf, REDACTED_VALUE } from './redaction';
import { UIBridgeRegistry } from './registry';
import { captureInteractiveElements } from '../render-log/dom-capture';

const SECRET = 'SECRET123';

function multiOptionSelect(redacted: boolean): HTMLSelectElement {
  const sel = document.createElement('select');
  if (redacted) sel.setAttribute('data-bridge-redact', 'true');
  for (const [v, t] of [
    ['staging', `staging (token: ${SECRET})`],
    ['prod', `prod (token: ${SECRET})`],
    ['dev', `dev (token: ${SECRET})`],
  ]) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = t;
    sel.appendChild(opt);
  }
  sel.selectedIndex = 2; // 'dev' — a real selected index that must not leak.
  return sel;
}

describe('scrubSelectState — the single shared select-option scrub', () => {
  it('collapses a redacted select to ONE synthetic entry (count + index carry no signal)', () => {
    const sel = multiOptionSelect(true);
    const out = scrubSelectState(sel, verdictOf(sel));

    expect(out.availableOptions).toHaveLength(1);
    expect(out.availableOptions[0].value).toBe(REDACTED_VALUE);
    expect(out.availableOptions[0].label).toBe(REDACTED_VALUE);
    expect(out.availableOptions[0].selected).toBe(false);
    expect(out.selectedOptions).toEqual([REDACTED_VALUE]);
    expect(out.value).toBe(REDACTED_VALUE);
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });

  it('[negative control] preserves count + selected flags for a NON-redacted select', () => {
    const sel = multiOptionSelect(false);
    const out = scrubSelectState(sel, verdictOf(sel));

    expect(out.availableOptions).toHaveLength(3);
    expect(out.availableOptions.map((o) => o.value)).toEqual(['staging', 'prod', 'dev']);
    expect(out.availableOptions[2].selected).toBe(true);
    expect(out.value).toBe('dev');
  });
});

describe('scrubAliases — the by-construction gate for GENERATED alias lists', () => {
  // The single minter that the four generated-alias sites route through
  // (registry.searchElements, ai/search-engine.toSearchable,
  // ai/semantic-snapshot.convertElement, and the getPageSummary path) —
  // replacing the open-coded `content ? [] : generate` ternary that carried no
  // compile tripwire.
  const generated = ['open menu', 'primary action', `token ${SECRET}`];

  it('returns [] when content-redacted (a redacted element contributes no DOM-derived aliases)', () => {
    const el = document.createElement('div');
    el.setAttribute('data-bridge-redact', 'true');
    const out = scrubAliases(generated, verdictOf(el));
    expect(out).toEqual([]);
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });

  it('[negative control] passes the generated list through when NOT content-redacted', () => {
    const el = document.createElement('div'); // no boundary
    const out = scrubAliases(['open menu', 'primary action'], verdictOf(el));
    expect(out).toEqual(['open menu', 'primary action']);
  });

  it('[negative control] a bare password field is NOT content-redacted — aliases survive', () => {
    const input = document.createElement('input');
    input.type = 'password';
    const out = scrubAliases(['password field', 'login'], verdictOf(input));
    expect(out).toEqual(['password field', 'login']);
  });
});

describe('select-scrub uniformity — registry + render-log paths collapse identically', () => {
  let registry: UIBridgeRegistry;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => container.remove());

  it('registry getElementState collapses a redacted select to length 1', () => {
    const sel = multiOptionSelect(true);
    container.appendChild(sel);
    const state = registry.registerElement('sel', sel, { type: 'select' }).getState();

    expect(state.availableOptions).toHaveLength(1);
    expect(state.availableOptions?.[0]?.selected).toBe(false);
    expect(JSON.stringify(state)).not.toContain(SECRET);
  });

  it('render-log captureInteractiveElements collapses a redacted select to length 1', () => {
    const sel = multiOptionSelect(true);
    container.appendChild(sel);

    // jsdom reports 0-size rects, so includeHidden keeps the fixture in-scope.
    const captured = captureInteractiveElements({ includeHidden: true });
    const entry = captured.elements.find((c) => c.state.availableOptions !== undefined);

    expect(entry).toBeDefined();
    expect(entry!.state.availableOptions).toHaveLength(1);
    expect(entry!.state.availableOptions?.[0]?.selected).toBe(false);
    expect(JSON.stringify(captured)).not.toContain(SECRET);
  });
});
