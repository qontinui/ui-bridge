/**
 * `/design/style-guide/infer` and `/design/tokens/drift` answer with one model
 * over both transports.
 *
 * The server handlers (`createHandlers`, reading the registry directly) and the
 * relay handlers (`createRelayHandlers`, shipping the command to a tab running
 * `executeCommand`) both call `specs/style-inference-request.ts`. These tests
 * run both over ONE registry — the relay tab runs the real `executeCommand` —
 * and require the same envelope from each, failures included, plus the
 * round-trip of an inferred guide through `/design/style-guide/load`.
 *
 * jsdom's getComputedStyle returns declared values, so normalisation of real
 * Chrome serializations is pinned in `specs/__tests__/style-inference.test.ts`;
 * this file pins the transports.
 *
 * Plan: 2026-11-13-ui-bridge-infers-a-draft-style-guide-and-token-drift-from-computed-styles.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeCommand, type BridgeAccess } from './commandHandlers';
import { getGlobalRegistry, resetGlobalRegistry } from '../core/registry';
import { createHandlers, type RegistryLike } from '../server/handlers';
import { createRelayHandlers } from '../server/relay-handlers';
import { CommandRelay } from '../server/command-relay';
import { DefaultActionExecutor } from '../control/action-executor';
import type { APIResponse } from '../server/types';
import type { StyleInferenceResponse, TokenDriftResponse } from '../specs/style-inference-request';

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

function serverHandlers(): ReturnType<typeof createHandlers> {
  const registry = getGlobalRegistry();
  return createHandlers(
    registry as unknown as RegistryLike,
    new DefaultActionExecutor(registry) as never,
    { idleDetection: false }
  );
}

function relayHandlers(): ReturnType<typeof createRelayHandlers> {
  const relay = new CommandRelay({
    globalPrefix: `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`,
  });
  relay.subscribeToCommands((command) => {
    void executeCommand(
      command.action,
      command.payload as Record<string, unknown>,
      emptyBridge
    ).then(
      (result) => relay.resolveCommand(command.commandId, result, 'tab-a'),
      (err: unknown) => relay.rejectCommand(command.commandId, String(err))
    );
  }, 'tab-a');
  return createRelayHandlers(relay);
}

/** A response minus the per-run fields. */
function stable<T extends { timestamp: number; durationMs: number }>(
  r: T
): Omit<T, 'timestamp' | 'durationMs'> {
  const { timestamp: _t, durationMs: _d, ...rest } = r;
  return rest;
}

function failure(response: APIResponse<unknown>): Record<string, unknown> {
  return { success: response.success, error: response.error, code: response.code };
}

