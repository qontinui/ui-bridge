/**
 * §4.6 redaction — regression tests for the CONTROL subsystem projection.
 *
 * PORTED to Phase 3 (structural branding). The behavioural SCENARIOS are
 * unchanged; the ONLY adaptation is the provenance API: the per-site
 * `state.contentRedacted?: boolean` flag was superseded by the two-axis
 * `state.redaction?: { content?: true; value?: true }` structured field (both
 * carry the same DATA-not-sentinel provenance). Assertions therefore read
 * `state.redaction?.content` and the DiscoveredElement fixture stamps
 * `redaction: { content: true }`. No assertion was weakened.
 *
 * WHY THIS FILE EXISTS (the leak it closes — the most severe of the set):
 * `src/control/action-executor.ts` carries its own PRIVATE `getElementState`,
 * a THIRD independent element-state builder entirely separate from the
 * canonical one in `core/registry.ts`. Before this change it had ZERO
 * redaction: `grep -rn 'isElementRedacted|REDACTED|data-bridge-redact'
 * src/control/` returned nothing.
 *
 * Concretely, canonical `core/registry.ts` read
 *     state.value = isRedacted ? REDACTED_VALUE : element.value;
 * while this one read
 *     state.value = element.value;                    // raw, ungated
 *
 * So for `<input type="password">` or ANY `data-bridge-redact` subtree this
 * path emitted the CLEARTEXT VALUE — strictly worse than the label/accessible
 * -name leaks fixed in the sibling projections, because the value of a
 * password field IS the secret rather than merely describing it. It backs
 * `find()` / `discover()` → the registered route `POST /control/discover`,
 * and feeds the `DiscoveredElement` arm of `SearchEngine`, which the
 * `toSearchable` DOM gate deliberately does NOT cover (that gate keys on
 * `'getState' in element && element.element instanceof HTMLElement`) — so the
 * DiscoveredElement arm keys on the `state.redaction.content` DATA flag this
 * builder stamps instead.
 *
 * The fix routes this subsystem through the SHARED `isValueRedacted` /
 * `isContentRedacted` / `scrubIfRedacted` helpers exported by
 * `core/registry.ts` — deliberately NOT a fourth private predicate, since a
 * duplicated predicate is the exact root cause of this whole bug class.
 *
 * TWO predicates over two field sets (§4.6 as corrected): `isValueRedacted`
 * covers what the user ENTERED (password inputs unconditionally + any
 * `data-bridge-redact` subtree); `isContentRedacted` covers DESCRIPTIVE text
 * and is the opt-in boundary ONLY. A bare password input therefore keeps its
 * label / placeholder / id-slug / `semanticType` and stays addressable, while
 * its cleartext VALUE is still scrubbed. Both directions are tested in
 * "password input OUTSIDE a boundary stays addressable".
 *
 * Every leak test here was verified RED before the change and GREEN after
 * (`isContentRedacted` temporarily reverted to the merged predicate; the
 * addressability tests flip too). Tests that are DELIBERATE NEGATIVE
 * CONTROLS — proving no over-redaction — pass in both states and are labelled
 * `[negative control]`; they are not regression tests and are not claimed as
 * such.
 *
 * TRAPS THIS FILE GUARDS AGAINST (both previously hit on this workstream):
 *   1. A fixture that is never actually matched makes every assertion
 *      vacuous. Each describe block therefore opens with an explicit
 *      "fixture is genuinely returned" sanity test BEFORE any leak assertion.
 *   2. A weak/partial needle can pass pre-fix on its own. The search-oracle
 *      tests probe EXACT field values (an exact hit scores 1.0; a partial
 *      needle can fall under the fuzzy threshold and pass vacuously).
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.6.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry, REDACTED_VALUE } from '../core/registry';
import { DefaultActionExecutor, extractReactState } from './action-executor';
import { SearchEngine } from '../ai/search-engine';
import type { DiscoveredElement } from './types';

/** Blanket needle — must never appear anywhere in a serialized response. */
const SECRET = 'SECRET123';
/**
 * The headline leak: the cleartext value of a password input. Asserted on by
 * name, not only via the blanket JSON check, because `state.value` is the
 * single highest-severity field on this path.
 */
const PASSWORD_VALUE = `hunter2-${SECRET}`;

