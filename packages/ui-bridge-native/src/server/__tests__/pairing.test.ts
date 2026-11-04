/**
 * Device pairing, entered the way a socket enters it: through the handler
 * `start()` hands the adapter. Calling `handleNetworkRequest` directly would
 * stay green if `start()` went back to handing over `handleRequest`, which is
 * the regression that reopens the whole port.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { CloudRelayClient } from '../../transport/CloudRelayClient';
import {
  NativeUIBridgeServer,
  type HTTPRequest,
  type HTTPResponse,
  type RequestHandler,
  type WebSocketServerAdapter,
  type WebSocketUpgradeDecision,
} from '../http-server';
import {
  PairingError,
  SIGNED_BODY_MAX_CHARS,
  SIGNED_METHOD_MAX_CHARS,
  SIGNED_TARGET_MAX_CHARS,
  canonicalSignatureInput,
  isLoopbackAddress,
  isLoopbackHost,
  isUnrebindableHost,
  signUIBridgeRequest,
  type PairingStore,
} from '../pairing';
import * as sha256Module from '../../core/sha256';
import type { NativeServerConfig } from '../types';

const DEVICE_ID = 'device-abc';
const APP_INFO = {
  appId: 'io.qontinui.mobile',
  appName: 'Qontinui',
  appType: 'mobile' as const,
  framework: 'react-native',
};
const SNAPSHOT = '/ui-bridge/control/snapshot';
const HEALTH = '/ui-bridge/health';
const PAIR = '/ui-bridge/pair';
const LAN_PEER = '192.168.1.50';
// The published test vector's token, not a secret.
const TOKEN = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'; // gitleaks:allow

interface MemoryStore extends PairingStore {
  token: string | null;
  sets: string[];
}

function memoryStore(initial: string | null = null): MemoryStore {
  return {
    token: initial,
    sets: [],
    get() {
      return this.token;
    },
    async set(token: string) {
      this.sets.push(token);
      this.token = token;
    },
    async clear() {
      this.token = null;
    },
    randomBytes(n: number) {
      return new Uint8Array(nodeRandomBytes(n));
    },
  };
}

type TestAdapter = WebSocketServerAdapter & { http: RequestHandler };

function fakeAdapter(): TestAdapter {
  const adapter = {
    http: (async () => {
      throw new Error('start() was never called');
    }) as RequestHandler,
    async start(_port: number, handler: RequestHandler) {
      adapter.http = handler;
    },
    async stop() {},
    isRunning: () => true,
  };
  return adapter as unknown as TestAdapter;
}

const stubExecutor = {
  executeAction: async () => ({ success: true, durationMs: 0, timestamp: 0 }),
  executeComponentAction: async () => ({ success: true, durationMs: 0, timestamp: 0 }),
  find: async () => ({ elements: [], count: 0, timestamp: 0 }),
};

async function started(config: NativeServerConfig = {}) {
  const server = new NativeUIBridgeServer(new NativeUIBridgeRegistry(), stubExecutor as never, {
    appInfo: APP_INFO,
    deviceId: DEVICE_ID,
    ...config,
  });
  const adapter = fakeAdapter();
  server.setAdapter(adapter);
  await server.start();
  return { server, adapter, http: (req: HTTPRequest) => adapter.http(req) };
}

function lan(over: Partial<HTTPRequest> = {}): HTTPRequest {
  return {
    method: 'GET',
    path: SNAPSHOT,
    headers: { host: '192.168.1.20:8087' },
    query: {},
    remoteAddress: LAN_PEER,
    ...over,
  };
}

function cable(over: Partial<HTTPRequest> = {}): HTTPRequest {
  return lan({ headers: { host: 'localhost:8087' }, remoteAddress: '127.0.0.1', ...over });
}

let nonceCounter = 0;
function freshNonce(): string {
  nonceCounter += 1;
  return `nonce${String(nonceCounter).padStart(16, '0')}`;
}

/** A LAN request signed the way a runner signs it. */
function signed(
  token: string,
  over: Partial<HTTPRequest> & { ts?: number; nonce?: string } = {}
): HTTPRequest {
  const { ts, nonce, ...request } = over;
  const req = lan(request);
  const header = signUIBridgeRequest(token, {
    method: req.method,
    pathAndQuery: req.rawTarget ?? req.path,
    body: req.rawBody,
    ts: ts ?? Date.now(),
    nonce: nonce ?? freshNonce(),
  });
  return { ...req, headers: { ...req.headers, 'x-ui-bridge-auth': header } };
}

function json(response: HTTPResponse): {
  success: boolean;
  code?: string;
  data?: Record<string, unknown>;
} {
  return JSON.parse(response.body);
}

function expectRefused(response: HTTPResponse, code = 'PAIRING_REQUIRED'): void {
  expect(response.status).toBe(401);
  expect(json(response).code).toBe(code);
}

/** A timestamp refusal, which has to tell the caller what to re-sync to. */
function expectTimestampRefused(response: HTTPResponse): number {
  expectRefused(response, 'PAIRING_TIMESTAMP_REFUSED');
  const serverTime = json(response).data!.serverTime as number;
  expect(serverTime).toBe(Date.now());
  return serverTime;
}

/** Every upgrade off the machine ends here, whatever it carries. */
function expectUpgradeRefused(decision: WebSocketUpgradeDecision): void {
  expect(decision.admit).toBe(false);
  if (decision.admit) return;
  expect(decision.response.status).toBe(403);
  expect(json(decision.response).code).toBe('PAIRING_WS_LOOPBACK_ONLY');
}

function corsHeaderNames(response: HTTPResponse): string[] {
  return Object.keys(response.headers).filter((name) => /^access-control-/i.test(name));
}

/**
 * Fakes the wall clock and the monotonic one together. `vi.advanceTimersByTime`
 * is time passing, which moves both. `vi.setSystemTime` is a clock step, which
 * moves only the wall clock.
 */
function fakeClocks(now: number): void {
  vi.useFakeTimers({ now, toFake: ['Date', 'performance'] });
}

function expectServed(response: HTTPResponse): void {
  expect(response.status).toBe(200);
  expect(json(response).success).toBe(true);
}

function postPair(over: Partial<HTTPRequest> = {}): HTTPRequest {
  return lan({ method: 'POST', path: PAIR, ...over });
}

function postCode(code: unknown, peer = LAN_PEER): HTTPRequest {
  return postPair({ body: { code }, remoteAddress: peer });
}

/** A valid 6-digit code that is not the armed one. */
function wrongCode(code: string): string {
  return code === '000000' ? '000001' : '000000';
}

describe('the network entry refuses an unpaired caller', () => {
  it('the network entry refuses an unpaired LAN peer', async () => {
    // A loopback Host, so only the peer address can be what refuses this.
    const { server } = await started({ pairingStore: memoryStore('t'.repeat(64)) });
    const response = await server.handleNetworkRequest(
      lan({ headers: { host: 'localhost:8087' } })
    );
    expect(response.status).toBe(401);
    expect(json(response).code).toBe('PAIRING_REQUIRED');
  });

  it('answers 401 on HTTP to a LAN peer with no signature', async () => {
    const { http } = await started({ pairingStore: memoryStore('t'.repeat(64)) });
    expectRefused(await http(lan()));
    expectRefused(await http(lan({ method: 'POST', path: '/ui-bridge/control/tap', body: {} })));
    expectRefused(await http(lan({ path: '/ui-bridge/_routes' })));
    expectRefused(await http(lan({ path: '/ui-bridge/control/console-errors' })));
    expectRefused(await http(lan({ method: 'OPTIONS' })));
  });

  it('refuses a LAN peer on a WebSocket upgrade', async () => {
    const { server } = await started({ pairingStore: memoryStore('t'.repeat(64)) });
    expectUpgradeRefused(server.handleWebSocketUpgrade(lan({ path: '/' })));
  });

  it('refuses a correctly signed WebSocket upgrade', async () => {
    const token = 't'.repeat(64);
    const { server } = await started({ pairingStore: memoryStore(token) });
    expectUpgradeRefused(server.handleWebSocketUpgrade(signed(token, { path: '/' })));
  });

  it('refuses a signed GET that was swallowed and re-sent as an upgrade', async () => {
    const token = 't'.repeat(64);
    const { http, server } = await started({ pairingStore: memoryStore(token) });
    const captured = signed(token, { path: HEALTH });
    const resent = {
      ...captured,
      headers: {
        ...captured.headers,
        upgrade: 'websocket',
        connection: 'Upgrade',
        'sec-websocket-key': 'x',
      },
    };
    expectUpgradeRefused(server.handleWebSocketUpgrade(resent));
    // The refusal spent nothing: the request it was carved from still serves once.
    expect(json(await http(captured)).data!.pairing).toEqual({
      required: true,
      authenticated: true,
    });
  });

  it('refuses the JSON-RPC of an adapter that never gated its upgrade', async () => {
    const { server } = await started({ pairingStore: memoryStore('t'.repeat(64)) });
    const message = JSON.stringify({ id: 1, method: 'control/snapshot' });
    const refused = JSON.parse((await server.handleNetworkWebSocketMessage('c', message)) ?? '{}');
    expect(refused.result.code).toBe('PAIRING_UNCONFIGURED');
    expect(refused.result.success).toBe(false);

    server.handleWebSocketUpgrade(cable({ path: '/' }));
    const served = JSON.parse((await server.handleNetworkWebSocketMessage('c', message)) ?? '{}');
    expect(served.result.success).toBe(true);
  });

  it.each([
    [JSON.stringify({ id: 7, method: 'health' }), 7],
    [JSON.stringify({ id: 'abc', method: 'health' }), 'abc'],
    [JSON.stringify({ method: 'health' }), 0],
    [JSON.stringify({ id: { nested: true } }), 0],
    ['null', 0],
    ['not json', 0],
  ])('answers the un-gated refusal of %s with the id it asked with', async (message, id) => {
    const { server } = await started({ pairingStore: memoryStore('t'.repeat(64)) });
    const refused = JSON.parse((await server.handleNetworkWebSocketMessage('c', message)) ?? '{}');
    expect(refused.id).toBe(id);
    expect(refused.result.code).toBe('PAIRING_UNCONFIGURED');
  });
});

