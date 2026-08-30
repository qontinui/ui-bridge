/**
 * B2 — CLI-side wait actions for `ui-bridge-inject --exec`.
 *
 * Variant A ran its `--exec` steps back to back with nothing between them, and
 * the only wait available was the one-shot `--expect-selector` gate applied
 * ONCE before the first step. State that arrives after settle — a row fetched
 * by a request an earlier step kicked off — could not be awaited without
 * re-invoking the whole CLI (a fresh browser, a fresh page load, and the loss
 * of everything the earlier steps did).
 *
 * These tests pin the grammar and the dispatch wiring without launching a
 * browser: `registerWaitActions` is exercised against a real `HandlerRegistry`
 * with a stub `page`.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  parseWaitForSelectorPayload,
  parseSleepPayload,
  validateWaitActions,
  registerWaitActions,
  CLI_WAIT_ACTIONS,
  DEFAULT_WAIT_SELECTOR_TIMEOUT_MS,
  MAX_SLEEP_MS,
  InjectCliArgError,
  USAGE,
} from '../src/inject-cli.js';
import { HandlerRegistry } from '../src/handler-registry.js';

describe('waitForSelector payload grammar', () => {
  it('defaults timeoutMs to 10000 and state to attached', () => {
    expect(parseWaitForSelectorPayload({ selector: '#row' })).toEqual({
      selector: '#row',
      timeoutMs: DEFAULT_WAIT_SELECTOR_TIMEOUT_MS,
      state: 'attached',
    });
    expect(DEFAULT_WAIT_SELECTOR_TIMEOUT_MS).toBe(10_000);
  });

  it('accepts an explicit timeoutMs and state', () => {
    expect(
      parseWaitForSelectorPayload({ selector: '.late', timeoutMs: 15_000, state: 'visible' })
    ).toEqual({ selector: '.late', timeoutMs: 15_000, state: 'visible' });
  });

  it('rejects a missing / empty selector', () => {
    expect(() => parseWaitForSelectorPayload({})).toThrow(InjectCliArgError);
    expect(() => parseWaitForSelectorPayload({ selector: '   ' })).toThrow(InjectCliArgError);
    expect(() => parseWaitForSelectorPayload({ selector: 7 })).toThrow(InjectCliArgError);
  });

  it('rejects a non-numeric or negative timeoutMs', () => {
    expect(() => parseWaitForSelectorPayload({ selector: '#a', timeoutMs: '5s' })).toThrow(
      /timeoutMs/
    );
    expect(() => parseWaitForSelectorPayload({ selector: '#a', timeoutMs: -1 })).toThrow(
      /timeoutMs/
    );
  });

  it('rejects an unknown state', () => {
    expect(() => parseWaitForSelectorPayload({ selector: '#a', state: 'mounted' })).toThrow(
      /state/
    );
  });
});

describe('sleep payload grammar', () => {
  it('requires a numeric ms in range', () => {
    expect(parseSleepPayload({ ms: 250 })).toEqual({ ms: 250 });
    expect(parseSleepPayload({ ms: 0 })).toEqual({ ms: 0 });
    expect(() => parseSleepPayload({})).toThrow(InjectCliArgError);
    expect(() => parseSleepPayload({ ms: -5 })).toThrow(InjectCliArgError);
    expect(() => parseSleepPayload({ ms: MAX_SLEEP_MS + 1 })).toThrow(InjectCliArgError);
  });
});

describe('validateWaitActions — bad payloads fail BEFORE the browser launches', () => {
  it('passes a well-formed two-step run', () => {
    expect(() =>
      validateWaitActions([
        { action: 'waitForSelector', payload: { selector: '#row', timeoutMs: 15_000 } },
        { action: 'discover', payload: {} },
      ])
    ).not.toThrow();
  });

  it('throws on a malformed wait step', () => {
    expect(() =>
      validateWaitActions([
        { action: 'find', payload: {} },
        { action: 'waitForSelector', payload: { timeoutMs: 1 } },
      ])
    ).toThrow(InjectCliArgError);
  });

  it('ignores payloads of in-page actions it does not own', () => {
    expect(() =>
      validateWaitActions([{ action: 'executeElementAction', payload: { nonsense: true } }])
    ).not.toThrow();
  });
});

describe('registerWaitActions — dispatch wiring', () => {
  it('registers exactly the CLI-side wait ids', () => {
    const registry = new HandlerRegistry();
    registerWaitActions(registry);
    for (const id of CLI_WAIT_ACTIONS) expect(registry.has(id)).toBe(true);
  });

  it('waitForSelector delegates to the transport page handle and reports elapsedMs', async () => {
    const registry = new HandlerRegistry();
    registerWaitActions(registry);
    const waitForSelector = vi.fn().mockResolvedValue({});
    const result = await registry.dispatch(
      'waitForSelector',
      { selector: '[data-row="account"]', timeoutMs: 15_000 },
      { page: { waitForSelector } }
    );
    expect(waitForSelector).toHaveBeenCalledWith('[data-row="account"]', {
      state: 'attached',
      timeout: 15_000,
    });
    expect(result).toMatchObject({ waited: true, selector: '[data-row="account"]', state: 'attached' });
    expect(typeof (result as { elapsedMs: number }).elapsedMs).toBe('number');
  });

  it('a waitForSelector TIMEOUT surfaces as a thrown failure, not a silent pass', async () => {
    const registry = new HandlerRegistry();
    registerWaitActions(registry);
    const waitForSelector = vi.fn().mockRejectedValue(new Error('Timeout 10000ms exceeded.'));
    await expect(
      registry.dispatch('waitForSelector', { selector: '#never' }, { page: { waitForSelector } })
    ).rejects.toThrow(/Timeout/);
  });

  it('waitForSelector fails loudly when the context exposes no page handle', async () => {
    const registry = new HandlerRegistry();
    registerWaitActions(registry);
    await expect(registry.dispatch('waitForSelector', { selector: '#a' }, {})).rejects.toThrow(
      /page handle/
    );
  });

  it('sleep pauses for the requested duration and reports it', async () => {
    const registry = new HandlerRegistry();
    registerWaitActions(registry);
    const startedAt = Date.now();
    const result = await registry.dispatch('sleep', { ms: 30 }, {});
    expect(result).toEqual({ slept: 30 });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(25);
  });

  it('neither wait result trips the returned-failure predicate', async () => {
    const registry = new HandlerRegistry();
    registerWaitActions(registry);
    const slept = (await registry.dispatch('sleep', { ms: 0 }, {})) as Record<string, unknown>;
    expect('success' in slept).toBe(false);
  });
});

describe('USAGE documents the wait actions', () => {
  it('names both action ids and the two-step example', () => {
    expect(USAGE).toContain('waitForSelector');
    expect(USAGE).toContain('sleep {"ms":250}');
    expect(USAGE).toContain('late-arriving row');
  });
});
