/**
 * §4.6 redaction — regression tests for the CLIENT-FACING PROJECTIONS.
 *
 * PRE-EXISTING GAP THIS FILE CLOSES:
 * `registry.redaction.test.ts` (the sibling file) exercises ONLY
 * `reg.getState()` and `isBridgeInvisible`. It never touched
 * `serializeRegisteredElement`, `createSnapshot()`, or `searchElements` —
 * the three projections a snapshot/search client actually receives. Those
 * projections re-derive their content STRAIGHT FROM THE RAW DOM
 * (`aria-label` / W3C accname / `innerText` / `title` / `placeholder`)
 * rather than reading the scrubbed `state`, so a `data-bridge-redact`
 * subtree's secret text shipped on every snapshot despite `getState()`
 * being correctly redacted. The fix routes all three read paths through
 * the shared exported predicates (`isValueRedacted` for entered values,
 * `isContentRedacted` for descriptive text); these tests are what keep a
 * fourth projection from being added without them.
 *
 * The search path is tested for BOTH what it emits and what it MATCHES:
 * scrubbing only the output would leave a confirmation oracle — a client
 * could search `{ accessibleName: '<guessed secret>' }` and learn the
 * secret from a high-confidence hit it is not allowed to be shown.
 *
 * DELIBERATE BOUNDARY (not a miss): developer-SET `element.aliases`,
 * `element.description`, and `element.label` are still emitted verbatim on
 * a redacted element. §4.6 protects DOM-DERIVED content; fields the
 * developer deliberately hand-wrote onto the registration are the
 * developer's explicit choice, not scraped page content. A dev who writes
 * a secret into `aliases` still ships it — out of scope by design.
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.6,
 * plans/2026-07-20-ui-bridge-redaction-a11y-projection-leak.md.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry, serializeRegisteredElement, REDACTED_VALUE } from './registry';
// PORTED to Phase 3: the per-site predicates + `scrubIfRedacted(raw, boolean)`
// moved OUT of `registry.ts` into the `core/redaction` choke point and became
// the branded minters `scrubContentByVerdict` / `scrubValueByVerdict`
// (verdict-taking, not bare-boolean — a hand-forged `false` can no longer slip
// an unscrubbed value past). The predicates re-import from `./redaction`.
import {
  isValueRedacted,
  isContentRedacted,
  scrubContentByVerdict,
  scrubValueByVerdict,
  verdictFromState,
} from './redaction';

const SECRET = 'SECRET123';

// Verdict fixtures for the shape tests (the minters take an unforgeable verdict
// token now, not a boolean — obtained here from a stamped state).
const NOT_REDACTED = verdictFromState({});
const CONTENT_REDACTED = verdictFromState({ redaction: { content: true } });
const VALUE_REDACTED = verdictFromState({ redaction: { value: true } });

// ADAPTED from the `scrubIfRedacted (shared scrub shape)` block: same scrub
// CONTRACT, expressed through the two branded minters. The one deliberate
// contract change is the empty-string split — CONTENT collapses `''` to
// `undefined` (the `<img alt="">` case), while VALUE PRESERVES `''` (a field
// cleared to empty is a meaningful state, not absence). No assertion weakened.
describe('scrubContentByVerdict / scrubValueByVerdict (shared branded scrub shape)', () => {
  it('passes everything through untouched when not redacted', () => {
    expect(scrubContentByVerdict('hello', NOT_REDACTED)).toBe('hello');
    expect(scrubContentByVerdict(undefined, NOT_REDACTED)).toBeUndefined();
    expect(scrubValueByVerdict('hello', NOT_REDACTED)).toBe('hello');
  });

  it('collapses a PRESENT field to the sentinel on the matching axis', () => {
    expect(scrubContentByVerdict('hello', CONTENT_REDACTED)).toBe(REDACTED_VALUE);
    expect(scrubValueByVerdict('hunter2', VALUE_REDACTED)).toBe(REDACTED_VALUE);
  });

  it('CONTENT treats an EMPTY STRING as absent — never fabricates a sentinel', () => {
    // The a11y helpers are not uniform: some return `''` for "no label"
    // rather than `undefined`. A naive `!== undefined` check would stamp
    // `[REDACTED]` onto every unlabelled element in a redacted subtree.
    expect(scrubContentByVerdict('', CONTENT_REDACTED)).toBeUndefined();
    expect(scrubContentByVerdict('', NOT_REDACTED)).toBeUndefined();
    expect(scrubContentByVerdict(undefined, CONTENT_REDACTED)).toBeUndefined();
  });

  it('VALUE preserves an empty string (a cleared field), never fabricates a sentinel for it', () => {
    expect(scrubValueByVerdict('', VALUE_REDACTED)).toBe('');
    expect(scrubValueByVerdict('', NOT_REDACTED)).toBe('');
    expect(scrubValueByVerdict(undefined, VALUE_REDACTED)).toBeUndefined();
  });
});

describe('isValueRedacted / isContentRedacted (the split §4.6 predicates)', () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => document.body.removeChild(container));

  it('BOTH are true on the boundary element itself and on any descendant', () => {
    const boundary = document.createElement('div');
    boundary.setAttribute('data-bridge-redact', 'true');
    const inner = document.createElement('button');
    boundary.appendChild(inner);
    container.appendChild(boundary);
    expect(isValueRedacted(boundary)).toBe(true);
    expect(isValueRedacted(inner)).toBe(true);
    expect(isContentRedacted(boundary)).toBe(true);
    expect(isContentRedacted(inner)).toBe(true);
  });

  it('THE SPLIT: a bare <input type="password"> redacts its VALUE but NOT its CONTENT', () => {
    // This is the whole point of the split. A password field's accessible
    // name is "Password" — not a secret. The secret is its VALUE. Making
    // the unconditional password rule govern labels too cost every password
    // input on every page its addressability (`find({label:'Password'})`,
    // its placeholder, its semantic id slug, and the "password" substring
    // that downstream `semanticType` classification keys on).
    const input = document.createElement('input');
    input.type = 'password';
    container.appendChild(input);
    expect(isValueRedacted(input)).toBe(true);
    expect(isContentRedacted(input)).toBe(false);
  });

  it('a password input INSIDE a boundary redacts BOTH', () => {
    const boundary = document.createElement('div');
    boundary.setAttribute('data-bridge-redact', 'true');
    const input = document.createElement('input');
    input.type = 'password';
    boundary.appendChild(input);
    container.appendChild(boundary);
    expect(isValueRedacted(input)).toBe(true);
    expect(isContentRedacted(input)).toBe(true);
  });

  it('both are false outside any boundary, and for non-literal-"true" attribute values', () => {
    const plain = document.createElement('div');
    container.appendChild(plain);
    expect(isValueRedacted(plain)).toBe(false);
    expect(isContentRedacted(plain)).toBe(false);

    for (const v of ['false', '', 'yes', '1']) {
      const el = document.createElement('div');
      el.setAttribute('data-bridge-redact', v);
      container.appendChild(el);
      expect(isValueRedacted(el), `attr="${v}" must NOT redact`).toBe(false);
      expect(isContentRedacted(el), `attr="${v}" must NOT redact`).toBe(false);
    }
  });

  it('neither throws on a null/undefined element (the `while (cursor)` fix)', () => {
    // `closestRedactionBoundary` looped `while (cursor !== null)`, so an
    // `undefined` element walked into `undefined.getAttribute` and threw.
    // Call sites guarded inconsistently — two in this very file were
    // unguarded, two lines below one that optional-chains the same access.
    // Fixing the loop covers every site at once.
    expect(() => isValueRedacted(undefined)).not.toThrow();
    expect(() => isValueRedacted(null)).not.toThrow();
    expect(() => isContentRedacted(undefined)).not.toThrow();
    expect(() => isContentRedacted(null)).not.toThrow();
    expect(isValueRedacted(undefined)).toBe(false);
    expect(isContentRedacted(null)).toBe(false);
  });
});

describe('serializeRegisteredElement — a11y projection honors §4.6', () => {
  let registry: UIBridgeRegistry;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => document.body.removeChild(container));

  /** A labelled, titled, text-bearing button inside a redact boundary. */
  function buildSecretButton(id: string): HTMLButtonElement {
    const boundary = document.createElement('div');
    boundary.setAttribute('data-bridge-redact', 'true');
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', `token: ${SECRET}`);
    btn.setAttribute('title', SECRET);
    btn.textContent = `copy ${SECRET}`;
    boundary.appendChild(btn);
    container.appendChild(boundary);
    registry.registerElement(id, btn, { type: 'button' });
    return btn;
  }

  it('collapses ariaLabel / accessibleName / text to the sentinel', () => {
    buildSecretButton('secret-btn');
    const el = registry.findElement('secret-btn')!;
    const serialized = serializeRegisteredElement(el);

    expect(serialized.ariaLabel).toBe(REDACTED_VALUE);
    expect(serialized.accessibleName).toBe(REDACTED_VALUE);
    expect(serialized.text).toBe(REDACTED_VALUE);
    expect(JSON.stringify(serialized)).not.toContain(SECRET);
  });

  it('leaks nothing through the createSnapshot() wire path either', () => {
    buildSecretButton('secret-btn');
    const snapshot = registry.createSnapshot();
    const entry = snapshot.elements.find((e) => e.id === 'secret-btn');

    expect(entry).toBeDefined();
    expect(entry?.ariaLabel).toBe(REDACTED_VALUE);
    expect(entry?.accessibleName).toBe(REDACTED_VALUE);
    expect(entry?.text).toBe(REDACTED_VALUE);
    expect(JSON.stringify(snapshot)).not.toContain(SECRET);
  });

  it('KEEPS the a11y fields of a bare <input type="password"> — addressability', () => {
    // THE SPLIT (correct-by-design change). The unconditional password rule
    // governs the VALUE, not the label: a password field's accessible name
    // is "Password", which is not a secret. Collapsing it cost every
    // password input on every page its addressability. A developer who
    // considers a particular label sensitive declares the boundary, which
    // is covered by the test below.
    const input = document.createElement('input');
    input.type = 'password';
    input.setAttribute('aria-label', 'Password');
    container.appendChild(input);
    registry.registerElement('pw', input, { type: 'input' });

    const serialized = serializeRegisteredElement(registry.findElement('pw')!);
    expect(serialized.ariaLabel).toBe('Password');
    expect(serialized.accessibleName).toBe('Password');
  });

  it('redacts a password input a11y fields ONCE INSIDE a boundary', () => {
    const boundary = document.createElement('div');
    boundary.setAttribute('data-bridge-redact', 'true');
    const input = document.createElement('input');
    input.type = 'password';
    input.setAttribute('aria-label', `vault ${SECRET}`);
    boundary.appendChild(input);
    container.appendChild(boundary);
    registry.registerElement('pw', input, { type: 'input' });

    const serialized = serializeRegisteredElement(registry.findElement('pw')!);
    expect(serialized.ariaLabel).toBe(REDACTED_VALUE);
    expect(serialized.accessibleName).toBe(REDACTED_VALUE);
    expect(JSON.stringify(serialized)).not.toContain(SECRET);
  });

  it('a bare password input still redacts its VALUE in getState()', () => {
    // The other half of the split — the leak this whole workstream closed
    // must remain closed while the label survives.
    const input = document.createElement('input');
    input.type = 'password';
    input.setAttribute('aria-label', 'Password');
    input.value = `hunter2-${SECRET}`;
    container.appendChild(input);
    const reg = registry.registerElement('pw', input, { type: 'input' });

    const state = reg.getState();
    expect(state.value).toBe(REDACTED_VALUE);
    expect(JSON.stringify(state)).not.toContain(SECRET);
    // Content is NOT flagged — the element is not inside a boundary.
    expect(state.redaction?.content).toBeUndefined();
    expect(state.accessibleName).toBe('Password');
  });

  it('[negative control] is PRESENCE-PRESERVING — an absent field stays undefined, never a fabricated sentinel', () => {
    // No aria-label, no text: redaction must not invent a "[REDACTED]"
    // label on an element that never had one.
    const boundary = document.createElement('div');
    boundary.setAttribute('data-bridge-redact', 'true');
    const bare = document.createElement('div');
    boundary.appendChild(bare);
    container.appendChild(boundary);
    registry.registerElement('bare', bare, { type: 'generic' });

    const serialized = serializeRegisteredElement(registry.findElement('bare')!);
    expect(serialized.ariaLabel).toBeUndefined();
    expect(serialized.accessibleName).toBeUndefined();
    expect(serialized.text).toBeUndefined();
  });

  it('[negative control] does NOT redact structural fields (role survives)', () => {
    const boundary = document.createElement('div');
    boundary.setAttribute('data-bridge-redact', 'true');
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', SECRET);
    boundary.appendChild(btn);
    container.appendChild(boundary);
    registry.registerElement('rolecheck', btn, { type: 'button' });

    const serialized = serializeRegisteredElement(registry.findElement('rolecheck')!);
    expect(serialized.role).toBe('button');
    expect(serialized.id).toBe('rolecheck');
    expect(serialized.tagName).toBe('button');
  });

  // ---- NEGATIVE CONTROL ----
  it('[negative control] does NOT over-redact a non-redacted sibling — its name/text surface normally', () => {
    const boundary = document.createElement('div');
    boundary.setAttribute('data-bridge-redact', 'true');
    const secret = document.createElement('button');
    secret.setAttribute('aria-label', `token: ${SECRET}`);
    secret.textContent = SECRET;
    boundary.appendChild(secret);

    const publicBtn = document.createElement('button');
    publicBtn.setAttribute('aria-label', 'public');
    publicBtn.textContent = 'public button';

    container.appendChild(boundary);
    container.appendChild(publicBtn);
    registry.registerElement('secret', secret, { type: 'button' });
    registry.registerElement('public', publicBtn, { type: 'button' });

    const pub = serializeRegisteredElement(registry.findElement('public')!);
    expect(pub.ariaLabel).toBe('public');
    expect(pub.accessibleName).toBe('public');
    expect(pub.text).toBe('public button');
  });
});

