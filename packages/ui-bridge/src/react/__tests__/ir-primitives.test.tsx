/**
 * IR Primitives Tests
 *
 * Phase 4 / UI Bridge Redesign — Section 1 Foundations.
 *
 * Verifies the additive IR-emitting metadata fields on `useUIState` /
 * `useUITransition` and the `<State>` / `<TransitionTo>` JSX wrappers:
 *
 * 1. `<State>` renders a Fragment (no DOM impact).
 * 2. `<State>` registers a UI state on mount via the underlying hook.
 * 3. `<State>` with IR-shaped `metadata` writes to the global annotation
 *    store for each element ID.
 * 4. `<TransitionTo>` registers a transition with the `effect` field
 *    preserved on the registered metadata bag (`metadata.__ir.effect`).
 * 5. Unmounting `<State>` unregisters cleanly via the hook's existing
 *    teardown.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { State } from '../State';
import { TransitionTo } from '../TransitionTo';
import { UIBridgeRegistry } from '../../core/registry';
import { getGlobalAnnotationStore, resetGlobalAnnotationStore } from '../../annotations';
import type { UIBridgeContextValue } from '../UIBridgeProvider';

// Mock the provider so we can inject a real UIBridgeRegistry without the
// full provider tree. Mirrors the pattern used by useAutoRegister.test.tsx.
let mockBridge: UIBridgeContextValue | null = null;
vi.mock('../UIBridgeProvider', () => ({
  useUIBridgeOptional: () => mockBridge,
}));

function createMockBridge(registry: UIBridgeRegistry): UIBridgeContextValue {
  return { registry } as unknown as UIBridgeContextValue;
}

describe('<State> — IR-emitting JSX wrapper', () => {
  let registry: UIBridgeRegistry;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    mockBridge = createMockBridge(registry);
    resetGlobalAnnotationStore();
  });

  afterEach(() => {
    cleanup();
    mockBridge = null;
  });

  it('renders a Fragment with no DOM impact', () => {
    const { container } = render(
      <State id="page-foo" name="Foo Page">
        <span data-testid="child">child</span>
      </State>
    );
    // Fragment has no DOM node of its own, so the only child of the
    // testing-library container is the <span>.
    expect(container.children.length).toBe(1);
    expect(container.firstElementChild?.tagName).toBe('SPAN');
    expect(container.firstElementChild?.getAttribute('data-testid')).toBe('child');
  });

  it('registers a UI state on mount via useUIState', () => {
    render(<State id="login-form" name="Login Form" elements={['email', 'password']} />);
    const registered = registry.getState('login-form');
    expect(registered).toBeDefined();
    expect(registered?.name).toBe('Login Form');
    expect(registered?.elements).toEqual(['email', 'password']);
  });

  it('writes IR-shaped metadata to the global annotation store for each element ID', () => {
    render(
      <State
        id="login-form"
        name="Login Form"
        elements={['email-input', 'password-input']}
        metadata={{
          description: 'Login form section',
          purpose: 'Authenticate existing users',
          tags: ['auth', 'form'],
        }}
      />
    );

    const store = getGlobalAnnotationStore();
    expect(store.has('email-input')).toBe(true);
    expect(store.has('password-input')).toBe(true);
    expect(store.get('email-input')?.description).toBe('Login form section');
    expect(store.get('password-input')?.purpose).toBe('Authenticate existing users');
    expect(store.get('email-input')?.tags).toEqual(['auth', 'form']);
  });

  it('uses requiredElements (IR canonical) when provided, with id-bearing criteria', () => {
    render(
      <State
        id="dashboard"
        name="Dashboard"
        requiredElements={[{ id: 'header' }, { id: 'sidebar' }]}
        metadata={{ description: 'Main dashboard view' }}
      />
    );

    const registered = registry.getState('dashboard');
    expect(registered?.elements).toEqual(['header', 'sidebar']);

    const store = getGlobalAnnotationStore();
    expect(store.get('header')?.description).toBe('Main dashboard view');
    expect(store.get('sidebar')?.description).toBe('Main dashboard view');
  });

  it('does NOT write to the annotation store when metadata is non-IR shape', () => {
    render(
      <State
        id="legacy-state"
        name="Legacy"
        elements={['btn']}
        // Custom metadata bag with non-IR keys — must not pollute the store.
        metadata={{ legacyKey: 'value', anotherKey: 42 }}
      />
    );

    const store = getGlobalAnnotationStore();
    expect(store.has('btn')).toBe(false);

    // But the state itself is still registered with the metadata.
    const registered = registry.getState('legacy-state');
    expect(registered?.metadata).toEqual({ legacyKey: 'value', anotherKey: 42 });
  });

  it('unregisters cleanly on unmount', () => {
    const { unmount } = render(<State id="ephemeral" name="Ephemeral" />);
    expect(registry.getState('ephemeral')).toBeDefined();

    unmount();

    expect(registry.getState('ephemeral')).toBeUndefined();
  });
});

describe('<TransitionTo> — IR-emitting JSX wrapper', () => {
  let registry: UIBridgeRegistry;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    mockBridge = createMockBridge(registry);
    resetGlobalAnnotationStore();
  });

  afterEach(() => {
    cleanup();
    mockBridge = null;
  });

  it('renders a Fragment with no DOM impact', () => {
    const { container } = render(
      <TransitionTo
        id="t-noop"
        name="Noop"
        fromStates={['a']}
        activateStates={['b']}
        exitStates={['a']}
      >
        <span data-testid="child">child</span>
      </TransitionTo>
    );
    expect(container.children.length).toBe(1);
    expect(container.firstElementChild?.getAttribute('data-testid')).toBe('child');
  });

  it('registers a transition via useUITransition', () => {
    render(
      <TransitionTo
        id="open-login"
        name="Open Login"
        fromStates={['landing']}
        activateStates={['login-form']}
        exitStates={['landing']}
      />
    );
    const registered = registry.getTransition('open-login');
    expect(registered).toBeDefined();
    expect(registered?.fromStates).toEqual(['landing']);
    expect(registered?.activateStates).toEqual(['login-form']);
    expect(registered?.exitStates).toEqual(['landing']);
  });

  it('preserves the IR effect/metadata/provenance on the registered metadata bag', () => {
    render(
      <TransitionTo
        id="delete-account"
        name="Delete Account"
        fromStates={['settings']}
        activateStates={['confirmation']}
        exitStates={['settings']}
        effect="destructive"
        metadata={{ description: 'Permanently deletes the account' }}
        provenance={{ source: 'hand-authored' }}
      />
    );

    const registered = registry.getTransition('delete-account');
    expect(registered).toBeDefined();
    const bag = registered?.metadata as { __ir?: Record<string, unknown> } | undefined;
    expect(bag?.__ir).toBeDefined();
    expect(bag?.__ir).toMatchObject({
      effect: 'destructive',
      metadata: { description: 'Permanently deletes the account' },
      provenance: { source: 'hand-authored' },
    });
  });

  it('omits the metadata bag when no IR fields are provided', () => {
    render(
      <TransitionTo
        id="plain"
        name="Plain"
        fromStates={['a']}
        activateStates={['b']}
        exitStates={['a']}
      />
    );
    const registered = registry.getTransition('plain');
    expect(registered).toBeDefined();
    expect(registered?.metadata).toBeUndefined();
  });

  it('unregisters cleanly on unmount', () => {
    const { unmount } = render(
      <TransitionTo
        id="ephemeral-transition"
        name="Ephemeral"
        fromStates={['a']}
        activateStates={['b']}
        exitStates={['a']}
      />
    );
    expect(registry.getTransition('ephemeral-transition')).toBeDefined();

    unmount();

    expect(registry.getTransition('ephemeral-transition')).toBeUndefined();
  });
});
