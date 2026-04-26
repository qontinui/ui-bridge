/**
 * useBuildIdWatcher Hook Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBuildIdWatcher } from '../useBuildIdWatcher';

// Minimal EventSource shim that records listeners and lets tests dispatch
// events synchronously. Mirrors the subset of the spec the hook touches.
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  listeners: Map<string, Set<(e: MessageEvent) => void>> = new Map();
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, cb: (e: MessageEvent) => void) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(cb);
  }
  removeEventListener(name: string, cb: (e: MessageEvent) => void) {
    this.listeners.get(name)?.delete(cb);
  }
  close() {
    this.closed = true;
  }
  emit(name: string, data: string) {
    const cbs = this.listeners.get(name);
    if (!cbs) return;
    const event = { data } as MessageEvent;
    for (const cb of Array.from(cbs)) cb(event);
  }
}

function setMetaBuildId(value: string | null) {
  document.head.querySelectorAll('meta[name="build-id"]').forEach((n) => n.remove());
  if (value !== null) {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'build-id');
    meta.setAttribute('content', value);
    document.head.appendChild(meta);
  }
}

describe('useBuildIdWatcher', () => {
  let originalEventSource: typeof EventSource | undefined;

  beforeEach(() => {
    FakeEventSource.instances = [];
    originalEventSource = (globalThis as unknown as { EventSource?: typeof EventSource })
      .EventSource;
    (globalThis as unknown as { EventSource: unknown }).EventSource =
      FakeEventSource as unknown as typeof EventSource;
  });

  afterEach(() => {
    setMetaBuildId(null);
    if (originalEventSource === undefined) {
      delete (globalThis as unknown as { EventSource?: unknown }).EventSource;
    } else {
      (globalThis as unknown as { EventSource: typeof EventSource }).EventSource =
        originalEventSource;
    }
  });

  it('subscribes to default /health/stream when meta tag is present', () => {
    setMetaBuildId('build-A');
    renderHook(() => useBuildIdWatcher({ onBuildIdChange: vi.fn() }));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe('/health/stream');
  });

  it('respects healthStreamUrl override', () => {
    setMetaBuildId('build-A');
    renderHook(() =>
      useBuildIdWatcher({ healthStreamUrl: '/custom/health/stream', onBuildIdChange: vi.fn() })
    );
    expect(FakeEventSource.instances[0].url).toBe('/custom/health/stream');
  });

  it('no-ops when meta tag is missing', () => {
    setMetaBuildId(null);
    renderHook(() => useBuildIdWatcher({ onBuildIdChange: vi.fn() }));
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('no-ops when meta tag has empty content', () => {
    setMetaBuildId('');
    renderHook(() => useBuildIdWatcher({ onBuildIdChange: vi.fn() }));
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('fires callback when SSE buildId differs from initial', () => {
    setMetaBuildId('build-A');
    const onBuildIdChange = vi.fn();
    renderHook(() => useBuildIdWatcher({ onBuildIdChange }));
    const src = FakeEventSource.instances[0];
    src.emit('health', JSON.stringify({ status: 'healthy', buildId: 'build-B' }));
    expect(onBuildIdChange).toHaveBeenCalledTimes(1);
    expect(onBuildIdChange).toHaveBeenCalledWith('build-A', 'build-B');
  });

  it('does not fire when SSE buildId matches initial', () => {
    setMetaBuildId('build-A');
    const onBuildIdChange = vi.fn();
    renderHook(() => useBuildIdWatcher({ onBuildIdChange }));
    const src = FakeEventSource.instances[0];
    src.emit('health', JSON.stringify({ status: 'healthy', buildId: 'build-A' }));
    expect(onBuildIdChange).not.toHaveBeenCalled();
  });

  it('fires only once even when multiple changed events arrive', () => {
    setMetaBuildId('build-A');
    const onBuildIdChange = vi.fn();
    renderHook(() => useBuildIdWatcher({ onBuildIdChange }));
    const src = FakeEventSource.instances[0];
    src.emit('health', JSON.stringify({ buildId: 'build-B' }));
    src.emit('health', JSON.stringify({ buildId: 'build-C' }));
    src.emit('health', JSON.stringify({ buildId: 'build-B' }));
    expect(onBuildIdChange).toHaveBeenCalledTimes(1);
  });

  it('handles unnamed message events too', () => {
    setMetaBuildId('build-A');
    const onBuildIdChange = vi.fn();
    renderHook(() => useBuildIdWatcher({ onBuildIdChange }));
    const src = FakeEventSource.instances[0];
    src.emit('message', JSON.stringify({ buildId: 'build-Z' }));
    expect(onBuildIdChange).toHaveBeenCalledWith('build-A', 'build-Z');
  });

  it('ignores malformed JSON payloads', () => {
    setMetaBuildId('build-A');
    const onBuildIdChange = vi.fn();
    renderHook(() => useBuildIdWatcher({ onBuildIdChange }));
    const src = FakeEventSource.instances[0];
    src.emit('health', 'not json');
    src.emit('health', '');
    src.emit('health', JSON.stringify(null));
    src.emit('health', JSON.stringify({ noBuildId: true }));
    src.emit('health', JSON.stringify({ buildId: 42 }));
    expect(onBuildIdChange).not.toHaveBeenCalled();
  });

  it('closes EventSource on unmount', () => {
    setMetaBuildId('build-A');
    const { unmount } = renderHook(() => useBuildIdWatcher({ onBuildIdChange: vi.fn() }));
    const src = FakeEventSource.instances[0];
    expect(src.closed).toBe(false);
    unmount();
    expect(src.closed).toBe(true);
  });

  it('does not throw when callback is omitted', () => {
    setMetaBuildId('build-A');
    renderHook(() => useBuildIdWatcher());
    const src = FakeEventSource.instances[0];
    expect(() => src.emit('health', JSON.stringify({ buildId: 'build-B' }))).not.toThrow();
  });

  it('swallows callback errors so the listener stays alive', () => {
    setMetaBuildId('build-A');
    const onBuildIdChange = vi.fn(() => {
      throw new Error('boom');
    });
    renderHook(() => useBuildIdWatcher({ onBuildIdChange }));
    const src = FakeEventSource.instances[0];
    expect(() => src.emit('health', JSON.stringify({ buildId: 'build-B' }))).not.toThrow();
    expect(onBuildIdChange).toHaveBeenCalledTimes(1);
  });

  it('no-ops cleanly when EventSource is undefined', () => {
    setMetaBuildId('build-A');
    delete (globalThis as unknown as { EventSource?: unknown }).EventSource;
    expect(() => renderHook(() => useBuildIdWatcher({ onBuildIdChange: vi.fn() }))).not.toThrow();
  });

  describe('getCurrentBuildId path', () => {
    const flush = () => new Promise<void>((r) => setTimeout(r, 0));

    it('fires once when the getter returns a different build-id', async () => {
      setMetaBuildId('build-A');
      const onBuildIdChange = vi.fn();
      const getCurrentBuildId = vi.fn().mockResolvedValue('build-B');
      renderHook(() =>
        useBuildIdWatcher({ getCurrentBuildId, pollIntervalMs: 0, onBuildIdChange })
      );
      await flush();
      expect(getCurrentBuildId).toHaveBeenCalledTimes(1);
      expect(onBuildIdChange).toHaveBeenCalledWith('build-A', 'build-B');
      expect(FakeEventSource.instances).toHaveLength(0);
    });

    it('does not fire when the getter matches the meta tag', async () => {
      setMetaBuildId('build-A');
      const onBuildIdChange = vi.fn();
      renderHook(() =>
        useBuildIdWatcher({
          getCurrentBuildId: () => Promise.resolve('build-A'),
          pollIntervalMs: 0,
          onBuildIdChange,
        })
      );
      await flush();
      expect(onBuildIdChange).not.toHaveBeenCalled();
    });

    it('swallows getter errors without crashing', async () => {
      setMetaBuildId('build-A');
      const onBuildIdChange = vi.fn();
      renderHook(() =>
        useBuildIdWatcher({
          getCurrentBuildId: () => Promise.reject(new Error('boom')),
          pollIntervalMs: 0,
          onBuildIdChange,
        })
      );
      await flush();
      expect(onBuildIdChange).not.toHaveBeenCalled();
    });

    it('skips SSE when getCurrentBuildId is provided', () => {
      setMetaBuildId('build-A');
      renderHook(() =>
        useBuildIdWatcher({
          getCurrentBuildId: () => Promise.resolve('build-A'),
          pollIntervalMs: 0,
        })
      );
      expect(FakeEventSource.instances).toHaveLength(0);
    });
  });

  describe('pollUrl path', () => {
    let originalFetch: typeof fetch | undefined;
    const flush = () => new Promise<void>((r) => setTimeout(r, 0));

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      if (originalFetch === undefined) {
        delete (globalThis as unknown as { fetch?: unknown }).fetch;
      } else {
        globalThis.fetch = originalFetch;
      }
    });

    it('fires once when /api/health returns a different build-id', async () => {
      setMetaBuildId('build-A');
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ buildId: 'build-B' }),
      } as unknown as Response);
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const onBuildIdChange = vi.fn();
      renderHook(() =>
        useBuildIdWatcher({ pollUrl: '/api/health', pollIntervalMs: 0, onBuildIdChange })
      );
      await flush();
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/health',
        expect.objectContaining({ cache: 'no-store' })
      );
      expect(onBuildIdChange).toHaveBeenCalledWith('build-A', 'build-B');
      expect(FakeEventSource.instances).toHaveLength(0);
    });

    it('does not fire when /api/health matches the meta tag', async () => {
      setMetaBuildId('build-A');
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ buildId: 'build-A' }),
      } as unknown as Response) as unknown as typeof fetch;
      const onBuildIdChange = vi.fn();
      renderHook(() =>
        useBuildIdWatcher({ pollUrl: '/api/health', pollIntervalMs: 0, onBuildIdChange })
      );
      await flush();
      expect(onBuildIdChange).not.toHaveBeenCalled();
    });

    it('ignores non-OK responses', async () => {
      setMetaBuildId('build-A');
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ buildId: 'build-B' }),
      } as unknown as Response) as unknown as typeof fetch;
      const onBuildIdChange = vi.fn();
      renderHook(() =>
        useBuildIdWatcher({ pollUrl: '/api/health', pollIntervalMs: 0, onBuildIdChange })
      );
      await flush();
      expect(onBuildIdChange).not.toHaveBeenCalled();
    });

    it('ticks again after pollIntervalMs and stops after unmount', async () => {
      vi.useFakeTimers();
      try {
        setMetaBuildId('build-A');
        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ buildId: 'build-A' }),
        } as unknown as Response);
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        const onBuildIdChange = vi.fn();
        const { unmount } = renderHook(() =>
          useBuildIdWatcher({ pollUrl: '/api/health', pollIntervalMs: 1000, onBuildIdChange })
        );
        // First tick fires synchronously on mount; flush microtasks.
        await vi.advanceTimersByTimeAsync(0);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        // Advance past the interval — second tick should fire.
        await vi.advanceTimersByTimeAsync(1000);
        expect(fetchMock).toHaveBeenCalledTimes(2);

        // Unmount before the next tick, then advance again — no further calls.
        unmount();
        await vi.advanceTimersByTimeAsync(5000);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(onBuildIdChange).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('aborts in-flight fetch on unmount and does not invoke callback', async () => {
      setMetaBuildId('build-A');
      let capturedSignal: AbortSignal | undefined;
      let resolveFetch: ((value: Response) => void) | null = null;
      const fetchMock = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            capturedSignal = init?.signal ?? undefined;
            resolveFetch = resolve;
            // Reject when aborted, mirroring the real fetch contract.
            if (capturedSignal) {
              capturedSignal.addEventListener('abort', () => {
                const err = new Error('aborted');
                (err as { name: string }).name = 'AbortError';
                reject(err);
              });
            }
          })
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const onBuildIdChange = vi.fn();
      const { unmount } = renderHook(() =>
        useBuildIdWatcher({ pollUrl: '/api/health', pollIntervalMs: 0, onBuildIdChange })
      );

      // Fetch is in flight; signal must have been passed.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(capturedSignal).toBeDefined();
      expect(capturedSignal?.aborted).toBe(false);

      unmount();

      // Cleanup must abort the in-flight request.
      expect(capturedSignal?.aborted).toBe(true);

      // Even if the upstream resolves anyway, the callback must NOT fire.
      resolveFetch?.({
        ok: true,
        json: () => Promise.resolve({ buildId: 'build-B' }),
      } as unknown as Response);
      await new Promise<void>((r) => setTimeout(r, 0));
      expect(onBuildIdChange).not.toHaveBeenCalled();
    });

    it('does not re-subscribe when only an inline onBuildIdChange lambda changes', async () => {
      setMetaBuildId('build-A');
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ buildId: 'build-A' }),
      } as unknown as Response);
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const { rerender } = renderHook(
        ({ cb }: { cb: () => void }) =>
          useBuildIdWatcher({ pollUrl: '/api/health', pollIntervalMs: 0, onBuildIdChange: cb }),
        { initialProps: { cb: () => {} } }
      );
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Re-render with a brand-new inline lambda; if the effect re-subscribed,
      // we'd see a second fetch on the new mount.
      rerender({ cb: () => {} });
      rerender({ cb: () => {} });
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('routes calls to the latest onBuildIdChange ref on rerender', async () => {
      setMetaBuildId('build-A');
      // Defer the fetch resolution until after the rerender so the latest cb
      // is what compare() sees.
      let resolveFetch: ((value: Response) => void) | null = null;
      const fetchMock = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          })
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const first = vi.fn();
      const second = vi.fn();
      const { rerender } = renderHook(
        ({ cb }: { cb: () => void }) =>
          useBuildIdWatcher({ pollUrl: '/api/health', pollIntervalMs: 0, onBuildIdChange: cb }),
        { initialProps: { cb: first } }
      );
      // Swap callback before fetch resolves.
      rerender({ cb: second });
      resolveFetch?.({
        ok: true,
        json: () => Promise.resolve({ buildId: 'build-B' }),
      } as unknown as Response);
      await flush();
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledWith('build-A', 'build-B');
    });
  });
});
