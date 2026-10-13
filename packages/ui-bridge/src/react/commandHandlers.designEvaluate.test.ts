/**
 * `/design/evaluate*` answers with one model over both transports.
 *
 * Two handler sets serve `/design/evaluate`, `/design/evaluate/contexts`,
 * `/design/evaluate/baseline` and `/design/evaluate/diff`: the server handlers
 * (`createHandlers`, reading the registry directly) and the relay handlers
 * (`createRelayHandlers`, which ship the command to a browser tab running
 * `executeCommand`). Until plan 2026-10-13-image-generation-and-visual-judgment
 * Phase 6 the relay answered with a different model: a label/action coverage
 * score with no metrics, a context list the evaluator rejects (`elements`,
 * `design`), and a "diff" that only counted elements, so every diff through it
 * read as "no changes". Which transport reached the page decided which model
 * the caller got (`domain_spec/ui-bridge` behaviour (7)).
 *
 * These tests run both handler sets over ONE registry — the relay tab here runs
 * the real `executeCommand` — and require the same envelope from each.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeCommand, type BridgeAccess } from './commandHandlers';
import { getGlobalRegistry, resetGlobalRegistry } from '../core/registry';
import type { ElementType } from '../core/types';
import { createHandlers, type RegistryLike } from '../server/handlers';
import { createRelayHandlers } from '../server/relay-handlers';
import { CommandRelay } from '../server/command-relay';
import { DefaultActionExecutor } from '../control/action-executor';
import { listContexts } from '../specs/quality-contexts';
import type {
  QualityContext,
  QualityEvaluationReport,
  SnapshotDiffReport,
} from '../specs/quality-types';
import type { StyleGuideConfig } from '../specs/style-types';
import type { APIResponse } from '../server/types';

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

const VIEWPORT = { width: 1280, height: 800 };

function serverHandlers(): ReturnType<typeof createHandlers> {
  const registry = getGlobalRegistry();
  // No idle detector: its debounced DOM scans would outlive this file's jsdom.
  return createHandlers(
    registry as unknown as RegistryLike,
    new DefaultActionExecutor(registry) as never,
    { idleDetection: false }
  );
}

/** Relay handlers whose one tab answers every command with the real in-page dispatcher. */
function relayHandlers(): ReturnType<typeof createRelayHandlers> {
  // Own globalThis-key prefix: CommandRelay persists state on globalThis.
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

/** A report minus the two per-run fields: when it ran and how long it took. */
function stable(
  report: QualityEvaluationReport
): Omit<QualityEvaluationReport, 'timestamp' | 'durationMs'> {
  const { timestamp: _timestamp, durationMs: _durationMs, ...rest } = report;
  return rest;
}

/** The parts of a failure envelope a caller branches on. */
function failure(response: APIResponse<unknown>): Record<string, unknown> {
  return { success: response.success, error: response.error, code: response.code };
}

describe('/design/evaluate family · relay and server answer with one model', () => {
  let container: HTMLDivElement;

  function register(id: string, tag: string, text: string, type: ElementType): HTMLElement {
    const el = document.createElement(tag);
    el.textContent = text;
    container.appendChild(el);
    getGlobalRegistry().registerElement(id, el, { type });
    return el;
  }

  beforeEach(() => {
    resetGlobalRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
    register('title', 'h1', 'Dashboard', 'generic');
    register('save', 'button', 'Save', 'button');
    register('name', 'input', '', 'input');
  });

  afterEach(() => {
    container.remove();
    resetGlobalRegistry();
  });

  it('evaluateQuality: the same report, 28 metrics as values, no grade', async () => {
    const request = { context: 'general', viewport: VIEWPORT };
    const server = await serverHandlers().evaluateQuality(request);
    const relay = await relayHandlers().evaluateQuality(request);

    expect(server.success).toBe(true);
    expect(relay.success).toBe(true);
    const report = relay.data!;
    expect(report.metrics).toHaveLength(28);
    expect(report.totalElements).toBe(3);
    expect(stable(report)).toEqual(stable(server.data!));
    expect(report).not.toHaveProperty('grade');
    expect(report).not.toHaveProperty('uxGrade');
    expect(report).not.toHaveProperty('labelCoverage');
  });

  it('evaluateQuality: the requested context is honoured, an unknown one fails the same way', async () => {
    const minimal = await relayHandlers().evaluateQuality({
      context: 'minimal',
      viewport: VIEWPORT,
    });
    expect(minimal.data?.contextName).toBe('minimal');

    // `design` was on the relay's old context list; the evaluator never knew it.
    // `constructor` names no context either, though a plain lookup reaches
    // `Object.prototype` with it.
    for (const context of ['design', 'constructor']) {
      const request = { context, viewport: VIEWPORT };
      const server = await serverHandlers().evaluateQuality(request);
      const relay = await relayHandlers().evaluateQuality(request);
      expect(server.success).toBe(false);
      expect(server.error).toContain(`Unknown quality context: "${context}"`);
      expect(server.code).toBe('UB-VALIDATION-ERROR');
      expect(failure(relay)).toEqual(failure(server));
    }
  });

  it('evaluateQuality: a context the loaded style guide declares is resolved on both', async () => {
    const brand: QualityContext = {
      name: 'brand',
      description: 'A tenant-declared context',
      metrics: {
        contentOverflow: { enabled: false, weight: 0, thresholds: { good: 80, warning: 50 } },
      },
    };
    const guide = {
      version: '1',
      name: 'tenant guide',
      rules: [],
      qualityContexts: { brand },
    } as unknown as StyleGuideConfig;
    const server = serverHandlers();
    const relay = relayHandlers();
    await server.loadStyleGuide({ guide });
    await relay.loadStyleGuide({ guide });

    const request = { context: 'brand', viewport: VIEWPORT };
    const fromServer = await server.evaluateQuality(request);
    const fromRelay = await relay.evaluateQuality(request);
    expect(fromRelay.data?.contextName).toBe('brand');
    const overflow = fromRelay.data?.metrics.find((m) => m.metricId === 'contentOverflow');
    expect(overflow?.enabled).toBe(false);
    expect(stable(fromRelay.data!)).toEqual(stable(fromServer.data!));
    await relay.clearStyleGuide();
  });

  it('getQualityContexts: the same list, and every listed context evaluates', async () => {
    const relay = relayHandlers();
    const contexts = await relay.getQualityContexts();
    const server = await serverHandlers().getQualityContexts();
    expect(contexts.success).toBe(true);
    expect(contexts.data).toEqual(server.data);
    expect(contexts.data).toEqual(listContexts());
    expect(contexts.data!.length).toBeGreaterThan(0);
    for (const { name } of contexts.data!) {
      const report = await relay.evaluateQuality({ context: name, viewport: VIEWPORT });
      expect(report.success).toBe(true);
      expect(report.data?.contextName).toBe(name);
      expect(report.data?.metrics).toHaveLength(28);
    }
  });

  it('diffBaseline: no baseline fails the same way, then both report the real changes', async () => {
    const server = serverHandlers();
    const relay = relayHandlers();
    const noBaseline = await server.diffBaseline();
    expect(noBaseline.success).toBe(false);
    expect(failure(await relay.diffBaseline())).toEqual(failure(noBaseline));

    const savedServer = await server.saveBaseline({ label: 'before' });
    const savedRelay = await relay.saveBaseline({ label: 'before' });
    expect(savedRelay.data).toEqual({ saved: true, elementCount: 3 });
    expect(savedRelay.data).toEqual(savedServer.data);

    (document.querySelector('button') as HTMLButtonElement).style.color = 'rgb(255, 0, 0)';
    register('status', 'p', 'Saved', 'generic');

    const fromServer = await server.diffBaseline();
    const fromRelay = await relay.diffBaseline();
    const diff = fromRelay.data as SnapshotDiffReport;
    expect(diff.added.map((d) => d.elementId)).toEqual(['status']);
    expect(diff.removed).toEqual([]);
    const save = diff.modified.find((d) => d.elementId === 'save');
    expect(save?.styleChanges?.map((c) => c.property)).toContain('color');
    expect(diff.hasSignificantChanges).toBe(true);
    expect(fromRelay.data).toEqual(fromServer.data);
  });

  // The routes declare `bodyRequired`, so the caller's JSON reaches these
  // handlers as sent. A malformed field is refused, coded, on both transports.
  type QualityMethod = 'evaluateQuality' | 'saveBaseline' | 'diffBaseline';
  const IDS = 'elementIds must be an array of strings';
  const BAD_VIEWPORT = 'viewport must be { width, height }';
  const BODY = 'the request body must be a JSON object';
  const CUSTOM = 'customContext must be an object with a string name and a metrics object';
  // [method, what is wrong, the body, what the error says]
  const MALFORMED: Array<[QualityMethod, string, unknown, string]> = [
    ['evaluateQuality', 'elementIds as a string', { elementIds: 'save' }, IDS],
    ['evaluateQuality', 'elementIds holding a number', { elementIds: ['save', 7] }, IDS],
    ['evaluateQuality', 'a viewport with no height', { viewport: { width: 1280 } }, BAD_VIEWPORT],
    [
      'evaluateQuality',
      'a zero viewport width',
      { viewport: { width: 0, height: 800 } },
      BAD_VIEWPORT,
    ],
    [
      'evaluateQuality',
      'a negative viewport width',
      { viewport: { width: -1, height: 800 } },
      BAD_VIEWPORT,
    ],
    [
      'evaluateQuality',
      'a string viewport width',
      { viewport: { width: '1280', height: 800 } },
      BAD_VIEWPORT,
    ],
    [
      'evaluateQuality',
      'an infinite viewport width',
      { viewport: { width: Infinity, height: 800 } },
      BAD_VIEWPORT,
    ],
    ['evaluateQuality', 'a string viewport', { viewport: 'desktop' }, BAD_VIEWPORT],
    ['evaluateQuality', 'an array body', ['general'], BODY],
    ['evaluateQuality', 'a string body', 'general', BODY],
    ['evaluateQuality', 'a numeric context', { context: 7 }, 'context must be a string'],
    [
      'evaluateQuality',
      'a customContext with no metrics',
      { customContext: { name: 'mine' } },
      CUSTOM,
    ],
    [
      'evaluateQuality',
      'a string metric weight',
      { customContext: { name: 'mine', metrics: { contentOverflow: { weight: 'heavy' } } } },
      'customContext.metrics.contentOverflow must be an object',
    ],
    ['saveBaseline', 'elementIds as a string', { elementIds: 'save' }, IDS],
    ['saveBaseline', 'a numeric label', { label: 3 }, 'label must be a string'],
    ['diffBaseline', 'elementIds as a string', { elementIds: 'save' }, IDS],
  ];
  const ROUTE: Record<QualityMethod, string> = {
    evaluateQuality: '/design/evaluate',
    saveBaseline: '/design/evaluate/baseline',
    diffBaseline: '/design/evaluate/diff',
  };

  it.each(MALFORMED)(
    '%s refuses %s with UB-VALIDATION-ERROR on both transports',
    async (method, _what, request, message) => {
      const server = serverHandlers();
      const relay = relayHandlers();
      // A diff is checked only once a baseline exists.
      await server.saveBaseline({});
      await relay.saveBaseline({});
      const call = (handlers: typeof server | typeof relay) =>
        (handlers[method] as (request: unknown) => Promise<APIResponse<unknown>>)(request);

      const fromServer = await call(server);
      const fromRelay = await call(relay);
      expect(failure(fromServer)).toEqual({
        success: false,
        error: expect.stringContaining(`${ROUTE[method]}: ${message}`),
        code: 'UB-VALIDATION-ERROR',
      });
      expect(failure(fromRelay)).toEqual(failure(fromServer));
      // Nothing was computed: no report, baseline or diff rides along. (The
      // relay envelope keeps the dispatcher's own failure object under `data`.)
      for (const response of [fromServer, fromRelay]) {
        expect(response.data ?? {}).not.toHaveProperty('metrics');
        expect(response.data ?? {}).not.toHaveProperty('saved');
        expect(response.data ?? {}).not.toHaveProperty('modified');
      }
    }
  );

  it('a field sent as JSON null is not given, on both transports', async () => {
    const request = { context: null, customContext: null, elementIds: null, viewport: null };
    for (const handlers of [serverHandlers(), relayHandlers()]) {
      const report = await (
        handlers.evaluateQuality as (
          request: unknown
        ) => Promise<APIResponse<QualityEvaluationReport>>
      )(request);
      expect(report.success).toBe(true);
      expect(report.data?.contextName).toBe('general');
      expect(report.data?.totalElements).toBe(3);
    }
    const saved = await (
      relayHandlers().saveBaseline as (request: unknown) => Promise<APIResponse<unknown>>
    )({ label: null, elementIds: null });
    expect(saved.data).toEqual({ saved: true, elementCount: 3 });
  });

  // Custom properties are read by walking the page's stylesheets. One pass
  // reads them once for the whole batch, and an evaluation whose context runs
  // no metric that reads them (`CUSTOM_PROPERTY_METRICS`) does not walk them.
  it('the stylesheets are read once per evaluation, and not at all when no metric reads them', async () => {
    const style = document.createElement('style');
    style.textContent = ':root { --brand: #123456; } button { --pad: 4px; }';
    document.head.appendChild(style);
    const noCustomProperties: QualityContext = {
      name: 'no-custom-properties',
      description: 'customPropertyConsistency off',
      metrics: {
        customPropertyConsistency: {
          enabled: false,
          weight: 0,
          thresholds: { good: 80, warning: 50 },
        },
      },
    };
    const sheets = vi.spyOn(document, 'styleSheets', 'get');
    try {
      for (const handlers of [serverHandlers(), relayHandlers()]) {
        sheets.mockClear();
        const skipped = await handlers.evaluateQuality({
          customContext: noCustomProperties,
          viewport: VIEWPORT,
        });
        expect(skipped.success).toBe(true);
        expect(sheets).not.toHaveBeenCalled();

        const read = await handlers.evaluateQuality({ context: 'general', viewport: VIEWPORT });
        expect(read.success).toBe(true);
        // Three elements, one pass over the stylesheets.
        expect(read.data?.totalElements).toBe(3);
        expect(sheets).toHaveBeenCalledTimes(1);
        const metric = read.data?.metrics.find((m) => m.metricId === 'customPropertyConsistency');
        expect(metric?.enabled).toBe(true);
      }
    } finally {
      sheets.mockRestore();
      style.remove();
    }
  });
});