describe('searchElements — AI-discovery projection honors §4.6', () => {
  let registry: UIBridgeRegistry;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => document.body.removeChild(container));

  /**
   * Registers a redacted, secret-bearing button under a NON-secret dev-set
   * label so a search can reach it without querying the secret itself.
   */
  function registerSecretButton(): void {
    const boundary = document.createElement('div');
    boundary.setAttribute('data-bridge-redact', 'true');
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', `token: ${SECRET}`);
    btn.setAttribute('title', SECRET);
    btn.setAttribute('placeholder', SECRET);
    btn.textContent = `copy ${SECRET}`;
    boundary.appendChild(btn);
    container.appendChild(boundary);
    registry.registerElement('secret-btn', btn, { type: 'button', label: 'vault control' });
  }

  it('emits no raw DOM content on a redacted hit (accessibleName / aliases / description)', () => {
    registerSecretButton();
    // Reached by ROLE (a non-content signal), not by the secret NOR by the
    // dev-set label — inside a boundary the label is scrubbed too (resolved
    // design), so the matching oracle is closed on both.
    const results = registry.searchElements({ role: 'button', fuzzy: true });
    const hit = results.find((r) => r.element.id === 'secret-btn');

    expect(hit).toBeDefined();
    expect(hit!.element.accessibleName).toBe(REDACTED_VALUE);
    expect(hit!.element.aliases).toEqual([]);
    expect(hit!.element.description).not.toContain(SECRET);
    expect(hit!.element.state.textContent).toBe(REDACTED_VALUE);
    expect(JSON.stringify(hit)).not.toContain(SECRET);
    expect(JSON.stringify(results)).not.toContain(SECRET);
  });

  it('CLOSES THE MATCHING ORACLE — searching the secret accessible name does not confirm it', () => {
    registerSecretButton();
    const results = registry.searchElements({
      accessibleName: `token: ${SECRET}`,
      fuzzy: true,
    });
    const hit = results.find((r) => r.element.id === 'secret-btn');

    // Either no hit at all, or (if some other signal matched) no
    // accessibility-scored confirmation of the secret name.
    expect(hit?.scores.accessibility ?? 0).toBeLessThan(0.7);
    expect(JSON.stringify(results)).not.toContain(SECRET);
  });

  it('CLOSES THE ALIAS ORACLE — the secret title/placeholder cannot be matched either', () => {
    registerSecretButton();
    const results = registry.searchElements({ text: SECRET, fuzzy: true });
    const hit = results.find((r) => r.element.id === 'secret-btn');

    expect(hit?.scores.fuzzy ?? 0).toBeLessThan(0.7);
    expect(JSON.stringify(results)).not.toContain(SECRET);
  });

  // ---- NEGATIVE CONTROLS ----
  it('[negative control] does NOT over-redact a non-redacted element in search output', () => {
    const publicBtn = document.createElement('button');
    publicBtn.setAttribute('aria-label', 'public save');
    publicBtn.textContent = 'Save';
    container.appendChild(publicBtn);
    registry.registerElement('public-btn', publicBtn, { type: 'button', label: 'Save' });

    const results = registry.searchElements({ accessibleName: 'public save', fuzzy: true });
    const hit = results.find((r) => r.element.id === 'public-btn');

    expect(hit).toBeDefined();
    expect(hit!.element.accessibleName).toBe('public save');
    expect(hit!.scores.accessibility).toBeGreaterThanOrEqual(0.7);
    expect(hit!.element.aliases.length).toBeGreaterThan(0);
  });

  it('SCRUBS a DEVELOPER-SET label INSIDE a boundary (resolved design: origin cannot be discriminated)', () => {
    // Supersedes the earlier "dev-label survives a boundary" reading. The
    // resolved design decision (plan §"Phase 3 two-lens verification"): one
    // `label` field carries either a scraped or a dev-set value with NO
    // discriminator, and a developer who WRAPS a subtree in
    // `data-bridge-redact` intends it hidden — so `label` scrubs on the CONTENT
    // axis regardless of origin. Searching the dev label must NOT confirm the
    // element (matching-oracle closed) and its `label`/`accessibleName` must
    // not carry the value.
    const boundary = document.createElement('div');
    boundary.setAttribute('data-bridge-redact', 'true');
    const btn = document.createElement('button');
    btn.textContent = SECRET; // DOM-derived content — must NOT survive
    boundary.appendChild(btn);
    container.appendChild(boundary);
    registry.registerElement('dev-label', btn, { type: 'button', label: 'vault control' });

    const results = registry.searchElements({ text: 'vault control', fuzzy: true });
    const hit = results.find((r) => r.element.id === 'dev-label');

    // Oracle closed: the dev label no longer confirms a redacted element.
    expect(hit?.scores.text ?? 0).toBeLessThan(0.7);
    // If some other signal surfaced it, the label/accessibleName are scrubbed.
    if (hit) {
      expect(hit.element.label ?? REDACTED_VALUE).not.toBe('vault control');
      expect(hit.element.accessibleName ?? REDACTED_VALUE).not.toBe('vault control');
    }
    expect(JSON.stringify(results)).not.toContain(SECRET);
    expect(JSON.stringify(results)).not.toContain('vault control');
  });

  it('still scrubs accessibleName when the name IS DOM-derived, even with a dev label present', () => {
    const boundary = document.createElement('div');
    boundary.setAttribute('data-bridge-redact', 'true');
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', `token: ${SECRET}`);
    boundary.appendChild(btn);
    container.appendChild(boundary);
    registry.registerElement('dom-name', btn, { type: 'button', label: 'vault control' });

    // Match by role (a non-content signal) so the element is surfaced without
    // relying on the now-scrubbed label — then assert accessibleName is the
    // sentinel and the DOM secret never ships.
    const results = registry.searchElements({ role: 'button', fuzzy: true });
    const hit = results.find((r) => r.element.id === 'dom-name');

    expect(hit).toBeDefined();
    expect(hit!.element.accessibleName).toBe(REDACTED_VALUE);
    expect(JSON.stringify(results)).not.toContain(SECRET);
  });

  it('[negative control] lets a DEVELOPER-SET label through as accessibleName OUTSIDE any boundary', () => {
    // The other half of the resolved decision: dev-set metadata SURVIVES
    // outside a `data-bridge-redact` boundary — the addressability guarantee.
    const btn = document.createElement('button');
    btn.textContent = 'Open'; // short DOM text, no aria-label
    container.appendChild(btn);
    registry.registerElement('dev-label-public', btn, { type: 'button', label: 'vault control' });

    const results = registry.searchElements({ text: 'vault control', fuzzy: true });
    const hit = results.find((r) => r.element.id === 'dev-label-public');

    expect(hit).toBeDefined();
    expect(hit!.element.accessibleName).toBe('vault control');
    expect(hit!.element.label).toBe('vault control');
  });

  it('still honors a DEVELOPER-SET alias on a redacted element (documented boundary)', () => {
    const boundary = document.createElement('div');
    boundary.setAttribute('data-bridge-redact', 'true');
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', `token: ${SECRET}`);
    boundary.appendChild(btn);
    container.appendChild(boundary);
    const reg = registry.registerElement('dev-alias', btn, { type: 'button', label: 'vault' });
    reg.aliases = ['rotate credentials'];

    const results = registry.searchElements({ text: 'rotate credentials', fuzzy: true });
    const hit = results.find((r) => r.element.id === 'dev-alias');

    expect(hit).toBeDefined();
    expect(hit!.element.aliases).toEqual(['rotate credentials']);
    // Dev-set metadata survives; DOM-derived secret still does not.
    expect(JSON.stringify(results)).not.toContain(SECRET);
  });
});
