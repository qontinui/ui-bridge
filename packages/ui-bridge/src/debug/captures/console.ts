/**
 * Console Capture Sub-module
 *
 * Wraps console.error/console.warn and listens for unhandledrejection events.
 */

import type { ConsoleCapturedEvent, AnyCapturedEvent } from '../browser-capture-types';

type Emit = (event: AnyCapturedEvent) => void;

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

export function installConsoleCapture(emit: Emit): () => void {
  const originalError = console.error;
  const originalWarn = console.warn;

  console.error = (...args: unknown[]) => {
    emit(makeEvent('error', argsToMessage(args), extractStack(args)));
    originalError.apply(console, args);
  };

  console.warn = (...args: unknown[]) => {
    emit(makeEvent('warn', argsToMessage(args), extractStack(args)));
    originalWarn.apply(console, args);
  };

  const rejectionHandler = (event: PromiseRejectionEvent) => {
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
    if (typeof window !== 'undefined') {
      window.removeEventListener('unhandledrejection', rejectionHandler);
    }
  };
}
