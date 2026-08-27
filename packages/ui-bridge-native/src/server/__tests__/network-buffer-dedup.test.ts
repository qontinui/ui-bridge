import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NetworkRequestBuffer } from '../observability';

/**
 * One request must produce exactly ONE entry in `GET /sdk/network-requests`.
 *
 * `NetworkRequestBuffer.install()` patches `fetch` AND
 * `XMLHttpRequest.prototype.open`/`send`, unconditionally and with no either/or
 * branch. React Native implements `fetch` **on top of** XHR (whatwg-fetch), so
 * both patches observed the same request and the buffer carried two
 * near-identical entries — same url, timestamps ~1ms apart, and on failure one
 * `"Network request failed"` beside one `"XMLHttpRequest error"`. A tester reads
 * that as a double-fetch bug in the app and chases a defect that does not exist.
 *
 * These tests model that global exactly: a `fetch` built on the same
 * `XMLHttpRequest` the SDK patches.
 */

type Listener = () => void;

/** Minimal XHR with just the surface the patches and the fake fetch touch. */
class FakeXhr {
  status = 0;
  private listeners = new Map<string, Set<Listener>>();
  /** Set by the test to decide how this request resolves. */
  static nextOutcome: { status: number } | { error: true } = { status: 200 };

  open(_method: string, _url: string): void {
    /* recorded by the SDK's patch */
  }

  send(_body?: unknown): void {
    const outcome = FakeXhr.nextOutcome;
    // Real XHR dispatches asynchronously; so must this, or the SDK's
    // `loadend` listener would be attached after the event.
    setTimeout(() => {
      if ('error' in outcome) {
        this.dispatch('error');
      } else {
        this.status = outcome.status;
        this.dispatch('load');
      }
      this.dispatch('loadend');
    }, 0);
  }

  addEventListener(type: string, fn: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }

  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }

  private dispatch(type: string): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  }
}

/**
 * A whatwg-fetch-shaped polyfill: it constructs, opens and sends an XHR
 * synchronously inside the Promise executor, exactly as React Native's does.
 */
function makeXhrBackedFetch(XhrCtor: typeof FakeXhr) {
  return (input: unknown, init?: { method?: string }) =>
    new Promise<Response>((resolve, reject) => {
      const xhr = new XhrCtor();
      xhr.open(init?.method ?? 'GET', String(input));
      xhr.addEventListener('load', () => {
        resolve(new Response('body', { status: xhr.status }));
      });
      xhr.addEventListener('error', () => {
        reject(new Error('Network request failed'));
      });
      xhr.send();
    });
}

