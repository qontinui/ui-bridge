/**
 * The registry's discovery-rescan hook (plan
 * 2026-10-22-ui-bridge-hover-forces-the-css-hover-state, Phase 5a): a forced
 * hover asks the registry to run its installed discovery rescanners, so a
 * control the hover's CSS revealed is registered and can be reported and
 * clicked. The hook is the registry's own, so it answers only that registry.
 */

import { describe, it, expect } from 'vitest';
import { UIBridgeRegistry } from './registry';

describe('UIBridgeRegistry discovery rescan', () => {
  it('with no rescanner installed resolves { rescanners: 0 } at once', async () => {
    const registry = new UIBridgeRegistry();
    await expect(registry.requestDiscoveryRescan()).resolves.toEqual({ rescanners: 0 });
  });

  it('runs every installed rescanner synchronously, before the promise resolves', async () => {
    const registry = new UIBridgeRegistry();
    const ran: string[] = [];
    registry.addDiscoveryRescanner(() => ran.push('a'));
    registry.addDiscoveryRescanner(() => ran.push('b'));
    const pending = registry.requestDiscoveryRescan();
    // Synchronous: no frame, no timer, no microtask needed.
    expect(ran).toEqual(['a', 'b']);
    await expect(pending).resolves.toEqual({ rescanners: 2 });
  });

  it('the same function installed twice is two installs, each with its own uninstall', async () => {
    const registry = new UIBridgeRegistry();
    let runs = 0;
    const fn = (): void => {
      runs += 1;
    };
    const first = registry.addDiscoveryRescanner(fn);
    registry.addDiscoveryRescanner(fn);
    await expect(registry.requestDiscoveryRescan()).resolves.toEqual({ rescanners: 2 });
    expect(runs).toBe(2);
    first();
    first(); // idempotent
    await expect(registry.requestDiscoveryRescan()).resolves.toEqual({ rescanners: 1 });
    expect(runs).toBe(3);
  });

  it('survives clear(), which a route change and an auth re-scan both call', async () => {
    const registry = new UIBridgeRegistry();
    let runs = 0;
    registry.addDiscoveryRescanner(() => {
      runs += 1;
    });
    registry.clear();
    await expect(registry.requestDiscoveryRescan()).resolves.toEqual({ rescanners: 1 });
    expect(runs).toBe(1);
  });

  it('is per instance: one registry never runs another one`s rescanners', async () => {
    const a = new UIBridgeRegistry();
    const b = new UIBridgeRegistry();
    let ranA = 0;
    a.addDiscoveryRescanner(() => {
      ranA += 1;
    });
    await expect(b.requestDiscoveryRescan()).resolves.toEqual({ rescanners: 0 });
    expect(ranA).toBe(0);
  });

  it('a throwing rescanner does not stop the others, and the promise rejects with its error', async () => {
    const registry = new UIBridgeRegistry();
    const ran: string[] = [];
    registry.addDiscoveryRescanner(() => {
      throw new Error('first blew up');
    });
    registry.addDiscoveryRescanner(() => ran.push('second'));
    await expect(registry.requestDiscoveryRescan()).rejects.toThrow('first blew up');
    expect(ran).toEqual(['second']);
  });

  it('a rescanner that uninstalls itself mid-run does not disturb this run', async () => {
    const registry = new UIBridgeRegistry();
    const ran: string[] = [];
    const uninstall = registry.addDiscoveryRescanner(() => {
      ran.push('self');
      uninstall();
    });
    registry.addDiscoveryRescanner(() => ran.push('other'));
    await expect(registry.requestDiscoveryRescan()).resolves.toEqual({ rescanners: 2 });
    expect(ran).toEqual(['self', 'other']);
    await expect(registry.requestDiscoveryRescan()).resolves.toEqual({ rescanners: 1 });
  });
});