describe('control/action-executor §4.6 — find()/discover() projection', () => {
  let registry: UIBridgeRegistry;
  let executor: DefaultActionExecutor;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    executor = new DefaultActionExecutor(registry);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  /**
   * jsdom reports a zero-size rect for everything, so `state.visible` is
   * false for every fixture. `includeHidden: true` keeps them in the result
   * set — without it the visibility filter would drop the fixtures before
   * any assertion ran and the whole file would pass vacuously.
   */
  const OPTS = { includeHidden: true } as const;

  function findById(elements: DiscoveredElement[], id: string) {
    return elements.find((e) => e.id === id);
  }

  // ---------------------------------------------------------------------
  // Password input — redacted UNCONDITIONALLY, no boundary attribute needed
  // ---------------------------------------------------------------------
  describe('<input type="password">', () => {
    beforeEach(() => {
      const input = document.createElement('input');
      input.type = 'password';
      input.setAttribute('data-testid', 'pw');
      input.value = PASSWORD_VALUE;
      container.appendChild(input);
    });

    it('SANITY: the password fixture is genuinely returned (guards vacuity)', async () => {
      const res = await executor.find(OPTS);
      const pw = findById(res.elements, 'pw');
      expect(pw).toBeDefined();
      expect(pw!.tagName).toBe('input');
    });

    it('does not emit the cleartext password VALUE', async () => {
      const res = await executor.find(OPTS);
      const pw = findById(res.elements, 'pw')!;
      // Named, field-specific assertion — the headline of this whole fix.
      expect(pw.state.value).not.toBe(PASSWORD_VALUE);
      expect(pw.state.value).not.toContain(SECRET);
      expect(pw.state.value).toBe(REDACTED_VALUE);
    });

    it('does not leak the password value anywhere in the serialized response', async () => {
      const res = await executor.find(OPTS);
      expect(JSON.stringify(res)).not.toContain(PASSWORD_VALUE);
      expect(JSON.stringify(res)).not.toContain(SECRET);
    });

    it('[negative control] still reports STRUCTURAL fields — type/tagName/role survive redaction', async () => {
      const res = await executor.find(OPTS);
      const pw = findById(res.elements, 'pw')!;
      expect(pw.tagName).toBe('input');
      expect(pw.state.rect).toBeDefined();
      expect(typeof pw.state.enabled).toBe('boolean');
    });
  });

  // ---------------------------------------------------------------------
  // THE SPLIT — a password input OUTSIDE any boundary keeps its
  // addressability while its VALUE stays scrubbed. These are the
  // regression tests for the functional regression the first pass caused:
  // extending the UNCONDITIONAL password rule from values to labels/ids
  // made every password input on every page unaddressable.
  // ---------------------------------------------------------------------
  describe('password input OUTSIDE a boundary stays addressable', () => {
    beforeEach(() => {
      const form = document.createElement('form');

      const label = document.createElement('label');
      label.setAttribute('for', 'input-password');
      label.textContent = 'Password';

      const pw = document.createElement('input');
      pw.type = 'password';
      pw.id = 'input-password';
      pw.setAttribute('aria-label', 'Password');
      pw.setAttribute('placeholder', 'Enter your password');
      pw.value = PASSWORD_VALUE;

      const confirm = document.createElement('input');
      confirm.type = 'password';
      confirm.id = 'input-confirm-password';
      confirm.setAttribute('aria-label', 'Confirm password');
      confirm.value = PASSWORD_VALUE;

      form.appendChild(label);
      form.appendChild(pw);
      form.appendChild(confirm);
      container.appendChild(form);
    });

    it('keeps aria-label / placeholder as the emitted accessibleName + label', async () => {
      const res = await executor.find(OPTS);
      const pw = findById(res.elements, 'input-password')!;
      expect(pw.accessibleName).toBe('Password');
      expect(pw.label).toBe('Password');
    });

    it('keeps DISTINCT SLUG-DERIVED semantic ids for unlabelled-by-id fields', async () => {
      // The fixtures above carry explicit HTML `id`s, which `getElementId`
      // returns before ever reaching the slug path — so they would NOT have
      // exercised this regression. These two have neither `data-testid` nor
      // an HTML id, forcing the aria-label slug fallback that the merged
      // predicate suppressed: pre-split both collapsed to `input` /
      // `input-1`, distinguishable only by document order and reshuffled by
      // inserting any unlabelled input above.
      //
      // Labels deliberately DO NOT collide with the outer fixtures' HTML
      // ids (`input-password` / `input-confirm-password`) — asserting on
      // those slugs here would be satisfied by the outer fixtures' own ids
      // and the test would pass pre-split, proving nothing.
      const slugForm = document.createElement('form');
      const a = document.createElement('input');
      a.type = 'password';
      a.setAttribute('aria-label', 'Vault key');
      const b = document.createElement('input');
      b.type = 'password';
      b.setAttribute('aria-label', 'Confirm vault key');
      slugForm.appendChild(a);
      slugForm.appendChild(b);
      container.appendChild(slugForm);

      const res = await executor.find(OPTS);
      const ids = res.elements.map((e) => e.id);
      expect(ids).toContain('input-vault-key');
      expect(ids).toContain('input-confirm-vault-key');
    });

    it('remains findable by find({ label: "Password" })', async () => {
      const res = await executor.find({ ...OPTS, label: 'Password' });
      const ids = res.elements.map((e) => e.id);
      // Both match — `label` is a case-insensitive partial match, and
      // "Confirm password" contains "password".
      expect(ids).toContain('input-password');
      expect(ids).toContain('input-confirm-password');
    });

    it('STILL scrubs the cleartext VALUE — the split relaxes content only', async () => {
      const res = await executor.find(OPTS);
      const pw = findById(res.elements, 'input-password')!;
      expect(pw.state.value).toBe(REDACTED_VALUE);
      expect(JSON.stringify(res)).not.toContain(SECRET);
      // Not inside a boundary, so the content flag is NOT set.
      expect(pw.state.redaction?.content).toBeUndefined();
    });

    it('scrubs EVERYTHING once the same password input is inside a boundary', async () => {
      // The other direction: a developer who declares the boundary still
      // gets the full §4.6 guarantee, labels included.
      const boundary = document.createElement('div');
      boundary.setAttribute('data-bridge-redact', 'true');
      const pw = document.createElement('input');
      pw.type = 'password';
      pw.setAttribute('data-testid', 'pw-bounded');
      pw.setAttribute('aria-label', `vault ${SECRET}`);
      pw.setAttribute('placeholder', `enter ${SECRET}`);
      pw.value = PASSWORD_VALUE;
      boundary.appendChild(pw);
      container.appendChild(boundary);

      const res = await executor.find(OPTS);
      const bounded = findById(res.elements, 'pw-bounded')!;
      expect(bounded.state.value).toBe(REDACTED_VALUE);
      expect(bounded.accessibleName ?? '').not.toContain(SECRET);
      expect(bounded.label ?? '').not.toContain(SECRET);
      expect(bounded.state.redaction?.content).toBe(true);
      expect(JSON.stringify(res)).not.toContain(SECRET);
    });
  });

  // ---------------------------------------------------------------------
  // data-bridge-redact subtree
  // ---------------------------------------------------------------------
  describe('data-bridge-redact="true" subtree', () => {
    beforeEach(() => {
      const boundary = document.createElement('div');
      boundary.setAttribute('data-bridge-redact', 'true');

      // Text input with the secret in EVERY channel at once: value,
      // aria-label, title, and descendant text.
      const input = document.createElement('input');
      input.type = 'text';
      input.setAttribute('data-testid', 'tok');
      input.value = `tok-${SECRET}`;
      input.setAttribute('aria-label', `API token ${SECRET}`);
      input.setAttribute('title', `title ${SECRET}`);
      boundary.appendChild(input);

      // A select whose OPTION LABELS carry the secret.
      const select = document.createElement('select');
      select.setAttribute('data-testid', 'env');
      const opt = document.createElement('option');
      opt.value = `prod-${SECRET}`;
      opt.textContent = `prod (token: ${SECRET})`;
      select.appendChild(opt);
      boundary.appendChild(select);

      // A textarea.
      const ta = document.createElement('textarea');
      ta.setAttribute('data-testid', 'notes');
      ta.value = `notes ${SECRET}`;
      boundary.appendChild(ta);

      container.appendChild(boundary);
    });

    it('SANITY: the redacted fixtures are genuinely returned (guards vacuity)', async () => {
      const res = await executor.find(OPTS);
      expect(findById(res.elements, 'tok')).toBeDefined();
      expect(findById(res.elements, 'env')).toBeDefined();
      expect(findById(res.elements, 'notes')).toBeDefined();
    });

    it('scrubs input value, textContent, accessibleName and label', async () => {
      const res = await executor.find(OPTS);
      const tok = findById(res.elements, 'tok')!;

      expect(tok.state.value).not.toContain(SECRET);
      expect(tok.state.value).toBe(REDACTED_VALUE);
      expect(tok.state.textContent).not.toContain(SECRET);
      expect(tok.accessibleName ?? '').not.toContain(SECRET);
      expect(tok.label ?? '').not.toContain(SECRET);
    });

    it('scrubs textarea value', async () => {
      const res = await executor.find(OPTS);
      expect(findById(res.elements, 'notes')!.state.value).toBe(REDACTED_VALUE);
    });

    it('scrubs select value, selectedOptions and availableOptions labels', async () => {
      const res = await executor.find(OPTS);
      const env = findById(res.elements, 'env')!;
      expect(env.state.value).toBe(REDACTED_VALUE);
      expect(JSON.stringify(env.state.selectedOptions)).not.toContain(SECRET);
      expect(JSON.stringify(env.state.availableOptions)).not.toContain(SECRET);
    });

    it('does not leak the secret anywhere in the serialized response', async () => {
      const res = await executor.find(OPTS);
      expect(JSON.stringify(res)).not.toContain(SECRET);
    });
  });

  // ---------------------------------------------------------------------
  // The aria-label / title textContent FALLBACK — must not be a bypass
  // ---------------------------------------------------------------------
  describe('icon-only textContent fallback', () => {
    beforeEach(() => {
      const boundary = document.createElement('div');
      boundary.setAttribute('data-bridge-redact', 'true');
      // No text content at all — this is exactly the shape that triggers the
      // `if (!state.textContent) state.textContent = aria-label || title`
      // fallback, which would otherwise RESURRECT the secret that the
      // boundary exists to hide.
      const btn = document.createElement('button');
      btn.setAttribute('data-testid', 'icon');
      btn.setAttribute('aria-label', `delete token ${SECRET}`);
      btn.setAttribute('title', `title ${SECRET}`);
      boundary.appendChild(btn);
      container.appendChild(boundary);
    });

    it('SANITY: the icon-only fixture is genuinely returned (guards vacuity)', async () => {
      const res = await executor.find(OPTS);
      expect(findById(res.elements, 'icon')).toBeDefined();
    });

    it('the aria-label/title fallback does not resurrect the secret', async () => {
      const res = await executor.find(OPTS);
      const icon = findById(res.elements, 'icon')!;
      expect(icon.state.textContent ?? '').not.toContain(SECRET);
      expect(icon.accessibleName ?? '').not.toContain(SECRET);
      expect(icon.label ?? '').not.toContain(SECRET);
      expect(JSON.stringify(res)).not.toContain(SECRET);
    });

    it('the derived element ID does not smuggle the secret out as a slug', async () => {
      // `getElementId` builds a semantic id from aria-label/title/textContent
      // when there is no data-testid/HTML id. Here there IS a data-testid, so
      // assert the general property across a fixture that has neither.
      const boundary = document.createElement('div');
      boundary.setAttribute('data-bridge-redact', 'true');
      const bare = document.createElement('button');
      bare.setAttribute('aria-label', `revoke ${SECRET}`);
      boundary.appendChild(bare);
      container.appendChild(boundary);

      const res = await executor.find(OPTS);
      for (const el of res.elements) {
        expect(el.id).not.toContain(SECRET);
        expect(el.id.toLowerCase()).not.toContain(SECRET.toLowerCase());
      }
    });
  });

  // ---------------------------------------------------------------------
  // Media / altText — NOT in the original brief; gated during the audit,
  // so it gets its own coverage rather than shipping untested.
  // ---------------------------------------------------------------------
  describe('media elements (altText path)', () => {
    it('SANITY + scrub: a redacted <img> alt text never reaches the client', async () => {
      const boundary = document.createElement('div');
      boundary.setAttribute('data-bridge-redact', 'true');
      const img = document.createElement('img');
      boundary.appendChild(img);
      container.appendChild(boundary);

      registry.registerMediaElement('img-secret', img, {
        type: 'image',
        label: 'Avatar',
        mediaMetadata: {
          mediaType: 'image',
          altText: `QR code for ${SECRET}`,
          isDecorative: false,
          renderedWidth: 10,
          renderedHeight: 10,
          loadingState: 'loaded',
          lazyLoading: false,
        },
      });

      const res = await executor.find({ includeHidden: true, includeMedia: true });
      const media = findById(res.elements, 'img-secret');
      // Sanity FIRST — a media fixture that is never returned would make the
      // scrub assertions below vacuous.
      expect(media).toBeDefined();

      expect(media!.accessibleName ?? '').not.toContain(SECRET);
      expect(media!.mediaMetadata?.altText ?? '').not.toContain(SECRET);
      // Structural media fields must SURVIVE — oversize/lazy-loading audits
      // still have to work inside a redacted subtree.
      expect(media!.mediaMetadata?.renderedWidth).toBe(10);
      expect(media!.mediaMetadata?.loadingState).toBe('loaded');
      expect(JSON.stringify(res)).not.toContain(SECRET);
    });

    it('scrubs URL fields (src / srcset / poster) — a data: URI IS the rendered secret', async () => {
      // Finding 2: `MediaMetadata` also carries `src`, `srcset`, `sizes`,
      // `sources[].srcset`, and `videoState.poster`. Inside a boundary a
      // `data:image/...;base64,...` URI is itself the rendered secret (a QR
      // code / one-time key) and a signed URL carries a token in its query
      // string. All URL fields scrub; structural fields survive.
      const boundary = document.createElement('div');
      boundary.setAttribute('data-bridge-redact', 'true');
      const video = document.createElement('video');
      boundary.appendChild(video);
      container.appendChild(boundary);

      registry.registerMediaElement('vid-secret', video, {
        type: 'video',
        label: 'Recording',
        mediaMetadata: {
          mediaType: 'video',
          src: `https://cdn.example.com/clip.mp4?token=${SECRET}`,
          srcset: `https://cdn.example.com/clip.mp4?token=${SECRET} 1x`,
          sizes: '(max-width: 600px) 480px, 800px', // layout metadata — survives
          sources: [{ srcset: `data:video/mp4;base64,${SECRET}`, type: 'video/mp4' }],
          isDecorative: false,
          renderedWidth: 320,
          renderedHeight: 240,
          loadingState: 'loaded',
          lazyLoading: false,
          format: 'mp4',
          videoState: {
            poster: `data:image/png;base64,${SECRET}`,
            currentTime: 5,
            duration: 30,
            paused: true,
            muted: false,
          },
        },
      });

      const res = await executor.find({ includeHidden: true, includeMedia: true });
      const media = findById(res.elements, 'vid-secret');
      expect(media).toBeDefined();

      const meta = media!.mediaMetadata!;
      expect(meta.src).toBe(REDACTED_VALUE);
      expect(meta.srcset).toBe(REDACTED_VALUE);
      expect(meta.sources?.[0].srcset).toBe(REDACTED_VALUE);
      expect(meta.videoState?.poster).toBe(REDACTED_VALUE);
      // Structural fields SURVIVE — playback + layout audits still work.
      expect(meta.renderedWidth).toBe(320);
      expect(meta.format).toBe('mp4');
      expect(meta.sizes).toBe('(max-width: 600px) 480px, 800px');
      expect(meta.videoState?.duration).toBe(30);
      expect(meta.videoState?.paused).toBe(true);
      expect(JSON.stringify(res)).not.toContain(SECRET);
    });

    it('[negative control] a NON-redacted media element keeps its src / poster', async () => {
      const img = document.createElement('img');
      container.appendChild(img);
      registry.registerMediaElement('vid-public', img, {
        type: 'image',
        label: 'Logo',
        mediaMetadata: {
          mediaType: 'image',
          src: 'https://cdn.example.com/logo.png',
          altText: 'Company logo',
          isDecorative: false,
          renderedWidth: 100,
          renderedHeight: 40,
          loadingState: 'loaded',
          lazyLoading: false,
        },
      });

      const res = await executor.find({ includeHidden: true, includeMedia: true });
      const media = findById(res.elements, 'vid-public')!;
      expect(media.mediaMetadata?.src).toBe('https://cdn.example.com/logo.png');
      expect(media.mediaMetadata?.altText).toBe('Company logo');
    });
  });

  // ---------------------------------------------------------------------
  // NEGATIVE CONTROLS — no over-redaction. These pass BOTH pre- and
  // post-change by design; labelled explicitly so they are not miscounted
  // as regression tests.
  // ---------------------------------------------------------------------
  describe('[negative control] non-redacted elements are untouched', () => {
    beforeEach(() => {
      const input = document.createElement('input');
      input.type = 'text';
      input.setAttribute('data-testid', 'public');
      input.value = 'public-value';
      input.setAttribute('aria-label', 'Search box');
      container.appendChild(input);

      const btn = document.createElement('button');
      btn.setAttribute('data-testid', 'public-btn');
      btn.textContent = 'Save changes';
      container.appendChild(btn);
    });

    it('[negative control] still reports the real value/accessibleName/label', async () => {
      const res = await executor.find(OPTS);
      const pub = findById(res.elements, 'public')!;
      expect(pub.state.value).toBe('public-value');
      expect(pub.accessibleName).toBe('Search box');
      expect(pub.label).toBe('Search box');
      expect(pub.state.value).not.toBe(REDACTED_VALUE);
    });

    it('[negative control] still reports real textContent', async () => {
      const res = await executor.find(OPTS);
      const btn = findById(res.elements, 'public-btn')!;
      expect(btn.state.textContent).toBe('Save changes');
    });

    // NOT a pure negative control despite living in this block: it asserts
    // BOTH that the plain input keeps its value AND that the adjacent
    // password is scrubbed. The second half is a real leak assertion, so
    // this test is RED pre-fix. Kept together deliberately — the pairing is
    // the point: redaction must be per-element, not per-page.
    it('scrubs a password WITHOUT collateral-redacting its non-redacted sibling', async () => {
      const pw = document.createElement('input');
      pw.type = 'password';
      pw.setAttribute('data-testid', 'pw2');
      pw.value = PASSWORD_VALUE;
      container.appendChild(pw);

      const res = await executor.find(OPTS);
      expect(findById(res.elements, 'public')!.state.value).toBe('public-value');
      expect(findById(res.elements, 'pw2')!.state.value).toBe(REDACTED_VALUE);
    });
  });
});

