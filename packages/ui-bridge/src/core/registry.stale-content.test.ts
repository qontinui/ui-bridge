/**
 * Regression: a DOM-scraped `content` must not be frozen at first registration.
 *
 * ## The defect this pins
 *
 * `cc9d534` fixed the identical defect on `label` and closed with:
 *
 * > Known follow-up, not addressed here: `RegisteredElement.content` is frozen
 * > by the identical mechanism and needs its own regression test and mutation
 * > proof.
 *
 * This is that test. `content` is a `textContent` copy taken at
 * `registerContentElement`, and `serializeRegisteredElement` emits it beside a
 * `text` (`computeVisibleText`) that IS re-derived from the live node on every
 * read. So one snapshot entry could carry
 *
 *   content: "Waiting for coord…"      ← frozen at first render
 *   text:    "No work units in this window"   ← the DOM as it is now
 *
 * which is exactly the self-contradiction that made a session file a UX
 * finding against `/admin/coord/plans` on 2026-09-06 while the page was
 * correct. An instrument whose own fields disagree cannot be used to decide
 * anything, because a reader cannot tell which field is lying.
 *
 * Plan: 2026-09-06-ui-bridge-element-metadata-is-stale-and-misdeclared
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { UIBridgeRegistry } from './registry';
import type { ContentMetadata } from './types';

const EMPTY_METADATA = {} as ContentMetadata;

function makeAllVisible(): void {
  document.body.querySelectorAll<HTMLElement>('*').forEach((el) => {
    Object.defineProperty(el, 'offsetParent', { get: () => document.body, configurable: true });
  });
}

/**
 * Register the way `useAutoRegister`'s content path does — a scraped value
 * PLUS the closure that re-derives it. Both are single-sourced there for the
 * same reason they are here: a refresh that used a different algorithm could
 * change the answer instead of only unstaling it.
 */
function registerScrapedParagraph(registry: UIBridgeRegistry, node: HTMLElement): void {
  const derive = (el: HTMLElement): string | undefined => {
    const raw = el.textContent?.trim();
    return raw ? raw.replace(/\s+/g, ' ') : undefined;
  };
  registry.registerContentElement('content-para', node, {
    contentType: 'paragraph',
    contentMetadata: EMPTY_METADATA,
    label: derive(node),
    labelSource: () => derive(node),
    content: derive(node),
    contentSource: () => derive(node),
  });
}

describe('stale content — DOM-scraped content is re-derived, not frozen at registration', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('a snapshot after the text changes emits the NEW content, agreeing with its own text', () => {
    document.body.innerHTML = `<p id="para">Waiting for coord…</p>`;
    const registry = new UIBridgeRegistry();
    const node = document.getElementById('para')!;
    registerScrapedParagraph(registry, node);
    makeAllVisible();

    const before = registry.createSnapshot().elements.find((e) => e.id === 'content-para');
    expect(before?.content).toBe('Waiting for coord…');

    node.textContent = 'No work units in this window';

    const after = registry.createSnapshot().elements.find((e) => e.id === 'content-para');
    expect(after?.content).toBe('No work units in this window');
    // The three text fields in ONE entry must agree. The asymmetry between a
    // cached `content` and a live `text` IS the defect.
    expect(after?.text).toBe('No work units in this window');
    expect(after?.label).toBe('No work units in this window');
  });

  it('createSnapshotAsync emits the NEW content too', async () => {
    document.body.innerHTML = `<p id="para">Waiting for coord…</p>`;
    const registry = new UIBridgeRegistry();
    const node = document.getElementById('para')!;
    registerScrapedParagraph(registry, node);
    makeAllVisible();

    node.textContent = 'No work units in this window';

    const snap = await registry.createSnapshotAsync(50);
    expect(snap.elements.find((e) => e.id === 'content-para')?.content).toBe(
      'No work units in this window'
    );
  });

  it('refreshScrapedText() counts a label AND a content move as two fields', () => {
    document.body.innerHTML = `<p id="para">Waiting for coord…</p>`;
    const registry = new UIBridgeRegistry();
    const node = document.getElementById('para')!;
    registerScrapedParagraph(registry, node);

    node.textContent = 'No work units in this window';
    expect(registry.refreshScrapedText()).toBe(2);
    // Idempotent: a second sweep with no DOM change moves nothing.
    expect(registry.refreshScrapedText()).toBe(0);
  });

  it('a DEVELOPER-SET content is never overwritten by a DOM re-read', () => {
    document.body.innerHTML = `<p id="para">scraped text</p>`;
    const registry = new UIBridgeRegistry();
    // No `contentSource` — this is the explicit, developer-authored shape.
    registry.registerContentElement('dev-content', document.getElementById('para')!, {
      contentType: 'paragraph',
      contentMetadata: EMPTY_METADATA,
      content: 'Developer chosen content',
    });

    document.getElementById('para')!.textContent = 'changed scraped text';
    expect(registry.refreshScrapedText()).toBe(0);
    expect(registry.getElement('dev-content')!.content).toBe('Developer chosen content');
  });

  it('a detached node keeps its last known content rather than being blanked', () => {
    document.body.innerHTML = `<p id="para">Waiting for coord…</p>`;
    const registry = new UIBridgeRegistry();
    const node = document.getElementById('para')!;
    registerScrapedParagraph(registry, node);
    node.remove();

    expect(registry.refreshScrapedText()).toBe(0);
    expect(registry.getElement('content-para')!.content).toBe('Waiting for coord…');
  });

  it('a THROWING content closure leaves the value verbatim and does not break the sweep', () => {
    document.body.innerHTML = `<p id="a">alpha</p><p id="b">beta</p>`;
    const registry = new UIBridgeRegistry();
    const a = document.getElementById('a')!;
    const b = document.getElementById('b')!;
    registry.registerContentElement('c-a', a, {
      contentType: 'paragraph',
      contentMetadata: EMPTY_METADATA,
      content: 'alpha',
      contentSource: () => {
        throw new Error('derivation blew up');
      },
    });
    registerScrapedParagraph(registry, b);

    b.textContent = 'beta changed';

    // The throwing entry is skipped; the healthy one still refreshes (label +
    // content = 2). A broken closure must not take the read down with it.
    expect(registry.refreshScrapedText()).toBe(2);
    expect(registry.getElement('c-a')!.content).toBe('alpha');
    expect(registry.getElement('content-para')!.content).toBe('beta changed');
  });

  it('the content re-derivation closure is NOT serialized onto the wire', () => {
    document.body.innerHTML = `<p id="para">Waiting for coord…</p>`;
    const registry = new UIBridgeRegistry();
    registerScrapedParagraph(registry, document.getElementById('para')!);
    makeAllVisible();

    const entry = registry.getElement('content-para')!;
    expect(Object.keys(entry)).not.toContain('__contentSource');
    expect(JSON.stringify(registry.createSnapshot())).not.toContain('__contentSource');
  });
});
