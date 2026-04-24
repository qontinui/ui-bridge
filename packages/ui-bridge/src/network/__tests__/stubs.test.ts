/**
 * F2 — Network Stub Registry unit tests.
 *
 * These test the pure `NetworkStubRegistry` + validator contract.
 * Integration tests (fetch interceptor short-circuit + `networkRequests`
 * tagging) live in `commandHandlers.networkStubs.test.ts`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  NetworkStubRegistry,
  validateStubRequest,
  getGlobalStubRegistry,
  __resetGlobalStubRegistryForTest,
} from '../stubs';

describe('NetworkStubRegistry — validation', () => {
  it('rejects missing urlPattern', () => {
    expect(validateStubRequest({ response: { body: 'x' } })?.field).toBe('urlPattern');
  });

  it('rejects empty urlPattern', () => {
    expect(validateStubRequest({ urlPattern: '', response: { body: 'x' } })?.field).toBe(
      'urlPattern'
    );
  });

  it('rejects unknown method', () => {
    expect(
      validateStubRequest({ urlPattern: '/foo', method: 'HEAD', response: { body: 'x' } })?.field
    ).toBe('method');
  });

  it('accepts wildcard method', () => {
    expect(
      validateStubRequest({ urlPattern: '/foo', method: '*', response: { body: 'x' } })
    ).toBeNull();
  });

  it('rejects missing body AND bodyJson', () => {
    expect(validateStubRequest({ urlPattern: '/foo', response: {} })?.field).toBe('response.body');
  });

  it('rejects body AND bodyJson supplied together', () => {
    expect(
      validateStubRequest({ urlPattern: '/foo', response: { body: 'x', bodyJson: { y: 1 } } })
        ?.field
    ).toBe('response.body');
  });

  it('rejects status out of range', () => {
    expect(
      validateStubRequest({ urlPattern: '/foo', response: { status: 99, body: 'x' } })?.field
    ).toBe('response.status');
    expect(
      validateStubRequest({ urlPattern: '/foo', response: { status: 600, body: 'x' } })?.field
    ).toBe('response.status');
  });

  it('rejects non-integer status', () => {
    expect(
      validateStubRequest({ urlPattern: '/foo', response: { status: 200.5, body: 'x' } })?.field
    ).toBe('response.status');
  });

  it('rejects invalid times', () => {
    expect(
      validateStubRequest({ urlPattern: '/foo', response: { body: 'x' }, times: 0 })?.field
    ).toBe('times');
    expect(
      validateStubRequest({ urlPattern: '/foo', response: { body: 'x' }, times: -1 })?.field
    ).toBe('times');
    expect(
      validateStubRequest({ urlPattern: '/foo', response: { body: 'x' }, times: 'once' })?.field
    ).toBe('times');
  });

  it('accepts times: "always"', () => {
    expect(
      validateStubRequest({ urlPattern: '/foo', response: { body: 'x' }, times: 'always' })
    ).toBeNull();
  });

  it('accepts bodyJson alone', () => {
    expect(
      validateStubRequest({ urlPattern: '/foo', response: { bodyJson: { a: 1 } } })
    ).toBeNull();
  });
});

describe('NetworkStubRegistry — register + match', () => {
  let reg: NetworkStubRegistry;

  beforeEach(() => {
    reg = new NetworkStubRegistry();
  });

  it('returns a stub ID on register', () => {
    const id = reg.register({ urlPattern: '/foo', response: { body: 'hi' } });
    expect(id).toMatch(/^stub_/);
  });

  it('default method "*" matches any method', () => {
    reg.register({ urlPattern: '/foo', response: { body: 'hi' } });
    expect(reg.match('/foo', 'GET')).not.toBeNull();
    expect(reg.match('/foo', 'POST')).not.toBeNull();
    expect(reg.match('/foo', 'DELETE')).not.toBeNull();
  });

  it('method constraint rejects mismatches', () => {
    reg.register({ urlPattern: '/foo', method: 'POST', response: { body: 'hi' } });
    expect(reg.match('/foo', 'GET')).toBeNull();
    expect(reg.match('/foo', 'POST')).not.toBeNull();
  });

  it('urlPattern is case-sensitive substring match', () => {
    reg.register({ urlPattern: '/Foo', response: { body: 'hi' } });
    expect(reg.match('/foo', 'GET')).toBeNull();
    expect(reg.match('https://x/Foo?q=1', 'GET')).not.toBeNull();
  });

  it('first-registered wins on overlapping patterns', () => {
    const a = reg.register({ urlPattern: '/foo', response: { body: 'A' } });
    const b = reg.register({ urlPattern: '/foo', response: { body: 'B' } });
    const hit = reg.match('/foo/bar', 'GET');
    expect(hit?.id).toBe(a);
    // Sanity: the second stub still lives in the registry.
    expect(reg.list().map((s) => s.id)).toContain(b);
  });

  it('times: 1 consumes after first hit', () => {
    reg.register({ urlPattern: '/once', response: { body: 'A' }, times: 1 });
    expect(reg.match('/once', 'GET')).not.toBeNull();
    expect(reg.match('/once', 'GET')).toBeNull();
    expect(reg.list()).toHaveLength(0);
  });

  it('times: 3 consumes after three hits', () => {
    reg.register({ urlPattern: '/three', response: { body: 'A' }, times: 3 });
    expect(reg.match('/three', 'GET')?.id).toBeDefined();
    expect(reg.match('/three', 'GET')?.id).toBeDefined();
    expect(reg.match('/three', 'GET')?.id).toBeDefined();
    expect(reg.match('/three', 'GET')).toBeNull();
  });

  it('times: "always" never consumes', () => {
    reg.register({ urlPattern: '/inf', response: { body: 'A' } });
    for (let i = 0; i < 25; i++) {
      expect(reg.match('/inf', 'GET')).not.toBeNull();
    }
    expect(reg.list()[0].hitCount).toBe(25);
  });

  it('tracks hitCount without consumption for times: "always"', () => {
    reg.register({ urlPattern: '/a', response: { body: 'x' }, times: 'always' });
    reg.match('/a', 'GET');
    reg.match('/a', 'GET');
    expect(reg.list()[0].hitCount).toBe(2);
    expect(reg.list()[0].timesRemaining).toBe('always');
  });

  it('buildResponse yields a Response with headers + body + status', async () => {
    reg.register({
      urlPattern: '/data',
      response: { status: 418, headers: { 'x-test': '1' }, body: '{"ok":1}' },
    });
    const m = reg.match('/data', 'GET')!;
    const resp = m.buildResponse();
    expect(resp.status).toBe(418);
    expect(resp.headers.get('x-test')).toBe('1');
    expect(await resp.text()).toBe('{"ok":1}');
  });

  it('bodyJson auto-sets content-type and stringifies', async () => {
    reg.register({ urlPattern: '/j', response: { bodyJson: { hello: 'world' } } });
    const resp = reg.match('/j', 'GET')!.buildResponse();
    expect(resp.headers.get('content-type')).toBe('application/json');
    expect(await resp.json()).toEqual({ hello: 'world' });
  });

  it('explicit content-type in headers overrides the bodyJson default', () => {
    reg.register({
      urlPattern: '/j',
      response: { bodyJson: { a: 1 }, headers: { 'Content-Type': 'application/ld+json' } },
    });
    const resp = reg.match('/j', 'GET')!.buildResponse();
    expect(resp.headers.get('content-type')).toBe('application/ld+json');
  });
});

describe('NetworkStubRegistry — delete / clear / list', () => {
  let reg: NetworkStubRegistry;

  beforeEach(() => {
    reg = new NetworkStubRegistry();
  });

  it('delete by id returns true and hides subsequent matches', () => {
    const id = reg.register({ urlPattern: '/foo', response: { body: 'A' } });
    expect(reg.delete(id)).toBe(true);
    expect(reg.match('/foo', 'GET')).toBeNull();
  });

  it('delete unknown id returns false', () => {
    expect(reg.delete('stub_nope')).toBe(false);
  });

  it('clear drops everything and reports count', () => {
    reg.register({ urlPattern: '/a', response: { body: 'A' } });
    reg.register({ urlPattern: '/b', response: { body: 'B' } });
    expect(reg.clear()).toBe(2);
    expect(reg.list()).toHaveLength(0);
    expect(reg.match('/a', 'GET')).toBeNull();
  });

  it('list returns entries in registration order', () => {
    const a = reg.register({ urlPattern: '/a', response: { body: 'A' } });
    const b = reg.register({ urlPattern: '/b', response: { body: 'B' } });
    const ids = reg.list().map((s) => s.id);
    expect(ids).toEqual([a, b]);
  });
});

describe('NetworkStubRegistry — peek (N3 non-consuming lookup)', () => {
  let reg: NetworkStubRegistry;

  beforeEach(() => {
    reg = new NetworkStubRegistry();
  });

  it('peek returns a match without consuming times: 1 or bumping hitCount', () => {
    const id = reg.register({
      urlPattern: '/once',
      response: { body: 'A' },
      times: 1,
    });

    for (let i = 0; i < 5; i++) {
      const hit = reg.peek('/once', 'GET');
      expect(hit).not.toBeNull();
      expect(hit!.id).toBe(id);
    }

    const [entry] = reg.list();
    expect(entry.timesRemaining).toBe(1);
    expect(entry.hitCount).toBe(0);
  });

  it('peek then match once: peek null afterwards once the stub is consumed', () => {
    reg.register({
      urlPattern: '/once',
      response: { body: 'A' },
      times: 1,
    });

    // Five peeks don't consume.
    for (let i = 0; i < 5; i++) {
      expect(reg.peek('/once', 'GET')).not.toBeNull();
    }

    // A single match() consumes.
    expect(reg.match('/once', 'GET')).not.toBeNull();

    // Registry is empty, peek reports null.
    expect(reg.list()).toHaveLength(0);
    expect(reg.peek('/once', 'GET')).toBeNull();
  });

  it('peek respects method constraint like match', () => {
    reg.register({
      urlPattern: '/m',
      method: 'POST',
      response: { body: 'A' },
    });
    expect(reg.peek('/m', 'GET')).toBeNull();
    expect(reg.peek('/m', 'POST')).not.toBeNull();
  });

  it('peek buildResponse yields the correct status+headers+body', async () => {
    reg.register({
      urlPattern: '/data',
      response: { status: 418, headers: { 'x-test': '1' }, body: '{"ok":1}' },
    });
    const hit = reg.peek('/data', 'GET')!;
    const resp = hit.buildResponse();
    expect(resp.status).toBe(418);
    expect(resp.headers.get('x-test')).toBe('1');
    expect(await resp.text()).toBe('{"ok":1}');
  });

  it('peek returns first-registered on overlapping patterns (FIFO like match)', () => {
    const a = reg.register({ urlPattern: '/foo', response: { body: 'A' } });
    reg.register({ urlPattern: '/foo', response: { body: 'B' } });
    expect(reg.peek('/foo/bar', 'GET')?.id).toBe(a);
  });

  it('peekEntry returns the live entry snapshot with unchanged hitCount', () => {
    reg.register({ urlPattern: '/x', response: { body: 'A' }, times: 3 });
    const entry = reg.peekEntry('/x', 'GET')!;
    expect(entry.urlPattern).toBe('/x');
    expect(entry.timesRemaining).toBe(3);
    expect(entry.hitCount).toBe(0);
    // Peek one more time — still 0 hitCount, still 3 remaining.
    reg.peek('/x', 'GET');
    const after = reg.peekEntry('/x', 'GET')!;
    expect(after.timesRemaining).toBe(3);
    expect(after.hitCount).toBe(0);
  });

  it('peekEntry returns null when no stub matches', () => {
    expect(reg.peekEntry('/nope', 'GET')).toBeNull();
  });
});

describe('NetworkStubRegistry — global singleton', () => {
  beforeEach(() => __resetGlobalStubRegistryForTest());

  it('getGlobalStubRegistry returns a stable instance', () => {
    expect(getGlobalStubRegistry()).toBe(getGlobalStubRegistry());
  });

  it('__resetGlobalStubRegistryForTest swaps in a fresh one', () => {
    const first = getGlobalStubRegistry();
    first.register({ urlPattern: '/foo', response: { body: 'A' } });
    __resetGlobalStubRegistryForTest();
    expect(getGlobalStubRegistry().list()).toHaveLength(0);
  });
});
