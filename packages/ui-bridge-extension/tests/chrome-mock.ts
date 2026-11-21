/**
 * A minimal `chrome` global for the extension's unit tests: just the
 * listener registrations the service worker makes at import time, plus the
 * `tabs` calls the capture path reads. Every listener is recorded so a test
 * can drive it the way Chrome would.
 */

import { vi } from 'vitest';

type AnyListener = (...args: never[]) => unknown;

export interface ChromeMock {
  listeners: Record<string, AnyListener[]>;
  tabs: {
    query: ReturnType<typeof vi.fn>;
    captureVisibleTab: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    onRemoved: { addListener: (l: AnyListener) => void };
    onUpdated: { addListener: (l: AnyListener) => void };
  };
  runtime: {
    onMessage: { addListener: (l: AnyListener) => void };
    sendMessage: ReturnType<typeof vi.fn>;
  };
  commands: { onCommand: { addListener: (l: AnyListener) => void } };
  storage: { local: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> } };
  sidePanel: { open: ReturnType<typeof vi.fn> };
}

export function installChromeMock(): ChromeMock {
  const listeners: Record<string, AnyListener[]> = {};
  const on = (name: string) => ({
    addListener: (l: AnyListener) => {
      (listeners[name] ??= []).push(l);
    },
  });
  const mock: ChromeMock = {
    listeners,
    tabs: {
      query: vi.fn(async () => []),
      captureVisibleTab: vi.fn(async () => 'data:image/png;base64,'),
      sendMessage: vi.fn(),
      onRemoved: on('tabs.onRemoved'),
      onUpdated: on('tabs.onUpdated'),
    },
    runtime: { onMessage: on('runtime.onMessage'), sendMessage: vi.fn() },
    commands: { onCommand: on('commands.onCommand') },
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) } },
    sidePanel: { open: vi.fn() },
  };
  vi.stubGlobal('chrome', mock);
  return mock;
}
