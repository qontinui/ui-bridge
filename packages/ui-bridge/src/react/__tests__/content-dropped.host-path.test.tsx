/**
 * ARMING — plan 2026-11-02-text-over-image-contrast-cannot-see-what-the-snapshot-left-out,
 * Phase 1.
 *
 * Enters where the embedded population enters: qontinui-web
 * (`frontend/src/lib/ui-bridge/provider.tsx`) and qontinui-runner (`src/App.tsx`)
 * both mount the real `UIBridgeProvider` with an `AutoRegisterProvider` inside it,
 * configured as below (`maxContentElements: 200`). A page past that cap used to
 * serve a snapshot that looked whole; now its `registration.contentDropped` is the
 * exact number of registrable text elements that got no row.
 *
 * The snapshot is read the way a host reads it, through `useUIBridge()`'s
 * `createSnapshot`. Nothing here is mocked except layout (jsdom lays nothing out).
 */

import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { UIBridgeProvider } from '../UIBridgeProvider';
import { AutoRegisterProvider } from '../AutoRegisterProvider';
import { useUIBridge } from '../useUIBridge';
import { resetGlobalRegistry } from '../../core/registry';
import type { BridgeSnapshot } from '../../core/types';

beforeEach(() => {
  resetGlobalRegistry();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    top: 0,
    left: 0,
    right: 100,
    bottom: 20,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetGlobalRegistry();
});

let takeSnapshot: (() => BridgeSnapshot) | null = null;

function SnapshotProbe() {
  const bridge = useUIBridge();
  takeSnapshot = bridge.createSnapshot;
  return null;
}

/** 230 registrable paragraphs: 30 past the hosts' cap of 200. */
function LongPage() {
  return (
    <main>
      {Array.from({ length: 230 }, (_, i) => (
        <p key={i}>Paragraph number {i}</p>
      ))}
    </main>
  );
}

it('a host page past the 200-row content cap serves registration.contentDropped = 30', async () => {
  render(
    <UIBridgeProvider features={{ control: true }}>
      <AutoRegisterProvider
        enabled={true}
        idStrategy="prefer-existing"
        debounceMs={100}
        excludeSelectors={['[data-no-register]']}
        contentDiscovery={{ enabled: true, maxContentElements: 200 }}
      >
        <SnapshotProbe />
        <LongPage />
      </AutoRegisterProvider>
    </UIBridgeProvider>
  );
  // The hosts leave the content debounce at its 250 ms default.
  await act(() => new Promise((resolve) => setTimeout(resolve, 800)));

  const registration = takeSnapshot!().registration;
  const contentRows = takeSnapshot!().elements.filter((e) => e.category === 'content');
  expect(contentRows).toHaveLength(200);
  expect(registration.contentDropped).toBe(30);
}, 60_000);
