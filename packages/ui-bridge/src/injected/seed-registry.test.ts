/**
 * Unit tests for injected-mode DOM → registry seeding (plan §6).
 *
 * Verifies that `seedRegistryFromDom` populates a standalone
 * `UIBridgeRegistry` with the correct elements (live refs, labels, inferred
 * actions) from a bare DOM, and that the relay dispatcher driven over that
 * registry can `find` and `act` — including the OQ-1 residual check that
 * typing into a controlled React input fires its `onChange`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { UIBridgeRegistry, setGlobalRegistry } from '../core/registry';
import { executeCommand } from '../react/commandHandlers';
import { seedRegistryFromDom, observeAndSeed } from './seed-registry';
import { bridgeAccessOver } from './bridge-access';

function setBody(html: string): void {
  document.body.innerHTML = html;
}

/**
 * jsdom computes no layout: `offsetParent` is always null, so the
 * dispatcher's visibility gates (`offsetParent !== null`) reject every
 * element. Stub just `offsetParent` so the find/act paths exercise real
 * logic. We deliberately leave `getBoundingClientRect` at jsdom's zero rect:
 * a non-zero rect would push `computeState` into a viewport hit-test
 * (`elementFromPoint`) that jsdom can't satisfy — irrelevant to what these
 * tests assert.
 */
function makeVisible(el: HTMLElement): void {
  Object.defineProperty(el, 'offsetParent', { get: () => document.body, configurable: true });
}

function makeAllVisible(): void {
  document.body.querySelectorAll<HTMLElement>('*').forEach(makeVisible);
}

describe('seedRegistryFromDom', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('registers interactive elements with live refs, labels, and inferred actions', () => {
    setBody(`
      <label for="email">Email address</label>
      <input id="email" type="text" />
      <button>Sign in</button>
      <a href="/help">Help</a>
      <div>not interactive</div>
    `);
    const registry = new UIBridgeRegistry();
    const result = seedRegistryFromDom(registry, document.body);

    expect(result.registered).toBeGreaterThanOrEqual(3);
    const all = registry.getAllElements();

    const input = all.find((e) => e.element.tagName === 'INPUT');
    expect(input).toBeDefined();
    // Live DOM ref carried through.
    expect(input!.element).toBe(document.getElementById('email'));
    // Label resolved via the associated <label for>.
    expect(input!.label).toBe('Email address');
    // Inferred input actions include type/clear.
    expect(input!.actions).toContain('type');
    expect(input!.actions).toContain('clear');

    const button = all.find((e) => e.element.tagName === 'BUTTON');
    expect(button?.label).toBe('Sign in');
    expect(button?.actions).toContain('click');
  });

  it('is idempotent across re-seeds with a shared tracked map (no duplicates)', () => {
    setBody(`<button>One</button><button>Two</button>`);
    const registry = new UIBridgeRegistry();
    const tracked = new Map<HTMLElement, string>();
    const first = seedRegistryFromDom(registry, document.body, { tracked });
    const second = seedRegistryFromDom(registry, document.body, { tracked });

    expect(first.registered).toBe(2);
    expect(second.registered).toBe(0); // already tracked
    expect(registry.getAllElements()).toHaveLength(2);
  });

  it('disambiguates colliding ids deterministically', () => {
    setBody(`<button>Save</button><button>Save</button>`);
    const registry = new UIBridgeRegistry();
    seedRegistryFromDom(registry, document.body);
    const ids = registry.getAllElements().map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length); // all unique
    expect(ids.length).toBe(2);
  });
});

describe('executeCommand over a DOM-seeded registry (Tier 1)', () => {
  let registry: UIBridgeRegistry;

  beforeEach(() => {
    document.body.innerHTML = '';
    registry = new UIBridgeRegistry();
    setGlobalRegistry(registry); // executeCommand reads the global registry
  });

  it('find resolves a seeded element by label', async () => {
    setBody(`
      <label for="email">Email</label>
      <input id="email" type="text" />
      <button>Continue</button>
    `);
    makeAllVisible();
    seedRegistryFromDom(registry, document.body);
    const bridge = bridgeAccessOver(registry);

    const res = (await executeCommand('find', { label: 'Email' }, bridge)) as {
      elements: Array<{ id: string }>;
      total: number;
    };
    expect(res.total).toBeGreaterThanOrEqual(1);
  });

  it('typing into a controlled React input fires its onChange (OQ-1 residual)', async () => {
    setBody(`<input id="name" type="text" />`);
    const input = document.getElementById('name') as HTMLInputElement;
    makeVisible(input);

    // Simulate a React-controlled input: install a _valueTracker and an
    // __reactProps$ onChange the dispatcher's `type` case targets.
    let observed = '';
    (input as unknown as { _valueTracker: { setValue(v: string): void } })._valueTracker = {
      setValue: () => {},
    };
    (input as unknown as Record<string, unknown>)['__reactProps$test'] = {
      onChange: (e: { target: HTMLInputElement }) => {
        observed = e.target.value;
      },
    };

    seedRegistryFromDom(registry, document.body);
    const bridge = bridgeAccessOver(registry);
    const id = registry.getAllElements().find((e) => e.element === input)!.id;

    await executeCommand('executeElementAction', { id, request: { action: 'type', text: 'Ada' } }, bridge);

    expect(input.value).toBe('Ada');
    expect(observed).toBe('Ada'); // onChange fired with the new value
  });
});

describe('observeAndSeed', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('seeds immediately and returns a working disconnect', () => {
    setBody(`<button>Now</button>`);
    const registry = new UIBridgeRegistry();
    const stop = observeAndSeed(registry, document.body);
    expect(registry.getAllElements().length).toBeGreaterThanOrEqual(1);
    // Disconnect must not throw and must be idempotent.
    expect(() => {
      stop();
      stop();
    }).not.toThrow();
  });
});
