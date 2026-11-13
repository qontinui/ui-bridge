// @vitest-environment jsdom
/**
 * The request-scoped projection (`properties` / `attributes`) and the
 * `ai/assert` style and attribute checks, on BOTH transports, entered where a
 * caller enters: the HTTP route.
 *
 *   - in-process: the Next adapter over `createHandlers` on this page's registry;
 *   - relay: the Next adapter over `createRelayHandlers`, with this page joined
 *     to the relay through the production `useCommandRelay` hook, so a request
 *     travels route → relay queue → the page's dispatcher → back.
 *
 * jsdom computes inline longhands and inline custom properties, which is all
 * these tests need: they pin that each transport carries the names to the
 * page and the values back. What the cascade computes — `var()`, inherited
 * tokens, logical longhands — is pinned in real Chromium by
 * `core/element-projection.smoke.test.ts`.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { renderHook } from '@testing-library/react';
import { CommandRelay } from './command-relay';
import { createNextRouteHandlers } from './nextjs';
import { createExpressApp } from './express';
import { StandaloneServer } from './standalone';
import { createRelayHandlers } from './relay-handlers';
import { createAIHandlers, createHandlers, type RegistryLike } from './handlers';
import { useCommandRelay } from '../react/useCommandRelay';
import { listener } from '../react/__tests__/relay-into-listener';
import { getGlobalRegistry, resetGlobalRegistry } from '../core/registry';
import { createActionExecutor } from '../control/action-executor';
import { REDACTED_VALUE } from '../core/redaction';

const BASE = 'http://bridge.test/api/ui-bridge';

type Routes = ReturnType<typeof createNextRouteHandlers>;

interface Reply {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  code?: string;
}

/** Serve a fetch from the Next route handlers, in process. */
function routeFetch(routes: Routes): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(BASE)) return new Response('not routed', { status: 404 });
    const nextUrl = new URL(url);
    const request = Object.assign(new Request(url, init), { nextUrl });
    const path = nextUrl.pathname.slice(new URL(BASE).pathname.length + 1);
    const method = (init?.method ?? 'GET').toUpperCase() as keyof Routes;
    return routes[method](request, { params: { path } });
  };
}

async function until(check: () => boolean, what: string, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function post(path: string, body: unknown): Promise<Reply> {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await response.json()) as Reply;
}

async function get(path: string): Promise<Reply> {
  return (await (await fetch(`${BASE}${path}`)).json()) as Reply;
}

/**
 * The page. `save` carries every style the projection is asked for, as inline
 * longhands jsdom computes, plus attributes inside and outside the allow-list;
 * `pay` sits in a §4.6 redaction boundary.
 */
const PAGE = `
  <main>
    <button id="save" lang="de" dir="ltr" title="Bestellung speichern" aria-label="Save order"
      aria-expanded="false" onclick="void 0"
      style="border-top-color: rgb(1, 2, 3); border-right-color: rgb(4, 5, 6);
             border-bottom-color: rgb(7, 8, 9); border-left-color: rgb(10, 11, 12);
             outline-offset: 3px; hyphens: auto; --brand: #00aaff">Save</button>
    <div data-bridge-redact="true">
      <button id="pay" title="Card 4111" aria-expanded="true"
        style="border-top-color: rgb(1, 2, 3); --tone: #123456">Pay</button>
    </div>
  </main>`;

const LONGHANDS = {
  'border-top-color': 'rgb(1, 2, 3)',
  'border-right-color': 'rgb(4, 5, 6)',
  'border-bottom-color': 'rgb(7, 8, 9)',
  'border-left-color': 'rgb(10, 11, 12)',
  'outline-offset': '3px',
  hyphens: 'auto',
};

function mountPage(): void {
  resetGlobalRegistry();
  document.body.innerHTML = PAGE;
  const registry = getGlobalRegistry();
  for (const id of ['save', 'pay']) {
    registry.registerElement(id, document.getElementById(id)!, { type: 'button', label: id });
  }
}

function registryLike(): RegistryLike {
  const reg = getGlobalRegistry();
  return {
    getAllElements: () => reg.getAllElements(),
    getElement: (id) => reg.getElement(id),
    getAllComponents: () => reg.getAllComponents(),
    getComponent: (id) => reg.getComponent(id),
    createSnapshot: () => reg.createSnapshot() as ReturnType<RegistryLike['createSnapshot']>,
  };
}

interface Mounted {
  /** The relay, on the relay transport — to observe what was queued. */
  relay?: CommandRelay;
}

