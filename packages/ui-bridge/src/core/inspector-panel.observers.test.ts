/**
 * The package's DOM observers ignore the debug inspector's own panel-root
 * `pointer-events` toggle — plan `2026-11-23-ui-bridge-element-state-collapse-follow-ups`,
 * D3 review rounds 1 and 2.
 *
 * `readInspectorState` sets every panel root to `pointer-events: none` around
 * its state read and restores it, so each read writes that root's `style`
 * attribute twice. Every observer below would read those writes as page
 * activity (un-settling the page, scheduling a re-seed, re-scanning the panel,
 * logging a change, resolving a wait). Each is driven by the REAL
 * `readInspectorState`, and each has a control case: a `style` change on an
 * ordinary element is still seen.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import { DOMSettlingDetector } from '../idle/dom-settling';
import { waitForElementStable } from '../idle/element-settling';
import { observeAndSeed } from '../injected/seed-registry';
import { DOMChangeObserver } from '../render-log/dom-capture';
import { ChangeTracker, type ChangeTrackerDeps } from '../ai/change-tracker';
import type { SemanticSnapshotManager } from '../ai/semantic-snapshot';
import type { ControlSnapshot } from '../control/types';
import { executeCommand } from '../react/commandHandlers';
import { bridgeAccessOver } from '../injected/bridge-access';
import { readInspectorState } from '../debug/inspector';
import { UIBridgeRegistry } from './registry';
import { INSPECTOR_PANEL_ATTR, isInspectorPanelRecord } from './inspector-panel';

// useAutoRegister reads its bridge from the provider; hand it a bare registry.
let mockBridge: unknown = null;
vi.mock('../react/UIBridgeProvider', () => ({
  useUIBridgeOptional: () => mockBridge,
}));
const { useAutoRegister } = await import('../react/useAutoRegister');

/** Let MutationObserver callbacks (microtasks) and short timers run. */
function flush(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `body` on a fake clock (timers and Date), so a debounce or a timeout is
 * advanced explicitly rather than waited out in wall-clock time.
 */
async function onFakeClock<T>(body: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  try {
    return await body();
  } finally {
    vi.useRealTimers();
  }
}

/** Deliver pending MutationObserver records (a microtask) without moving the clock. */
async function deliverRecords(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await Promise.resolve();
}

let panel: HTMLElement;
let other: HTMLElement;

/** One real inspector read of an element outside the panel: toggles the panel root. */
function inspectorRead(): void {
  readInspectorState(other);
}

/** The panel re-rendering its own content (a live Bounds readout, say). */
function panelTextChange(): void {
  (panel.firstElementChild as HTMLElement).textContent = `x ${Date.now()}`;
}

/** The control: an ordinary style change on a page element. */
function pageStyleChange(): void {
  other.style.setProperty('color', other.style.color === 'red' ? 'blue' : 'red');
}

beforeEach(() => {
  document.body.innerHTML = '';
  panel = document.createElement('div');
  panel.setAttribute(INSPECTOR_PANEL_ATTR, '');
  panel.innerHTML = '<button type="button">x</button>';
  other = document.createElement('div');
  other.innerHTML = '<button type="button">page</button>';
  document.body.append(panel, other);
});

afterEach(() => {
  cleanup();
  mockBridge = null;
  document.body.innerHTML = '';
});

describe('isInspectorPanelRecord', () => {
  it('matches every record of the panel own DOM, and nothing outside it', async () => {
    const seen: MutationRecord[] = [];
    const observer = new MutationObserver((records) => seen.push(...records));
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    inspectorRead(); // two style records on the panel root
    panel.setAttribute('title', 't'); // another attribute on the root
    (panel.firstElementChild as HTMLElement).style.color = 'red'; // inside
    (panel.firstElementChild!.firstChild as Text).data = 'y'; // text inside
    panel.appendChild(document.createElement('span')); // child list of the root
    pageStyleChange(); // outside
    await flush();
    observer.disconnect();
    expect(seen.map(isInspectorPanelRecord)).toEqual([true, true, true, true, true, true, false]);
  });
});

describe('DOMSettlingDetector', () => {
  // Fake clock: the 50 ms settle window never elapses, so `isIdle()` answers
  // only whether the change was counted as a mutation.
  async function idleAfter(change: () => void): Promise<boolean> {
    return onFakeClock(async () => {
      const detector = new DOMSettlingDetector({ root: document.body, settleMs: 50 });
      detector.install();
      try {
        change();
        await deliverRecords();
        return detector.isIdle();
      } finally {
        detector.destroy();
      }
    });
  }
  it('an inspector read leaves the page settled', async () => {
    expect(await idleAfter(inspectorRead)).toBe(true);
  });
  it('an in-panel text change leaves the page settled', async () => {
    expect(await idleAfter(panelTextChange)).toBe(true);
  });
  it('a style change on another element still un-settles the page', async () => {
    expect(await idleAfter(pageStyleChange)).toBe(false);
  });
});

describe('waitForElementStable', () => {
  // Fake clock, timers and frames: the quiet window is 100 ms, the change lands
  // at 50 ms, and the question is whether the wait has resolved at 110 ms —
  // which it has only if the change did NOT reset the quiet clock.
  async function settledByQuietDeadline(change: () => void): Promise<boolean> {
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'Date',
        'requestAnimationFrame',
        'cancelAnimationFrame',
      ],
    });
    try {
      let settled = false;
      const pending = waitForElementStable(document.body, {
        quietMs: 100,
        timeout: 10_000,
        observeSubtree: true,
      }).then((result) => {
        settled = result.stable;
      });
      await vi.advanceTimersByTimeAsync(50);
      change();
      // MutationObserver records are delivered as a microtask.
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(60);
      const answer = settled;
      await vi.advanceTimersByTimeAsync(500);
      await pending;
      return answer;
    } finally {
      vi.useRealTimers();
    }
  }
  it('an inspector read does not reset the quiet clock', async () => {
    expect(await settledByQuietDeadline(inspectorRead)).toBe(true);
  });
  it('a style change on another element still resets it', async () => {
    expect(await settledByQuietDeadline(pageStyleChange)).toBe(false);
  });
});

