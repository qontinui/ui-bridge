/**
 * useUIElement — slot-keyed id ownership on unmount.
 *
 * Consumers routinely key `id` on a *slot* rather than on a component instance
 * (`panel-<zoneIndex>`, `terminal-<thing>-<zoneIndex>`). The registry is
 * last-write-wins, so across a re-layout two components legitimately hold the
 * same id in sequence:
 *
 *   A mounts as zone 1  → registry[X] = nodeA
 *   layout shifts, B mounts as zone 1 → registry[X] = nodeB   (overwrite)
 *   A unmounts          → cleanup unregisters X
 *
 * If that last step deletes unconditionally it removes the entry **B owns**.
 * B stays live in the DOM with no registry entry, permanently — nothing
 * re-registers it, so the element is unreachable for the rest of the session.
 *
 * The unmount path must therefore only remove the entry it still owns.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { UIBridgeRegistry } from '../../core/registry';
import { useUIElement } from '../useUIElement';
import type { UIBridgeContextValue } from '../UIBridgeProvider';

let mockBridge: UIBridgeContextValue | null = null;
vi.mock('../UIBridgeProvider', () => ({
  useUIBridgeOptional: () => mockBridge,
}));

function Slot({ id, text }: { id: string; text: string }) {
  const { ref } = useUIElement({ id, type: 'button', label: text });
  return (
    <button ref={ref} data-text={text}>
      {text}
    </button>
  );
}

describe('useUIElement — slot-keyed id ownership', () => {
  let registry: UIBridgeRegistry;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    mockBridge = { registry } as unknown as UIBridgeContextValue;
  });

  afterEach(() => {
    cleanup();
    mockBridge = null;
    document.body.innerHTML = '';
  });

  it('keeps B registered when A unmounts after B took the same id', () => {
    // A owns "zone-1".
    const a = render(<Slot id="zone-1" text="A" />);
    const nodeA = a.getByText('A');
    expect(registry.getElement('zone-1')?.element).toBe(nodeA);

    // Layout shifts: B mounts into the same slot and overwrites the entry.
    const b = render(<Slot id="zone-1" text="B" />);
    const nodeB = b.getByText('B');
    expect(registry.getElement('zone-1')?.element).toBe(nodeB);

    // A unmounts last. Its cleanup must not delete the entry B now owns.
    a.unmount();

    const entry = registry.getElement('zone-1');
    expect(entry).toBeDefined();
    expect(entry?.element).toBe(nodeB);
    expect(entry?.mounted).toBe(true);
    expect(nodeB.isConnected).toBe(true);
  });

  it('still unregisters the entry it owns on an ordinary unmount', () => {
    const a = render(<Slot id="zone-2" text="A" />);
    expect(registry.getElement('zone-2')).toBeDefined();

    a.unmount();

    expect(registry.getElement('zone-2')).toBeUndefined();
  });

  it('leaves B registered even when A unmounts last out of three owners', () => {
    const a = render(<Slot id="zone-3" text="A" />);
    const b = render(<Slot id="zone-3" text="B" />);
    const c = render(<Slot id="zone-3" text="C" />);
    const nodeC = c.getByText('C');

    // Unmount in a different order than they mounted — only the last writer
    // owns the entry, so neither of the earlier owners may remove it.
    b.unmount();
    expect(registry.getElement('zone-3')?.element).toBe(nodeC);

    a.unmount();
    expect(registry.getElement('zone-3')?.element).toBe(nodeC);

    // The real owner still cleans up after itself.
    c.unmount();
    expect(registry.getElement('zone-3')).toBeUndefined();
  });
});