const transports: Array<{ name: string; mount: () => Promise<Mounted> }> = [
  {
    name: 'in-process',
    async mount() {
      mountPage();
      const handlers = createHandlers(registryLike(), createActionExecutor(getGlobalRegistry()));
      vi.stubGlobal('fetch', routeFetch(createNextRouteHandlers(handlers)));
      return {};
    },
  },
  {
    name: 'relay',
    async mount() {
      mountPage();
      const relay = new CommandRelay({
        globalPrefix: `__uiBridgeProjection_${Math.random().toString(36).slice(2, 10)}`,
      });
      vi.stubGlobal(
        'fetch',
        routeFetch(createNextRouteHandlers(createRelayHandlers(relay), { relay }))
      );
      ({ unmount } = renderHook(() => useCommandRelay({ basePath: BASE, disablePhoneHome: true })));
      await until(() => relay.getConnectedTabs().length === 1, 'the page to join the relay');
      relays.push(relay);
      return { relay };
    },
  },
];

let unmount: (() => void) | undefined;
const relays: CommandRelay[] = [];

beforeAll(() => {
  if (typeof document !== 'undefined' && !document.elementFromPoint) {
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
  }
});

afterEach(() => {
  unmount?.();
  unmount = undefined;
  for (const relay of relays.splice(0)) relay.destroy();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetGlobalRegistry();
  document.body.innerHTML = '';
});

type Row = { id: string; projection?: Record<string, unknown> };

/** What `?properties=hyphens&properties=outline-offset,--brand&attributes=lang&attributes=dir` reads off `save`. */
const REPEATED_KEYS_PROJECTION = {
  properties: { hyphens: 'auto', 'outline-offset': '3px', '--brand': '#00aaff' },
  attributes: { lang: 'de', dir: 'ltr' },
  unmeasured: [],
};

const rowsOf = (reply: Reply): Row[] => (reply.data?.elements ?? []) as Row[];
const rowOf = (reply: Reply, id: string): Row | undefined => rowsOf(reply).find((r) => r.id === id);

/** The commands the relay queued to the page, by action. */
function queuedActions(relay: CommandRelay | undefined): string[] {
  return (vi.mocked(relay!.queueCommand).mock?.calls ?? []).map((c) => c[0] as string);
}