describe('the loopback exemption', () => {
  it('admits a loopback peer with no Origin and no store at all', async () => {
    const { http, server } = await started();
    expectServed(await http(cable()));
    expect(server.handleWebSocketUpgrade(cable({ path: '/' }))).toEqual({ admit: true });
  });

  it('refuses a loopback peer that sends an Origin, as a CORS request from a page does', async () => {
    const { http, server } = await started({ pairingStore: memoryStore('t'.repeat(64)) });
    const page = {
      headers: { host: '127.0.0.1:8087', origin: 'https://evil.example' },
    };
    expectRefused(await http(cable(page)));
    expectRefused(await http(cable({ headers: { host: 'localhost:8087', origin: 'null' } })));
    expectUpgradeRefused(server.handleWebSocketUpgrade(cable({ ...page, path: '/' })));
  });

  it.each([
    ['cross-site', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' }],
    ['same-site', { 'sec-fetch-site': 'same-site' }],
    ['same-origin', { 'sec-fetch-site': 'same-origin' }],
    ['any casing', { 'Sec-Fetch-Site': 'CROSS-SITE' }],
    ['a Referer', { referer: 'https://evil.example/' }],
    ['a Referer in any casing', { Referer: 'https://evil.example/' }],
  ])('refuses a no-cors request from a page, which sends no Origin: %s', async (_name, web) => {
    const { http, server } = await started({ pairingStore: memoryStore('t'.repeat(64)) });
    const page = { headers: { host: '127.0.0.1:8087', ...web } };
    expectRefused(await http(cable(page)));
    expectUpgradeRefused(server.handleWebSocketUpgrade(cable({ ...page, path: '/' })));
  });

  it('still admits Sec-Fetch-Site: none, which is a person typing the URL', async () => {
    const { http } = await started({ pairingStore: memoryStore('t'.repeat(64)) });
    const typed = { headers: { host: '127.0.0.1:8087', 'sec-fetch-site': 'None ' } };
    expectServed(await http(cable(typed)));
  });

  it('refuses a loopback peer with a foreign Host, which is DNS rebinding', async () => {
    const { http } = await started({ pairingStore: memoryStore('t'.repeat(64)) });
    expectRefused(await http(cable({ headers: { host: 'evil.example:8087' } })));
    expectRefused(await http(cable({ headers: { host: '127.0.0.1.evil.example' } })));
    expectRefused(await http(cable({ headers: {} })));
  });

  it.each([
    'localhost',
    'localhost:8087',
    'LOCALHOST:8087',
    '127.0.0.1',
    '127.0.0.1:8087',
    '127.5.6.7:1',
    '[::1]',
    '[::1]:8087',
    '[0:0:0:0:0:0:0:1]:8087',
    '[::ffff:127.0.0.1]:8087',
  ])('accepts Host %s', (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each([
    '',
    'evil.example',
    'evil.example:8087',
    'localhost.evil.example',
    '127.0.0.1.evil.example',
    '128.0.0.1',
    '192.168.1.20:8087',
    'localhost:',
    'localhost:99999',
    '::1',
    '::1:8087',
    '[::2]:8087',
    '[::1]8087',
    'localhost, evil.example',
  ])('refuses Host %j', (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });

  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '::1',
    '0:0:0:0:0:0:0:1',
    '0000:0000:0000:0000:0000:0000:0000:0001',
    '::ffff:127.0.0.1',
    '0:0:0:0:0:ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::1%lo',
  ])('passes peer %s end to end', async (remoteAddress) => {
    expect(isLoopbackAddress(remoteAddress)).toBe(true);
    const { http } = await started();
    expectServed(await http(cable({ remoteAddress })));
  });

  it.each([
    '192.168.1.50',
    '128.0.0.1',
    '127.0.0.256',
    '127.0.0',
    '127.0.0.1.evil.example',
    '::',
    '::2',
    '1::1',
    '::ffff:192.168.1.50',
    '::ffff:128.0.0.1',
    '::127.0.0.1',
    'localhost',
    '',
  ])('refuses peer %j end to end', async (remoteAddress) => {
    expect(isLoopbackAddress(remoteAddress)).toBe(false);
    const { http } = await started({ pairingStore: memoryStore('t'.repeat(64)) });
    expectRefused(await http(cable({ remoteAddress })));
  });

  it('refuses a request with no peer address, and says why once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { http } = await started({ pairingStore: memoryStore('t'.repeat(64)) });
      expectRefused(await http(cable({ remoteAddress: undefined })));
      expectRefused(await http(cable({ remoteAddress: undefined })));
      const warned = warn.mock.calls.filter((args) => String(args[0]).includes('no peer address'));
      expect(warned).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('header names match case-insensitively', () => {
  it('sees an Origin under any casing', async () => {
    const { http } = await started({ pairingStore: memoryStore('t'.repeat(64)) });
    for (const name of ['Origin', 'ORIGIN', 'oRiGiN']) {
      expectRefused(await http(cable({ headers: { Host: 'localhost', [name]: 'https://x' } })));
    }
  });

  it('reads a Host under any casing', async () => {
    const { http } = await started();
    for (const name of ['Host', 'HOST', 'hOsT']) {
      expectServed(await http(cable({ headers: { [name]: 'localhost:8087' } })));
    }
  });

  it('refuses when two casings of Host disagree', async () => {
    const { http } = await started({ pairingStore: memoryStore('t'.repeat(64)) });
    expectRefused(await http(cable({ headers: { Host: 'localhost', host: 'evil.example' } })));
  });

  it('reads the signature under any casing', async () => {
    const token = 't'.repeat(64);
    const { http } = await started({ pairingStore: memoryStore(token) });
    for (const name of ['X-UI-Bridge-Auth', 'x-ui-bridge-auth', 'X-UI-BRIDGE-AUTH']) {
      const header = signUIBridgeRequest(token, {
        method: 'GET',
        pathAndQuery: SNAPSHOT,
        ts: Date.now(),
        nonce: freshNonce(),
      });
      expectServed(await http(lan({ headers: { host: 'x', [name]: header } })));
    }
  });
});

describe('the signature', () => {
  const FIXED_NONCE = '0123456789abcdef0123456789abcdef';
  const FIXED_TS = 1798761600000;

  it('matches a vector computed by an independent HMAC, which a Rust signer can pin', () => {
    // Computed by Node's OpenSSL-backed crypto over the bytes below, and pasted
    // here, so this fails if the canonical string or the HMAC moves at all.
    const body = '{"elementId":"é"}';
    const target = '/ui-bridge/control/element/a%20b/action?x=1&y=%C3%A9';
    const sig = '6be10f9a7c3dec0f0ed248a5b23a7110abb94f30f870d7ac5f706b68f80c7586';
    expect(
      signUIBridgeRequest(TOKEN, {
        method: 'POST',
        pathAndQuery: target,
        body,
        ts: FIXED_TS,
        nonce: FIXED_NONCE,
      })
    ).toBe(`${FIXED_TS}.${FIXED_NONCE}.${sig}`);

    expect(
      signUIBridgeRequest(TOKEN, {
        method: 'GET',
        pathAndQuery: SNAPSHOT,
        ts: FIXED_TS,
        nonce: FIXED_NONCE,
      })
    ).toBe(
      `${FIXED_TS}.${FIXED_NONCE}.d856303e4228382376cf7dd3adf5fc190a82d1cb2e0f54eb6fb31fb6b1de02bf`
    );
  });

  it('has the documented canonical form', () => {
    const input = canonicalSignatureInput({
      method: 'POST',
      pathAndQuery: '/a?b=1',
      ts: '12',
      nonce: 'n',
      bodySha256Hex: 'ff',
    });
    expect(input).toBe('POST\n/a?b=1\n12\nn\nff');
  });

  it('admits a valid signature, with a raw target and a raw body', async () => {
    const { http } = await started({ pairingStore: memoryStore(TOKEN) });
    expectServed(await http(signed(TOKEN)));
    expectServed(
      await http(
        signed(TOKEN, {
          rawTarget: `${SNAPSHOT}?visibleOnly=true&a=%20b`,
          query: { visibleOnly: 'true', a: ' b' },
        })
      )
    );
    const rawBody = '{"query":"é"}';
    const response = await http(
      signed(TOKEN, {
        method: 'POST',
        path: '/ui-bridge/control/find',
        body: JSON.parse(rawBody),
        rawBody,
      })
    );
    expectServed(response);
  });

  it('refuses a replay of a request it already served', async () => {
    const { http } = await started({ pairingStore: memoryStore(TOKEN) });
    const request = signed(TOKEN);
    expectServed(await http(request));
    expectRefused(await http(request));
  });

  it('lets only one of two simultaneous copies through', async () => {
    const { http } = await started({ pairingStore: memoryStore(TOKEN) });
    const request = signed(TOKEN);
    const statuses = (await Promise.all([http(request), http(request)])).map((r) => r.status);
    expect(statuses.sort()).toEqual([200, 401]);
  });

  it('holds its window at 300 s on both sides', async () => {
    const now = Date.now();
    fakeClocks(now);
    try {
      const { http } = await started({ pairingStore: memoryStore(TOKEN) });
      vi.advanceTimersByTime(400_000);
      const clock = Date.now();
      expectTimestampRefused(await http(signed(TOKEN, { ts: clock + 300_001 })));
      expectTimestampRefused(await http(signed(TOKEN, { ts: clock - 300_001 })));
      expectServed(await http(signed(TOKEN, { ts: clock + 299_000 })));
      expectServed(await http(signed(TOKEN, { ts: clock - 299_000 })));
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads a timestamp in seconds as skew, not as a valid time', async () => {
    const { http } = await started({ pairingStore: memoryStore(TOKEN) });
    expect(json(await http(signed(TOKEN, { ts: Math.floor(Date.now() / 1000) }))).code).toBe(
      'PAIRING_TIMESTAMP_REFUSED'
    );
  });

  it('refuses a request captured before this server started, whose nonce it cannot know', async () => {
    const now = Date.now();
    vi.useFakeTimers({ now, toFake: ['Date'] });
    try {
      const captured = signed(TOKEN, { ts: now - 1000 });
      const { http } = await started({ pairingStore: memoryStore(TOKEN) });
      expectTimestampRefused(await http(captured));
      expectServed(await http(signed(TOKEN, { ts: now })));
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps refusing a replay after the bounded cache has evicted its nonce', async () => {
    const now = Date.now();
    vi.useFakeTimers({ now, toFake: ['Date'] });
    try {
      const { http } = await started({ pairingStore: memoryStore(TOKEN) });
      const first = signed(TOKEN, { ts: now + 1 });
      expectServed(await http(first));
      for (let i = 0; i < 4096; i++) {
        expectServed(await http(signed(TOKEN, { ts: now + 2 })));
      }
      // The cache holds 4096, so the first nonce is gone. It must still not pass.
      expectTimestampRefused(await http(first));
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps refusing a nonce the expiry sweep forgot, on a runtime that cannot see a step', async () => {
    const now = Date.now();
    vi.useFakeTimers({ now, toFake: ['Date'] });
    vi.stubGlobal('performance', undefined);
    try {
      const { http } = await started({ pairingStore: memoryStore(TOKEN) });
      const victim = signed(TOKEN, { ts: now + 1000 });
      expectServed(await http(victim));
      for (let i = 0; i < 4095; i++) {
        expectServed(await http(signed(TOKEN, { ts: now + 1000 })));
      }
      // A clock an hour ahead makes the whole cache look expired, and the next
      // request sweeps it.
      vi.setSystemTime(now + 3_600_000);
      expectServed(await http(signed(TOKEN, { ts: now + 3_600_000 })));
      vi.setSystemTime(now + 2000);
      expectRefused(await http(victim), 'PAIRING_TIMESTAMP_REFUSED');
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it.each([
    ['another method', { method: 'POST' }],
    ['another path', { path: '/ui-bridge/control/elements' }],
  ])('refuses a signature moved to %s', async (_name, change) => {
    const { http } = await started({ pairingStore: memoryStore(TOKEN) });
    const request = signed(TOKEN);
    expectRefused(await http({ ...request, ...change }));
  });

  it('refuses a signature moved to another query', async () => {
    const { http } = await started({ pairingStore: memoryStore(TOKEN) });
    const request = signed(TOKEN, { rawTarget: `${SNAPSHOT}?a=1`, query: { a: '1' } });
    expectRefused(await http({ ...request, rawTarget: `${SNAPSHOT}?a=2`, query: { a: '2' } }));
  });

  it('refuses a signature moved to another body', async () => {
    const { http } = await started({ pairingStore: memoryStore(TOKEN) });
    const request = signed(TOKEN, {
      method: 'POST',
      path: '/ui-bridge/control/tap',
      rawBody: '{"x":1}',
      body: { x: 1 },
    });
    expectRefused(await http({ ...request, rawBody: '{"x":2}', body: { x: 2 } }));
  });

  it('refuses a signature made with another token', async () => {
    const { http } = await started({ pairingStore: memoryStore(TOKEN) });
    expectRefused(await http(signed('f'.repeat(64))));
  });

  it('refuses what it cannot check: a parsed body or query with no raw form', async () => {
    const { http } = await started({ pairingStore: memoryStore(TOKEN) });
    const body = await http({ ...signed(TOKEN, { method: 'POST' }), body: { x: 1 } });
    expectRefused(body);
    const query = await http({ ...signed(TOKEN), query: { visibleOnly: 'true' } });
    expectRefused(query);
  });

  it('refuses a raw target whose path is not the path being routed', async () => {
    const { http } = await started({ pairingStore: memoryStore(TOKEN) });
    const request = signed(TOKEN, { path: '/ui-bridge/control/tap', rawTarget: SNAPSHOT });
    expectRefused(await http(request));
  });

  it.each([
    ['empty', ''],
    ['no parts', 'abc'],
    ['two parts', '1.2'],
    ['a short nonce', () => `${Date.now()}.short.${'a'.repeat(64)}`],
    ['a short signature', () => `${Date.now()}.${'n'.repeat(32)}.abcd`],
    ['extra parts', () => `${Date.now()}.${'n'.repeat(32)}.${'a'.repeat(64)}.x`],
  ])('refuses a malformed header: %s', async (_name, value) => {
    const { http } = await started({ pairingStore: memoryStore(TOKEN) });
    const header = typeof value === 'function' ? value() : value;
    expectRefused(await http(lan({ headers: { host: 'x', 'x-ui-bridge-auth': header } })));
  });

  // Correctly signed, so only the nonce's form can be what refuses them.
  it.each([
    ['a newline', `${'n'.repeat(16)}\n`],
    ['a space', `${'n'.repeat(16)} x`],
    ['a plus', `${'n'.repeat(16)}+x`],
    ['a slash', `${'n'.repeat(16)}/x`],
    ['a non-ASCII letter', `${'n'.repeat(16)}é`],
    ['too short', 'n'.repeat(15)],
    ['too long', 'n'.repeat(65)],
  ])('refuses a correctly signed nonce with %s', async (_name, nonce) => {
    const { http } = await started({ pairingStore: memoryStore(TOKEN) });
    expectRefused(await http(signed(TOKEN, { nonce })));
  });

  it.each([
    ['the shortest', 'n'.repeat(16)],
    ['the longest', 'n'.repeat(64)],
    ['every class', 'aZ09_-aZ09_-aZ09'],
  ])('admits a correctly signed nonce of %s form', async (_name, nonce) => {
    const { http } = await started({ pairingStore: memoryStore(TOKEN) });
    expectServed(await http(signed(TOKEN, { nonce })));
  });

  it('refuses an uppercase signature, since the form has one spelling', async () => {
    const { http } = await started({ pairingStore: memoryStore(TOKEN) });
    const request = signed(TOKEN);
    const [ts, nonce, sig] = request.headers['x-ui-bridge-auth']!.split('.');
    const upper = `${ts}.${nonce}.${sig!.toUpperCase()}`;
    expectRefused(await http({ ...request, headers: { host: 'x', 'x-ui-bridge-auth': upper } }));
  });

  it('refuses two signature headers rather than choosing one', async () => {
    const { http } = await started({ pairingStore: memoryStore(TOKEN) });
    const request = signed(TOKEN);
    const header = request.headers['x-ui-bridge-auth']!;
    const headers = { host: 'x', 'X-UI-Bridge-Auth': header, 'x-ui-bridge-auth': header };
    expectRefused(await http({ ...request, headers }));
  });

  it('never accepts a store holding an empty token, whose key is public', async () => {
    const { http } = await started({ pairingStore: memoryStore('') });
    const response = await http(signed(''));
    expect(response.status).toBe(503);
    expect(json(response).code).toBe('PAIRING_UNAVAILABLE');
  });
});

describe('a cable pairs with no code', () => {
  it('mints a token, returns the device id, and carries no CORS header', async () => {
    const store = memoryStore();
    const { http } = await started({ pairingStore: store, cors: true });
    const response = await http(cable({ method: 'POST', path: PAIR }));
    expectServed(response);
    const data = json(response).data!;
    expect(data.token).toMatch(/^[0-9a-f]{64}$/);
    expect(data.deviceId).toBe(DEVICE_ID);
    expect(typeof data.serverTime).toBe('number');
    expect(store.token).toBe(data.token);
    expect(response.headers['Cache-Control']).toBe('no-store');
    expect(Object.keys(response.headers).join()).not.toMatch(/access-control/i);
  });

  it('is idempotent, so a second runner does not invalidate the first', async () => {
    const store = memoryStore();
    const { http } = await started({ pairingStore: store });
    const first = json(await http(cable({ method: 'POST', path: PAIR }))).data!.token;
    const second = json(await http(cable({ method: 'POST', path: PAIR }))).data!.token;
    expect(second).toBe(first);
    expect(store.sets).toHaveLength(1);
  });

  it('mints one token for two simultaneous first calls', async () => {
    const store = memoryStore();
    const { http } = await started({ pairingStore: store });
    const responses = await Promise.all([
      http(cable({ method: 'POST', path: PAIR })),
      http(cable({ method: 'POST', path: PAIR })),
    ]);
    expect(json(responses[0]!).data!.token).toBe(json(responses[1]!).data!.token);
    expect(store.sets).toHaveLength(1);
  });

  it('answers only after the store write has finished', async () => {
    let finishWrite!: () => void;
    const store = memoryStore();
    store.set = () => new Promise<void>((resolve) => (finishWrite = resolve));
    const { http } = await started({ pairingStore: store });

    let answered = false;
    const pending = http(cable({ method: 'POST', path: PAIR })).then((r) => {
      answered = true;
      return r;
    });
    await vi.waitFor(() => expect(finishWrite).toBeDefined());
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(answered).toBe(false);

    finishWrite();
    expectServed(await pending);
  });

  it('hands out no token when the write fails', async () => {
    const store = memoryStore();
    store.set = async () => {
      throw new Error('disk full');
    };
    const { http } = await started({ pairingStore: store });
    const response = await http(cable({ method: 'POST', path: PAIR }));
    expect(response.status).toBe(503);
    expect(json(response).data).toBeUndefined();
  });

  it('refuses a generator that returns the wrong length or nothing but zeros', async () => {
    for (const bytes of [new Uint8Array(4).fill(7), new Uint8Array(32)]) {
      const store = memoryStore();
      store.randomBytes = () => bytes;
      const { http } = await started({ pairingStore: store });
      expect((await http(cable({ method: 'POST', path: PAIR }))).status).toBe(503);
      expect(store.sets).toEqual([]);
    }
  });

  it('holds pairing until the device id has loaded, then needs no restart', async () => {
    const { http, server } = await started({
      pairingStore: memoryStore(),
      deviceId: undefined,
    });
    const before = await http(cable({ method: 'POST', path: PAIR }));
    expect(before.status).toBe(503);
    expect(json(before).code).toBe('PAIRING_UNAVAILABLE');

    server.setDeviceId(DEVICE_ID);
    expect(json(await http(cable({ method: 'POST', path: PAIR }))).data!.deviceId).toBe(DEVICE_ID);
  });

  it('treats a loopback caller with a foreign Host as a LAN pair, which needs a code', async () => {
    const store = memoryStore();
    const { http } = await started({ pairingStore: store });
    const response = await http(
      cable({ method: 'POST', path: PAIR, headers: { host: 'evil.example' } })
    );
    expectRefused(response, 'PAIRING_NOT_ARMED');
    expect(store.sets).toEqual([]);
  });
});

describe('a LAN pair spends an armed code', () => {
  it('refuses unarmed, without comparing, and without spending anything', async () => {
    const store = memoryStore();
    const { http, server } = await started({ pairingStore: store });
    expectRefused(await http(postCode('123456')), 'PAIRING_NOT_ARMED');
    expect(server.getPairingState().armed).toBe(false);
    expect(store.sets).toEqual([]);
  });

  it('gets the token with the right code, once, and shows who consumed it', async () => {
    const store = memoryStore();
    const { http, server } = await started({ pairingStore: store });
    const { code, expiresAt } = await server.armPairingCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(server.getPairingState()).toMatchObject({
      armed: true,
      expiresAt,
      attemptsRemaining: 5,
    });

    const response = await http(postCode(code));
    expectServed(response);
    expect(json(response).data!.token).toBe(store.token);
    expect(json(response).data!.deviceId).toBe(DEVICE_ID);

    const state = server.getPairingState();
    expect(state.armed).toBe(false);
    expect(state.consumedBy).toBe(LAN_PEER);
    expect(typeof state.consumedAt).toBe('number');
    expect(state.disarmReason).toBe('consumed');

    expectRefused(await http(postCode(code)), 'PAIRING_NOT_ARMED');
  });

  it('returns the token a cable already issued, so one phone has one token', async () => {
    const store = memoryStore();
    const { http, server } = await started({ pairingStore: store });
    const viaCable = json(await http(cable({ method: 'POST', path: PAIR }))).data!.token;
    const { code } = await server.armPairingCode();
    expect(json(await http(postCode(code))).data!.token).toBe(viaCable);
    expect(store.sets).toHaveLength(1);
  });

  it('disarms globally after 5 wrong attempts from different peers, and mints nothing', async () => {
    const store = memoryStore();
    const randomBytes = vi.spyOn(store, 'randomBytes');
    const { http, server } = await started({ pairingStore: store });
    const { code } = await server.armPairingCode();
    const wrong = wrongCode(code);
    randomBytes.mockClear();

    for (let i = 1; i <= 4; i++) {
      expectRefused(await http(postCode(wrong, `192.168.1.${i}`)), 'PAIRING_CODE_INVALID');
      expect(server.getPairingState().attemptsRemaining).toBe(5 - i);
    }
    expectRefused(await http(postCode(wrong, '192.168.1.5')), 'PAIRING_CODE_INVALID');

    const state = server.getPairingState();
    expect(state.armed).toBe(false);
    expect(state.disarmReason).toBe('attempts_exhausted');
    expect(state.consumedBy).toBeNull();

    // The right code no longer works, and no replacement appeared.
    expectRefused(await http(postCode(code)), 'PAIRING_NOT_ARMED');
    expect(randomBytes).not.toHaveBeenCalled();
    expect(store.sets).toEqual([]);
  });

  it('still accepts the right code on the fifth attempt', async () => {
    const { http, server } = await started({ pairingStore: memoryStore() });
    const { code } = await server.armPairingCode();
    for (let i = 0; i < 4; i++) await http(postCode(wrongCode(code)));
    expectServed(await http(postCode(code)));
  });

  it('counts simultaneous guesses exactly', async () => {
    const { http, server } = await started({ pairingStore: memoryStore() });
    const { code } = await server.armPairingCode();
    await Promise.all(Array.from({ length: 5 }, () => http(postCode(wrongCode(code)))));
    expect(server.getPairingState().disarmReason).toBe('attempts_exhausted');
  });

  it('spends no attempt on a value that cannot be a guess', async () => {
    const { http, server } = await started({ pairingStore: memoryStore() });
    const { code } = await server.armPairingCode();
    for (const bad of [
      undefined,
      null,
      123456,
      '12345',
      '1234567',
      'abcdef',
      ['123456'],
      code + ' ',
    ]) {
      const response = await http(postCode(bad));
      expect(response.status).toBe(400);
      expect(json(response).code).toBe('PAIRING_CODE_REQUIRED');
    }
    await http(postPair({ body: 'not json' }));
    expect(server.getPairingState().attemptsRemaining).toBe(5);
    expectServed(await http(postCode(code)));
  });

  it('expires after about two minutes', async () => {
    const now = Date.now();
    vi.useFakeTimers({ now, toFake: ['Date'] });
    try {
      const { http, server } = await started({ pairingStore: memoryStore() });
      const { code, expiresAt } = await server.armPairingCode();
      expect(expiresAt - now).toBe(120_000);
      vi.setSystemTime(now + 119_000);
      expect(server.getPairingState().armed).toBe(true);
      vi.setSystemTime(now + 120_000);
      expect(server.getPairingState()).toMatchObject({ armed: false, disarmReason: 'expired' });
      expectRefused(await http(postCode(code)), 'PAIRING_NOT_ARMED');
    } finally {
      vi.useRealTimers();
    }
  });

  it('can be cancelled from the app', async () => {
    const { http, server } = await started({ pairingStore: memoryStore() });
    const { code } = await server.armPairingCode();
    server.disarmPairingCode();
    expect(server.getPairingState()).toMatchObject({ armed: false, disarmReason: 'cancelled' });
    expectRefused(await http(postCode(code)), 'PAIRING_NOT_ARMED');
  });

  it('draws a code from the store generator, and resamples above the unbiased limit', async () => {
    const store = memoryStore();
    const draws = [
      new Uint8Array([0xff, 0xff, 0xff, 0xff]), // above the limit: must be redrawn
      new Uint8Array([0x00, 0x00, 0x00, 0x2a]), // 42
    ];
    store.randomBytes = (n: number) => {
      expect(n).toBe(4);
      return draws.shift()!;
    };
    const { server } = await started({ pairingStore: store });
    expect((await server.armPairingCode()).code).toBe('000042');
    expect(draws).toEqual([]);
  });

  it('refuses to arm when no store is configured', async () => {
    const { server } = await started();
    await expect(server.armPairingCode()).rejects.toBeInstanceOf(PairingError);
    expect(server.getPairingState().configured).toBe(false);
  });
});

describe('a web page cannot reach pairing', () => {
  const WEB_HEADERS: Array<[string, Record<string, string>]> = [
    ['an Origin', { origin: 'https://evil.example' }],
    ['a null Origin', { origin: 'null' }],
    ['a Referer', { referer: 'https://evil.example/' }],
    ['a Sec-Fetch-Site', { 'sec-fetch-site': 'cross-site' }],
  ];

  it.each(WEB_HEADERS)('refuses a pair carrying %s before it touches the code', async (_n, web) => {
    const store = memoryStore();
    const get = vi.spyOn(store, 'get');
    const { http, server } = await started({ pairingStore: store });
    const { code } = await server.armPairingCode();
    const before = server.getPairingState();

    for (const remoteAddress of ['127.0.0.1', LAN_PEER]) {
      for (const guess of [code, wrongCode(code)]) {
        const response = await http(
          postPair({
            remoteAddress,
            body: { code: guess },
            headers: { host: '127.0.0.1:8087', ...web },
          })
        );
        expect(response.status).toBe(403);
        expect(json(response).code).toBe('PAIRING_WEB_CALLER_REFUSED');
        expect(corsHeaderNames(response)).toEqual([]);
      }
    }

    expect(server.getPairingState()).toEqual(before);
    expect(store.sets).toEqual([]);
    expect(get).toHaveBeenCalledTimes(1); // the arm's own read, and no other
    expectServed(await http(postCode(code)));
  });

  it('refuses a pair from a page ahead of the no-store answer', async () => {
    const { http } = await started();
    const response = await http(postPair({ headers: { host: 'x', origin: 'https://e.example' } }));
    expect(json(response).code).toBe('PAIRING_WEB_CALLER_REFUSED');
  });

  it('lets a page read nothing from the gate or from open health', async () => {
    const { http, server } = await started({
      pairingStore: memoryStore('t'.repeat(64)),
      allowedOrigins: ['https://allowed.example'],
    });
    const headers = { host: '127.0.0.1:8087', origin: 'https://evil.example' };
    const answers = [
      await http(cable({ headers })),
      await http(cable({ headers, path: HEALTH })),
      await http(lan({ headers: { ...headers, 'x-ui-bridge-auth': 'bad' } })),
      await http(lan({ headers })),
      await http(lan({ headers, path: HEALTH })),
      await http(lan({ headers, method: 'OPTIONS' })),
      await http(postPair({ headers })),
    ];
    const upgrade = server.handleWebSocketUpgrade(cable({ headers, path: '/' }));
    if (!upgrade.admit) answers.push(upgrade.response);
    expect(answers).toHaveLength(8);
    for (const answer of answers) expect(corsHeaderNames(answer)).toEqual([]);
  });

  it('keeps CORS on a route an admitted caller reaches', async () => {
    const { http } = await started({ pairingStore: memoryStore('t'.repeat(64)) });
    expect(corsHeaderNames(await http(cable()))).not.toEqual([]);
  });
});

describe('a correct code survives a store that lets it down', () => {
  function failingWrites(store: MemoryStore): () => void {
    const realSet = store.set;
    store.set = async () => {
      throw new Error('disk full');
    };
    return () => {
      store.set = realSet;
    };
  }

  it('gives the code back when the write fails, with its attempts as they were', async () => {
    const store = memoryStore();
    const restore = failingWrites(store);
    const { http, server } = await started({ pairingStore: store });
    const { code } = await server.armPairingCode();
    expectRefused(await http(postCode(wrongCode(code))), 'PAIRING_CODE_INVALID');

    const response = await http(postCode(code));
    expect(response.status).toBe(503);
    expect(json(response).code).toBe('PAIRING_UNAVAILABLE');
    expect(server.getPairingState()).toMatchObject({
      armed: true,
      attemptsRemaining: 4,
      consumedBy: null,
      disarmReason: null,
    });

    restore();
    expectServed(await http(postCode(code)));
    expect(server.getPairingState()).toMatchObject({
      armed: false,
      consumedBy: LAN_PEER,
      disarmReason: 'consumed',
    });
    expectRefused(await http(postCode(code)), 'PAIRING_NOT_ARMED');
  });

  it('gives the code back when the read fails', async () => {
    const store = memoryStore();
    const { http, server } = await started({ pairingStore: store });
    const { code } = await server.armPairingCode();
    const realGet = store.get;
    store.get = () => {
      throw new Error('not loaded');
    };
    expect((await http(postCode(code))).status).toBe(503);
    expect(server.getPairingState().armed).toBe(true);
    store.get = realGet;
    expectServed(await http(postCode(code)));
  });

  /** A store whose next write waits for the returned release, then fails. */
  function heldWrite(store: MemoryStore): () => void {
    const realSet = store.set;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    store.set = async () => {
      await gate;
      store.set = realSet;
      throw new Error('disk full');
    };
    return release;
  }

  it('lets one spend through while the store answers, since a code works once', async () => {
    const store = memoryStore();
    const { http, server } = await started({ pairingStore: store });
    const { code } = await server.armPairingCode();
    const release = heldWrite(store);
    const first = http(postCode(code));
    expectRefused(await http(postCode(code)), 'PAIRING_NOT_ARMED');
    release();
    expect((await first).status).toBe(503);
    expect(server.getPairingState().armed).toBe(true);
  });

  it('does not give back a code the app has since cancelled', async () => {
    const store = memoryStore();
    const { http, server } = await started({ pairingStore: store });
    const { code } = await server.armPairingCode();
    const release = heldWrite(store);
    const pending = http(postCode(code));
    server.disarmPairingCode();
    release();
    expect((await pending).status).toBe(503);
    expect(server.getPairingState()).toMatchObject({ armed: false, disarmReason: 'cancelled' });
    expectRefused(await http(postCode(code)), 'PAIRING_NOT_ARMED');
  });

  it('does not give back a code the app has since replaced', async () => {
    const store = memoryStore();
    const { http, server } = await started({ pairingStore: store });
    const { code } = await server.armPairingCode();
    const release = heldWrite(store);
    const pending = http(postCode(code));
    const fresh = await server.armPairingCode();
    release();
    expect((await pending).status).toBe(503);
    expect(server.getPairingState()).toMatchObject({ armed: true, attemptsRemaining: 5 });
    if (fresh.code !== code) {
      expectRefused(await http(postCode(code)), 'PAIRING_CODE_INVALID');
    }
    expectServed(await http(postCode(fresh.code)));
  });

  it('does not give back a code a revoke has dropped', async () => {
    const store = memoryStore();
    const { http, server } = await started({ pairingStore: store });
    const { code } = await server.armPairingCode();
    const release = heldWrite(store);
    const pending = http(postCode(code));
    const revoked = server.revokePairing();
    release();
    expect((await pending).status).toBe(503);
    await revoked;
    expect(server.getPairingState()).toMatchObject({ armed: false, disarmReason: 'revoked' });
    expectRefused(await http(postCode(code)), 'PAIRING_NOT_ARMED');
  });

  it('does not give back a code that ran out while the store was busy', async () => {
    const now = Date.now();
    fakeClocks(now);
    try {
      const store = memoryStore();
      const { http, server } = await started({ pairingStore: store });
      const { code } = await server.armPairingCode();
      const release = heldWrite(store);
      const pending = http(postCode(code));
      vi.advanceTimersByTime(120_000);
      release();
      expect((await pending).status).toBe(503);
      expect(server.getPairingState()).toMatchObject({ armed: false, disarmReason: 'expired' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('still shows who took a code when the app cancelled it during the write', async () => {
    const store = memoryStore();
    const realSet = store.set;
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    store.set = async (token: string) => {
      await gate;
      await realSet.call(store, token);
    };
    const { http, server } = await started({ pairingStore: store });
    const { code } = await server.armPairingCode();
    const pending = http(postCode(code));
    server.disarmPairingCode();
    finish();
    expectServed(await pending);
    expect(server.getPairingState()).toMatchObject({
      armed: false,
      consumedBy: LAN_PEER,
      disarmReason: 'cancelled',
    });
  });

  it('spends nothing when the device id has not loaded, then needs no new code', async () => {
    const { http, server } = await started({ pairingStore: memoryStore(), deviceId: undefined });
    const { code } = await server.armPairingCode();
    const response = await http(postCode(code));
    expect(response.status).toBe(503);
    expect(json(response).code).toBe('PAIRING_UNAVAILABLE');
    expect(server.getPairingState()).toMatchObject({ armed: true, attemptsRemaining: 5 });

    expect((await http(postCode(wrongCode(code)))).status).toBe(503);
    expect(server.getPairingState()).toMatchObject({ armed: true, attemptsRemaining: 5 });

    server.setDeviceId(DEVICE_ID);
    expect(json(await http(postCode(code))).data!.deviceId).toBe(DEVICE_ID);
  });
});

describe('a clock that moves', () => {
  it('re-bases the floor when the clock is set back, so nothing locks out', async () => {
    const now = Date.now();
    fakeClocks(now);
    try {
      const { http } = await started({ pairingStore: memoryStore(TOKEN) });
      vi.setSystemTime(now - 3_600_000);
      expectServed(await http(signed(TOKEN, { ts: Date.now() })));
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-syncs from the refusal alone, with no new pairing', async () => {
    const now = Date.now();
    fakeClocks(now);
    try {
      const { http } = await started({ pairingStore: memoryStore(TOKEN) });
      vi.setSystemTime(now + 3_600_000);
      // The runner's offset is an hour stale.
      const serverTime = expectTimestampRefused(await http(signed(TOKEN, { ts: now })));
      vi.advanceTimersByTime(5);
      expectServed(await http(signed(TOKEN, { ts: serverTime + 5 })));
    } finally {
      vi.useRealTimers();
    }
  });

  it('raises the floor on a step forward', async () => {
    const now = Date.now();
    fakeClocks(now);
    try {
      const { http } = await started({ pairingStore: memoryStore(TOKEN) });
      vi.setSystemTime(now + 60_000);
      // Inside the window, and from before the step.
      expectTimestampRefused(await http(signed(TOKEN, { ts: now + 59_000 })));
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes one small correction for drift and leaves the floor alone', async () => {
    const now = Date.now();
    fakeClocks(now);
    try {
      const { http } = await started({ pairingStore: memoryStore(TOKEN) });
      vi.setSystemTime(now + 5000);
      expectServed(await http(signed(TOKEN, { ts: now + 1 })));
    } finally {
      vi.useRealTimers();
    }
  });

  it('adds small steps up until they cross the tolerance', async () => {
    const now = Date.now();
    fakeClocks(now);
    try {
      const { http } = await started({ pairingStore: memoryStore(TOKEN) });
      vi.setSystemTime(now + 3000);
      expectServed(await http(signed(TOKEN, { ts: now + 1 })));
      vi.setSystemTime(now + 6000);
      expectTimestampRefused(await http(signed(TOKEN, { ts: now + 2 })));
    } finally {
      vi.useRealTimers();
    }
  });

  it('never leaves the floor more than the tolerance ahead after repeated small steps back', async () => {
    const now = Date.now();
    fakeClocks(now);
    try {
      const { http } = await started({ pairingStore: memoryStore(TOKEN) });
      let clock = now;
      for (let i = 0; i < 21; i++) {
        clock -= 4000;
        vi.setSystemTime(clock);
        await http(signed(TOKEN, { ts: clock }));
      }
      // Now far behind where it started, and the floor is within 5 s of it.
      vi.advanceTimersByTime(5000);
      expectServed(await http(signed(TOKEN, { ts: Date.now() })));
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-bases once per step, not on every look afterwards', async () => {
    const now = Date.now();
    fakeClocks(now);
    try {
      const { http } = await started({ pairingStore: memoryStore(TOKEN) });
      vi.setSystemTime(now + 3_600_000);
      const serverTime = expectTimestampRefused(await http(signed(TOKEN, { ts: now })));
      vi.advanceTimersByTime(100);
      // Lagging the clock by 99 ms, as a signer's offset can, and above the floor.
      expectServed(await http(signed(TOKEN, { ts: serverTime + 1 })));
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not lock out again when a cache from before a step back overflows', async () => {
    const now = Date.now();
    fakeClocks(now);
    try {
      const { http } = await started({ pairingStore: memoryStore(TOKEN) });
      for (let i = 0; i < 4096; i++) {
        expectServed(await http(signed(TOKEN, { ts: now })));
      }
      vi.setSystemTime(now - 3_600_000);
      // The first two in the same millisecond, because evicting a clamped nonce
      // must leave the floor exactly where the re-base put it.
      expectServed(await http(signed(TOKEN, { ts: Date.now() })));
      expectServed(await http(signed(TOKEN, { ts: Date.now() })));
      for (const elapsed of [1, 200_000, 1_000_000, 2_000_000]) {
        vi.advanceTimersByTime(elapsed);
        expectServed(await http(signed(TOKEN, { ts: Date.now() })));
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('clamps a remembered nonce whose timestamp is exactly the new now', async () => {
    const now = Date.now();
    fakeClocks(now);
    try {
      const { http } = await started({ pairingStore: memoryStore(TOKEN) });
      for (let i = 0; i < 4096; i++) {
        expectServed(await http(signed(TOKEN, { ts: now })));
      }
      vi.advanceTimersByTime(20_000);
      vi.setSystemTime(now);
      expectServed(await http(signed(TOKEN, { ts: now })));
      expectServed(await http(signed(TOKEN, { ts: now })));
    } finally {
      vi.useRealTimers();
    }
  });

  it('still refuses a nonce it remembers after a step back', async () => {
    const now = Date.now();
    fakeClocks(now);
    try {
      const { http } = await started({ pairingStore: memoryStore(TOKEN) });
      vi.advanceTimersByTime(20_000);
      const request = signed(TOKEN, { ts: now + 20_000 });
      expectServed(await http(request));
      vi.setSystemTime(now + 10_000);
      expectRefused(await http(request));
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses the capture-evict-step replay the floor alone would have let through', async () => {
    const now = Date.now();
    fakeClocks(now);
    try {
      const { http } = await started({ pairingStore: memoryStore(TOKEN) });
      const victim = signed(TOKEN, { ts: now + 1000 });
      expectServed(await http(victim));
      for (let i = 0; i < 4095; i++) {
        expectServed(await http(signed(TOKEN, { ts: now + 1000 })));
      }
      vi.setSystemTime(now + 3_600_000);
      expectServed(await http(signed(TOKEN, { ts: now + 3_600_000 })));
      vi.setSystemTime(now + 2000);
      expectTimestampRefused(await http(victim));
    } finally {
      vi.useRealTimers();
    }
  });

  it('holds a live code to its two minutes when the clock is set back', async () => {
    const now = Date.now();
    fakeClocks(now);
    try {
      const { http, server } = await started({ pairingStore: memoryStore() });
      const { code } = await server.armPairingCode();
      vi.advanceTimersByTime(60_000);
      vi.setSystemTime(now - 3_600_000);
      vi.advanceTimersByTime(59_000);
      expect(server.getPairingState().armed).toBe(true);
      vi.advanceTimersByTime(1000);
      expect(server.getPairingState()).toMatchObject({ armed: false, disarmReason: 'expired' });
      expectRefused(await http(postCode(code)), 'PAIRING_NOT_ARMED');
    } finally {
      vi.useRealTimers();
    }
  });

  it('expires a code on the wall clock on a runtime with no monotonic one', async () => {
    const now = Date.now();
    vi.useFakeTimers({ now, toFake: ['Date'] });
    vi.stubGlobal('performance', undefined);
    try {
      const { http, server } = await started({ pairingStore: memoryStore() });
      const { code } = await server.armPairingCode();
      vi.setSystemTime(now + 119_000);
      expect(server.getPairingState().armed).toBe(true);
      vi.setSystemTime(now + 120_000);
      expectRefused(await http(postCode(code)), 'PAIRING_NOT_ARMED');
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});

describe('what a signature check costs a peer that has proved nothing', () => {
  function countingStore() {
    const store = memoryStore(TOKEN);
    return { store, get: vi.spyOn(store, 'get') };
  }

  it('refuses a signed body over the cap, without reading the store', async () => {
    const { store, get } = countingStore();
    const { http } = await started({ pairingStore: store });
    const rawBody = 'x'.repeat(SIGNED_BODY_MAX_CHARS + 1);
    const response = await http(
      signed(TOKEN, { method: 'POST', path: '/ui-bridge/control/find', body: {}, rawBody })
    );
    expect(response.status).toBe(413);
    expect(json(response).code).toBe('PAIRING_BODY_TOO_LARGE');
    expect(get).not.toHaveBeenCalled();
  });

  it('checks a signed body at exactly the cap', async () => {
    const { http } = await started({ pairingStore: memoryStore(TOKEN) });
    const prefix = '{"query":"';
    const rawBody = `${prefix}${'x'.repeat(SIGNED_BODY_MAX_CHARS - prefix.length - 2)}"}`;
    expect(rawBody).toHaveLength(SIGNED_BODY_MAX_CHARS);
    expectServed(
      await http(
        signed(TOKEN, {
          method: 'POST',
          path: '/ui-bridge/control/find',
          body: JSON.parse(rawBody),
          rawBody,
        })
      )
    );
  });

  it('never hashes an over-cap body', async () => {
    const { http } = await started({ pairingStore: memoryStore(TOKEN) });
    // Well formed with a made-up tag, so nothing but the cap can stop it reaching the hash.
    const header = `${Date.now()}.${'n'.repeat(32)}.${'a'.repeat(64)}`;
    const huge = new Proxy(
      { length: SIGNED_BODY_MAX_CHARS + 1 },
      {
        get(target, key) {
          if (key === 'length') return target.length;
          throw new Error('the body was read');
        },
      }
    ) as unknown as string;
    const response = await http(
      lan({
        method: 'POST',
        path: '/ui-bridge/control/find',
        body: {},
        rawBody: huge,
        headers: { host: 'x', 'x-ui-bridge-auth': header },
      })
    );
    expect(response.status).toBe(413);
  });

  // A made-up tag, so a test that reaches the hash pays for nothing it did not ask.
  function unsignedHeader(): string {
    return `${Date.now()}.${'n'.repeat(32)}.${'a'.repeat(64)}`;
  }

  it.each<[string, Partial<HTTPRequest>]>([
    ['a method one over', { method: 'M'.repeat(SIGNED_METHOD_MAX_CHARS + 1) }],
    ['a 4 MB method', { method: 'M'.repeat(4_000_000) }],
    ['a path one over', { path: `/${'a'.repeat(SIGNED_TARGET_MAX_CHARS)}` }],
    ['a 4 MB path', { path: `/${'a'.repeat(4_000_000)}` }],
    [
      'a raw target one over',
      {
        path: SNAPSHOT,
        rawTarget: `${SNAPSHOT}?x=${'b'.repeat(SIGNED_TARGET_MAX_CHARS - SNAPSHOT.length - 2)}`,
        query: { x: 'b' },
      },
    ],
    [
      'an 8 MB raw target',
      {
        path: SNAPSHOT,
        rawTarget: `${SNAPSHOT}?x=${'b'.repeat(8_000_000)}`,
        query: { x: 'b' },
      },
    ],
  ])('refuses %s, without reading the store or hashing', async (_name, over) => {
    const { store, get } = countingStore();
    const { http } = await started({ pairingStore: store });
    const hash = vi.spyOn(sha256Module, 'hmacSha256');
    const response = await http(
      lan({ ...over, headers: { host: 'x', 'x-ui-bridge-auth': unsignedHeader() } })
    );
    expect(response.status).toBe(414);
    expect(json(response).code).toBe('PAIRING_TARGET_TOO_LONG');
    expect(get).not.toHaveBeenCalled();
    expect(hash).not.toHaveBeenCalled();
    hash.mockRestore();
  });

  it('checks a method and a target at exactly their caps', async () => {
    const { http } = await started({ pairingStore: memoryStore(TOKEN) });
    const rawTarget = `${SNAPSHOT}?x=${'b'.repeat(SIGNED_TARGET_MAX_CHARS - SNAPSHOT.length - 3)}`;
    expect(rawTarget).toHaveLength(SIGNED_TARGET_MAX_CHARS);
    expectServed(await http(signed(TOKEN, { rawTarget, query: { x: 'b' } })));

    const method = 'M'.repeat(SIGNED_METHOD_MAX_CHARS);
    expect(json(await http(signed(TOKEN, { method }))).code).not.toBe('PAIRING_TARGET_TOO_LONG');
    expect(json(await http(signed(TOKEN, { method }))).code).not.toBe('PAIRING_REQUIRED');
  });

  it('does no store read for a bad form, a stale timestamp or a low floor', async () => {
    const now = Date.now();
    fakeClocks(now);
    try {
      const { store, get } = countingStore();
      const { http } = await started({ pairingStore: store });
      vi.advanceTimersByTime(1000);
      const tag = 'a'.repeat(64);
      const nonce = 'n'.repeat(32);
      for (const header of [
        'junk',
        `${now + 1000 - 300_001}.${nonce}.${tag}`,
        `${now + 1000 + 300_001}.${nonce}.${tag}`,
        `${now - 1}.${nonce}.${tag}`,
      ]) {
        await http(lan({ headers: { host: 'x', 'x-ui-bridge-auth': header } }));
      }
      expect(get).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('only a direct connection can pair', () => {
  /** Runs a door's attempts against an armed code and proves none of them touched it. */
  async function armedServer() {
    const store = memoryStore();
    const running = await started({ pairingStore: store });
    const { code } = await running.server.armPairingCode();
    const randomBytes = vi.spyOn(store, 'randomBytes');
    return {
      ...running,
      store,
      code,
      expectUntouched() {
        expect(store.sets).toEqual([]);
        expect(store.token).toBeNull();
        expect(randomBytes).not.toHaveBeenCalled();
        expect(running.server.getPairingState()).toMatchObject({
          armed: true,
          attemptsRemaining: 5,
          consumedBy: null,
        });
      },
    };
  }

  it('JSON-RPC over a socket can neither mint nor burn', async () => {
    const { server, code, expectUntouched } = await armedServer();
    for (const params of [{}, { code }, { code: wrongCode(code) }]) {
      const raw = await server.handleWebSocketMessage(
        'c',
        JSON.stringify({ id: 1, method: 'pair', params })
      );
      const parsed = JSON.parse(raw ?? '{}');
      expect(parsed.result.success).toBe(false);
      expect(parsed.result.code).toBe('NOT_SUPPORTED');
      expect(raw).not.toContain('token');
    }
    expectUntouched();
  });

  it('a batch or a sequence over a socket can neither mint nor burn', async () => {
    const { server, code, expectUntouched } = await armedServer();
    const batch = await server.handleWebSocketMessage(
      'c',
      JSON.stringify({
        id: 1,
        batch: [{ id: 2, method: 'pair', params: { code: wrongCode(code) } }],
      })
    );
    expect(JSON.parse(batch ?? '{}').results[0].result.code).toBe('NOT_SUPPORTED');
    const sequence = await server.handleWebSocketMessage(
      'c',
      JSON.stringify({
        id: 1,
        method: 'sequence',
        params: { steps: [{ method: 'pair', params: { code } }] },
      })
    );
    expect(JSON.parse(sequence ?? '{}').result.data.results[0].result.code).toBe('NOT_SUPPORTED');
    expectUntouched();
  });

  describe('the cloud relay', () => {
    interface RelaySocket {
      sent: string[];
      onopen: (() => void) | null;
      onmessage: ((event: { data: string }) => void) | null;
    }
    let socket: RelaySocket;
    let originalWebSocket: unknown;

    beforeEach(() => {
      originalWebSocket = (globalThis as Record<string, unknown>).WebSocket;
      class FakeWebSocket {
        static readonly OPEN = 1;
        readyState = 1;
        sent: string[] = [];
        onopen: (() => void) | null = null;
        onmessage: ((event: { data: string }) => void) | null = null;
        onclose: unknown = null;
        onerror: unknown = null;
        constructor() {
          socket = this as unknown as RelaySocket;
        }
        send(data: string) {
          this.sent.push(data);
        }
        close() {}
      }
      (globalThis as Record<string, unknown>).WebSocket = FakeWebSocket;
      vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      (globalThis as Record<string, unknown>).WebSocket = originalWebSocket;
      vi.restoreAllMocks();
    });

    async function tunnel(request: {
      method: string;
      path: string;
      body?: unknown;
    }): Promise<{ status: number; body: { code?: string; success?: boolean; data?: unknown } }> {
      const id = `req-${socket.sent.length}`;
      const before = socket.sent.length;
      socket.onmessage?.({
        data: JSON.stringify({ type: 'tunnel_request', id, headers: {}, ...request }),
      });
      await vi.waitFor(() => expect(socket.sent.length).toBeGreaterThan(before));
      return JSON.parse(socket.sent[socket.sent.length - 1]!);
    }

    it('cannot mint or burn, and its own path still works with no peer and no signature', async () => {
      const { server, code, expectUntouched } = await armedServer();
      const client = new CloudRelayClient({
        relayUrl: 'wss://relay.example/device-bridge',
        deviceId: DEVICE_ID,
        authToken: 'relay-credential',
        uiBridgeServer: server,
      });
      client.start();
      socket.onopen?.();

      for (const body of [{}, { code }, { code: wrongCode(code) }]) {
        const response = await tunnel({ method: 'POST', path: PAIR, body });
        expect(response.status).toBe(501);
        expect(response.body.code).toBe('NOT_SUPPORTED');
      }
      expectUntouched();

      const snapshot = await tunnel({ method: 'GET', path: SNAPSHOT });
      expect(snapshot.status).toBe(200);
      expect(snapshot.body.success).toBe(true);

      client.stop();
    });
  });

  it('a route table entry stands behind the network path for an admitted caller', async () => {
    const { http } = await started({ pairingStore: memoryStore() });
    const wrongVerb = await http(cable({ method: 'GET', path: PAIR }));
    expect(wrongVerb.status).toBe(405);
  });
});

describe('a store that has not loaded, or none at all', () => {
  function unloadedStore(): MemoryStore {
    const store = memoryStore('t'.repeat(64));
    store.get = () => {
      throw new Error('not loaded');
    };
    return store;
  }

  it('fails a signed LAN request closed, and tells it the truth', async () => {
    const { http } = await started({ pairingStore: unloadedStore() });
    const response = await http(signed('t'.repeat(64)));
    expect(response.status).toBe(503);
    expect(json(response).code).toBe('PAIRING_UNAVAILABLE');
    expect(json(response).data).toBeUndefined();
  });

  it('fails a signed LAN request closed when the read rejects', async () => {
    const store = memoryStore('t'.repeat(64));
    store.get = () => Promise.reject(new Error('not loaded'));
    const { http } = await started({ pairingStore: store });
    expect((await http(signed('t'.repeat(64)))).status).toBe(503);
  });

  it('reads an undefined from an untyped store as not loaded, never as no token', async () => {
    const store = memoryStore();
    store.get = (() => undefined) as unknown as PairingStore['get'];
    const { http } = await started({ pairingStore: store });
    expect((await http(cable({ method: 'POST', path: PAIR }))).status).toBe(503);
    expect(store.sets).toEqual([]);
  });

  it('answers an unsigned LAN caller 401 as ever, without reading the store', async () => {
    const store = unloadedStore();
    const get = vi.spyOn(store, 'get');
    const { http } = await started({ pairingStore: store });
    expectRefused(await http(lan()));
    expect(get).not.toHaveBeenCalled();
  });

  it('does not mint over a token still on disk', async () => {
    const store = unloadedStore();
    const { http } = await started({ pairingStore: store });
    const response = await http(cable({ method: 'POST', path: PAIR }));
    expect(response.status).toBe(503);
    expect(store.sets).toEqual([]);
  });

  it('leaves a cable working', async () => {
    const { http } = await started({ pairingStore: unloadedStore() });
    expectServed(await http(cable()));
  });

  it('refuses to arm, and to revoke', async () => {
    const { server } = await started({ pairingStore: unloadedStore() });
    await expect(server.armPairingCode()).rejects.toMatchObject({ code: 'PAIRING_UNAVAILABLE' });
    await expect(server.revokePairing()).rejects.toMatchObject({ code: 'PAIRING_UNAVAILABLE' });
  });

  it('gives up on a store that never answers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const store = memoryStore();
      store.get = () => new Promise<string | null>(() => {});
      const { http } = await started({ pairingStore: store });
      const pending = http(cable({ method: 'POST', path: PAIR }));
      await vi.advanceTimersByTimeAsync(10_000);
      expect((await pending).status).toBe(503);
    } finally {
      vi.useRealTimers();
    }
  });

  it('answers PAIRING_UNCONFIGURED everywhere off the machine with no store', async () => {
    const { http, server } = await started();
    expectRefused(await http(lan()), 'PAIRING_UNCONFIGURED');
    expectRefused(await http(signed('t'.repeat(64))), 'PAIRING_UNCONFIGURED');
    expectRefused(await http(postCode('123456')), 'PAIRING_UNCONFIGURED');
    expectUpgradeRefused(server.handleWebSocketUpgrade(lan({ path: '/' })));
  });

  it('answers PAIRING_UNCONFIGURED to a cable pair too, which it cannot honour', async () => {
    const { http } = await started();
    expectRefused(await http(cable({ method: 'POST', path: PAIR })), 'PAIRING_UNCONFIGURED');
  });

  describe('the opt-out still refuses a web page', () => {
    function optedOut() {
      return started({ allowUnauthenticatedNetwork: true });
    }
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
      warn.mockRestore();
    });

    it.each<[string, Record<string, string>]>([
      ['an Origin', { host: '192.168.1.20:8087', origin: 'https://evil.example' }],
      ['a Referer', { host: '192.168.1.20:8087', referer: 'https://evil.example/' }],
      ['a Sec-Fetch-Site', { host: '192.168.1.20:8087', 'sec-fetch-site': 'cross-site' }],
      ['a rebound Host, with nothing else to show for it', { host: 'attacker.example' }],
      ['two Hosts, one of them rebound', { host: '192.168.1.20', Host: 'attacker.example' }],
      ['no Host at all', {}],
    ])('refuses %s, and answers it nothing a page can read', async (_name, headers) => {
      const { http } = await optedOut();
      for (const remoteAddress of [LAN_PEER, '127.0.0.1']) {
        for (const request of [
          lan({ headers, remoteAddress }),
          lan({
            headers,
            remoteAddress,
            method: 'POST',
            path: '/ui-bridge/control/find',
            body: {},
          }),
          lan({ headers, remoteAddress, method: 'OPTIONS' }),
        ]) {
          const response = await http(request);
          expect(response.status).toBe(403);
          expect(json(response).code).toBe('PAIRING_WEB_CALLER_REFUSED');
          expect(corsHeaderNames(response)).toEqual([]);
        }
      }
    });

    it('trims open health for one, and sends it no CORS header', async () => {
      const { http } = await optedOut();
      const response = await http(
        lan({ path: HEALTH, headers: { host: 'x', origin: 'https://evil.example' } })
      );
      expect(response.status).toBe(200);
      expect(json(response).data!.elementCount).toBeUndefined();
      expect(corsHeaderNames(response)).toEqual([]);
    });

    it.each([
      '192.168.1.20',
      '192.168.1.20:8087',
      '10.0.2.2:8087',
      '[fe80::1]:8087',
      '[fe80::1%25en0]:8087',
      '[::ffff:192.168.1.20]',
      'localhost',
      'localhost:8087',
      'phone.local:8087',
      'PHONE.LOCAL',
    ])('admits a caller that names %s', async (host) => {
      const { http } = await optedOut();
      expectServed(await http(lan({ headers: { host } })));
    });

    it.each([
      'attacker.example',
      'attacker.example:8087',
      '192.168.1.20.nip.io',
      'localhost.',
      'foo.localhost',
      'local',
      '2130706433',
      '127.1',
      '0x7f.0.0.1',
      '999.1.1.1',
      '[::zz]',
      '[fe80::1',
      'localhost:99999',
      '192.168.1.20:99999',
      '[fe80::1]:99999',
      '192.168.1.20:8087,attacker.example',
      '',
    ])('calls %j rebindable', (host) => {
      expect(isUnrebindableHost(host)).toBe(false);
    });
  });

  it('opens only HTTP on the explicit opt-out', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { http, server } = await started({ allowUnauthenticatedNetwork: true });
      expectServed(await http(lan()));
      const message = JSON.stringify({ id: 1, method: 'health' });
      const ungated = JSON.parse(
        (await server.handleNetworkWebSocketMessage('c', message)) ?? '{}'
      );
      expect(ungated.result.code).toBe('PAIRING_UNCONFIGURED');
      expectUpgradeRefused(server.handleWebSocketUpgrade(lan({ path: '/' })));
      expect(server.handleWebSocketUpgrade(cable({ path: '/' }))).toEqual({ admit: true });
      expect(warn.mock.calls.flat().join(' ')).toContain('allowUnauthenticatedNetwork');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('open health', () => {
  it('gives an unauthenticated caller only what discovery needs', async () => {
    const { http } = await started({ pairingStore: memoryStore('t'.repeat(64)) });
    const before = Date.now();
    const response = await http(lan({ path: HEALTH }));
    expect(response.status).toBe(200);
    const data = json(response).data!;
    expect(Object.keys(data).sort()).toEqual([
      'deviceId',
      'pairing',
      'serverTime',
      'status',
      'uiBridge',
    ]);
    expect(data.status).toBe('healthy');
    expect(data.deviceId).toBe(DEVICE_ID);
    expect(data.serverTime).toBeGreaterThanOrEqual(before);
    expect(data.pairing).toEqual({ required: true, authenticated: false });
    const uiBridge = data.uiBridge as Record<string, unknown>;
    expect(Object.keys(uiBridge).sort()).toEqual([
      'appId',
      'appName',
      'appType',
      'framework',
      'version',
    ]);
    expect(uiBridge.appId).toBe(APP_INFO.appId);
    expect(response.body).not.toMatch(/elementCount|componentCount|registration|capabilities/);
  });

  it('says so to a signed caller, and answers it in full', async () => {
    const token = 't'.repeat(64);
    const { http } = await started({ pairingStore: memoryStore(token) });
    const data = json(await http(signed(token, { path: HEALTH }))).data!;
    expect(data.pairing).toEqual({ required: true, authenticated: true });
    expect(data.registration).toBeDefined();
    expect(data.deviceId).toBe(DEVICE_ID);
    expect((data.uiBridge as Record<string, unknown>).elementCount).toBeDefined();
  });

  it('tells a cable that nothing is required', async () => {
    const { http } = await started({ pairingStore: memoryStore() });
    const data = json(await http(cable({ path: HEALTH }))).data!;
    expect(data.pairing).toEqual({ required: false, authenticated: true });
    expect(data.registration).toBeDefined();
  });

  it('stays trimmed for a bad signature instead of refusing', async () => {
    const { http } = await started({ pairingStore: memoryStore('t'.repeat(64)) });
    const response = await http(signed('f'.repeat(64), { path: HEALTH }));
    expect(response.status).toBe(200);
    expect(json(response).data!.pairing).toEqual({ required: true, authenticated: false });
    expect(json(response).data!.registration).toBeUndefined();
  });

  it('answers with no store too, reporting a device nobody can pair with', async () => {
    const { http } = await started();
    const data = json(await http(lan({ path: HEALTH }))).data!;
    expect(data.pairing).toEqual({ required: true, authenticated: false });
  });

  it('opens only GET', async () => {
    const { http } = await started({ pairingStore: memoryStore('t'.repeat(64)) });
    expectRefused(await http(lan({ method: 'POST', path: HEALTH })));
    expectRefused(await http(lan({ path: `${HEALTH}/` })));
  });

  it('does not let an anonymous probe keep the screen awake', async () => {
    const { http, server } = await started({
      pairingStore: memoryStore('t'.repeat(64)),
      testHooks: true,
    });
    const provider = { request: vi.fn(), release: vi.fn() };
    server.setKeepAwakeProvider(provider);
    await http(lan({ path: HEALTH }));
    await http(lan());
    expect(provider.request).not.toHaveBeenCalled();
    await http(cable());
    expect(provider.request).toHaveBeenCalled();
  });

  it('leaves the relay path to health untouched', async () => {
    const { server } = await started({ pairingStore: memoryStore('t'.repeat(64)) });
    const response = await server.handleRequest({
      method: 'GET',
      path: HEALTH,
      headers: {},
      query: {},
    });
    const data = json(response).data!;
    expect(data.registration).toBeDefined();
    expect(data.pairing).toBeUndefined();
  });
});

describe('revoke', () => {
  it('replaces the token and kills the old signature', async () => {
    const store = memoryStore();
    const { http, server } = await started({ pairingStore: store });
    const old = json(await http(cable({ method: 'POST', path: PAIR }))).data!.token as string;
    expectServed(await http(signed(old)));

    await server.revokePairing();

    expect(store.token).toMatch(/^[0-9a-f]{64}$/);
    expect(store.token).not.toBe(old);
    expectRefused(await http(signed(old)));
    expectServed(await http(signed(store.token!)));
    expect(json(await http(cable({ method: 'POST', path: PAIR }))).data!.token).toBe(store.token);
  });

  it('disarms a live code', async () => {
    const { http, server } = await started({ pairingStore: memoryStore() });
    const { code } = await server.armPairingCode();
    await server.revokePairing();
    expect(server.getPairingState()).toMatchObject({ armed: false, disarmReason: 'revoked' });
    expectRefused(await http(postCode(code)), 'PAIRING_NOT_ARMED');
  });

  it('clears the old token when it cannot write a new one', async () => {
    const store = memoryStore('o'.repeat(64));
    store.set = async () => {
      throw new Error('disk full');
    };
    const { http, server } = await started({ pairingStore: store });
    await expect(server.revokePairing()).rejects.toBeInstanceOf(PairingError);
    expect(store.token).toBeNull();
    expectRefused(await http(signed('o'.repeat(64))));
  });

  it('stops trusting a store that could neither replace nor clear, until a revoke works', async () => {
    const oldToken = 'o'.repeat(64);
    const store = memoryStore(oldToken);
    const realSet = store.set;
    store.set = async () => {
      throw new Error('disk full');
    };
    store.clear = async () => {
      throw new Error('disk full');
    };
    const { http, server } = await started({ pairingStore: store });
    await expect(server.revokePairing()).rejects.toBeInstanceOf(PairingError);

    // The old token is still on disk, and neither a signature nor a pair may use it.
    expect(store.token).toBe(oldToken);
    expect((await http(signed(oldToken))).status).toBe(503);
    expect((await http(cable({ method: 'POST', path: PAIR }))).status).toBe(503);

    store.set = realSet;
    await server.revokePairing();
    expect(store.token).not.toBe(oldToken);
    expectRefused(await http(signed(oldToken)));
  });

  /** A store whose next write waits for the returned finish. */
  function heldWrite(store: MemoryStore): () => void {
    const realSet = store.set;
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    store.set = async (token: string) => {
      await gate;
      store.set = realSet;
      await realSet.call(store, token);
    };
    return finish;
  }

  it('verifies nothing from the moment a revoke starts', async () => {
    const oldToken = 'o'.repeat(64);
    const store = memoryStore(oldToken);
    const { http, server } = await started({ pairingStore: store });
    const finish = heldWrite(store);

    const revoked = server.revokePairing();
    await new Promise((resolve) => setTimeout(resolve, 0)); // into the write
    expect(store.token).toBe(oldToken);
    expectRefused(await http(signed(oldToken)));

    finish();
    await revoked;
    expectRefused(await http(signed(oldToken)));
    expectServed(await http(signed(store.token!)));
  });

  it('refuses a read that began before a revoke and answered during it', async () => {
    const oldToken = 'o'.repeat(64);
    const store = memoryStore(oldToken);
    const { http, server } = await started({ pairingStore: store });
    const { release, asked } = deferNextRead(store);
    const inFlight = http(signed(oldToken));
    await asked;

    const finish = heldWrite(store);
    const revoked = server.revokePairing();
    await new Promise((resolve) => setTimeout(resolve, 0)); // into the write
    release();
    expectRefused(await inFlight);

    finish();
    await revoked;
  });

  it('refuses the old token after a revoke that could not read the store', async () => {
    const oldToken = 'o'.repeat(64);
    const store = memoryStore(oldToken);
    const { http, server } = await started({ pairingStore: store });
    const realGet = store.get;
    store.get = () => {
      throw new Error('not loaded');
    };
    await expect(server.revokePairing()).rejects.toBeInstanceOf(PairingError);
    store.get = realGet;

    // The app told the user the revoke failed, so the old token may not verify,
    // and a pair may not hand it out, even though the store reads again.
    const refused = await http(signed(oldToken));
    expect(refused.status).toBe(503);
    expect(json(refused)).toMatchObject({
      code: 'PAIRING_UNAVAILABLE',
      error: 'Pairing is suspended until a revoke succeeds on the device.',
    });
    expect((await http(cable({ method: 'POST', path: PAIR }))).status).toBe(503);

    await server.revokePairing();
    expect(store.token).not.toBe(oldToken);
    expectRefused(await http(signed(oldToken)));
    expectServed(await http(signed(store.token!)));
  });

  it('keeps refusing the old token on a server rebuilt over the same store', async () => {
    const oldToken = 'o'.repeat(64);
    const store = memoryStore(oldToken);
    const first = await started({ pairingStore: store });
    const realGet = store.get;
    store.get = () => {
      throw new Error('not loaded');
    };
    await expect(first.server.revokePairing()).rejects.toBeInstanceOf(PairingError);
    store.get = realGet;

    const rebuilt = await started({ pairingStore: store });
    expect(store.token).toBe(oldToken);
    expect((await rebuilt.http(signed(oldToken))).status).toBe(503);
    expect((await rebuilt.http(cable({ method: 'POST', path: PAIR }))).status).toBe(503);

    await rebuilt.server.revokePairing();
    expectRefused(await rebuilt.http(signed(oldToken)));
    expectServed(await rebuilt.http(signed(store.token!)));
  });

  /** A store whose next `get` waits, still answering the token it read when asked. */
  function deferNextRead(store: MemoryStore): { release: () => void; asked: Promise<void> } {
    const realGet = store.get;
    const read = realGet.call(store);
    let release!: () => void;
    let asked!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const askedPromise = new Promise<void>((resolve) => (asked = resolve));
    store.get = async () => {
      store.get = realGet;
      asked();
      await released;
      return read;
    };
    return { release, asked: askedPromise };
  }

  it('does not serve a signature that read the old token before a revoke finished', async () => {
    const oldToken = 'o'.repeat(64);
    const store = memoryStore(oldToken);
    const { http, server } = await started({ pairingStore: store });
    const { release, asked } = deferNextRead(store);

    const inFlight = http(signed(oldToken));
    await asked;
    await server.revokePairing();
    expect(store.token).not.toBe(oldToken);

    release();
    expectRefused(await inFlight);
  });

  it('does not serve a signature whose read began while a revoke was running', async () => {
    const oldToken = 'o'.repeat(64);
    const store = memoryStore(oldToken);
    const realSet = store.set;
    let finishWrite!: () => void;
    const write = new Promise<void>((resolve) => (finishWrite = resolve));
    store.set = async (token: string) => {
      await write;
      await realSet.call(store, token);
    };
    const { http, server } = await started({ pairingStore: store });

    const revoked = server.revokePairing();
    await new Promise((resolve) => setTimeout(resolve, 0)); // into the write
    const { release, asked } = deferNextRead(store);
    const inFlight = http(signed(oldToken));
    await asked;

    finishWrite();
    await revoked;
    release();
    expectRefused(await inFlight);
  });

  it('refuses when no store is configured', async () => {
    const { server } = await started();
    await expect(server.revokePairing()).rejects.toMatchObject({ code: 'PAIRING_UNCONFIGURED' });
  });
});

describe('the pairing path never touches Math.random', () => {
  it('covers arm, both pair paths, verify and revoke', async () => {
    const random = vi.spyOn(Math, 'random');
    try {
      const store = memoryStore();
      const { http, server } = await started({ pairingStore: store });
      const viaCable = json(await http(cable({ method: 'POST', path: PAIR }))).data!
        .token as string;
      const { code } = await server.armPairingCode();
      await http(postCode(wrongCode(code)));
      await http(postCode(code));
      await http(signed(viaCable));
      await http(lan({ path: HEALTH }));
      await http(lan());
      await server.revokePairing();
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
  });
});

describe('nothing logs the token or the code', () => {
  it('leaves neither in the console nor in /control/console-errors', async () => {
    const sinks = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {})
    );
    const secrets: string[] = [];
    try {
      const store = memoryStore();
      const { http, server } = await started({ pairingStore: store, observability: true });

      // The ordinary flow, successes and refusals both.
      const token = json(await http(cable({ method: 'POST', path: PAIR }))).data!.token as string;
      secrets.push(token);
      const armed = await server.armPairingCode();
      secrets.push(armed.code);
      await http(postCode(wrongCode(armed.code)));
      await http(postCode(armed.code));
      await http(signed(token));
      await http(signed(token, { ts: 1 }));
      await http(lan());
      server.handleWebSocketUpgrade(lan({ path: '/' }));

      // A second code, then the same token through a store that fails loudly and
      // quotes what it holds, which is the shape a careless store would have.
      const second = await server.armPairingCode();
      secrets.push(second.code);
      await http(postCode(second.code, '192.168.1.77'));
      const quoting = `store failed holding ${token} and code ${second.code}`;
      store.get = () => {
        throw new Error(quoting);
      };
      await http(signed(token));
      await http(cable({ method: 'POST', path: PAIR }));
      store.get = () => token;
      store.set = async () => {
        throw new Error(quoting);
      };
      store.clear = async () => {
        throw new Error(quoting);
      };
      await server.revokePairing().catch(() => {});

      const emitted = sinks
        .flatMap((sink) => sink.mock.calls)
        .flat()
        .map((value) =>
          value instanceof Error ? `${value.message} ${value.stack}` : String(value)
        )
        .join('\n');

      const ring = await http(cable({ path: '/ui-bridge/control/console-errors' }));
      expect(ring.status).toBe(200);

      for (const secret of secrets) {
        expect(emitted).not.toContain(secret);
        expect(ring.body).not.toContain(secret);
      }
      expect(emitted).not.toContain(quoting);
      await server.stop();
    } finally {
      sinks.forEach((sink) => sink.mockRestore());
    }
  });

  it('keeps a store error out of the failure an app sees too', async () => {
    const token = 'o'.repeat(64);
    const store = memoryStore(token);
    store.set = async () => {
      throw new Error(`failed holding ${token}`);
    };
    const { server } = await started({ pairingStore: store });
    const failure = await server.revokePairing().catch((err: Error) => err);
    expect(String((failure as Error).message)).not.toContain(token);
  });
});
