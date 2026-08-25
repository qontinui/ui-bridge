/**
 * Stable Element Reference Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry, setGlobalRegistry, resetGlobalRegistry } from './registry';
import { createStableRef, resolveStableRef } from './stable-ref';
import { ELEMENT_RESOLUTION_CLASS, ELEMENT_RESOLUTION_RANK } from './resolution-score';
import type { RegisteredElement } from './types';

let idCounter = 0;

function makeRegisteredElement(
  registry: UIBridgeRegistry,
  tag: string,
  attrs: Record<string, string> = {}
): RegisteredElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  document.body.appendChild(el);
  const id = `test-el-${++idCounter}`;
  const registered = registry.registerElement(id, el, {});
  return registered;
}

describe('StableElementRef', () => {
  let registry: UIBridgeRegistry;

  beforeEach(() => {
    registry = new UIBridgeRegistry({ preserveIdAcrossRemount: true });
    setGlobalRegistry(registry);
  });

  afterEach(() => {
    // Clean up DOM elements added by tests
    document.body.innerHTML = '';
    resetGlobalRegistry();
  });

  describe('createStableRef', () => {
    it('captures id, fingerprint, and semanticPath', () => {
      const regEl = makeRegisteredElement(registry, 'button', {
        'data-testid': 'submit-btn',
      });
      const ref = createStableRef(regEl);

      expect(ref.id).toBe(regEl.id);
      expect(ref.primaryId).toBe(regEl.id);
      expect(ref.fingerprint).toBeTruthy();
      expect(ref.semanticPath).toBeTruthy();
      expect(ref.idStrategy).toBe('data-testid');
      expect(ref.lastSeenAt).toBeGreaterThan(0);
    });

    it('captures stableId from data-ui-bridge-id', () => {
      const regEl = makeRegisteredElement(registry, 'input', {
        'data-ui-bridge-id': 'stable-input-1',
      });
      const ref = createStableRef(regEl);
      expect(ref.stableId).toBe('stable-input-1');
    });

    it('uses html-id strategy when element has a non-React id', () => {
      const regEl = makeRegisteredElement(registry, 'div', {
        id: 'main-container',
      });
      const ref = createStableRef(regEl);
      expect(ref.idStrategy).toBe('html-id');
    });

    it('uses prefer-existing strategy for elements without stable ids', () => {
      const regEl = makeRegisteredElement(registry, 'span');
      const ref = createStableRef(regEl);
      expect(ref.idStrategy).toBe('prefer-existing');
    });
  });

  describe('resolveStableRef', () => {
    it('resolves by primaryId when element is still mounted', () => {
      const regEl = makeRegisteredElement(registry, 'button');
      const ref = createStableRef(regEl);

      const resolved = resolveStableRef(ref);
      expect(resolved).not.toBeNull();
      expect(resolved!.element.id).toBe(regEl.id);
      // Strategy 1 is the only non-inferential arm in the chain.
      expect(resolved!.resolution.strategy).toBe('registry-id');
      expect(resolved!.resolution.stabilityClass).toBe('exact');
    });

    it('resolves via data-ui-bridge-id when primaryId is stale', () => {
      const regEl = makeRegisteredElement(registry, 'button', {
        'data-ui-bridge-id': 'my-btn',
      });
      const ref = createStableRef(regEl);

      // Simulate re-render: unregister old, register new with same DOM attr
      registry.unregisterElement(regEl.id);
      const newEl = document.createElement('button');
      newEl.setAttribute('data-ui-bridge-id', 'my-btn');
      document.body.appendChild(newEl);
      registry.registerElement(`test-el-${++idCounter}`, newEl, {});

      const resolved = resolveStableRef(ref);
      expect(resolved).not.toBeNull();
      expect(resolved!.element.element).toBe(newEl);
    });

    it('reports the data-ui-bridge-id strategy as strong, not exact', () => {
      // A registry that does NOT re-match remounts by fingerprint, so the
      // stale primaryId genuinely misses strategy 1 and the stamped attribute
      // is what carries the resolution.
      const plain = new UIBridgeRegistry({ preserveIdAcrossRemount: false });
      setGlobalRegistry(plain);
      const el = document.createElement('button');
      const stampedId = `stamped-${++idCounter}`;
      el.setAttribute('data-ui-bridge-id', stampedId);
      el.textContent = 'Save';
      document.body.appendChild(el);
      const regEl = plain.registerElement(stampedId, el, {});
      const ref = createStableRef(regEl);

      plain.unregisterElement(regEl.id);
      const newEl = document.createElement('button');
      newEl.setAttribute('data-ui-bridge-id', stampedId);
      newEl.textContent = 'Save';
      document.body.appendChild(newEl);
      el.remove();
      plain.registerElement(`remounted-${++idCounter}`, newEl, {});

      const resolved = resolveStableRef(ref);
      expect(resolved).not.toBeNull();
      expect(resolved!.element.element).toBe(newEl);
      expect(resolved!.resolution.strategy).toBe('ui-bridge-id-attr');
      expect(resolved!.resolution.stabilityClass).toBe('strong');
      // Strictly weaker than an exact registry hit — that ordering is the
      // whole point of reporting a rank at all.
      expect(resolved!.resolution.stabilityRank).toBeLessThan(
        ELEMENT_RESOLUTION_RANK['registry-id']
      );
    });

    it('omits alternates unless the call asks for them', () => {
      const regEl = makeRegisteredElement(registry, 'button', {
        'data-ui-bridge-id': 'alt-btn',
      });
      const ref = createStableRef(regEl);
      // The ref's primaryId IS the stamp target here, so several strategies
      // would all resolve; by default the chain still stops at the first.
      ref.stableId = regEl.id;

      expect(resolveStableRef(ref)!.resolution.alternates).toBeUndefined();

      const withAlternates = resolveStableRef(ref, { includeAlternates: true })!;
      expect(withAlternates.resolution.alternates).toBeDefined();
      // The winner is never repeated in its own alternate list.
      expect(
        withAlternates.resolution.alternates!.some(
          (candidate) => candidate.strategy === withAlternates.resolution.strategy
        )
      ).toBe(false);
      // Ranked strongest-first.
      const ranks = withAlternates.resolution.alternates!.map((c) => c.stabilityRank);
      expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
    });

    it('ranks the semantic-path strategy as weak', () => {
      expect(ELEMENT_RESOLUTION_CLASS['semantic-path']).toBe('weak');
      expect(ELEMENT_RESOLUTION_RANK['semantic-path']).toBeLessThan(
        ELEMENT_RESOLUTION_RANK['fingerprint']
      );
      expect(ELEMENT_RESOLUTION_RANK['fingerprint']).toBeLessThan(
        ELEMENT_RESOLUTION_RANK['ui-bridge-id-attr']
      );
      expect(ELEMENT_RESOLUTION_RANK['ui-bridge-id-attr']).toBeLessThan(
        ELEMENT_RESOLUTION_RANK['registry-id']
      );
    });

    it('returns null when element is fully gone', () => {
      const regEl = makeRegisteredElement(registry, 'button');
      const ref = createStableRef(regEl);

      // Remove from DOM and registry
      regEl.element.remove();
      registry.unregisterElement(regEl.id);

      const resolved = resolveStableRef(ref);
      expect(resolved).toBeNull();
    });
  });
});