describe('observeAndSeed', () => {
  // Fake clock: the 5 ms re-seed debounce is advanced past explicitly.
  async function seedsAfter(change: () => void): Promise<number> {
    return onFakeClock(async () => {
      let seeds = 0;
      const stop = observeAndSeed(new UIBridgeRegistry(), document.body, {
        debounceMs: 5,
        onSeed: () => seeds++,
      });
      try {
        change();
        await deliverRecords();
        await vi.advanceTimersByTimeAsync(20);
        return seeds;
      } finally {
        stop();
      }
    });
  }
  it('an inspector read schedules no re-seed', async () => {
    expect(await seedsAfter(inspectorRead)).toBe(1); // the initial pass only
  });
  it('a style change on another element still schedules a re-seed', async () => {
    expect(await seedsAfter(pageStyleChange)).toBe(2);
  });
});

describe('useAutoRegister', () => {
  function Harness() {
    useAutoRegister({
      enabled: true,
      debounceMs: 0,
      includeHidden: true,
      contentDiscovery: { enabled: false },
      mediaDiscovery: { enabled: false },
    });
    return null;
  }
  async function rescannedAfter(target: HTMLElement, change: () => void): Promise<boolean> {
    mockBridge = { registry: new UIBridgeRegistry() };
    render(createElement(Harness));
    await flush();
    // The attribute branch re-scans the changed element's subtree.
    const spy = vi.spyOn(target, 'querySelectorAll');
    change();
    await flush();
    const rescanned = spy.mock.calls.length > 0;
    spy.mockRestore();
    return rescanned;
  }
  it('an inspector read does not re-scan the panel subtree', async () => {
    expect(await rescannedAfter(panel, inspectorRead)).toBe(false);
  });
  it('a style change on another element still re-scans its subtree', async () => {
    expect(await rescannedAfter(other, pageStyleChange)).toBe(true);
  });
});

describe('DOMChangeObserver (render log)', () => {
  async function changesAfter(change: () => void): Promise<number> {
    const observer = new DOMChangeObserver();
    observer.start(document.body);
    try {
      change();
      await flush();
      return observer.getChanges().length;
    } finally {
      observer.stop();
    }
  }
  it('an inspector read logs no change', async () => {
    expect(await changesAfter(inspectorRead)).toBe(0);
  });
  it('an in-panel text change logs no change', async () => {
    expect(await changesAfter(panelTextChange)).toBe(0);
  });
  it('a style change on another element is still logged', async () => {
    expect(await changesAfter(pageStyleChange)).toBeGreaterThan(0);
  });
});

describe('ChangeTracker DOM mutation buffer', () => {
  function deps(): ChangeTrackerDeps {
    return {
      snapshotManager: { createSnapshot: vi.fn() } as unknown as SemanticSnapshotManager,
      idleDetector: null,
      createControlSnapshot: vi.fn().mockReturnValue({} as ControlSnapshot),
      executeNLAction: vi.fn().mockResolvedValue({ success: true }),
      executeElementAction: vi.fn().mockResolvedValue({ success: true }),
      refreshElements: vi.fn(),
    };
  }
  async function bufferedAfter(change: () => void): Promise<number> {
    const tracker = new ChangeTracker(deps());
    await tracker.enableBuffer();
    try {
      change();
      await flush();
      return tracker.drainBuffer().dom.length;
    } finally {
      tracker.disableBuffer();
    }
  }
  it('an inspector read buffers no DOM mutation', async () => {
    expect(await bufferedAfter(inspectorRead)).toBe(0);
  });
  it('a style change on another element is still buffered', async () => {
    expect(await bufferedAfter(pageStyleChange)).toBeGreaterThan(0);
  });
});

describe('commandHandlers change buffer and waitForChange', () => {
  const run = (action: string, payload: Record<string, unknown> = {}) =>
    executeCommand(action, payload, bridgeAccessOver(new UIBridgeRegistry()));
  async function drainedAfter(change: () => void): Promise<number> {
    await run('enableChangeBuffer');
    await run('drainChangeBuffer');
    try {
      change();
      await flush();
      const drained = (await run('drainChangeBuffer')) as { count: number };
      return drained.count;
    } finally {
      await run('disableChangeBuffer');
    }
  }
  it('an inspector read adds nothing to the change buffer', async () => {
    expect(await drainedAfter(inspectorRead)).toBe(0);
  });
  it('a style change on another element is still buffered', async () => {
    expect(await drainedAfter(pageStyleChange)).toBeGreaterThan(0);
  });

  // Fake clock: the 80 ms wait times out only when the clock is advanced.
  async function waitAfter(change: () => void): Promise<boolean> {
    return onFakeClock(async () => {
      const pending = run('waitForChange', { timeout: 80 }) as Promise<{
        changed: boolean;
      }>;
      await deliverRecords();
      change();
      await deliverRecords();
      await vi.advanceTimersByTimeAsync(100);
      return (await pending).changed;
    });
  }
  it('an inspector read does not resolve waitForChange', async () => {
    expect(await waitAfter(inspectorRead)).toBe(false);
  });
  it('a style change on another element resolves waitForChange', async () => {
    expect(await waitAfter(pageStyleChange)).toBe(true);
  });
});
