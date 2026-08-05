/**
 * R8 (plan 2026-08-05-setup-wizard-tier-step-remount-remediation): the two
 * element-state serializers must agree, and `disabled` must stop being folded
 * into `enabled`.
 *
 * Before the fix:
 *   - `ElementState` declared `enabled` (= `!(native disabled || aria-disabled)`)
 *     and NO `disabled`, so a driver could not tell "the browser refuses the
 *     event" from "the author only labelled it disabled" — the exact
 *     distinction the setup-wizard investigation needed.
 *   - the DOM-fallback scanner emitted a `disabled` key the canonical type did
 *     not even declare, never emitted `ariaDisabled`, and computed `enabled`
 *     from the native property alone — so which keys existed, AND what
 *     `enabled` meant, depended on which serializer answered.
 *
 * Contract asserted here:
 *   1. both serializers emit the same disabled-family KEY SET;
 *   2. both emit the same VALUES for the same DOM;
 *   3. `disabled` and `ariaDisabled` are independent, and `enabled` is exactly
 *      their negated OR.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { scanDOMForInteractiveElements } from './dom-fallback';

/** The disabled-family keys both serializers must carry. */
const DISABLED_FAMILY = ['visible', 'enabled', 'disabled', 'ariaDisabled', 'focused'] as const;

function familyOf(state: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(DISABLED_FAMILY.map((k) => [k, state[k]]));
}

beforeAll(() => {
  // jsdom has no `elementFromPoint`; the registry visibility hit-test no-ops
  // when it is genuinely absent, so leave it undefined-but-defined.
  if (typeof document !== 'undefined' && !document.elementFromPoint) {
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => null,
    });
  }
});

describe('R8 · disabled / ariaDisabled split and serializer parity', () => {
  let container: HTMLDivElement;
  let registry: UIBridgeRegistry;

  /** id → the button, in scan order. */
  const fixtures: Array<[string, () => HTMLButtonElement]> = [
    ['plain-btn', () => document.createElement('button')],
    [
      'native-disabled-btn',
      () => {
        const b = document.createElement('button');
        b.disabled = true;
        return b;
      },
    ],
    [
      'aria-disabled-btn',
      () => {
        const b = document.createElement('button');
        b.setAttribute('aria-disabled', 'true');
        return b;
      },
    ],
    [
      'both-disabled-btn',
      () => {
        const b = document.createElement('button');
        b.disabled = true;
        b.setAttribute('aria-disabled', 'true');
        return b;
      },
    ],
  ];

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
    for (const [id, make] of fixtures) {
      const el = make();
      el.setAttribute('data-testid', id);
      el.textContent = id;
      container.appendChild(el);
      registry.registerElement(id, el, { type: 'button' });
    }
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  function registryState(id: string): Record<string, unknown> {
    const el = registry.getElement(id);
    expect(el, `element ${id} is registered`).toBeDefined();
    return el!.getState() as unknown as Record<string, unknown>;
  }

  function fallbackState(id: string): Record<string, unknown> {
    const scanned = scanDOMForInteractiveElements(container).find((e) => e.id === `dom-${id}`);
    expect(scanned, `element ${id} was scanned by the DOM fallback`).toBeDefined();
    return scanned!.state as unknown as Record<string, unknown>;
  }

  it('registry serializer reports the two signals independently', () => {
    expect(familyOf(registryState('plain-btn'))).toMatchObject({
      enabled: true,
      disabled: false,
      ariaDisabled: false,
    });
    expect(familyOf(registryState('native-disabled-btn'))).toMatchObject({
      enabled: false,
      disabled: true,
      ariaDisabled: false,
    });
    // The distinguishing case: announced as disabled, but the browser still
    // dispatches the click.
    expect(familyOf(registryState('aria-disabled-btn'))).toMatchObject({
      enabled: false,
      disabled: false,
      ariaDisabled: true,
    });
    expect(familyOf(registryState('both-disabled-btn'))).toMatchObject({
      enabled: false,
      disabled: true,
      ariaDisabled: true,
    });
  });

  it('both fields are present at rest (not omitted when false)', () => {
    const state = registryState('plain-btn');
    expect(Object.keys(state)).toContain('disabled');
    expect(Object.keys(state)).toContain('ariaDisabled');
    expect(state.disabled).toBe(false);
    expect(state.ariaDisabled).toBe(false);
  });

  it('the DOM-fallback serializer emits the identical key set', () => {
    for (const [id] of fixtures) {
      const fromRegistry = Object.keys(registryState(id)).filter((k) =>
        (DISABLED_FAMILY as readonly string[]).includes(k)
      );
      const fromFallback = Object.keys(fallbackState(id)).filter((k) =>
        (DISABLED_FAMILY as readonly string[]).includes(k)
      );
      expect(fromFallback.sort(), `${id}: disabled-family keys`).toEqual(
        [...DISABLED_FAMILY].sort()
      );
      expect(fromFallback.sort()).toEqual(fromRegistry.sort());
    }
  });

  it('the DOM-fallback serializer emits the identical values', () => {
    for (const [id] of fixtures) {
      const reg = familyOf(registryState(id));
      const dom = familyOf(fallbackState(id));
      // `visible`/`focused` are computed by different (pre-existing) code
      // paths; the disabled family is the contract R8 pins.
      expect(
        { enabled: dom.enabled, disabled: dom.disabled, ariaDisabled: dom.ariaDisabled },
        `${id}: DOM-fallback disabled family`
      ).toEqual({
        enabled: reg.enabled,
        disabled: reg.disabled,
        ariaDisabled: reg.ariaDisabled,
      });
    }
  });

  it('`enabled` stays exactly the negated OR of the two signals', () => {
    for (const [id] of fixtures) {
      for (const state of [registryState(id), fallbackState(id)]) {
        expect(state.enabled, `${id}: enabled is derived`).toBe(
          !(state.disabled === true || state.ariaDisabled === true)
        );
      }
    }
  });
});
