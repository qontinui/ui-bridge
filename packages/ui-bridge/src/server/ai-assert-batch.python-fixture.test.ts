// @vitest-environment jsdom
/**
 * The Python client's batch fixture,
 * `packages/ui-bridge-python/tests/fixtures/sdk_assert_batch_response.json`,
 * is a REAL `POST /ai/assert/batch` reply captured from this transport, and the
 * Python model's tests (`tests/test_types.py`) hold `BatchAssertionResult` to
 * it: `failed_count` counts every result that did not pass, and
 * `unmeasured_count` is the unmeasured subset of it. Were this SDK's reply to
 * change and the file not, those tests would go on passing against an answer
 * the SDK no longer gives.
 *
 * So this test replays the batch the file was captured from — the same three
 * checks, on the same page, through the in-process route — and compares the
 * reply with the file:
 *   - exactly: the verdict, the counts, and per result every field a reader
 *     acts on (`passed`, `outcome`, `target`, `expected`, `actual`,
 *     `failureReason`, `failureCode`, `unmeasured`, `suggestion`, …);
 *   - by shape (the same keys, nested, each leaf by its type): timing
 *     (`durationMs`, `timestamp`), which changes on every run, and the element
 *     snapshot (`elementState`) and search trace (`searchDetails`), which
 *     describe jsdom and the synonym table rather than the batch.
 *
 * When it fails because the reply changed on purpose, re-capture the file from
 * this request (the reply's `data`, `JSON.stringify(data, null, 2)`) and run the
 * Python tests against it.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createNextRouteHandlers } from './nextjs';
import { createHandlers, type RegistryLike } from './handlers';
import { getGlobalRegistry, resetGlobalRegistry } from '../core/registry';
import { createActionExecutor } from '../control/action-executor';

const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../ui-bridge-python/tests/fixtures/sdk_assert_batch_response.json'
);

const BASE = 'http://bridge.test/api/ui-bridge';

/** The page the fixture was captured from. */
const PAGE = '<main><button id="save" lang="de" style="outline-offset: 3px">Save</button></main>';

/** The batch the fixture answers: a check that passes, one unmeasured, one that fails. */
const BATCH = {
  skipSettle: true,
  mode: 'all',
  assertions: [
    { target: 'save', type: 'cssProperty', propertyName: 'outline-offset', expected: '3px' },
    { target: 'save', type: 'cssProperty', propertyName: '--not-set', expected: 'x' },
    { target: 'save', type: 'attribute', attributeName: 'lang', expected: 'fr' },
  ],
};

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

/** The fields compared by shape only — see the file doc. */
const BY_SHAPE = new Set(['durationMs', 'timestamp', 'elementState', 'searchDetails']);

/** The same keys, nested, with each leaf replaced by its type (an array by `'array'`). */
function shapeOf(value: Json): Json {
  if (Array.isArray(value)) return 'array';
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, shapeOf(v)]));
  }
  return value === null ? 'null' : typeof value;
}

/** `record` with each {@link BY_SHAPE} field replaced by its shape. */
function comparable(record: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(record).map(([key, v]) => [key, BY_SHAPE.has(key) ? shapeOf(v) : v])
  );
}

/** A batch as compared: its own fields, and each result's, through {@link comparable}. */
function comparableBatch(batch: JsonObject): JsonObject {
  return { ...comparable(batch), results: (batch.results as JsonObject[]).map(comparable) };
}

/** Serve a fetch from the Next route handlers, in process. */
function routeFetch(routes: ReturnType<typeof createNextRouteHandlers>): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const nextUrl = new URL(url);
    const request = Object.assign(new Request(url, init), { nextUrl });
    const path = nextUrl.pathname.slice(new URL(BASE).pathname.length + 1);
    const method = (init?.method ?? 'GET').toUpperCase() as keyof typeof routes;
    return routes[method](request, { params: { path } });
  };
}

beforeAll(() => {
  if (!document.elementFromPoint) {
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetGlobalRegistry();
  document.body.innerHTML = '';
});

it('the in-process /ai/assert/batch reply is the Python fixture: its counts, and each result a reader acts on', async () => {
  resetGlobalRegistry();
  document.body.innerHTML = PAGE;
  const registry = getGlobalRegistry();
  registry.registerElement('save', document.getElementById('save')!, {
    type: 'button',
    label: 'save',
  });
  const registryLike: RegistryLike = {
    getAllElements: () => registry.getAllElements(),
    getElement: (id) => registry.getElement(id),
    getAllComponents: () => registry.getAllComponents(),
    getComponent: (id) => registry.getComponent(id),
    createSnapshot: () => registry.createSnapshot() as ReturnType<RegistryLike['createSnapshot']>,
  };
  const handlers = createHandlers(registryLike, createActionExecutor(registry));
  vi.stubGlobal('fetch', routeFetch(createNextRouteHandlers(handlers)));

  const response = await fetch(`${BASE}/ai/assert/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(BATCH),
  });
  const reply = (await response.json()) as { success: boolean; data?: JsonObject; error?: string };
  expect(reply.success, reply.error).toBe(true);

  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as JsonObject;
  // What the Python tests read off the file: one result of each outcome, the
  // unmeasured one counted in `failedCount` and again in `unmeasuredCount`.
  expect((fixture.results as JsonObject[]).map((r) => r.outcome)).toEqual([
    'passed',
    'unmeasured',
    'failed',
  ]);
  expect(fixture).toMatchObject({
    passed: false,
    passedCount: 1,
    failedCount: 2,
    unmeasuredCount: 1,
  });

  expect(comparableBatch(reply.data!)).toEqual(comparableBatch(fixture));
});