describe.each(transports)('the $name transport', ({ mount }) => {
  describe('POST /control/find', () => {
    it('answers every requested longhand and a custom property, per returned row', async () => {
      await mount();
      const reply = await post('/control/find', {
        skipSettle: true,
        text: 'save',
        properties: [...Object.keys(LONGHANDS), '--brand'],
      });
      expect(reply.success, reply.error).toBe(true);
      expect(rowsOf(reply).map((r) => r.id)).toEqual(['save']);
      expect(rowOf(reply, 'save')!.projection).toEqual({
        properties: { ...LONGHANDS, '--brand': '#00aaff' },
        unmeasured: [],
      });
    });

    it('answers allow-listed attributes, null for an absent one, scrubbed inside a boundary', async () => {
      await mount();
      const reply = await post('/control/find', {
        skipSettle: true,
        attributes: ['lang', 'title', 'aria-label', 'aria-expanded', 'alt'],
      });
      expect(reply.success, reply.error).toBe(true);
      expect(rowOf(reply, 'save')!.projection).toEqual({
        attributes: {
          lang: 'de',
          title: 'Bestellung speichern',
          'aria-label': 'Save order',
          'aria-expanded': 'false',
          alt: null,
        },
        unmeasured: [],
      });
      expect(rowOf(reply, 'pay')!.projection!.attributes).toEqual({
        lang: null,
        title: REDACTED_VALUE,
        'aria-label': null,
        'aria-expanded': 'true',
        alt: null,
      });
    });

    it('a row a name could not be read for says so, with the code — never ""', async () => {
      await mount();
      const reply = await post('/control/find', {
        skipSettle: true,
        text: 'save',
        properties: ['--not-set', 'colr'],
      });
      expect(reply.success, reply.error).toBe(true);
      expect(rowOf(reply, 'save')!.projection).toEqual({
        properties: {},
        unmeasured: [
          expect.objectContaining({ kind: 'property', name: '--not-set', code: 'input_missing' }),
          expect.objectContaining({
            kind: 'property',
            name: 'colr',
            code: 'capability_unavailable_in_build',
          }),
        ],
      });
    });

    it('a request without a projection carries none', async () => {
      await mount();
      const reply = await post('/control/find', { skipSettle: true, text: 'save' });
      expect(reply.success, reply.error).toBe(true);
      expect(rowOf(reply, 'save')).not.toHaveProperty('projection');
    });

    it.each([
      ['an attribute outside the allow-list', { attributes: ['onclick'] }, 'attributes'],
      ['an invalid property name', { properties: ['color: red'] }, 'properties'],
      ['a non-array list', { properties: 'color' }, 'properties'],
    ])('refuses %s with UB-VALIDATION-ERROR', async (_label, projection, option) => {
      const { relay } = await mount();
      if (relay) vi.spyOn(relay, 'queueCommand');
      const reply = await post('/control/find', { skipSettle: true, ...projection });
      expect(reply.success).toBe(false);
      expect(reply.code).toBe('UB-VALIDATION-ERROR');
      expect(reply.error).toContain(`\`${option}\``);
      // The relay refuses before queueing: the tab never sees it.
      if (relay) expect(queuedActions(relay)).not.toContain('find');
    });

    it('POST /control/discover (the deprecated alias) carries the projection too', async () => {
      await mount();
      const reply = await post('/control/discover', {
        skipSettle: true,
        text: 'save',
        attributes: ['lang'],
      });
      expect(reply.success, reply.error).toBe(true);
      expect(rowOf(reply, 'save')!.projection).toEqual({
        attributes: { lang: 'de' },
        unmeasured: [],
      });
    });
  });

  describe('GET /control/element/:id/state', () => {
    it('answers the projection from the query, beside the unchanged state', async () => {
      await mount();
      const reply = await get(
        `/control/element/save/state?properties=${encodeURIComponent(
          'border-top-color,outline-offset,hyphens,--brand'
        )}&attributes=lang,aria-label,dir`
      );
      expect(reply.success, reply.error).toBe(true);
      expect(reply.data).toMatchObject({ id: 'save', visible: expect.any(Boolean) });
      expect(reply.data!.projection).toEqual({
        properties: {
          'border-top-color': 'rgb(1, 2, 3)',
          'outline-offset': '3px',
          hyphens: 'auto',
          '--brand': '#00aaff',
        },
        attributes: { lang: 'de', 'aria-label': 'Save order', dir: 'ltr' },
        unmeasured: [],
      });
      // `computedStyles` is the fixed snapshot set, unchanged by a projection.
      const computed = reply.data!.computedStyles as Record<string, unknown>;
      expect(computed).toBeDefined();
      expect(Object.keys(computed)).not.toContain('borderTopColor');
      expect(Object.keys(computed)).not.toContain('hyphens');
    });

    it('a state read without a query carries no projection', async () => {
      await mount();
      const reply = await get('/control/element/save/state');
      expect(reply.success, reply.error).toBe(true);
      expect(reply.data).toMatchObject({ id: 'save' });
      expect(reply.data).not.toHaveProperty('projection');
    });

    it('reads a repeated `properties` / `attributes` key as one list, as a comma list reads', async () => {
      await mount();
      const reply = await get(
        '/control/element/save/state?properties=hyphens&properties=outline-offset,--brand' +
          '&attributes=lang&attributes=dir'
      );
      expect(reply.success, reply.error).toBe(true);
      expect(reply.data!.projection).toEqual(REPEATED_KEYS_PROJECTION);
    });

    it.each([
      ['an attribute outside the allow-list', 'attributes=style', 'attributes'],
      ['an invalid property name', `properties=${encodeURIComponent('a{b}')}`, 'properties'],
    ])('refuses %s with UB-VALIDATION-ERROR', async (_label, query, option) => {
      const { relay } = await mount();
      if (relay) vi.spyOn(relay, 'queueCommand');
      const reply = await get(`/control/element/save/state?${query}`);
      expect(reply.success).toBe(false);
      expect(reply.code).toBe('UB-VALIDATION-ERROR');
      expect(reply.error).toContain(`\`${option}\``);
      if (relay) expect(queuedActions(relay)).not.toContain('getElementState');
    });
  });

  describe('POST /ai/assert and /ai/assert/batch', () => {
    it('the batch passes each assertion through whole: attributeName and propertyName arrive', async () => {
      await mount();
      const reply = await post('/ai/assert/batch', {
        skipSettle: true,
        mode: 'all',
        assertions: [
          {
            target: 'save',
            type: 'attribute',
            attributeName: 'aria-label',
            expected: 'Save order',
          },
          { target: 'save', type: 'attribute', attributeName: 'lang', expected: 'de' },
          {
            target: 'save',
            type: 'cssProperty',
            propertyName: 'border-top-color',
            expected: 'rgb(1, 2, 3)',
          },
          {
            target: 'save',
            type: 'cssPropertyInSet',
            propertyName: 'hyphens',
            allowedValues: ['manual', 'auto'],
          },
          {
            target: 'save',
            type: 'cssPropertyRange',
            propertyName: 'outline-offset',
            range: { min: 2, max: 4 },
          },
        ],
      });
      expect(reply.success, reply.error).toBe(true);
      const results = reply.data!.results as Array<Record<string, unknown>>;
      expect(results.map((r) => [r.outcome, r.actual])).toEqual([
        ['passed', 'Save order'],
        ['passed', 'de'],
        ['passed', 'rgb(1, 2, 3)'],
        ['passed', 'auto'],
        ['passed', 3],
      ]);
      expect(reply.data).toMatchObject({
        passed: true,
        passedCount: 5,
        failedCount: 0,
        unmeasuredCount: 0,
      });
    });

    it('a value that could not be read is UNMEASURED, apart from a real failure', async () => {
      await mount();
      const reply = await post('/ai/assert/batch', {
        skipSettle: true,
        mode: 'all',
        assertions: [
          { target: 'save', type: 'cssProperty', propertyName: '--not-set', expected: 'x' },
          { target: 'save', type: 'cssProperty', propertyName: 'colr', expected: 'red' },
          { target: 'save', type: 'attribute', attributeName: 'onclick', expected: 'void 0' },
          { target: 'save', type: 'attribute', attributeName: 'lang', expected: 'fr' },
        ],
      });
      expect(reply.success, reply.error).toBe(true);
      const results = reply.data!.results as Array<Record<string, unknown>>;
      expect(results.map((r) => [r.outcome, r.passed, r.failureCode])).toEqual([
        ['unmeasured', false, 'UB-OBS-INPUT-MISSING'],
        ['unmeasured', false, 'UB-OBS-CAPABILITY-UNAVAILABLE-IN-BUILD'],
        ['unmeasured', false, 'UB-VALIDATION-ERROR'],
        ['failed', false, 'UB-ASSERT-TEXT-MISMATCH'],
      ]);
      // Unmeasured carries no value at all — never `actual: ''`.
      for (const r of results.slice(0, 3)) expect(r).not.toHaveProperty('actual');
      expect(results[0]!.unmeasured).toEqual({
        code: 'input_missing',
        detail: 'custom property `--not-set` is not set on this element',
      });
      expect(results[3]!.actual).toBe('de');
      expect(reply.data).toMatchObject({
        passed: false,
        passedCount: 0,
        failedCount: 1,
        unmeasuredCount: 3,
      });
    });

    it('a value a redaction boundary withholds is UNMEASURED by policy — the sentinel is never compared', async () => {
      await mount();
      const reply = await post('/ai/assert/batch', {
        skipSettle: true,
        mode: 'all',
        assertions: [
          { target: 'pay', type: 'attribute', attributeName: 'title', expected: 'Card 4111' },
          { target: 'pay', type: 'cssProperty', propertyName: '--tone', expected: '#123456' },
          {
            target: 'pay',
            type: 'tokenCompliance',
            propertyName: '--tone',
            tokenPath: 'color.tone',
            expected: '#123456',
          },
          // Structure and the style vocabulary are not withheld: they are judged.
          { target: 'pay', type: 'attribute', attributeName: 'aria-expanded', expected: 'true' },
          {
            target: 'pay',
            type: 'cssProperty',
            propertyName: 'border-top-color',
            expected: 'rgb(1, 2, 3)',
          },
        ],
      });
      expect(reply.success, reply.error).toBe(true);
      const results = reply.data!.results as Array<Record<string, unknown>>;
      expect(results.map((r) => [r.outcome, r.failureCode])).toEqual([
        ['unmeasured', 'UB-OBS-NOT-ATTEMPTED-BY-POLICY'],
        ['unmeasured', 'UB-OBS-NOT-ATTEMPTED-BY-POLICY'],
        ['unmeasured', 'UB-OBS-NOT-ATTEMPTED-BY-POLICY'],
        ['passed', undefined],
        ['passed', undefined],
      ]);
      for (const r of results.slice(0, 3)) {
        // Neither a failure of the page nor a value: no `actual` at all.
        expect(r).not.toHaveProperty('actual');
        expect(r.passed).toBe(false);
        expect(r.unmeasured).toMatchObject({ code: 'not_attempted_by_policy' });
      }
      expect(reply.data).toMatchObject({
        passed: false,
        passedCount: 2,
        failedCount: 0,
        unmeasuredCount: 3,
      });
    });

    const NOT_AN_ASSERTION = 'must be an assertion object or a natural-language string, got';
    const NAMES_NOTHING = 'names nothing to check';

    it.each([
      ['null', null, `${NOT_AN_ASSERTION} null`],
      ['a number', 42, `${NOT_AN_ASSERTION} number`],
      ['an array', ['save'], `${NOT_AN_ASSERTION} an array`],
      ['an empty object', {}, NAMES_NOTHING],
      ['an object naming no target', { foo: 1 }, NAMES_NOTHING],
      ['a type with no target', { type: 'exists' }, NAMES_NOTHING],
      ['a blank string', '  ', NAMES_NOTHING],
    ])(
      'refuses a batch entry that is %s with UB-VALIDATION-ERROR — never a made-up failure',
      async (_label, entry, why) => {
        const { relay } = await mount();
        if (relay) vi.spyOn(relay, 'queueCommand');
        const reply = await post('/ai/assert/batch', {
          skipSettle: true,
          mode: 'all',
          assertions: [{ target: 'save', type: 'exists' }, entry],
        });
        expect(reply.success).toBe(false);
        expect(reply.code).toBe('UB-VALIDATION-ERROR');
        expect(reply.error).toContain(`assertions[1] ${why}`);
        // Nothing ran: no result for the malformed entry, nor for the good one.
        expect(reply.data?.results).toBeUndefined();
        // The relay refuses before queueing: the tab never sees it.
        if (relay) expect(queuedActions(relay)).not.toContain('aiAssertBatch');
      }
    );

    it('refuses a non-array `assertions` with UB-VALIDATION-ERROR', async () => {
      await mount();
      const reply = await post('/ai/assert/batch', { skipSettle: true, assertions: 'save exists' });
      expect(reply.success).toBe(false);
      expect(reply.code).toBe('UB-VALIDATION-ERROR');
      expect(reply.error).toContain('assertions must be an array, got string');
    });

    it.each([
      ['an empty request', {}],
      ['a type with no target', { type: 'exists' }],
      ['a blank target', { target: ' ', type: 'exists' }],
    ])('refuses a single assertion that is %s with UB-VALIDATION-ERROR', async (_label, body) => {
      const { relay } = await mount();
      if (relay) vi.spyOn(relay, 'queueCommand');
      const reply = await post('/ai/assert', { skipSettle: true, ...body });
      expect(reply.success).toBe(false);
      expect(reply.code).toBe('UB-VALIDATION-ERROR');
      expect(reply.error).toContain(`the assertion ${NAMES_NOTHING}`);
      if (relay) expect(queuedActions(relay)).not.toContain('aiAssert');
    });

    it('a structured target with no `type` stays search criteria: an exists check on it', async () => {
      await mount();
      const reply = await post('/ai/assert', { skipSettle: true, target: { idPattern: 'sav*' } });
      expect(reply.success, reply.error).toBe(true);
      expect(reply.data).toMatchObject({ outcome: 'passed' });
    });

    it.each([
      ['empty criteria', {}],
      ['criteria that only modify a search', { fuzzy: true, fuzzyThreshold: 0.5, strict: true }],
      ['a blank id pattern', { idPattern: '' }],
      ['a field the assertion search does not read', { selector: '#pay' }],
    ])(
      'refuses a notExists check whose target is %s with UB-VALIDATION-ERROR — it would pass without looking',
      async (_label, target) => {
        const { relay } = await mount();
        if (relay) vi.spyOn(relay, 'queueCommand');
        const single = await post('/ai/assert', { skipSettle: true, target, type: 'notExists' });
        expect(single.success).toBe(false);
        expect(single.code).toBe('UB-VALIDATION-ERROR');
        expect(single.error).toContain('the assertion names nothing to check');
        expect(single.error).toContain('selects by none of');
        const batch = await post('/ai/assert/batch', {
          skipSettle: true,
          assertions: [{ target, type: 'notExists' }],
        });
        expect(batch.success).toBe(false);
        expect(batch.code).toBe('UB-VALIDATION-ERROR');
        expect(batch.error).toContain('assertions[0] names nothing to check');
        expect(batch.data?.results).toBeUndefined();
        if (relay) {
          expect(queuedActions(relay)).not.toContain('aiAssert');
          expect(queuedActions(relay)).not.toContain('aiAssertBatch');
        }
      }
    );

    it('criteria that select still run: a notExists on an element that exists fails', async () => {
      await mount();
      const reply = await post('/ai/assert', {
        skipSettle: true,
        target: { idPattern: 'pay' },
        type: 'notExists',
      });
      expect(reply.success, reply.error).toBe(true);
      expect(reply.data).toMatchObject({ outcome: 'failed', passed: false });
    });

    it('a single assertion reads through the projection and keeps its message', async () => {
      await mount();
      const reply = await post('/ai/assert', {
        skipSettle: true,
        target: 'save',
        type: 'cssProperty',
        propertyName: 'border-left-color',
        expected: 'rgb(0, 0, 0)',
        message: 'left border is off-brand',
      });
      expect(reply.success, reply.error).toBe(true);
      expect(reply.data).toMatchObject({
        outcome: 'failed',
        passed: false,
        actual: 'rgb(10, 11, 12)',
        failureReason: 'left border is off-brand',
        failureCode: 'UB-ASSERT-LAYOUT',
      });
    });
  });
});