describe('style inference · relay and server answer with one model', () => {
  let container: HTMLDivElement;

  function register(id: string, style: string): HTMLElement {
    const el = document.createElement('div');
    el.setAttribute('style', style);
    el.textContent = id;
    container.appendChild(el);
    getGlobalRegistry().registerElement(id, el, { type: 'generic' });
    return el;
  }

  beforeEach(async () => {
    resetGlobalRegistry();
    // Neither transport's style guide may leak in from another test.
    await serverHandlers().clearStyleGuide();
    await relayHandlers().clearStyleGuide();
    container = document.createElement('div');
    document.body.appendChild(container);
    register(
      'a',
      'color: rgb(17, 17, 17); background-color: rgb(255, 255, 255); padding-top: 16px'
    );
    register('b', 'color: rgb(17, 17, 17); padding-top: 16px; margin-top: 8px');
    register('c', 'color: rgb(74, 144, 217); margin-top: 15px');
  });

  afterEach(() => {
    container.remove();
    resetGlobalRegistry();
  });

  it('inferStyleGuide: the same inventory and guide from both transports', async () => {
    const server = await serverHandlers().inferStyleGuide({});
    const relay = await relayHandlers().inferStyleGuide({});
    expect(server.success).toBe(true);
    expect(relay.success).toBe(true);
    const report = relay.data as StyleInferenceResponse;
    expect(stable(report)).toEqual(stable(server.data!));

    expect(report.status).toBe('ok');
    expect(report.capture).toMatchObject({
      scope: 'registered',
      elementsSampled: 3,
      elementCapReached: false,
    });
    expect(report.inventory.colors[0]).toMatchObject({
      name: 'color-1',
      value: '#111111',
      elementCount: 2,
    });
    expect(report.guide?.tokens.colors['color-1']).toBe('#111111');
    expect(report.guide?.tokens.spacing['space-1']).toBe('16px');
  });

  it('inferStyleGuide: elementIds and maxElements narrow the sample, and the cap is reported', async () => {
    const narrowed = await relayHandlers().inferStyleGuide({ elementIds: ['c'] });
    expect((narrowed.data as StyleInferenceResponse).capture.elementsSampled).toBe(1);
    const capped = await serverHandlers().inferStyleGuide({ maxElements: 2 });
    expect(capped.data?.capture).toMatchObject({
      elementsAvailable: 3,
      elementsSampled: 2,
      elementCapReached: true,
    });
  });

  it('inferStyleGuide: no registered element reads empty with a reason on both', async () => {
    const request = { elementIds: ['nope'] };
    const server = await serverHandlers().inferStyleGuide(request);
    const relay = await relayHandlers().inferStyleGuide(request);
    expect(server.data).toMatchObject({
      status: 'empty',
      reason: 'no elements were sampled',
      guide: null,
    });
    expect(server.data?.capture.notes).toContain('elementIds matched no registered element');
    expect(stable(relay.data as StyleInferenceResponse)).toEqual(stable(server.data!));
  });

  it('malformed bodies fail identically with UB-VALIDATION-ERROR', async () => {
    const bad: unknown[] = [
      'not-an-object',
      { scope: 'page' },
      { elementIds: 'a' },
      { maxElements: 0 },
      { limits: { colours: 3 } },
      { scope: 'document', elementIds: ['a'] },
    ];
    for (const request of bad) {
      const server = await serverHandlers().inferStyleGuide(request);
      const relay = await relayHandlers().inferStyleGuide(request);
      expect(server.success, JSON.stringify(request)).toBe(false);
      expect(server.code).toBe('UB-VALIDATION-ERROR');
      expect(failure(relay)).toEqual(failure(server));
    }
    const twoSources = { tokens: { colors: {} }, customProperties: { '--a': '#fff' } };
    const server = await serverHandlers().diffDesignTokens(twoSources);
    const relay = await relayHandlers().diffDesignTokens(twoSources);
    expect(server.code).toBe('UB-VALIDATION-ERROR');
    expect(server.error).toMatch(/exactly one declared token source/);
    expect(failure(relay)).toEqual(failure(server));
  });

  it('round-trip: an inferred guide loads through /design/style-guide/load unchanged', async () => {
    for (const handlers of [serverHandlers(), relayHandlers()]) {
      const inferred = await handlers.inferStyleGuide({ name: 'draft' });
      const guide = inferred.data!.guide!;
      expect((await handlers.loadStyleGuide({ guide })).success).toBe(true);
      const loaded = await handlers.getStyleGuide();
      // The server stores the guide; the relay stores the command payload `{ guide }`.
      const stored = (loaded.data as { guide?: unknown } | null)?.guide ?? loaded.data;
      expect(stored).toEqual(guide);
      await handlers.clearStyleGuide();
    }
  });

  it('diffDesignTokens: the same report from both, with near misses', async () => {
    const request = {
      tokens: {
        colors: { ink: '#111111', primary: '#4a90d9', paper: '#ffffff' },
        spacing: { sm: '8px', md: '16px' },
      },
    };
    const server = await serverHandlers().diffDesignTokens(request);
    const relay = await relayHandlers().diffDesignTokens(request);
    expect(server.success).toBe(true);
    const report = relay.data as TokenDriftResponse;
    expect(stable(report)).toEqual(stable(server.data!));
    expect(report.declaredSource).toBe('tokens');
    expect(report.verdict).toBe('drift');
    expect(report.undeclared).toEqual([
      expect.objectContaining({
        category: 'spacing',
        value: '15px',
        nearest: expect.objectContaining({ token: 'spacing.md', distance: 1 }),
        nearMiss: true,
      }),
    ]);
  });

  it('diffDesignTokens: falls back to the loaded style guide on both transports', async () => {
    for (const handlers of [serverHandlers(), relayHandlers()]) {
      const inferred = await handlers.inferStyleGuide({});
      await handlers.loadStyleGuide({ guide: inferred.data!.guide! });
      const drift = await handlers.diffDesignTokens({});
      expect(drift.success).toBe(true);
      expect(drift.data).toMatchObject({ declaredSource: 'loadedStyleGuide', verdict: 'no-drift' });
      await handlers.clearStyleGuide();
      const none = await handlers.diffDesignTokens({});
      expect(none.success).toBe(false);
      expect(none.code).toBe('UB-VALIDATION-ERROR');
      expect(none.error).toMatch(/no declared tokens/);
    }
  });

  it('diffDesignTokens: an empty capture is unknown, never no-drift', async () => {
    const request = { elementIds: ['nope'], tokens: { colors: { ink: '#111111' } } };
    const server = await serverHandlers().diffDesignTokens(request);
    const relay = await relayHandlers().diffDesignTokens(request);
    expect(server.data).toMatchObject({ verdict: 'unknown', reason: 'no elements were sampled' });
    expect(stable(relay.data as TokenDriftResponse)).toEqual(stable(server.data!));
  });

  it('diffDesignTokens: pageCustomPropertyPrefix reads the page :root custom properties', async () => {
    const style = document.createElement('style');
    style.textContent = ':root { --acme-ink: #111111; --acme-space-md: 16px; --other: #ff0000; }';
    document.head.appendChild(style);
    try {
      const request = { pageCustomPropertyPrefix: '--acme-' };
      const server = await serverHandlers().diffDesignTokens(request);
      const relay = await relayHandlers().diffDesignTokens(request);
      expect(server.success).toBe(true);
      expect(server.data?.declaredSource).toBe('pageCustomProperties');
      expect(server.data?.categories.colors).toMatchObject({
        status: 'compared',
        declared: 1,
        matched: 1,
      });
      expect(server.data?.unused.map((u) => u.token)).not.toContain('--other');
      expect(stable(relay.data as TokenDriftResponse)).toEqual(stable(server.data!));
    } finally {
      style.remove();
    }
  });
});
