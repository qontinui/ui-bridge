/**
 * Stable Element Reference Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry, setGlobalRegistry, resetGlobalRegistry } from './registry';
import { createStableRef, resolveStableRef } from './stable-ref';
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
      expect(resolved!.id).toBe(regEl.id);
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
      expect(resolved!.element).toBe(newEl);
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