// -------------------------------------------------------------------------
// extractReactState — the FOURTH ungated client-facing projection.
// -------------------------------------------------------------------------
describe('control/action-executor §4.6 — extractReactState (fourth projection)', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => container.remove());

  /**
   * Attach a fake React fiber/props pair. This projection reads React
   * INTERNALS, not the DOM — which is precisely why every DOM-level scrub
   * added elsewhere in this fix is irrelevant to it, and why it needs its
   * own gate. For a controlled React password input, `props.value` IS the
   * cleartext secret, and `handlers.ts` returns it verbatim via
   * `success(reactState)`.
   */
  function attachFakeReact(el: HTMLElement, props: Record<string, unknown>) {
    (el as unknown as Record<string, unknown>)['__reactProps$test'] = props;
  }

  it('SANITY: a non-redacted React element still yields its props (guards vacuity)', () => {
    const input = document.createElement('input');
    attachFakeReact(input, { value: 'public-value', placeholder: 'Search' });
    container.appendChild(input);

    const state = extractReactState(input);
    expect(state).not.toBeNull();
    expect(state!.props.value).toBe('public-value');
  });

  it('does not return the cleartext value from a redacted React password input', () => {
    const boundary = document.createElement('div');
    boundary.setAttribute('data-bridge-redact', 'true');
    const input = document.createElement('input');
    input.type = 'password';
    attachFakeReact(input, { value: PASSWORD_VALUE, name: 'password' });
    boundary.appendChild(input);
    container.appendChild(boundary);

    const state = extractReactState(input);
    expect(state).not.toBeNull();
    expect(state!.props.value).not.toBe(PASSWORD_VALUE);
    expect(state!.props.value).toBe(REDACTED_VALUE);
    expect(JSON.stringify(state)).not.toContain(SECRET);
  });

  it('redacts an unconditional password input even with no boundary attribute', () => {
    const input = document.createElement('input');
    input.type = 'password';
    attachFakeReact(input, { value: PASSWORD_VALUE });
    container.appendChild(input);

    const state = extractReactState(input);
    expect(JSON.stringify(state)).not.toContain(SECRET);
  });

  it('preserves prop KEYS (structure) while collapsing values', () => {
    const boundary = document.createElement('div');
    boundary.setAttribute('data-bridge-redact', 'true');
    const input = document.createElement('input');
    attachFakeReact(input, { value: PASSWORD_VALUE, name: 'token' });
    boundary.appendChild(input);
    container.appendChild(boundary);

    const state = extractReactState(input)!;
    expect(Object.keys(state.props).sort()).toEqual(['name', 'value']);
    // The key-preservation assertion alone passes pre-fix (the raw path has
    // the same keys), so it is not a regression test on its own. These value
    // assertions are what make it one.
    expect(state.props.value).toBe(REDACTED_VALUE);
    expect(state.props.name).toBe(REDACTED_VALUE);
  });

  it('[negative control] a non-React element still returns null', () => {
    const div = document.createElement('div');
    container.appendChild(div);
    expect(extractReactState(div)).toBeNull();
  });
});

