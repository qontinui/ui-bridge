import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { AnyCapturedEvent, ConsoleCapturedEvent } from '../browser-capture-types';
import { installConsoleCapture } from './console';

type ConsoleLevel = ConsoleCapturedEvent['level'];

interface Snapshot {
  error: typeof console.error;
  warn: typeof console.warn;
  debug: typeof console.debug;
  log: typeof console.log;
  info: typeof console.info;
}

function snapshotConsole(): Snapshot {
  return {
    error: console.error,
    warn: console.warn,
    debug: console.debug,
    log: console.log,
    info: console.info,
  };
}

function emittedLevels(emit: ReturnType<typeof vi.fn>): ConsoleLevel[] {
  return emit.mock.calls
    .map(([event]) => event as AnyCapturedEvent)
    .filter((e): e is ConsoleCapturedEvent => e.type === 'console')
    .map((e) => e.level);
}

describe('installConsoleCapture', () => {
  let original: Snapshot;
  let spies: Record<keyof Snapshot, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    spies = {
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      log: vi.fn(),
      info: vi.fn(),
    };
    console.error = spies.error;
    console.warn = spies.warn;
    console.debug = spies.debug;
    console.log = spies.log;
    console.info = spies.info;
    original = snapshotConsole();
  });

  afterEach(() => {
    console.error = original.error;
    console.warn = original.warn;
    console.debug = original.debug;
    console.log = original.log;
    console.info = original.info;
  });

  it('defaults to capturing error + warn + unhandledrejection, ignoring debug/log/info', () => {
    const emit = vi.fn();
    const dispose = installConsoleCapture(emit);

    console.error('boom');
    console.warn('careful');
    console.debug('quiet');
    console.log('chatty');
    console.info('fyi');

    expect(emittedLevels(emit).sort()).toEqual(['error', 'warn']);

    dispose();
  });

  it('captures every level when the full allow-list is passed', () => {
    const emit = vi.fn();
    const dispose = installConsoleCapture(emit, {
      levels: new Set<ConsoleLevel>([
        'error',
        'warn',
        'debug',
        'info',
        'log',
        'unhandledrejection',
      ]),
    });

    console.error('e');
    console.warn('w');
    console.debug('d');
    console.log('l');
    console.info('i');

    expect(emittedLevels(emit).sort()).toEqual(['debug', 'error', 'info', 'log', 'warn']);

    dispose();
  });

  it('captures only the levels in a custom subset', () => {
    const emit = vi.fn();
    const dispose = installConsoleCapture(emit, {
      levels: new Set<ConsoleLevel>(['error', 'debug']),
    });

    console.error('e');
    console.warn('w');
    console.debug('d');
    console.log('l');
    console.info('i');

    expect(emittedLevels(emit).sort()).toEqual(['debug', 'error']);

    dispose();
  });

  it('always forwards args to the original console method, even when emission is gated off', () => {
    const emit = vi.fn();
    const dispose = installConsoleCapture(emit, {
      levels: new Set<ConsoleLevel>(['error']),
    });

    console.error('err-args', 1);
    console.warn('warn-args', 2);
    console.debug('debug-args', 3);
    console.log('log-args', 4);
    console.info('info-args', 5);

    expect(spies.error).toHaveBeenCalledWith('err-args', 1);
    expect(spies.warn).toHaveBeenCalledWith('warn-args', 2);
    expect(spies.debug).toHaveBeenCalledWith('debug-args', 3);
    expect(spies.log).toHaveBeenCalledWith('log-args', 4);
    expect(spies.info).toHaveBeenCalledWith('info-args', 5);

    expect(emittedLevels(emit)).toEqual(['error']);

    dispose();
  });

  it('restores the original console methods on dispose (reference equality)', () => {
    const emit = vi.fn();
    const before = snapshotConsole();

    expect(console.error).toBe(before.error);

    const dispose = installConsoleCapture(emit);

    expect(console.error).not.toBe(before.error);
    expect(console.warn).not.toBe(before.warn);
    expect(console.debug).not.toBe(before.debug);
    expect(console.log).not.toBe(before.log);
    expect(console.info).not.toBe(before.info);

    dispose();

    expect(console.error).toBe(before.error);
    expect(console.warn).toBe(before.warn);
    expect(console.debug).toBe(before.debug);
    expect(console.log).toBe(before.log);
    expect(console.info).toBe(before.info);
  });

  it('emits unhandledrejection events only when included in the allow-list', () => {
    const emit = vi.fn();
    const dispose = installConsoleCapture(emit, {
      levels: new Set<ConsoleLevel>(['unhandledrejection']),
    });

    const evt = new Event('unhandledrejection') as Event & { reason?: unknown };
    Object.defineProperty(evt, 'reason', { value: new Error('async boom') });
    window.dispatchEvent(evt);

    const levels = emittedLevels(emit);
    expect(levels).toContain('unhandledrejection');

    dispose();
  });

  it('does NOT emit unhandledrejection when omitted from the allow-list', () => {
    const emit = vi.fn();
    const dispose = installConsoleCapture(emit, {
      levels: new Set<ConsoleLevel>(['error']),
    });

    const evt = new Event('unhandledrejection') as Event & { reason?: unknown };
    Object.defineProperty(evt, 'reason', { value: new Error('async boom') });
    window.dispatchEvent(evt);

    expect(emittedLevels(emit)).not.toContain('unhandledrejection');

    dispose();
  });

  it('captures unhandledrejection by default (back-compat)', () => {
    const emit = vi.fn();
    const dispose = installConsoleCapture(emit);

    const evt = new Event('unhandledrejection') as Event & { reason?: unknown };
    Object.defineProperty(evt, 'reason', { value: new Error('default boom') });
    window.dispatchEvent(evt);

    expect(emittedLevels(emit)).toContain('unhandledrejection');

    dispose();
  });
});