describe('a repeated query key on the adapters that serve no Next.js route', () => {
  // The Next.js adapter is the one the suites above enter through. The
  // standalone server builds its query from a `URLSearchParams` the same way
  // (`request-query.ts`); Express builds its own (`req.query`), which already
  // reads a repeated key as a list. Both over real HTTP, on the in-process
  // handlers.
  const PATH =
    '/ui-bridge/control/element/save/state?properties=hyphens&properties=outline-offset,--brand' +
    '&attributes=lang&attributes=dir';

  function inProcessHandlers() {
    mountPage();
    return createHandlers(registryLike(), createActionExecutor(getGlobalRegistry()));
  }

  it('the standalone server reads it as one list', async () => {
    const server = new StandaloneServer(inProcessHandlers(), {
      host: '127.0.0.1',
      port: 0,
      log: () => {},
    });
    await server.start();
    try {
      const response = await fetch(`http://127.0.0.1:${server.getAddress()!.port}${PATH}`);
      const reply = (await response.json()) as Reply;
      expect(reply.success, reply.error).toBe(true);
      expect(reply.data!.projection).toEqual(REPEATED_KEYS_PROJECTION);
    } finally {
      await server.stop();
    }
  });

  it('Express reads it as one list', async () => {
    const server: Server = createServer(
      createExpressApp(inProcessHandlers()) as Parameters<typeof createServer>[1]
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const reply = (await (await fetch(`http://127.0.0.1:${port}${PATH}`)).json()) as Reply;
      expect(reply.success, reply.error).toBe(true);
      expect(reply.data!.projection).toEqual(REPEATED_KEYS_PROJECTION);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('createAIHandlers, the AI-only in-process factory', () => {
  // Its own catch arms map the typed refusal; the HTTP suites above enter
  // through `createHandlers`, so these arms are pinned here.
  it('answers an assertion that names nothing with UB-VALIDATION-ERROR, single and batch', async () => {
    mountPage();
    const ai = createAIHandlers(registryLike(), createActionExecutor(getGlobalRegistry()));
    const single = await ai.aiAssert({} as Parameters<typeof ai.aiAssert>[0]);
    expect(single).toMatchObject({ success: false, code: 'UB-VALIDATION-ERROR' });
    expect(single.error).toContain('the assertion names nothing to check');
    const batch = await ai.aiAssertBatch({
      assertions: [{}],
    } as unknown as Parameters<typeof ai.aiAssertBatch>[0]);
    expect(batch).toMatchObject({ success: false, code: 'UB-VALIDATION-ERROR' });
    expect(batch.error).toContain('assertions[0] names nothing to check');
  });
});

describe('the tab dispatcher, reached directly', () => {
  // The relay refuses a malformed ai/assert request before queueing it (its
  // code would not survive the trip back as a tab failure). A caller that
  // reaches the dispatcher itself gets the same typed refusal.
  it.each([
    ['aiAssert', {}],
    ['aiAssertBatch', { assertions: [{ target: 'save', type: 'exists' }, {}] }],
  ])('%s refuses a request that names nothing to check, typed', async (action, payload) => {
    expect(await listener(action, payload)).toMatchObject({
      success: false,
      code: 'UB-VALIDATION-ERROR',
    });
  });
});

describe('the relay with its tab unreachable', () => {
  /** A relay whose tab never answers, so every read falls back to the cached snapshot. */
  function deadTabRelay() {
    const relay = new CommandRelay({
      globalPrefix: `__uiBridgeProjectionDead_${Math.random().toString(36).slice(2, 10)}`,
    });
    relays.push(relay);
    const queue = vi
      .spyOn(relay, 'queueCommand')
      .mockRejectedValue(new Error('SDK_DISCONNECTED: no tab'));
    return { queue, handlers: createRelayHandlers(relay) };
  }

  it('find: the cached snapshot cannot answer a projection, so it is refused, typed', async () => {
    const { handlers } = deadTabRelay();
    const reply = await handlers.find({ skipSettle: true, attributes: ['lang'] });
    expect(reply.success).toBe(false);
    expect(reply.code).toBe('UB-OBS-CAPABILITY-UNAVAILABLE-IN-BUILD');
    expect(reply.error).toContain('`attributes`');
  });

  it('find: a refusal from the cache names why the cache was asked — the live failure', async () => {
    const { handlers } = deadTabRelay();
    const projection = await handlers.find({ skipSettle: true, properties: ['hyphens'] });
    expect(projection.code).toBe('UB-OBS-CAPABILITY-UNAVAILABLE-IN-BUILD');
    expect(projection.error).toContain('(no live answer: SDK_DISCONNECTED: no tab');
    // Every refusal the cache raises carries it, not the projection's alone.
    const selector = await handlers.find({ skipSettle: true, selector: 'button' });
    expect(selector.code).toBe('UB-OBS-CAPABILITY-UNAVAILABLE-IN-BUILD');
    expect(selector.error).toContain('(no live answer: SDK_DISCONNECTED: no tab');
  });

  it('find without a projection still falls back to the cache', async () => {
    const { handlers } = deadTabRelay();
    const reply = await handlers.find({ skipSettle: true });
    expect(reply.success).toBe(true);
  });

  it('element state: the cached snapshot cannot answer a projection, so it is refused, typed', async () => {
    const { handlers } = deadTabRelay();
    const reply = await handlers.getElementState('save', { properties: 'hyphens' });
    expect(reply.success).toBe(false);
    expect(reply.code).toBe('UB-OBS-CAPABILITY-UNAVAILABLE-IN-BUILD');
  });

  it('element state pinned to a tab never falls back to the cache, and names the tab it asked', async () => {
    const { queue, handlers } = deadTabRelay();
    const reply = await handlers.getElementState('save', { tabId: 'tab-x', attributes: 'lang' });
    expect(reply.success).toBe(false);
    expect(queue).toHaveBeenCalledWith(
      'getElementState',
      { id: 'save', attributes: ['lang'] },
      expect.objectContaining({ targetTabId: 'tab-x' })
    );
  });
});

describe('the relay with a tab whose SDK predates the projection', () => {
  /**
   * A relay whose tab answers the way a UI Bridge SDK without the projection
   * does: it runs `getElementState` and `find`, ignores `properties` /
   * `attributes`, and answers with no `projection` anywhere.
   */
  function oldSdkRelay() {
    const relay = new CommandRelay({
      globalPrefix: `__uiBridgeProjectionOldSdk_${Math.random().toString(36).slice(2, 10)}`,
    });
    relays.push(relay);
    const queue = vi.spyOn(relay, 'queueCommand').mockImplementation((async (action: string) => {
      if (action === 'getElementState') {
        return { id: 'save', visible: true, enabled: true, isVisible: true, text: 'Save' };
      }
      if (action === 'find') {
        return {
          elements: [{ id: 'save', type: 'button', label: 'save', state: { visible: true } }],
          total: 1,
          durationMs: 1,
          timestamp: 0,
        };
      }
      throw new Error(`Unknown command action: ${action}`);
    }) as never);
    return { queue, handlers: createRelayHandlers(relay) };
  }

  it('element state: a live answer without the projection asked for is refused, typed', async () => {
    const { queue, handlers } = oldSdkRelay();
    const reply = await handlers.getElementState('save', {
      properties: 'hyphens',
      attributes: 'lang',
    });
    // The tab was asked, and answered: this is its answer refused, not the cache's.
    expect(queue).toHaveBeenCalledWith(
      'getElementState',
      { id: 'save', properties: ['hyphens'], attributes: ['lang'] },
      undefined
    );
    expect(reply.success).toBe(false);
    expect(reply.code).toBe('UB-OBS-CAPABILITY-UNAVAILABLE-IN-BUILD');
    expect(reply.error).toContain('`properties` / `attributes`');
    expect(reply.error).toContain('predates the request-scoped projection');
  });

  it('element state pinned to a tab: the same answer is refused the same way', async () => {
    const { handlers } = oldSdkRelay();
    const reply = await handlers.getElementState('save', { tabId: 'tab-old', attributes: 'lang' });
    expect(reply.success).toBe(false);
    expect(reply.code).toBe('UB-OBS-CAPABILITY-UNAVAILABLE-IN-BUILD');
    expect(reply.error).toContain('predates the request-scoped projection');
  });

  it('find: live rows without the projection asked for are refused, typed — pinned or not', async () => {
    const { handlers } = oldSdkRelay();
    for (const routing of [{}, { tabId: 'tab-old' }]) {
      const reply = await handlers.find({ skipSettle: true, properties: ['hyphens'], ...routing });
      expect(reply.success, JSON.stringify(routing)).toBe(false);
      expect(reply.code).toBe('UB-OBS-CAPABILITY-UNAVAILABLE-IN-BUILD');
      expect(reply.error).toContain('`properties`');
      expect(reply.error).toContain('predates the request-scoped projection');
    }
  });

  it('the same answers are the answer when no projection was asked for', async () => {
    const { handlers } = oldSdkRelay();
    expect((await handlers.getElementState('save', {})).success).toBe(true);
    expect((await handlers.find({ skipSettle: true })).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 3: the `document` page sentinel names `<html>` — which has no registry
// entry — for the reads above and as an `ai/assert` operand, on both
// transports. One resolver serves every site (core/page-sentinel.ts).
// ---------------------------------------------------------------------------

describe.each(transports)('the document sentinel on the $name transport', ({ mount }) => {
  /** `<html lang="de" dir="ltr" style="--page-tone: #123456">`, restored afterwards. */
  function decorateRoot(): void {
    const root = document.documentElement;
    root.setAttribute('lang', 'de');
    root.setAttribute('dir', 'ltr');
    root.style.setProperty('--page-tone', '#123456');
  }

  afterEach(() => {
    const root = document.documentElement;
    root.removeAttribute('lang');
    root.removeAttribute('dir');
    root.removeAttribute('style');
  });

  it('a scroll of each page sentinel, in any case, scrolls the page — one resolver for every site', async () => {
    await mount();
    // jsdom implements no element scrolling: give it a scrollBy to observe.
    const native = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollBy');
    if (!native) HTMLElement.prototype.scrollBy = function () {} as HTMLElement['scrollBy'];
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollBy');
    try {
      for (const id of ['Document', 'body', 'WINDOW']) {
        scroll.mockClear();
        const reply = await post(`/control/element/${id}/action`, {
          action: 'scroll',
          params: { direction: 'down' },
        });
        expect(reply.success, `${id}: ${reply.error}`).toBe(true);
        expect(scroll.mock.contexts[0], id).toBe(
          document.scrollingElement ?? document.documentElement
        );
      }
    } finally {
      scroll.mockRestore();
      if (!native) delete (HTMLElement.prototype as Partial<HTMLElement>).scrollBy;
    }
  });

  it('GET /control/element/document/state reads the projection off <html>', async () => {
    await mount();
    decorateRoot();
    const reply = await get(
      '/control/element/document/state?attributes=lang,dir,title&properties=--page-tone,--unset'
    );
    expect(reply.success, reply.error).toBe(true);
    expect(reply.data).toEqual({
      id: 'document',
      sentinel: 'document',
      tagName: 'html',
      projection: {
        properties: { '--page-tone': '#123456' },
        attributes: { lang: 'de', dir: 'ltr', title: null },
        unmeasured: [expect.objectContaining({ name: '--unset', code: 'input_missing' })],
      },
    });
    // <html> is reached through the sentinel, never registered.
    expect(
      getGlobalRegistry()
        .getAllElements()
        .some((e) => e.element === document.documentElement)
    ).toBe(false);
  });

  it('a read of the sentinel without a query carries its identity alone', async () => {
    await mount();
    const reply = await get('/control/element/document/state');
    expect(reply.success, reply.error).toBe(true);
    expect(reply.data).toEqual({ id: 'document', sentinel: 'document', tagName: 'html' });
  });

  it('only `document` names an element for a read: `window` and `body` do not', async () => {
    await mount();
    for (const id of ['window', 'body']) {
      const reply = await get(`/control/element/${id}/state?attributes=lang`);
      expect(reply.success, `${id} must not resolve for a read`).toBe(false);
    }
  });

  it('ai/assert takes the sentinel as the operand of its style and attribute checks', async () => {
    await mount();
    decorateRoot();
    const reply = await post('/ai/assert/batch', {
      skipSettle: true,
      mode: 'all',
      assertions: [
        { target: 'document', type: 'attribute', attributeName: 'lang', expected: 'de' },
        {
          target: 'document',
          type: 'cssProperty',
          propertyName: '--page-tone',
          expected: '#123456',
        },
        { target: 'document', type: 'attribute', attributeName: 'dir', expected: 'rtl' },
      ],
    });
    expect(reply.success, reply.error).toBe(true);
    const results = reply.data!.results as Array<Record<string, unknown>>;
    expect(results.map((r) => [r.target, r.outcome, r.actual])).toEqual([
      ['document', 'passed', 'de'],
      ['document', 'passed', '#123456'],
      ['document', 'failed', 'ltr'],
    ]);
  });

  it('a registered element named `document` wins over the sentinel', async () => {
    await mount();
    decorateRoot();
    const own = document.createElement('div');
    own.setAttribute('lang', 'en');
    own.textContent = 'document viewer';
    document.body.appendChild(own);
    getGlobalRegistry().registerElement('document', own, { type: 'generic', label: 'document' });

    const state = await get('/control/element/document/state?attributes=lang');
    expect(state.success, state.error).toBe(true);
    expect(state.data).toMatchObject({
      id: 'document',
      projection: { attributes: { lang: 'en' } },
    });
    expect(state.data).not.toHaveProperty('sentinel');

    const assert = await post('/ai/assert', {
      skipSettle: true,
      target: 'document',
      type: 'attribute',
      attributeName: 'lang',
      expected: 'en',
    });
    expect(assert.data).toMatchObject({ outcome: 'passed', actual: 'en' });
  });
});
