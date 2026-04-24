/**
 * useAutoRegister Hook Tests
 *
 * Covers the auto-instrumentation hardening (Item 5):
 *
 * 1. Unwrapped interactive elements (button, input, a[href]) get
 *    `data-ui-bridge-id` stamped on the DOM so the SDK's attribute-poll
 *    fallback path can resolve them for bbox tracking.
 * 2. Each registration carries `origin: 'auto'` so snapshot consumers can
 *    distinguish scanner-discovered elements from explicit
 *    `useUIElement` hook registrations (which would be `origin: 'hook'`).
 * 3. Already-stamped attributes are not overwritten.
 * 4. Hidden inputs are excluded (the tightened selector).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { UIBridgeRegistry } from '../../core/registry';
import { useAutoRegister } from '../useAutoRegister';
import type { UIBridgeContextValue } from '../UIBridgeProvider';

// Build a minimal-but-realistic bridge context: the hook only needs
// `registry`, plus optional `relationshipTracker`/`dragDropDetector`
// that it guards with `?.`. We pass those as `undefined` so the no-op
// branches run.
function createMockBridge(registry: UIBridgeRegistry): UIBridgeContextValue {
  return {
    registry,
    // The guarded paths in useAutoRegister short-circuit when these are
    // absent — perfect for a focused scanner test.
    relationshipTracker: undefined,
    dragDropDetector: undefined,
  } as unknown as UIBridgeContextValue;
}

// Mock UIBridgeProvider so the hook picks up our registry without needing
// the full provider tree.
let mockBridge: UIBridgeContextValue | null = null;
vi.mock('../UIBridgeProvider', () => ({
  useUIBridgeOptional: () => mockBridge,
}));

function AutoRegisterHarness() {
  useAutoRegister({
    enabled: true,
    // debounceMs = 0 so pending registrations flush on the next timer tick.
    debounceMs: 0,
    // Allow hidden elements to show up in the scan — we still want the
    // selector to filter `input[type=hidden]`, so this is the strictest
    // possible test of selector behaviour.
    includeHidden: true,
    // Content/media discovery off — Item 5 is about interactive elements.
    contentDiscovery: { enabled: false },
    mediaDiscovery: { enabled: false },
  });
  return null;
}

describe('useAutoRegister — attribute stamping', () => {
  let registry: UIBridgeRegistry;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    mockBridge = createMockBridge(registry);
  });

  afterEach(() => {
    cleanup();
    mockBridge = null;
    document.body.innerHTML = '';
  });

  it('stamps data-ui-bridge-id on three unwrapped interactive elements', async () => {
    // Fixture: a button, a text input, a link — none wrapped with useUIElement.
    const fixture = document.createElement('div');
    fixture.innerHTML = `
      <button type="button">Save</button>
      <input type="text" placeholder="Name" />
      <a href="/home">Home</a>
    `;
    document.body.appendChild(fixture);

    render(<AutoRegisterHarness />);

    // debounceMs=0 flushes on the next tick.
    await new Promise((r) => setTimeout(r, 5));

    const button = fixture.querySelector('button')!;
    const input = fixture.querySelector('input')!;
    const link = fixture.querySelector('a')!;

    // Every interactive element got the fallback attribute.
    expect(button.getAttribute('data-ui-bridge-id')).toBeTruthy();
    expect(input.getAttribute('data-ui-bridge-id')).toBeTruthy();
    expect(link.getAttribute('data-ui-bridge-id')).toBeTruthy();

    // Three registrations landed in the registry.
    const elements = registry.getAllElements();
    expect(elements.length).toBeGreaterThanOrEqual(3);

    // All scanner-discovered elements are tagged origin='auto' so downstream
    // consumers can filter them out of hook-only snapshots.
    for (const el of elements) {
      expect(el.origin).toBe('auto');
    }
  });

  it('does not overwrite a pre-existing data-ui-bridge-id', async () => {
    const fixture = document.createElement('div');
    const btn = document.createElement('button');
    btn.textContent = 'Already tagged';
    btn.setAttribute('data-ui-bridge-id', 'caller-assigned-id');
    fixture.appendChild(btn);
    document.body.appendChild(fixture);

    render(<AutoRegisterHarness />);
    await new Promise((r) => setTimeout(r, 5));

    // Attribute survives — the scanner must never clobber a consumer-set id.
    expect(btn.getAttribute('data-ui-bridge-id')).toBe('caller-assigned-id');
  });

  it('excludes hidden inputs from auto-registration', async () => {
    const fixture = document.createElement('div');
    fixture.innerHTML = `
      <input type="hidden" name="csrf" value="abc123" />
      <input type="text" placeholder="visible" />
    `;
    document.body.appendChild(fixture);

    render(<AutoRegisterHarness />);
    await new Promise((r) => setTimeout(r, 5));

    const hidden = fixture.querySelector('input[type="hidden"]') as HTMLInputElement;
    const visible = fixture.querySelector('input[type="text"]') as HTMLInputElement;

    // Hidden inputs never appear in the snapshot — they have no
    // visual representation for a runner to grounding-click.
    expect(hidden.getAttribute('data-ui-bridge-id')).toBeNull();
    // Visible text input gets stamped as normal.
    expect(visible.getAttribute('data-ui-bridge-id')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// persistWhileMounted — logically-persistent elements bypass the visibility
// gate. Covers sidebar navigation items that live inside a collapsible group
// (opacity:0 / max-height:0 during the collapsed state) but must stay in the
// registry so UI Bridge clients can still discover and drive them.
// ---------------------------------------------------------------------------

// Harness variant that does NOT set includeHidden — so the visibility gate is
// active. The `persistWhileMounted` option is the only thing that should let
// an opacity-0 element through.
function PersistHarness({ persistWhileMounted }: { persistWhileMounted?: boolean }) {
  useAutoRegister({
    enabled: true,
    debounceMs: 0,
    contentDiscovery: { enabled: false },
    mediaDiscovery: { enabled: false },
    persistWhileMounted,
  });
  return null;
}

describe('useAutoRegister — persistWhileMounted', () => {
  let registry: UIBridgeRegistry;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    mockBridge = createMockBridge(registry);
  });

  afterEach(() => {
    cleanup();
    mockBridge = null;
    document.body.innerHTML = '';
  });

  it('registers opacity-0 elements when the hook option is set', async () => {
    // Element is styled exactly like the runner's NavGroup collapsed state:
    // opacity:0 + max-height:0. Without persistWhileMounted, isElementVisible
    // rejects it. With the flag, registration proceeds.
    const fixture = document.createElement('div');
    fixture.style.opacity = '0';
    fixture.style.maxHeight = '0';
    fixture.style.overflow = 'hidden';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Settings';
    fixture.appendChild(btn);
    document.body.appendChild(fixture);

    render(<PersistHarness persistWhileMounted />);
    await new Promise((r) => setTimeout(r, 5));

    expect(btn.getAttribute('data-ui-bridge-id')).toBeTruthy();
    expect(registry.getAllElements().length).toBeGreaterThanOrEqual(1);
  });

  it('registers individual opacity-0 elements carrying data-ui-bridge-persist', async () => {
    // Per-element opt-in: global flag stays off, but a single element marks
    // itself persistent. The other opacity-0 sibling still gets rejected.
    const fixture = document.createElement('div');
    fixture.style.opacity = '0';
    const persistent = document.createElement('button');
    persistent.type = 'button';
    persistent.textContent = 'Keep me';
    persistent.setAttribute('data-ui-bridge-persist', 'true');
    const skipped = document.createElement('button');
    skipped.type = 'button';
    skipped.textContent = 'Skip me';
    fixture.appendChild(persistent);
    fixture.appendChild(skipped);
    document.body.appendChild(fixture);

    render(<PersistHarness />);
    await new Promise((r) => setTimeout(r, 5));

    expect(persistent.getAttribute('data-ui-bridge-id')).toBeTruthy();
    expect(skipped.getAttribute('data-ui-bridge-id')).toBeNull();
  });

  it('keeps legacy behavior when the flag is off and element is not marked', async () => {
    // Baseline: opacity-0 element with no persist marker stays out of the
    // registry when the hook option is default-off. Protects the current
    // behavior consumers rely on.
    const fixture = document.createElement('div');
    fixture.style.opacity = '0';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Should skip';
    fixture.appendChild(btn);
    document.body.appendChild(fixture);

    render(<PersistHarness />);
    await new Promise((r) => setTimeout(r, 5));

    expect(btn.getAttribute('data-ui-bridge-id')).toBeNull();
    expect(registry.getAllElements().length).toBe(0);
  });
});
