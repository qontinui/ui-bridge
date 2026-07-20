/**
 * §4.6 redaction — regression tests for the SearchEngine projection.
 *
 * WHY THIS FILE EXISTS (the bypass it closes):
 * `SearchEngine` — not `registry.searchElements` — is the REAL client-facing
 * search surface: `POST /ai/search` → `handlers.ts` → `searchEngine.search()`,
 * plus the relay `aiSearch` / `aiFind` / `aiSemanticSearch` verbs and
 * `ai/find.ts` (which imports `SearchEngine`, NOT the registry). Its
 * `buildSearchable` read raw `aria-label`, `placeholder`, `title`, `name`,
 * and `<label>` element text with no gate, then fed them to
 * `generateAliases` and emitted them as `accessibleName` / `placeholder` /
 * `title` / `labelText` / `aliases`.
 *
 * Those fields leak TWICE over:
 *   1. by EMISSION, on every search result; and
 *   2. as a CONFIRMATION ORACLE — they are scored against
 *      (`scoreAliasMatch` gives an exact alias hit 1.0; there are dedicated
 *      `criteria.placeholder` / `criteria.title` branches and a weighted
 *      name chain), so a client that cannot be SHOWN the secret could still
 *      CONFIRM a guess of it via a high-confidence hit.
 *
 * Both halves are tested here. The gate lives in `buildSearchable` — the
 * single choke point every `criteria.*` branch and `toAIDiscoveredElement`
 * read from — so a scoring branch added later is closed by construction.
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.6.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SearchEngine } from './search-engine';
import { UIBridgeRegistry, REDACTED_VALUE } from '../core/registry';

const SECRET = 'SECRET123';

describe('SearchEngine — AI search projection honors §4.6', () => {
  let registry: UIBridgeRegistry;
  let engine: SearchEngine;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    // `includeHidden` — jsdom reports a zero rect for everything, so without
    // this the visibility filter would drop the fixtures before scoring and
    // the oracle assertions would pass vacuously.
    engine = new SearchEngine({ includeHidden: true });
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => document.body.removeChild(container));

  /**
   * A redacted input carrying the secret in EVERY raw DOM channel
   * `buildSearchable` reads: aria-label, placeholder, title, name, the
   * associated <label> element's text, and its own value. Registered under
   * a non-secret dev-set label so a search can reach it without querying
   * the secret itself.
   */
  function registerSecretInput(): void {
    const boundary = document.createElement('div');
    boundary.setAttribute('data-bridge-redact', 'true');

    const input = document.createElement('input');
    input.id = 'secret-input';
    input.setAttribute('aria-label', `token ${SECRET}`);
    input.setAttribute('placeholder', `enter ${SECRET}`);
    input.setAttribute('title', `title ${SECRET}`);
    input.setAttribute('name', `name-${SECRET}`);
    input.value = SECRET;

    const label = document.createElement('label');
    label.setAttribute('for', 'secret-input');
    label.textContent = `label ${SECRET}`;

    boundary.appendChild(label);
    boundary.appendChild(input);
    container.appendChild(boundary);
    registry.registerElement('secret-input', input, { type: 'input', label: 'vault control' });
  }

  function refresh(): void {
    engine.updateElements(registry.getAllElements());
  }

  // ---- EMISSION ----

  it('emits no raw DOM content on a redacted hit', () => {
    registerSecretInput();
    refresh();

    // Reached by the STRUCTURAL id, not by any redacted content channel —
    // `id` is deliberately not redacted, so this stays reachable after the
    // fix and the assertions below are never vacuous.
    const res = engine.search({ idPattern: 'secret-input', fuzzy: true });
    const hit = res.results.find((r) => r.element.id === 'secret-input');

    expect(hit).toBeDefined();
    expect(hit!.element.accessibleName).toBe(REDACTED_VALUE);
    expect(hit!.element.placeholder).toBeUndefined();
    expect(hit!.element.title).toBeUndefined();
    expect(hit!.element.labelText).toBeUndefined();
    expect(hit!.element.aliases).toEqual([]);
    expect(hit!.element.description).not.toContain(SECRET);
  });

  it('leaks the secret nowhere in the full search response, matchReasons included', () => {
    registerSecretInput();
    refresh();

    const res = engine.search({ idPattern: 'secret-input', fuzzy: true });
    expect(res.results.some((r) => r.element.id === 'secret-input')).toBe(true);

    // Blanket assertion over the ENTIRE response — `matchReasons` echoed
    // alias strings verbatim, so scrubbing only the element fields would
    // still have shipped the secret in the reasons array.
    expect(JSON.stringify(res)).not.toContain(SECRET);
    for (const r of res.results) {
      expect(JSON.stringify(r.matchReasons)).not.toContain(SECRET);
    }
  });

  // ---- ORACLE CLOSURE ----
  // A client must not be able to CONFIRM a secret it cannot be shown.

  // Each probe guesses the EXACT value of the redacted field it targets —
  // the strongest form of the oracle. An exact hit scores 1.0 on that
  // branch, so pre-fix each of these returned a confident confirmation.
  it.each([
    ['text', { text: `token ${SECRET}`, fuzzy: true }],
    ['accessibleName', { accessibleName: `token ${SECRET}`, fuzzy: true }],
    ['placeholder', { placeholder: `enter ${SECRET}`, fuzzy: true }],
    ['title', { title: `title ${SECRET}`, fuzzy: true }],
    ['labelText via text', { text: `label ${SECRET}`, fuzzy: true }],
    ['value via text', { text: SECRET, fuzzy: true }],
    ['textContains', { textContains: SECRET, fuzzy: true }],
  ])('CLOSES THE ORACLE — guessing the exact redacted `%s` yields no high-confidence hit', (_field, criteria) => {
    registerSecretInput();
    refresh();

    const res = engine.search(criteria as never);
    const hit = res.results.find((r) => r.element.id === 'secret-input');

    expect(hit?.confidence ?? 0).toBeLessThan(0.7);
    // Assert on the RESULTS, not the whole envelope: `SearchResponse` echoes
    // `criteria` back, and here the criteria IS the secret the client typed.
    // Its own input coming back is not a leak — the leak would be the
    // ELEMENT's content, or a confidence score confirming the guess.
    expect(JSON.stringify(res.results)).not.toContain(SECRET);
    expect(JSON.stringify(res.bestMatch)).not.toContain(SECRET);
  });

  it('CLOSES THE ALIAS ORACLE — no alias is derived from redacted DOM content', () => {
    registerSecretInput();
    refresh();

    const res = engine.search({ text: `enter ${SECRET}`, fuzzy: true });
    const hit = res.results.find((r) => r.element.id === 'secret-input');

    expect(hit?.confidence ?? 0).toBeLessThan(0.7);
    expect(JSON.stringify(res.results)).not.toContain(SECRET);
  });

  it('does not leak an ancestor aria-label through parentContext (structure survives)', () => {
    // Discovered during the audit: `resolveParentContext` reads the nearest
    // semantic container's `aria-label`, and walking UP from a redacted
    // element that container is usually INSIDE the boundary. parentContext
    // is emitted AND scored (`criteria.within`), so it leaked both ways.
    const boundary = document.createElement('div');
    boundary.setAttribute('data-bridge-redact', 'true');
    const form = document.createElement('form');
    form.setAttribute('aria-label', `vault ${SECRET}`);
    const input = document.createElement('input');
    form.appendChild(input);
    boundary.appendChild(form);
    container.appendChild(boundary);
    registry.registerElement('nested', input, { type: 'input' });
    refresh();

    const res = engine.search({ idPattern: 'nested', fuzzy: true });
    const hit = res.results.find((r) => r.element.id === 'nested');

    expect(hit).toBeDefined();
    // Structure survives, the secret label does not.
    expect(hit!.element.parentContext).toBe('form');
    expect(JSON.stringify(res.results)).not.toContain(SECRET);
  });

  // ---- THE SPLIT: password addressability ----
  // The unconditional password rule governs the VALUE. Extending it to
  // descriptive text made every password input on every page unaddressable
  // AND silently degraded downstream classification: `inferSemanticType`
  // returns `password-input` only when "password" appears in the
  // textContent/ariaLabel/id, so form discovery and login-flow inference
  // stopped recognising login forms.

  function registerPasswordInput(): void {
    const input = document.createElement('input');
    input.type = 'password';
    input.id = 'input-password';
    input.setAttribute('aria-label', 'Password');
    input.setAttribute('placeholder', 'Enter your password');
    input.setAttribute('title', 'Your account password');
    input.value = `hunter2-${SECRET}`;

    const label = document.createElement('label');
    label.setAttribute('for', 'input-password');
    label.textContent = 'Password';

    container.appendChild(label);
    container.appendChild(input);
    registry.registerElement('input-password', input, { type: 'input' });
  }

  it('a password input OUTSIDE a boundary keeps its content fields and aliases', () => {
    registerPasswordInput();
    refresh();

    const res = engine.search({ idPattern: 'input-password', fuzzy: true });
    const hit = res.results.find((r) => r.element.id === 'input-password');

    expect(hit).toBeDefined();
    expect(hit!.element.accessibleName).toBe('Password');
    expect(hit!.element.placeholder).toBe('Enter your password');
    expect(hit!.element.title).toBe('Your account password');
    expect(hit!.element.labelText).toBe('Password');
    expect(hit!.element.aliases.length).toBeGreaterThan(0);
  });

  it('a password input OUTSIDE a boundary still classifies as `password-input`', () => {
    registerPasswordInput();
    refresh();

    const res = engine.search({ idPattern: 'input-password', fuzzy: true });
    const hit = res.results.find((r) => r.element.id === 'input-password');

    expect(hit!.element.semanticType).toBe('password-input');
  });

  it('a password input OUTSIDE a boundary is findable by label', () => {
    registerPasswordInput();
    refresh();

    const res = engine.search({ accessibleName: 'Password', fuzzy: true });
    const hit = res.results.find((r) => r.element.id === 'input-password');

    expect(hit).toBeDefined();
    expect(hit!.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('its cleartext VALUE is STILL closed — emission and oracle both', () => {
    registerPasswordInput();
    refresh();

    // Emission: the raw `.value` read off the live input must not surface.
    const res = engine.search({ idPattern: 'input-password', fuzzy: true });
    expect(JSON.stringify(res.results)).not.toContain(SECRET);

    // Oracle: guessing the exact value must not score a confirmation.
    const probe = engine.search({ textContains: `hunter2-${SECRET}`, fuzzy: true });
    const hit = probe.results.find((r) => r.element.id === 'input-password');
    expect(hit?.confidence ?? 0).toBeLessThan(0.7);
    expect(JSON.stringify(probe.results)).not.toContain(SECRET);
  });

  it('the SAME password input inside a boundary has everything scrubbed', () => {
    const boundary = document.createElement('div');
    boundary.setAttribute('data-bridge-redact', 'true');
    const input = document.createElement('input');
    input.id = 'bounded-password';
    input.type = 'password';
    input.setAttribute('aria-label', `vault ${SECRET}`);
    input.setAttribute('placeholder', `enter ${SECRET}`);
    input.setAttribute('title', `title ${SECRET}`);
    input.value = `hunter2-${SECRET}`;
    boundary.appendChild(input);
    container.appendChild(boundary);
    registry.registerElement('bounded-password', input, { type: 'input' });
    refresh();

    const res = engine.search({ idPattern: 'bounded-password', fuzzy: true });
    const hit = res.results.find((r) => r.element.id === 'bounded-password');

    expect(hit).toBeDefined();
    expect(hit!.element.accessibleName).toBe(REDACTED_VALUE);
    expect(hit!.element.placeholder).toBeUndefined();
    expect(hit!.element.title).toBeUndefined();
    expect(hit!.element.labelText).toBeUndefined();
    expect(hit!.element.aliases).toEqual([]);
    expect(JSON.stringify(res.results)).not.toContain(SECRET);
  });

  // ---- NEGATIVE CONTROLS ----

  it('[negative control] KEEPS an ancestor aria-label on parentContext when nothing is redacted', () => {
    const form = document.createElement('form');
    form.setAttribute('aria-label', 'login form');
    const input = document.createElement('input');
    form.appendChild(input);
    container.appendChild(form);
    registry.registerElement('plain', input, { type: 'input' });
    refresh();

    const res = engine.search({ idPattern: 'plain', fuzzy: true });
    const hit = res.results.find((r) => r.element.id === 'plain');

    expect(hit).toBeDefined();
    expect(hit!.element.parentContext).toBe('form[login form]');
  });

  it('[negative control] does NOT over-redact a non-redacted element — fields surface normally', () => {
    const input = document.createElement('input');
    input.id = 'public-input';
    input.setAttribute('aria-label', 'public save');
    input.setAttribute('placeholder', 'enter your name');
    input.setAttribute('title', 'save the document');

    const label = document.createElement('label');
    label.setAttribute('for', 'public-input');
    label.textContent = 'Full name';

    container.appendChild(label);
    container.appendChild(input);
    registry.registerElement('public-input', input, { type: 'input', label: 'Full name' });
    refresh();

    const res = engine.search({ accessibleName: 'public save', fuzzy: true });
    const hit = res.results.find((r) => r.element.id === 'public-input');

    expect(hit).toBeDefined();
    expect(hit!.element.accessibleName).toBe('public save');
    expect(hit!.element.placeholder).toBe('enter your name');
    expect(hit!.element.title).toBe('save the document');
    expect(hit!.element.labelText).toBe('Full name');
    expect(hit!.element.aliases.length).toBeGreaterThan(0);
    expect(hit!.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it.each([
    ['text', 'public save'],
    ['accessibleName', 'public save'],
    ['placeholder', 'enter your name'],
    ['title', 'save the document'],
  ])('[negative control] non-redacted element still scores >= 0.7 via `%s`', (field, needle) => {
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'public save');
    input.setAttribute('placeholder', 'enter your name');
    input.setAttribute('title', 'save the document');
    container.appendChild(input);
    registry.registerElement('public-input', input, { type: 'input', label: 'public save' });
    refresh();

    const res = engine.search({ [field]: needle, fuzzy: true } as never);
    const hit = res.results.find((r) => r.element.id === 'public-input');

    expect(hit, `expected a hit for ${field}="${needle}"`).toBeDefined();
    expect(hit!.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('still EMITS a developer-SET alias on a redacted element (documented boundary)', () => {
    registerSecretInput();
    const reg = registry.findElement('secret-input')!;
    reg.aliases = ['rotate credentials'];
    refresh();

    // Reached by the structural id. NOTE: this asserts the dev alias is
    // still EMITTED, not that it is FINDABLE by alias alone — in this
    // engine `scoreAliasMatch` is only a bonus, and a zero text score
    // dilutes an exact alias hit below the default threshold. That is
    // pre-existing ranking behaviour, unrelated to redaction.
    const res = engine.search({ idPattern: 'secret-input', fuzzy: true });
    const hit = res.results.find((r) => r.element.id === 'secret-input');

    expect(hit).toBeDefined();
    // Dev-authored metadata survives; DOM-derived aliases do not.
    expect(hit!.element.aliases).toEqual(['rotate credentials']);
    expect(JSON.stringify(res.results)).not.toContain(SECRET);
  });
});
