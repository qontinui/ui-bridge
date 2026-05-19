/**
 * Phase 3 — Diagnostic discipline: sync `action-executor` failure paths
 * populate `failureDetails` with rendered recovery templates + typed-reason
 * discriminators.
 *
 * Plan: 2026-05-18-ui-bridge-diagnostic-discipline-plan.md §8 (Phase 3).
 *
 * Asserts that every sync `success: false` return from `executeAction`
 * carries a populated `failureDetails` (canonical `UiBridgeErrorCode` +
 * non-empty `suggestedActions[]` + the relevant discriminator), and that
 * `${...}` placeholders in the catalog templates are context-rendered.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from './action-executor';
import {
  UI_BRIDGE_ERROR_CODES,
  DIAGNOSTICS,
  getRecoverySuggestions,
} from '../diagnostics';

const VALID_CODES = new Set<string>(UI_BRIDGE_ERROR_CODES);

function expectValidFailureDetails(details: unknown): void {
  expect(details, 'failureDetails must be populated on failure').toBeDefined();
  const d = details as {
    errorCode: string;
    message: string;
    suggestedActions: { suggestion: string; command?: string }[];
    retryRecommended: boolean;
  };
  expect(VALID_CODES.has(d.errorCode)).toBe(true);
  expect(typeof d.message).toBe('string');
  expect(d.message.length).toBeGreaterThan(0);
  expect(Array.isArray(d.suggestedActions)).toBe(true);
  expect(d.suggestedActions.length).toBeGreaterThan(0);
  expect(typeof d.retryRecommended).toBe('boolean');
}

describe('Phase 3 — sync executeAction failure paths populate failureDetails', () => {
  let registry: UIBridgeRegistry;
  let executor: DefaultActionExecutor;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    executor = new DefaultActionExecutor(registry);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('element-not-found: UB-ELEM-NOT-FOUND with ${elementId} rendered into suggestions', async () => {
    const res = await executor.executeAction('ghost-element', { action: 'click' });
    expect(res.success).toBe(false);
    expect(typeof res.error).toBe('string'); // prose retained (goal #3)
    expectValidFailureDetails(res.failureDetails);
    expect(res.failureDetails?.errorCode).toBe('UB-ELEM-NOT-FOUND');

    // The catalog template for UB-ELEM-NOT-FOUND contains `${elementId}`
    // placeholders; the rendered suggestions must contain the literal id and
    // NOT the raw placeholder.
    const joined = res
      .failureDetails!.suggestedActions.map((s) => s.suggestion)
      .join(' | ');
    expect(joined).toContain('ghost-element');
    expect(joined).not.toContain('${elementId}');
  });

  it('unsupported-action: UB-UNSUPPORTED-ACTION populated', async () => {
    const btn = document.createElement('button');
    container.appendChild(btn);
    registry.registerElement('b1', btn, { type: 'button', label: 'B' });

    const res = await executor.executeAction('b1', {
      action: 'no-such-verb',
    });
    expect(res.success).toBe(false);
    expectValidFailureDetails(res.failureDetails);
    expect(res.failureDetails?.errorCode).toBe('UB-UNSUPPORTED-ACTION');
  });

  it('stale element (was registered, now detached): UB-STALE-ELEMENT with staleReason', async () => {
    const btn = document.createElement('button');
    container.appendChild(btn);
    registry.registerElement('stale-1', btn, { type: 'button', label: 'S' });
    // Detach the node after registration — re-find should fail.
    container.removeChild(btn);

    const res = await executor.executeAction('stale-1', { action: 'click' });
    expect(res.success).toBe(false);
    expectValidFailureDetails(res.failureDetails);
    expect(res.failureDetails?.errorCode).toBe('UB-STALE-ELEMENT');
    expect(res.failureDetails?.staleReason).toBe('unmounted');
  });

  it('disabled element (native): UB-ELEM-DISABLED with disabledReason=native', async () => {
    const btn = document.createElement('button');
    btn.disabled = true;
    container.appendChild(btn);
    registry.registerElement('disabled-1', btn, { type: 'button', label: 'D' });

    const res = await executor.executeAction('disabled-1', { action: 'click' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/disabled/i);
    expectValidFailureDetails(res.failureDetails);
    expect(res.failureDetails?.errorCode).toBe('UB-ELEM-DISABLED');
    expect(res.failureDetails?.disabledReason).toBe('native');
  });

  it('disabled element (aria-only): disabledReason=aria (native > aria > pointer-none precedence)', async () => {
    const div = document.createElement('div');
    div.setAttribute('role', 'button');
    div.setAttribute('aria-disabled', 'true');
    container.appendChild(div);
    registry.registerElement('aria-d', div, { type: 'button', label: 'A' });

    const res = await executor.executeAction('aria-d', { action: 'click' });
    expect(res.success).toBe(false);
    expectValidFailureDetails(res.failureDetails);
    expect(res.failureDetails?.errorCode).toBe('UB-ELEM-DISABLED');
    expect(res.failureDetails?.disabledReason).toBe('aria');
  });

  it('hidden element (display:none): UB-ELEM-NOT-VISIBLE; top recovery is the canonical scroll/reveal command', async () => {
    const btn = document.createElement('button');
    btn.style.display = 'none';
    container.appendChild(btn);
    registry.registerElement('hidden-1', btn, { type: 'button', label: 'H' });

    const res = await executor.executeAction('hidden-1', { action: 'click' });
    expect(res.success).toBe(false);
    expectValidFailureDetails(res.failureDetails);
    expect(res.failureDetails?.errorCode).toBe('UB-ELEM-NOT-VISIBLE');
    expect(res.failureDetails?.visibilityReason).toBe('hidden');

    // The plan expects the top suggestion to be the scroll/reveal one. Assert
    // the actual canonical command from codes.json for UB-ELEM-NOT-VISIBLE
    // rather than hard-coding a guessed string. (priority 1 entry).
    const catalogTop = [...DIAGNOSTICS['UB-ELEM-NOT-VISIBLE'].recoveryTemplate]
      .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))[0];
    expect(catalogTop.command).toBe('scroll to element'); // canonical command

    const sug = res.failureDetails!.suggestedActions;
    const topByConfidence = [...sug].sort(
      (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)
    )[0];
    expect(topByConfidence.command).toBe('scroll to element');
    // Rendered: contains the element id, not the raw placeholder.
    expect(topByConfidence.suggestion).toContain('hidden-1');
    expect(topByConfidence.suggestion).not.toContain('${elementId}');
  });

  it('wait/timeout: UB-ACTION-TIMEOUT with waitCondition + waitTimedOutAfterMs and ${waitDurationMs} rendered', async () => {
    const btn = document.createElement('button');
    btn.style.display = 'none'; // never becomes visible -> wait times out
    container.appendChild(btn);
    registry.registerElement('wait-1', btn, { type: 'button', label: 'W' });

    const res = await executor.executeAction('wait-1', {
      action: 'focus',
      waitOptions: { visible: true, timeout: 60, interval: 10 },
    });
    expect(res.success).toBe(false);
    expectValidFailureDetails(res.failureDetails);
    expect(res.failureDetails?.errorCode).toBe('UB-ACTION-TIMEOUT');
    expect(res.failureDetails?.waitCondition).toBe('visible');
    expect(typeof res.failureDetails?.waitTimedOutAfterMs).toBe('number');
    expect(res.failureDetails?.timeoutType).toBe('computation');

    const joined = res
      .failureDetails!.suggestedActions.map((s) => s.suggestion)
      .join(' | ');
    // ${waitDurationMs} / ${waitCondition} substituted (no raw placeholders).
    expect(joined).not.toContain('${waitDurationMs}');
    expect(joined).not.toContain('${waitCondition}');
    expect(joined).toContain('visible'); // waitCondition rendered
  });

  it('successful action omits failureDetails', async () => {
    const btn = document.createElement('button');
    container.appendChild(btn);
    registry.registerElement('ok-1', btn, { type: 'button', label: 'OK' });
    const res = await executor.executeAction('ok-1', { action: 'click' });
    expect(res.success).toBe(true);
    expect(res.failureDetails).toBeUndefined();
  });
});

describe('Phase 3 — recovery template context rendering', () => {
  it('substitutes any ${key} from the context map; leaves unknown placeholders verbatim', () => {
    const rendered = getRecoverySuggestions('UB-ELEM-NOT-FOUND', {
      elementId: 'submit-btn',
    });
    const joined = rendered.map((r) => r.suggestion).join(' | ');
    expect(joined).toContain('submit-btn');
    expect(joined).not.toContain('${elementId}');
  });

  it('without a context map returns the static template (placeholders intact)', () => {
    const raw = getRecoverySuggestions('UB-ELEM-NOT-FOUND');
    const joined = raw.map((r) => r.suggestion).join(' | ');
    // The catalog template still carries the raw placeholder.
    expect(joined).toContain('${elementId}');
  });

  it('unknown placeholder is left untouched (nothing logged)', () => {
    const rendered = getRecoverySuggestions('UB-ACTION-TIMEOUT', {
      waitDurationMs: 1234,
      // waitCondition intentionally omitted -> placeholder must survive
    });
    const joined = rendered.map((r) => r.suggestion).join(' | ');
    expect(joined).toContain('1234');
    expect(joined).toContain('${waitCondition}');
  });
});
