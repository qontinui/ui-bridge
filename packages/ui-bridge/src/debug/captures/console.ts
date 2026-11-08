/**
 * Console Capture Sub-module
 *
 * Wraps console.error/warn/debug/log/info and listens for unhandledrejection
 * events. Wrapping is unconditional so cleanup can always restore originals;
 * an allow-list (passed via options.levels) gates which calls reach the emit
 * sink. Default allow-list preserves pre-0.5 behavior (error + warn +
 * unhandledrejection).
 */

import type { ConsoleCapturedEvent, AnyCapturedEvent } from '../browser-capture-types';

type Emit = (event: AnyCapturedEvent) => void;

const DEFAULT_LEVELS: ReadonlySet<ConsoleCapturedEvent['level']> = new Set([
  'error',
  'warn',
  'unhandledrejection',
]);

function argsToMessage(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return a.message;
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

function extractStack(args: unknown[]): string | undefined {
  const err = args.find((a) => a instanceof Error) as Error | undefined;
  return err?.stack;
}

function makeEvent(
  level: ConsoleCapturedEvent['level'],
  message: string,
  stack?: string
): ConsoleCapturedEvent {
  return {
    type: 'console',
    timestamp: Date.now(),
    url: typeof window !== 'undefined' ? window.location.href : '',
    level,
    message,
    stack,
  };
}

export function installConsoleCapture(
  emit: Emit,
  options?: {
    levels?: ReadonlySet<ConsoleCapturedEvent['level']>;
    /** Drop a call whose arguments match (it still reaches the real console). */
    ignore?: (args: unknown[]) => boolean;
  }
): () => void {
  const levels = options?.levels ?? DEFAULT_LEVELS;
  const ignore = options?.ignore;
  const record = (
    level: Exclude<ConsoleCapturedEvent['level'], 'unhandledrejection'>,
    args: unknown[]
  ) => {
    if (!levels.has(level)) return;
    if (ignore?.(args)) return;
    emit(makeEvent(level, argsToMessage(args), extractStack(args)));
  };

  const originalError = console.error;
  const originalWarn = console.warn;
  const originalDebug = console.debug;
  const originalLog = console.log;
  const originalInfo = console.info;

  console.error = (...args: unknown[]) => {
    record('error', args);
    originalError.apply(console, args);
  };

  console.warn = (...args: unknown[]) => {
    record('warn', args);
    originalWarn.apply(console, args);
  };

  console.debug = (...args: unknown[]) => {
    record('debug', args);
    originalDebug.apply(console, args);
  };

  console.log = (...args: unknown[]) => {
    record('log', args);
    originalLog.apply(console, args);
  };

  console.info = (...args: unknown[]) => {
    record('info', args);
    originalInfo.apply(console, args);
  };

  const rejectionHandler = (event: PromiseRejectionEvent) => {
    if (!levels.has('unhandledrejection')) return;
    const reason = event.reason;
    const message =
      reason instanceof Error ? reason.message : String(reason ?? 'Unhandled rejection');
    const stack = reason instanceof Error ? reason.stack : undefined;
    emit(makeEvent('unhandledrejection', message, stack));
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('unhandledrejection', rejectionHandler);
  }

  return () => {
    console.error = originalError;
    console.warn = originalWarn;
    console.debug = originalDebug;
    console.log = originalLog;
    console.info = originalInfo;
    if (typeof window !== 'undefined') {
      window.removeEventListener('unhandledrejection', rejectionHandler);
    }
  };
}
