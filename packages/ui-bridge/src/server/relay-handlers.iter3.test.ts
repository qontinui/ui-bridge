/**
 * Manual-test iter-3 remediation tests for relay-handlers.
 *
 * Item A — `type` action contract enforcement
 *   The docs (`docs-site/docs/api/runner-features.md` § per-action params)
 *   promise that POSTing `{action:"type", params:{value:"hi"}}` returns
 *   HTTP 400 with a `WRONG_TYPE_PARAM` code. Before this fix the relay
 *   pass-through forwarded the malformed payload to the browser, which
 *   silently no-op'd (or worse, substituted element.type as the typed
 *   text). Validate at the SDK boundary so misuse surfaces immediately.
 *
 * Item B — `staleMeta()` age-based decay
 *   Previously `_meta.stale` was only `true` if a relay command had
 *   actively failed. A tab that never connected (or silently disconnected
 *   on session boundary) left the cache `stale: false` forever. Now the
 *   metadata also flips when `cacheAgeMs > cacheTtlMs * 5`, so callers
 *   reading e.g. `getControlSnapshot()` on a dormant server see a clear
 *   staleness signal alongside the (potentially empty) payload.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';

function freshRelay(): CommandRelay {
  // Each test gets its own globalThis-key prefix so the persisted state
  // (CommandRelay stores everything on globalThis for HMR survival) does
  // not leak between tests.
  const prefix = `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`;
  return new CommandRelay({ globalPrefix: prefix });
}

describe('relay-handlers · iter-3 Item A — type action contract', () => {
  it('rejects {action:"type", params:{value:"hi"}} with HTTP 400 + WRONG_TYPE_PARAM', async () => {
    const handlers = createRelayHandlers(freshRelay());

    const result = await handlers.executeElementAction!('input-id', {
      action: 'type',
      params: { value: 'hi' },
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('WRONG_TYPE_PARAM');
    expect(result.httpStatus).toBe(400);
    expect(result.error).toContain("type action takes 'text' parameter");
    expect(result.error).toContain('setValue');
    expect((result.data as { hint?: { provided: string[]; required: string[] } } | undefined)?.hint).toEqual({
      provided: ['value'],
      required: ['text'],
    });
  });

  it('rejects {action:"type", params:{}} with HTTP 400 + MISSING_PARAM', async () => {
    const handlers = createRelayHandlers(freshRelay());

    const result = await handlers.executeElementAction!('input-id', {
      action: 'type',
      params: {},
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('MISSING_PARAM');
    expect(result.httpStatus).toBe(400);
    expect(
      (result.data as { required?: string[] } | undefined)?.required
    ).toEqual(['text']);
  });

  it('rejects {action:"type"} (no params at all) with HTTP 400 + MISSING_PARAM', async () => {
    const handlers = createRelayHandlers(freshRelay());

    const result = await handlers.executeElementAction!('input-id', {
      action: 'type',
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('MISSING_PARAM');
    expect(result.httpStatus).toBe(400);
  });

  it('does NOT fall back to element.type — relay is NEVER called when params.text is missing', async () => {
    const relay = freshRelay();
    const spy = vi.spyOn(relay, 'queueCommand');
    const handlers = createRelayHandlers(relay);

    await handlers.executeElementAction!('input-id', {
      action: 'type',
      params: { value: 'hi' },
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it('forwards valid {action:"type", params:{text:"hi"}} to the relay (no validation hijack)', async () => {
    const relay = freshRelay();
    const spy = vi
      .spyOn(relay, 'queueCommand')
      .mockResolvedValue({ success: true } as unknown);
    const handlers = createRelayHandlers(relay);

    const result = await handlers.executeElementAction!('input-id', {
      action: 'type',
      params: { text: 'hi' },
    });

    expect(spy).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
  });

  it('does NOT validate non-type actions — setValue {value:"x"} forwards to relay', async () => {
    const relay = freshRelay();
    const spy = vi
      .spyOn(relay, 'queueCommand')
      .mockResolvedValue({ success: true } as unknown);
    const handlers = createRelayHandlers(relay);

    await handlers.executeElementAction!('input-id', {
      action: 'setValue',
      params: { value: 'x' },
    });

    expect(spy).toHaveBeenCalledOnce();
  });
});

describe('relay-handlers · iter-3 Item B — staleMeta age-based decay', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports stale=false when cache is fresh (age < cacheTtlMs)', async () => {
    const now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    const handlers = createRelayHandlers(freshRelay(), { cacheTtlMs: 1000 });
    // No tab connected → hasListeners=false → returns cached snapshot + meta.
    const result = await handlers.getControlSnapshot!({});

    expect(result.success).toBe(true);
    expect(result._meta?.stale).toBe(false);
    expect(result._meta?.cacheAgeMs).toBeLessThan(1000);
  });

  it('reports stale=true once cacheAgeMs > cacheTtlMs * 5', async () => {
    const start = 1_000_000;
    let now = start;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    const cacheTtlMs = 1000;
    const handlers = createRelayHandlers(freshRelay(), { cacheTtlMs });

    // Fast-forward past 5×TTL — for TTL=1000, that's >5000ms.
    now = start + cacheTtlMs * 5 + 100;

    const result = await handlers.getControlSnapshot!({});
    expect(result.success).toBe(true);
    expect(result._meta?.stale).toBe(true);
    expect(result._meta?.cacheAgeMs).toBeGreaterThan(cacheTtlMs * 5);
  });

  it('includes cacheAgeMs in _meta on both fresh and stale branches', async () => {
    const start = 1_000_000;
    let now = start;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    const cacheTtlMs = 1000;
    const handlers = createRelayHandlers(freshRelay(), { cacheTtlMs });

    // Fresh branch
    now = start + 100;
    const fresh = await handlers.getControlSnapshot!({});
    expect(fresh._meta?.cacheAgeMs).toBeGreaterThanOrEqual(100);
    expect(fresh._meta?.stale).toBe(false);

    // Stale branch
    now = start + cacheTtlMs * 5 + 500;
    const stale = await handlers.getControlSnapshot!({});
    expect(stale._meta?.cacheAgeMs).toBeGreaterThan(cacheTtlMs * 5);
    expect(stale._meta?.stale).toBe(true);
  });

  it('still reports stale=true via the snapshotStaleSince path (existing behavior preserved)', async () => {
    // When a tab IS connected but the relay throws, snapshotStaleSince is
    // set and `staleMeta()` returns stale=true with staleSinceMs. Verify
    // we didn't regress that branch.
    const relay = freshRelay();
    // Simulate a connected tab so the relay path is taken.
    vi.spyOn(relay, 'hasCommandListeners').mockReturnValue(true);
    vi.spyOn(relay, 'queueCommand').mockRejectedValue(new Error('relay timeout'));

    const handlers = createRelayHandlers(relay, { cacheTtlMs: 1000 });
    const result = await handlers.getControlSnapshot!({});

    expect(result.success).toBe(true);
    expect(result._meta?.stale).toBe(true);
    // The staleSinceMs branch is exercised here (not the age-multiplier branch)
    expect(result._meta?.staleSinceMs).toBeDefined();
  });
});