describe('NetworkRequestBuffer — de-duplication on an RN-like global', () => {
  let buf: NetworkRequestBuffer;
  let originalFetch: typeof globalThis.fetch;
  let originalXhr: unknown;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalXhr = (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
    (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = FakeXhr;
    globalThis.fetch = makeXhrBackedFetch(FakeXhr) as unknown as typeof fetch;
    FakeXhr.nextOutcome = { status: 200 };
    buf = new NetworkRequestBuffer(10);
  });

  afterEach(() => {
    buf.uninstall();
    globalThis.fetch = originalFetch;
    (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = originalXhr;
  });

  it('records ONE entry for a fetch that is implemented on top of XHR', async () => {
    buf.install();

    const res = await fetch('https://example.test/usage');
    expect(res.status).toBe(200);

    const entries = buf.entries();
    expect(entries.length).toBe(1);
    expect(entries[0].url).toContain('example.test/usage');
    expect(entries[0].status).toBe(200);
    expect(entries[0].ok).toBe(true);
  });

  it('records ONE entry — not two differently-worded ones — for a failure', async () => {
    buf.install();
    FakeXhr.nextOutcome = { error: true };

    await expect(fetch('https://example.test/boom')).rejects.toThrow(/Network request failed/);

    const entries = buf.entries();
    expect(entries.length).toBe(1);
    // The surviving entry is the fetch layer's: it is the layer the app called.
    expect(entries[0].error).toMatch(/Network request failed/);
    expect(entries.some((e) => e.error === 'XMLHttpRequest error')).toBe(false);
  });

  it('still records a direct XMLHttpRequest the app makes itself', async () => {
    buf.install();

    const xhr = new FakeXhr();
    xhr.open('POST', 'https://example.test/direct');
    await new Promise<void>((resolve) => {
      xhr.addEventListener('loadend', () => resolve());
      xhr.send();
    });

    const entries = buf.entries();
    expect(entries.length).toBe(1);
    expect(entries[0].url).toContain('example.test/direct');
    expect(entries[0].method).toBe('POST');
  });

  it('keeps counting one-per-request across a mix of fetch and direct XHR', async () => {
    buf.install();

    await fetch('https://example.test/a');
    await fetch('https://example.test/b');
    const xhr = new FakeXhr();
    xhr.open('GET', 'https://example.test/c');
    await new Promise<void>((resolve) => {
      xhr.addEventListener('loadend', () => resolve());
      xhr.send();
    });

    expect(buf.entries().map((e) => e.url.split('/').pop())).toEqual(['a', 'b', 'c']);
  });

  it("KNOWN LIMIT — an unrelated XHR opened inside another wrapper's fetch is dropped", async () => {
    // The marker is set for every XHR opened while the original `fetch` runs,
    // which is the polyfill's own — but also any XHR a library that wrapped
    // `fetch` before us fires from inside that call (an analytics beacon, an
    // error-reporter transport). Those vanish from the buffer.
    //
    // Pinned rather than fixed: discriminating them needs the polyfill's XHR
    // to be identified by url, and whatwg-fetch normalises the url it opens
    // with, so a mismatch would silently restore the duplicate-every-request
    // bug this de-dup exists to close. A narrow, documented drop beats that.
    const beaconUrl = 'https://example.test/beacon';
    globalThis.fetch = ((input: unknown) =>
      new Promise<Response>((resolve) => {
        const beacon = new FakeXhr();
        beacon.open('POST', beaconUrl);
        beacon.send();
        const xhr = new FakeXhr();
        xhr.open('GET', String(input));
        xhr.addEventListener('load', () => resolve(new Response('body', { status: xhr.status })));
        xhr.send();
      })) as unknown as typeof fetch;
    buf.install();

    await fetch('https://example.test/real');

    const urls = buf.entries().map((e) => e.url);
    // The app's own fetch is recorded exactly once — the property that matters.
    expect(urls.filter((u) => u.endsWith('/real')).length).toBe(1);
    // The co-opened beacon is the known casualty. If this ever starts passing,
    // the marker got more precise and the limit note above should go.
    expect(urls).not.toContain(beaconUrl);
  });

  it('survives an uninstall -> install cycle without re-duplicating', async () => {
    buf.install();
    await fetch('https://example.test/first');
    buf.uninstall();
    expect(buf.isInstalled()).toBe(false);

    buf.install();
    await fetch('https://example.test/second');

    expect(buf.entries().map((e) => e.url.split('/').pop())).toEqual(['first', 'second']);
  });

  it('is idempotent — a second install() does not double-patch', async () => {
    buf.install();
    buf.install();

    await fetch('https://example.test/once');

    expect(buf.entries().length).toBe(1);
  });

  it('unwinds the depth counter so a later direct XHR is still recorded after a fetch throws', async () => {
    // A `fetch` that throws synchronously, before ever building an XHR. The
    // depth counter must still unwind, or every later XHR would be treated as
    // fetch-internal and silently dropped from the buffer.
    globalThis.fetch = (() => {
      throw new Error('synchronous fetch failure');
    }) as unknown as typeof fetch;
    buf.install();

    await expect(fetch('https://example.test/sync-throw')).rejects.toThrow(
      /synchronous fetch failure/
    );

    const xhr = new FakeXhr();
    xhr.open('GET', 'https://example.test/after');
    await new Promise<void>((resolve) => {
      xhr.addEventListener('loadend', () => resolve());
      xhr.send();
    });

    expect(buf.entries().some((e) => e.url.endsWith('/after'))).toBe(true);
  });
});
