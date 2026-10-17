/**
 * ARMING — plan 2026-09-20-ui-bridge-represents-the-users-path-and-the-passage-of-time,
 * Phase 4 (relay executeWithDiff carries the interaction timeline).
 *
 * Enters where the injected runtime's population enters: the injected
 * bootstrap (the IIFE inject-cli adds to a page) and the
 * `window.__uiBridgeInjected.execute` it installs — the same function the
 * relay client is handed as its `execute`. Nothing here calls the relay
 * dispatcher directly.
 *
 * Before Phase 4 the relay `executeWithDiff` answered element COUNTS
 * (`diff: { before, after, timestamp }`) and no timeline at all; now it runs
 * the shared ChangeTracker and the timeline is on by default, its summary a
 * set of Observation envelopes.
 */

import { it, expect, afterEach, beforeEach } from 'vitest';
import { setGlobalRegistry, UIBridgeRegistry } from '../core/registry';

beforeEach(() => {
  delete window.__uiBridgeInjected;
  delete window.__uiBridgeInjectedConfig;
  document.body.innerHTML = '';
  const button = document.createElement('button');
  button.id = 'save';
  button.textContent = 'Save';
  // jsdom has no layout: give the button a box so the relay does not refuse the click.
  Object.defineProperty(button, 'offsetParent', { configurable: true, get: () => document.body });
  button.getBoundingClientRect = () =>
    ({ x: 0, y: 0, width: 80, height: 24, top: 0, left: 0, right: 80, bottom: 24 }) as DOMRect;
  document.body.appendChild(button);
});

afterEach(() => {
  delete window.__uiBridgeInjected;
  setGlobalRegistry(new UIBridgeRegistry());
  document.body.innerHTML = '';
});

it('injected execute("executeWithDiff") answers timeline.summary as Observations by default', async () => {
  // Running the bootstrap module installs the runtime on window.
  await import('./bootstrap');
  const api = window.__uiBridgeInjected!;
  expect(api).toBeDefined();
  expect(api.ready).toBe(true);

  const snapshot = (await api.execute('getControlSnapshot', {})) as {
    elements: Array<{ id: string; label?: string }>;
  };
  const save = snapshot.elements.find((e) => e.label === 'Save') ?? snapshot.elements[0];
  expect(save).toBeDefined();

  const result = (await api.execute('executeWithDiff', {
    elementAction: { elementId: save.id, action: 'click' },
    settleMinStable: 20,
    timelineInterval: 10,
  })) as {
    timeline?: { events: Array<{ type: string }>; summary: Record<string, unknown> };
  };

  expect(result.timeline).toBeDefined();
  const { summary, events } = result.timeline!;
  expect(events[0].type).toBe('action');
  for (const field of [
    'firstResponseMs',
    'settleMs',
    'layoutShiftTotal',
    'layoutShiftCount',
    'layoutShiftAfterFirstResponseMs',
    'animationsUnsettledAtEnd',
    'longTaskTotalMs',
  ]) {
    const obs = summary[field] as { status?: unknown; provenance?: unknown };
    expect(['measured', 'absent', 'unknown'], field).toContain(obs.status);
    expect(obs.provenance, field).toBeDefined();
  }
  // jsdom has no PerformanceObserver: could-not-look, never a measured 0.
  expect(summary.layoutShiftTotal).toMatchObject({
    status: 'unknown',
    unknown: { code: 'performance_observer_unsupported' },
  });
  expect(summary.expectedStates).toEqual([]);
}, 30_000);
