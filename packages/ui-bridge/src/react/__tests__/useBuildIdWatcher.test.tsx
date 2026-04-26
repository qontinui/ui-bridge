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
});