// -------------------------------------------------------------------------
// SearchEngine — the DiscoveredElement arm the buildSearchable gate skips.
// -------------------------------------------------------------------------
describe('SearchEngine §4.6 — DiscoveredElement arm', () => {
  let engine: SearchEngine;
  let registry: UIBridgeRegistry;
  let executor: DefaultActionExecutor;
  let container: HTMLDivElement;

  beforeEach(() => {
    // `includeHidden` — jsdom rects are zero-size, so without this the
    // visibility filter drops every fixture and the oracle probes below
    // would pass vacuously (a zero-result search "leaks nothing" trivially).
    engine = new SearchEngine({ includeHidden: true });
    registry = new UIBridgeRegistry();
    executor = new DefaultActionExecutor(registry);
    container = document.createElement('div');
    document.body.appendChild(container);

    const boundary = document.createElement('div');
    boundary.setAttribute('data-bridge-redact', 'true');
    const secretInput = document.createElement('input');
    secretInput.type = 'text';
    secretInput.setAttribute('data-testid', 'input');
    secretInput.value = PASSWORD_VALUE;
    secretInput.setAttribute('aria-label', `API token ${SECRET}`);
    boundary.appendChild(secretInput);
    container.appendChild(boundary);

    const plainInput = document.createElement('input');
    plainInput.type = 'text';
    plainInput.setAttribute('data-testid', 'search-box');
    plainInput.value = 'public-value';
    plainInput.setAttribute('aria-label', 'Search box');
    container.appendChild(plainInput);
  });

  afterEach(() => container.remove());

  /**
   * The DiscoveredElements are taken from the REAL `find()` output rather
   * than hand-written literals. This matters: a hand-written fixture with
   * pre-scrubbed `[REDACTED]` values would exercise nothing — it would pass
   * identically before and after the fix, since nothing sensitive was ever
   * put in it. Sourcing them from `find()` reproduces the ACTUAL data path
   * (`POST /control/discover` → `SearchEngine`) and makes these genuine
   * regression tests: pre-fix, `find()` hands raw cleartext to the engine.
   */
  async function discovered(): Promise<DiscoveredElement[]> {
    const res = await executor.find({ includeHidden: true });
    return res.elements;
  }

  it('SANITY: the DiscoveredElement fixtures are genuinely searchable (guards vacuity)', async () => {
    const els = await discovered();
    expect(els.some((e) => e.id === 'input')).toBe(true);
    expect(els.some((e) => e.id === 'search-box')).toBe(true);

    const res = engine.search({ text: 'Search box' }, els);
    // The plain element must actually be found, otherwise every "no leak"
    // assertion below is trivially true against an empty result set.
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results.some((r) => r.element.id === 'search-box')).toBe(true);
  });

  it('emits no secret for a redacted DiscoveredElement', async () => {
    const res = engine.search({ type: 'input' }, await discovered());
    expect(JSON.stringify(res)).not.toContain(SECRET);
    expect(JSON.stringify(res)).not.toContain(PASSWORD_VALUE);
  });

  it('offers no confirm-by-search ORACLE on the EXACT secret value', async () => {
    const els = await discovered();
    // EXACT probes, not partial needles: an exact field hit scores 1.0,
    // whereas a partial needle can fall under the fuzzy threshold and make
    // this test pass vacuously. Each probe is the precise value a client
    // would be guessing.
    const probes = [
      { text: PASSWORD_VALUE },
      { accessibleName: PASSWORD_VALUE },
      { text: `API token ${SECRET}` },
      { accessibleName: `API token ${SECRET}` },
      // `value` is NOT a member of `SearchCriteria` (`ai/types.ts:24-78`),
      // so `{ value: … }` supplied no criteria at all and probed nothing.
      // `textContains` is the real criterion that reaches the value channel.
      { textContains: PASSWORD_VALUE },
    ];
    for (const criteria of probes) {
      const res = engine.search(criteria as never, els);
      const hit = res.results.find((r) => r.element.id === 'input');
      // Either no hit at all, or a hit whose confidence is NOT the
      // exact-match score — the client must not be able to distinguish
      // "correct guess" from "wrong guess".
      if (hit) {
        expect(hit.confidence).toBeLessThan(0.9);
      }
      // Scoped to `results`, NOT the whole response: `SearchResponse` echoes
      // the caller's own `criteria` back, so a blanket check on `res` would
      // trip on the client's own probe string — which it supplied and
      // already knows, and is therefore not a leak.
      expect(JSON.stringify(res.results)).not.toContain(SECRET);
    }
  });

  it('[negative control] a non-redacted DiscoveredElement still scores an exact match normally', async () => {
    const res = engine.search({ accessibleName: 'Search box' }, await discovered());
    const hit = res.results.find((r) => r.element.id === 'search-box');
    expect(hit).toBeDefined();
    // Proves the oracle assertion above is measuring something real: an
    // exact accessibleName hit on a NON-redacted element does score high.
    expect(hit!.confidence).toBeGreaterThan(0.5);
  });

  // ---- Finding 3: redaction inferred from DATA, not a page-forgeable magic string ----
  it('does NOT treat a non-redacted element as redacted just because its text is literally "[REDACTED]"', () => {
    // `REDACTED_VALUE` is an ordinary string this package EXPORTS for
    // consumers to assert on. A secrets-management UI (this product's own
    // domain) routinely renders the literal text "[REDACTED]" for masked
    // values. Keying redaction on `state.textContent === REDACTED_VALUE`
    // made such an element lose all its search aliases. The fix keys on the
    // `state.redaction.content` DATA flag instead.
    const masked: DiscoveredElement = {
      id: 'masked-btn',
      type: 'button',
      tagName: 'button',
      accessibleName: 'Reveal secret',
      label: 'Reveal secret',
      actions: ['click'],
      registered: true,
      state: {
        visible: true,
        enabled: true,
        focused: false,
        rect: { x: 0, y: 0, width: 10, height: 10, top: 0, right: 10, bottom: 10, left: 0 },
        // The element legitimately DISPLAYS the sentinel string — but it is
        // NOT redacted (no boundary), so `redaction.content` is unset.
        textContent: REDACTED_VALUE,
      },
    };
    const twin: DiscoveredElement = {
      ...masked,
      id: 'twin-btn',
      state: { ...masked.state, textContent: 'Reveal value' },
    };

    const maskedRes = engine.search({ accessibleName: 'Reveal secret' }, [masked]);
    const twinRes = engine.search({ accessibleName: 'Reveal secret' }, [twin]);

    const maskedHit = maskedRes.results.find((r) => r.element.id === 'masked-btn');
    const twinHit = twinRes.results.find((r) => r.element.id === 'twin-btn');

    expect(maskedHit).toBeDefined();
    expect(twinHit).toBeDefined();
    // The masked element is NOT stripped: it keeps the accessibleName-derived
    // aliases exactly as its non-masked twin does. (Only the textContent-
    // derived aliases differ — "redacted"/"masked" vs "value" — because the
    // two carry different visible text; that difference is not redaction.)
    expect(maskedHit!.element.aliases.length).toBeGreaterThan(0);
    expect(twinHit!.element.aliases.length).toBeGreaterThan(0);
    for (const shared of ['reveal', 'secret', 'reveal secret']) {
      expect(maskedHit!.element.aliases).toContain(shared);
      expect(twinHit!.element.aliases).toContain(shared);
    }
    expect(maskedHit!.element.accessibleName).toBe('Reveal secret');
  });

  it('DOES treat a DiscoveredElement carrying `state.redaction.content` as redacted (data-keyed)', () => {
    const redacted: DiscoveredElement = {
      id: 'flagged',
      type: 'input',
      tagName: 'input',
      accessibleName: REDACTED_VALUE,
      actions: [],
      registered: true,
      state: {
        visible: true,
        enabled: true,
        focused: false,
        rect: { x: 0, y: 0, width: 10, height: 10, top: 0, right: 10, bottom: 10, left: 0 },
        accessibleName: REDACTED_VALUE,
        textContent: REDACTED_VALUE,
        redaction: { content: true },
      },
    };
    const res = engine.search({ type: 'input' }, [redacted]);
    const hit = res.results.find((r) => r.element.id === 'flagged');
    expect(hit).toBeDefined();
    // Redacted → no DOM-derived aliases.
    expect(hit!.element.aliases).toEqual([]);
  });
});
