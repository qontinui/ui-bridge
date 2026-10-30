/**
 * useUIElement forwards `paintsText` to the registry, so a React-registered
 * canvas surface is swept like a directly registered one.
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

function Surface({ id, paintsText }: { id: string; paintsText?: boolean }) {
  const { ref } = useUIElement({ id, type: 'canvas', label: 'Chart', paintsText });
  return <div ref={ref} data-testid={id} />;
}

describe('useUIElement — paintsText', () => {
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

  it('forwards paintsText into the registered element and its state', () => {
    render(<Surface id="chart-revenue" paintsText />);
    const entry = registry.getElement('chart-revenue');
    expect(entry?.paintsText).toBe(true);
    expect(entry?.getState().paintsText).toBe(true);
  });

  it('leaves it off when the option is not passed', () => {
    render(<Surface id="chart-plain" />);
    const entry = registry.getElement('chart-plain');
    expect(entry?.paintsText).toBeUndefined();
    expect(entry?.getState().paintsText).toBeUndefined();
  });

  it('keeps the hook own stamp through unmount (it is not a registry-owned stamp)', () => {
    const { getByTestId, unmount } = render(<Surface id="chart-stamp" paintsText />);
    const node = getByTestId('chart-stamp');
    expect(node.getAttribute('data-ui-bridge-id')).toBe('chart-stamp');
    // The hook writes its stamp before registering, so the registry does not
    // record it as its own and does not take it back.
    registry.unregisterElement('chart-stamp');
    expect(node.getAttribute('data-ui-bridge-id')).toBe('chart-stamp');
    unmount();
  });
});
