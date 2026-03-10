/**
 * Error Fingerprinting & Deduplication Tests
 *
 * Tests the public API: computeFingerprint, extractSourceLocation, deduplicateEvents.
 *
 * Covers all three stack trace formats:
 *   - V8 (Chrome): "    at fn (file:line:col)"
 *   - SpiderMonkey (Firefox): "fn@file:line:col"
 *   - JSC bare (Safari): "file:line:col"
 */

import { describe, it, expect } from 'vitest';
import { computeFingerprint, extractSourceLocation, deduplicateEvents } from './error-fingerprint';
import type {
  AnyCapturedEvent,
  ConsoleCapturedEvent,
  NetworkCapturedEvent,
  ReactErrorCapturedEvent,
  ResourceErrorCapturedEvent,
  HmrCapturedEvent,
  WsDisconnectionCapturedEvent,
  NavigationCapturedEvent,
  LongTaskCapturedEvent,
  LoafCapturedEvent,
  WebVitalCapturedEvent,
  MemoryCapturedEvent,
  LoafScriptAttribution,
} from './browser-capture-types';

// ---------------------------------------------------------------------------
// Mock event builders
// ---------------------------------------------------------------------------

let nextTimestamp = 1000;

function ts(): number {
  return nextTimestamp++;
}

function makeConsoleEvent(overrides: Partial<ConsoleCapturedEvent> = {}): ConsoleCapturedEvent {
  return {
    type: 'console',
    timestamp: ts(),
    url: 'http://localhost:3001/dashboard',
    level: 'error',
    message: 'Something went wrong',
    ...overrides,
  };
}

function makeNetworkEvent(overrides: Partial<NetworkCapturedEvent> = {}): NetworkCapturedEvent {
  return {
    type: 'network',
    timestamp: ts(),
    url: 'http://localhost:3001/dashboard',
    method: 'GET',
    requestUrl: 'http://localhost:8000/api/v1/tasks',
    status: 500,
    durationMs: 120,
    kind: 'http-error',
    ...overrides,
  };
}

function makeReactErrorEvent(
  overrides: Partial<ReactErrorCapturedEvent> = {}
): ReactErrorCapturedEvent {
  return {
    type: 'react-error',
    timestamp: ts(),
    url: 'http://localhost:3001/dashboard',
    message: 'Cannot read properties of undefined',
    ...overrides,
  };
}

function makeResourceErrorEvent(
  overrides: Partial<ResourceErrorCapturedEvent> = {}
): ResourceErrorCapturedEvent {
  return {
    type: 'resource-error',
    timestamp: ts(),
    url: 'http://localhost:3001/dashboard',
    resourceUrl: 'http://localhost:3001/images/logo.png',
    tagName: 'IMG',
    ...overrides,
  };
}

function makeHmrEvent(overrides: Partial<HmrCapturedEvent> = {}): HmrCapturedEvent {
  return {
    type: 'hmr',
    timestamp: ts(),
    url: 'http://localhost:3001/dashboard',
    level: 'error',
    message: 'Module build failed',
    ...overrides,
  };
}

function makeWsDisconnectionEvent(
  overrides: Partial<WsDisconnectionCapturedEvent> = {}
): WsDisconnectionCapturedEvent {
  return {
    type: 'ws-disconnection',
    timestamp: ts(),
    url: 'http://localhost:3001/dashboard',
    previousState: 'connected',
    newState: 'disconnected',
    ...overrides,
  };
}

function makeNavigationEvent(
  overrides: Partial<NavigationCapturedEvent> = {}
): NavigationCapturedEvent {
  return {
    type: 'navigation',
    timestamp: ts(),
    url: 'http://localhost:3001/old-page',
    from: 'http://localhost:3001/old-page',
    to: 'http://localhost:3001/new-page',
    trigger: 'pushState',
    ...overrides,
  };
}

function makeLongTaskEvent(overrides: Partial<LongTaskCapturedEvent> = {}): LongTaskCapturedEvent {
  return {
    type: 'long-task',
    timestamp: ts(),
    url: 'http://localhost:3001/dashboard',
    durationMs: 120,
    ...overrides,
  };
}

function makeLoafEvent(
  overrides: Partial<LoafCapturedEvent> & { scripts?: LoafScriptAttribution[] } = {}
): LoafCapturedEvent {
  return {
    type: 'long-animation-frame',
    timestamp: ts(),
    url: 'http://localhost:3001/dashboard',
    durationMs: 200,
    blockingDurationMs: 150,
    scripts: [
      {
        invoker: 'TimerHandler:setTimeout',
        sourceURL: 'http://localhost:3001/src/components/App.tsx',
        sourceFunctionName: 'render',
        sourceCharPosition: 42,
        duration: 180,
      },
    ],
    ...overrides,
  };
}

function makeWebVitalEvent(overrides: Partial<WebVitalCapturedEvent> = {}): WebVitalCapturedEvent {
  return {
    type: 'web-vital',
    timestamp: ts(),
    url: 'http://localhost:3001/dashboard',
    metric: 'LCP',
    value: 2500,
    ...overrides,
  };
}

function makeMemoryEvent(overrides: Partial<MemoryCapturedEvent> = {}): MemoryCapturedEvent {
  return {
    type: 'memory',
    timestamp: ts(),
    url: 'http://localhost:3001/dashboard',
    usedJSHeapSize: 50_000_000,
    totalJSHeapSize: 100_000_000,
    jsHeapSizeLimit: 200_000_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Stack trace fixtures
//
// V8 format (Chrome):   "    at fn (file:line:col)"
// SpiderMonkey (FF):    "fn@file:line:col"
// JSC bare (Safari):    "file:line:col"
// ---------------------------------------------------------------------------

/** SpiderMonkey-format stack with an app frame followed by an internal frame */
const SM_STACK_APP_FIRST = `handleClick@http://localhost:3001/src/components/Button.tsx:42:15
dispatch@http://localhost:3001/node_modules/react-dom/cjs/react-dom.development.js:3456:12`;

/** SpiderMonkey-format stack where ALL frames are internal */
const SM_STACK_ALL_INTERNALS = `dispatch@http://localhost:3001/node_modules/react-dom/cjs/react-dom.development.js:3456:12
scheduleUpdateOnFiber@http://localhost:3001/node_modules/react-dom/cjs/react-dom.development.js:21851:12`;

/** JSC bare stack: first frame is internal, second is app-level */
const JSC_BARE_STACK = `http://localhost:3001/node_modules/react-dom/cjs/react-dom.development.js:3456:12
http://localhost:3001/src/pages/Dashboard.tsx:88:5`;

/** V8-style stack (indented `at` lines) */
const V8_STACK = `Error: Something failed
    at handleClick (http://localhost:3001/src/components/Button.tsx:42:15)
    at HTMLButtonElement.dispatch (http://localhost:3001/node_modules/react-dom/cjs/react-dom.development.js:3456:12)`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('error-fingerprint', () => {
  // =========================================================================
  // computeFingerprint
  // =========================================================================

  describe('computeFingerprint', () => {
    describe('console events', () => {
      it('should fingerprint a console error event', () => {
        const fp = computeFingerprint(makeConsoleEvent());
        expect(fp).toContain('console:error');
        expect(fp).toContain('Something went wrong');
      });

      it('should include the level in the fingerprint', () => {
        const fpError = computeFingerprint(makeConsoleEvent({ level: 'error' }));
        const fpWarn = computeFingerprint(makeConsoleEvent({ level: 'warn' }));
        expect(fpError).not.toBe(fpWarn);
      });

      it('should include the stack frame location when available (SpiderMonkey format)', () => {
        const fp = computeFingerprint(makeConsoleEvent({ stack: SM_STACK_APP_FIRST }));
        expect(fp).toContain('Button.tsx');
      });

      it('should produce an empty frame segment when no stack is provided', () => {
        const fp = computeFingerprint(makeConsoleEvent({ stack: undefined }));
        // fingerprint ends with "|" since topFrameForFingerprint returns ""
        expect(fp).toMatch(/\|$/);
      });
    });

    describe('network events', () => {
      it('should fingerprint a network event', () => {
        const fp = computeFingerprint(makeNetworkEvent());
        expect(fp).toContain('network:GET');
        expect(fp).toContain('500');
      });

      it('should use kind when status is absent', () => {
        const fp = computeFingerprint(
          makeNetworkEvent({ status: undefined, kind: 'network-error' })
        );
        expect(fp).toContain('network-error');
      });

      it('should normalize UUIDs in the request URL', () => {
        const fp1 = computeFingerprint(
          makeNetworkEvent({
            requestUrl: 'http://localhost:8000/api/v1/tasks/550e8400-e29b-41d4-a716-446655440000',
          })
        );
        const fp2 = computeFingerprint(
          makeNetworkEvent({
            requestUrl: 'http://localhost:8000/api/v1/tasks/a1234567-b89c-def0-1234-567890abcdef',
          })
        );
        expect(fp1).toBe(fp2);
      });

      it('should normalize numeric IDs in the request URL', () => {
        const fp1 = computeFingerprint(
          makeNetworkEvent({ requestUrl: 'http://localhost:8000/api/v1/tasks/123' })
        );
        const fp2 = computeFingerprint(
          makeNetworkEvent({ requestUrl: 'http://localhost:8000/api/v1/tasks/456' })
        );
        expect(fp1).toBe(fp2);
      });
    });

    describe('react-error events', () => {
      it('should fingerprint a react-error event', () => {
        const fp = computeFingerprint(makeReactErrorEvent());
        expect(fp).toContain('react-error');
        expect(fp).toContain('Cannot read properties of undefined');
      });

      it('should include source location from stack (SpiderMonkey format)', () => {
        const fp = computeFingerprint(makeReactErrorEvent({ stack: SM_STACK_APP_FIRST }));
        expect(fp).toContain('Button.tsx');
      });
    });

    describe('resource-error events', () => {
      it('should fingerprint a resource-error event', () => {
        const fp = computeFingerprint(makeResourceErrorEvent());
        expect(fp).toContain('resource-error:IMG');
      });

      it('should normalize the resource URL', () => {
        const fp1 = computeFingerprint(
          makeResourceErrorEvent({
            resourceUrl:
              'http://localhost:3001/images/550e8400-e29b-41d4-a716-446655440000/photo.png',
          })
        );
        const fp2 = computeFingerprint(
          makeResourceErrorEvent({
            resourceUrl:
              'http://localhost:3001/images/a1234567-b89c-def0-1234-567890abcdef/photo.png',
          })
        );
        expect(fp1).toBe(fp2);
      });
    });

    describe('hmr events', () => {
      it('should fingerprint an hmr event', () => {
        const fp = computeFingerprint(makeHmrEvent());
        expect(fp).toContain('hmr:error');
        expect(fp).toContain('Module build failed');
      });

      it('should include moduleName when present', () => {
        const fpWithModule = computeFingerprint(makeHmrEvent({ moduleName: 'src/App.tsx' }));
        const fpWithoutModule = computeFingerprint(makeHmrEvent({ moduleName: undefined }));
        expect(fpWithModule).not.toBe(fpWithoutModule);
        expect(fpWithModule).toContain('src/App.tsx');
      });
    });

    describe('ws-disconnection events', () => {
      it('should fingerprint a ws-disconnection event', () => {
        const fp = computeFingerprint(makeWsDisconnectionEvent());
        expect(fp).toBe('ws-disconnection:connected->disconnected');
      });

      it('should differ by state transition', () => {
        const fp1 = computeFingerprint(
          makeWsDisconnectionEvent({ previousState: 'connected', newState: 'disconnected' })
        );
        const fp2 = computeFingerprint(
          makeWsDisconnectionEvent({ previousState: 'disconnected', newState: 'connecting' })
        );
        expect(fp1).not.toBe(fp2);
      });
    });

    describe('navigation events', () => {
      it('should fingerprint a navigation event', () => {
        const fp = computeFingerprint(makeNavigationEvent());
        expect(fp).toContain('navigation:pushState');
      });

      it('should normalize UUIDs in the target URL', () => {
        const fp1 = computeFingerprint(
          makeNavigationEvent({
            to: 'http://localhost:3001/task/550e8400-e29b-41d4-a716-446655440000',
          })
        );
        const fp2 = computeFingerprint(
          makeNavigationEvent({
            to: 'http://localhost:3001/task/a1234567-b89c-def0-1234-567890abcdef',
          })
        );
        expect(fp1).toBe(fp2);
      });

      it('should differ by trigger type', () => {
        const fp1 = computeFingerprint(makeNavigationEvent({ trigger: 'pushState' }));
        const fp2 = computeFingerprint(makeNavigationEvent({ trigger: 'popstate' }));
        expect(fp1).not.toBe(fp2);
      });
    });

    describe('long-task events', () => {
      it('should fingerprint a long-task event', () => {
        const fp = computeFingerprint(makeLongTaskEvent({ durationMs: 120 }));
        expect(fp).toContain('long-task:');
      });

      it('should bucket durations to 50ms increments', () => {
        // Math.round(100/50)*50 = 100, Math.round(120/50)*50 = 100, Math.round(149/50)*50 = 150
        const fp100 = computeFingerprint(makeLongTaskEvent({ durationMs: 100 }));
        const fp120 = computeFingerprint(makeLongTaskEvent({ durationMs: 120 }));
        const fp149 = computeFingerprint(makeLongTaskEvent({ durationMs: 149 }));
        expect(fp100).toBe(fp120);
        expect(fp100).toContain('100ms');
        expect(fp149).toContain('150ms');
        expect(fp100).not.toBe(fp149);
      });
    });

    describe('long-animation-frame events', () => {
      it('should fingerprint a loaf event', () => {
        const fp = computeFingerprint(makeLoafEvent());
        expect(fp).toContain('loaf:');
        expect(fp).toContain('TimerHandler:setTimeout');
      });

      it('should bucket durations to 50ms increments', () => {
        // Math.round(210/50)*50 = 200, Math.round(220/50)*50 = 200
        const fp1 = computeFingerprint(makeLoafEvent({ durationMs: 210 }));
        const fp2 = computeFingerprint(makeLoafEvent({ durationMs: 220 }));
        expect(fp1).toBe(fp2);
      });

      it('should include script attribution in the fingerprint', () => {
        const fpA = computeFingerprint(
          makeLoafEvent({
            scripts: [
              {
                invoker: 'TimerHandler:setTimeout',
                sourceURL: 'http://localhost:3001/src/components/App.tsx',
                sourceFunctionName: 'render',
                sourceCharPosition: 42,
                duration: 180,
              },
            ],
          })
        );
        const fpB = computeFingerprint(
          makeLoafEvent({
            scripts: [
              {
                invoker: 'EventHandler:click',
                sourceURL: 'http://localhost:3001/src/components/Button.tsx',
                sourceFunctionName: 'handleClick',
                sourceCharPosition: 10,
                duration: 180,
              },
            ],
          })
        );
        expect(fpA).not.toBe(fpB);
      });
    });

    describe('web-vital events', () => {
      it('should fingerprint a web-vital event by metric name', () => {
        const fp = computeFingerprint(makeWebVitalEvent({ metric: 'LCP' }));
        expect(fp).toBe('web-vital:LCP');
      });

      it('should differ by metric type', () => {
        const fpLcp = computeFingerprint(makeWebVitalEvent({ metric: 'LCP' }));
        const fpCls = computeFingerprint(makeWebVitalEvent({ metric: 'CLS' }));
        expect(fpLcp).not.toBe(fpCls);
      });

      it('should NOT differ by value (same metric always same fingerprint)', () => {
        const fp1 = computeFingerprint(makeWebVitalEvent({ metric: 'LCP', value: 1500 }));
        const fp2 = computeFingerprint(makeWebVitalEvent({ metric: 'LCP', value: 3000 }));
        expect(fp1).toBe(fp2);
      });
    });

    describe('memory events', () => {
      it('should produce a constant fingerprint for all memory events', () => {
        const fp1 = computeFingerprint(makeMemoryEvent({ usedJSHeapSize: 50_000_000 }));
        const fp2 = computeFingerprint(makeMemoryEvent({ usedJSHeapSize: 100_000_000 }));
        expect(fp1).toBe('memory:snapshot');
        expect(fp1).toBe(fp2);
      });
    });
  });

  // =========================================================================
  // Fingerprint stability (dynamic value normalization)
  // =========================================================================

  describe('fingerprint stability', () => {
    it('should produce the same fingerprint for messages differing only by UUID', () => {
      const fp1 = computeFingerprint(
        makeConsoleEvent({
          message: 'Failed to fetch task 550e8400-e29b-41d4-a716-446655440000',
        })
      );
      const fp2 = computeFingerprint(
        makeConsoleEvent({
          message: 'Failed to fetch task a1234567-b89c-def0-1234-567890abcdef',
        })
      );
      expect(fp1).toBe(fp2);
    });

    it('should produce the same fingerprint for messages differing only by ISO timestamp', () => {
      const fp1 = computeFingerprint(
        makeConsoleEvent({
          message: 'Request failed at 2024-01-15T10:30:00.000Z',
        })
      );
      const fp2 = computeFingerprint(
        makeConsoleEvent({
          message: 'Request failed at 2025-06-20T22:15:45.123Z',
        })
      );
      expect(fp1).toBe(fp2);
    });

    it('should produce the same fingerprint for messages differing only by hex addresses', () => {
      const fp1 = computeFingerprint(
        makeConsoleEvent({
          message: 'Null pointer at 0x1a2b3c4d',
        })
      );
      const fp2 = computeFingerprint(
        makeConsoleEvent({
          message: 'Null pointer at 0xdeadbeef',
        })
      );
      expect(fp1).toBe(fp2);
    });

    it('should produce the same fingerprint for messages differing only by numeric values', () => {
      const fp1 = computeFingerprint(
        makeConsoleEvent({
          message: 'Expected 5 items but got 12',
        })
      );
      const fp2 = computeFingerprint(
        makeConsoleEvent({
          message: 'Expected 100 items but got 0',
        })
      );
      expect(fp1).toBe(fp2);
    });

    it('should produce the same fingerprint for messages differing by unix timestamps', () => {
      const fp1 = computeFingerprint(
        makeConsoleEvent({
          message: 'Cache expired at 1705312200000',
        })
      );
      const fp2 = computeFingerprint(
        makeConsoleEvent({
          message: 'Cache expired at 1720000000000',
        })
      );
      expect(fp1).toBe(fp2);
    });

    it('should produce the same fingerprint for messages with multiple dynamic values', () => {
      const fp1 = computeFingerprint(
        makeConsoleEvent({
          message:
            'Task 550e8400-e29b-41d4-a716-446655440000 failed after 3 retries at 2024-01-15T10:30:00Z (code 0x1234)',
        })
      );
      const fp2 = computeFingerprint(
        makeConsoleEvent({
          message:
            'Task a1234567-b89c-def0-1234-567890abcdef failed after 10 retries at 2025-06-20T22:15:45Z (code 0xabcd)',
        })
      );
      expect(fp1).toBe(fp2);
    });

    it('should produce the same fingerprint regardless of event timestamp', () => {
      const fp1 = computeFingerprint(makeConsoleEvent({ timestamp: 1000 }));
      const fp2 = computeFingerprint(makeConsoleEvent({ timestamp: 9999 }));
      expect(fp1).toBe(fp2);
    });
  });

  // =========================================================================
  // Fingerprint distinctness
  // =========================================================================

  describe('fingerprint distinctness', () => {
    it('should produce different fingerprints for different event types', () => {
      const fps = new Set([
        computeFingerprint(makeConsoleEvent()),
        computeFingerprint(makeNetworkEvent()),
        computeFingerprint(makeReactErrorEvent()),
        computeFingerprint(makeResourceErrorEvent()),
        computeFingerprint(makeHmrEvent()),
        computeFingerprint(makeWsDisconnectionEvent()),
        computeFingerprint(makeNavigationEvent()),
        computeFingerprint(makeLongTaskEvent()),
        computeFingerprint(makeLoafEvent()),
        computeFingerprint(makeWebVitalEvent()),
        computeFingerprint(makeMemoryEvent()),
      ]);
      expect(fps.size).toBe(11);
    });

    it('should produce different fingerprints for different error messages', () => {
      const fp1 = computeFingerprint(
        makeConsoleEvent({ message: 'TypeError: x is not a function' })
      );
      const fp2 = computeFingerprint(
        makeConsoleEvent({ message: 'ReferenceError: y is not defined' })
      );
      expect(fp1).not.toBe(fp2);
    });

    it('should produce different fingerprints for different HTTP methods', () => {
      const fp1 = computeFingerprint(makeNetworkEvent({ method: 'GET' }));
      const fp2 = computeFingerprint(makeNetworkEvent({ method: 'POST' }));
      expect(fp1).not.toBe(fp2);
    });

    it('should produce different fingerprints for different status codes', () => {
      const fp1 = computeFingerprint(makeNetworkEvent({ status: 404 }));
      const fp2 = computeFingerprint(makeNetworkEvent({ status: 500 }));
      expect(fp1).not.toBe(fp2);
    });

    it('should produce different fingerprints for different resource tag names', () => {
      const fp1 = computeFingerprint(makeResourceErrorEvent({ tagName: 'IMG' }));
      const fp2 = computeFingerprint(makeResourceErrorEvent({ tagName: 'SCRIPT' }));
      expect(fp1).not.toBe(fp2);
    });

    it('should produce different fingerprints for different URLs on network events', () => {
      const fp1 = computeFingerprint(
        makeNetworkEvent({ requestUrl: 'http://localhost:8000/api/v1/tasks' })
      );
      const fp2 = computeFingerprint(
        makeNetworkEvent({ requestUrl: 'http://localhost:8000/api/v1/users' })
      );
      expect(fp1).not.toBe(fp2);
    });

    it('should produce different fingerprints for different console levels', () => {
      const fp1 = computeFingerprint(makeConsoleEvent({ level: 'error' }));
      const fp2 = computeFingerprint(makeConsoleEvent({ level: 'warn' }));
      const fp3 = computeFingerprint(makeConsoleEvent({ level: 'unhandledrejection' }));
      expect(new Set([fp1, fp2, fp3]).size).toBe(3);
    });

    it('should produce different fingerprints for errors with different stack locations (SpiderMonkey)', () => {
      const stack1 = `render@http://localhost:3001/src/components/App.tsx:10:5`;
      const stack2 = `render@http://localhost:3001/src/components/Dashboard.tsx:20:5`;
      const fp1 = computeFingerprint(makeConsoleEvent({ message: 'fail', stack: stack1 }));
      const fp2 = computeFingerprint(makeConsoleEvent({ message: 'fail', stack: stack2 }));
      expect(fp1).not.toBe(fp2);
    });
  });

  // =========================================================================
  // extractSourceLocation
  // =========================================================================

  describe('extractSourceLocation', () => {
    it('should return undefined for undefined input', () => {
      expect(extractSourceLocation(undefined)).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      expect(extractSourceLocation('')).toBeUndefined();
    });

    it('should return undefined for a stack with no parseable frames', () => {
      expect(extractSourceLocation('Error: something\n  no frames here')).toBeUndefined();
    });

    describe('V8 format', () => {
      it('should parse V8 frames and return the first app-level frame', () => {
        const result = extractSourceLocation(V8_STACK);
        expect(result).toBeDefined();
        expect(result).toContain('Button.tsx');
        expect(result).toContain(':42');
      });

      it('should parse V8 frames without function name', () => {
        const stack = `Error: test\n    at http://localhost:3001/src/utils/helper.ts:15:10`;
        const result = extractSourceLocation(stack);
        expect(result).toBeDefined();
        expect(result).toContain('helper.ts');
        expect(result).toContain(':15');
      });
    });

    describe('SpiderMonkey format', () => {
      it('should parse SpiderMonkey (Firefox) frames', () => {
        const result = extractSourceLocation(SM_STACK_APP_FIRST);
        expect(result).toBeDefined();
        expect(result).toContain('Button.tsx');
        expect(result).toContain(':42');
      });

      it('should extract filename without protocol or host', () => {
        const result = extractSourceLocation(SM_STACK_APP_FIRST);
        expect(result).toBeDefined();
        expect(result).not.toContain('http://');
        expect(result).not.toContain('localhost');
      });
    });

    describe('JSC bare format', () => {
      it('should parse bare file:line:col frames', () => {
        const result = extractSourceLocation(JSC_BARE_STACK);
        expect(result).toBeDefined();
        // First frame is react-dom (node_modules), should skip to the app frame
        expect(result).toContain('Dashboard.tsx');
        expect(result).toContain(':88');
      });
    });

    describe('frame skipping', () => {
      it('should skip node_modules frames (SpiderMonkey)', () => {
        const stack = `badCall@http://localhost:3001/node_modules/some-lib/index.js:10:5
goodCall@http://localhost:3001/src/components/App.tsx:25:8`;
        const result = extractSourceLocation(stack);
        expect(result).toBeDefined();
        expect(result).toContain('App.tsx');
        expect(result).toContain(':25');
      });

      it('should skip react-dom frames (SpiderMonkey)', () => {
        const stack = `dispatch@http://localhost:3001/node_modules/react-dom/cjs/react-dom.development.js:100:5
handleClick@http://localhost:3001/src/components/Button.tsx:42:15`;
        const result = extractSourceLocation(stack);
        expect(result).toBeDefined();
        expect(result).toContain('Button.tsx');
        expect(result).toContain(':42');
      });

      it('should skip webpack-internal frames (SpiderMonkey)', () => {
        const stack = `evaluate@webpack-internal:///./src/index.ts:10:5
render@http://localhost:3001/src/App.tsx:30:12`;
        const result = extractSourceLocation(stack);
        expect(result).toBeDefined();
        expect(result).toContain('App.tsx');
        expect(result).toContain(':30');
      });

      it('should skip chrome-extension frames (SpiderMonkey)', () => {
        const stack = `inject@chrome-extension://abcdefg/content.js:5:10
myFunc@http://localhost:3001/src/utils/api.ts:99:3`;
        const result = extractSourceLocation(stack);
        expect(result).toBeDefined();
        expect(result).toContain('api.ts');
        expect(result).toContain(':99');
      });

      it('should skip moz-extension frames (SpiderMonkey)', () => {
        const stack = `inject@moz-extension://abcdefg/content.js:5:10
myFunc@http://localhost:3001/src/utils/api.ts:77:8`;
        const result = extractSourceLocation(stack);
        expect(result).toBeDefined();
        expect(result).toContain('api.ts');
        expect(result).toContain(':77');
      });

      it('should return first app frame, not the first frame overall', () => {
        const result = extractSourceLocation(SM_STACK_APP_FIRST);
        // handleClick is the first app frame; dispatch is node_modules
        expect(result).toBeDefined();
        expect(result).toContain('Button.tsx');
      });

      it('should fall back to first parseable frame when all frames are internals', () => {
        const result = extractSourceLocation(SM_STACK_ALL_INTERNALS);
        // Both frames are node_modules, so fallback gives first parseable
        expect(result).toBeDefined();
        expect(result).toContain('react-dom');
      });

      it('should skip react.development frames (JSC bare)', () => {
        const stack = `http://localhost:3001/node_modules/react.development.js:200:10
http://localhost:3001/src/App.tsx:55:3`;
        const result = extractSourceLocation(stack);
        expect(result).toBeDefined();
        expect(result).toContain('App.tsx');
        expect(result).toContain(':55');
      });

      it('should skip scheduler frames (JSC bare)', () => {
        const stack = `http://localhost:3001/node_modules/scheduler.production.min.js:14:100
http://localhost:3001/src/App.tsx:55:3`;
        const result = extractSourceLocation(stack);
        expect(result).toBeDefined();
        expect(result).toContain('App.tsx');
      });
    });

    describe('filename extraction', () => {
      it('should strip protocol and host from source URLs', () => {
        const stack = `fn@http://localhost:3001/src/utils/api.ts:10:5`;
        const result = extractSourceLocation(stack);
        expect(result).toBeDefined();
        expect(result).not.toContain('http://');
        expect(result).not.toContain('localhost');
      });

      it('should strip query params from source URLs', () => {
        const stack = `fn@http://localhost:3001/src/utils/api.ts?v=123:10:5`;
        const result = extractSourceLocation(stack);
        expect(result).toBeDefined();
        expect(result).not.toContain('?v=');
      });

      it('should keep up to 3 meaningful path segments for long paths', () => {
        const stack = `fn@http://localhost:3001/src/deeply/nested/components/Widget.tsx:10:5`;
        const result = extractSourceLocation(stack);
        expect(result).toBeDefined();
        // extractFilename: parts=["src","deeply","nested","components","Widget.tsx"], length>3 => slice(-3)
        expect(result).toBe('nested/components/Widget.tsx:10');
      });

      it('should keep short paths unchanged', () => {
        const stack = `fn@http://localhost:3001/src/App.tsx:5:1`;
        const result = extractSourceLocation(stack);
        expect(result).toBeDefined();
        expect(result).toBe('src/App.tsx:5');
      });

      it('should strip _next/static chunk hashes', () => {
        const stack = `fn@http://localhost:3001/_next/static/abc123/pages/index.js:10:5`;
        const result = extractSourceLocation(stack);
        expect(result).toBeDefined();
        expect(result).not.toContain('_next/static/abc123');
        expect(result).toContain('index.js');
      });
    });
  });

  // =========================================================================
  // deduplicateEvents
  // =========================================================================

  describe('deduplicateEvents', () => {
    it('should return an empty array for empty input', () => {
      expect(deduplicateEvents([])).toEqual([]);
    });

    it('should return a single group for a single event', () => {
      const event = makeConsoleEvent({ timestamp: 5000 });
      const result = deduplicateEvents([event]);
      expect(result).toHaveLength(1);
      expect(result[0].event).toBe(event);
      expect(result[0].count).toBe(1);
      expect(result[0].firstSeen).toBe(5000);
      expect(result[0].lastSeen).toBe(5000);
    });

    it('should group identical events and count correctly', () => {
      const events: AnyCapturedEvent[] = [
        makeConsoleEvent({ timestamp: 1000, message: 'Error A' }),
        makeConsoleEvent({ timestamp: 1001, message: 'Error A' }),
        makeConsoleEvent({ timestamp: 1002, message: 'Error A' }),
      ];
      const result = deduplicateEvents(events);
      expect(result).toHaveLength(1);
      expect(result[0].count).toBe(3);
      expect(result[0].firstSeen).toBe(1000);
      expect(result[0].lastSeen).toBe(1002);
    });

    it('should preserve the first occurrence as the representative event', () => {
      const first = makeConsoleEvent({ timestamp: 1000, message: 'Error X' });
      const second = makeConsoleEvent({ timestamp: 2000, message: 'Error X' });
      const result = deduplicateEvents([first, second]);
      expect(result).toHaveLength(1);
      expect(result[0].event).toBe(first);
    });

    it('should keep different errors as separate groups', () => {
      const events: AnyCapturedEvent[] = [
        makeConsoleEvent({ timestamp: 1000, message: 'Error A' }),
        makeConsoleEvent({ timestamp: 1001, message: 'Error B' }),
      ];
      const result = deduplicateEvents(events);
      expect(result).toHaveLength(2);
      expect(result[0].event.type).toBe('console');
      expect(result[1].event.type).toBe('console');
    });

    it('should preserve insertion order (order of first occurrence)', () => {
      const events: AnyCapturedEvent[] = [
        makeConsoleEvent({ timestamp: 1000, message: 'First' }),
        makeNetworkEvent({ timestamp: 1001 }),
        makeConsoleEvent({ timestamp: 1002, message: 'First' }), // duplicate of first
        makeReactErrorEvent({ timestamp: 1003 }),
        makeNetworkEvent({ timestamp: 1004 }), // duplicate of second
      ];
      const result = deduplicateEvents(events);
      expect(result).toHaveLength(3);
      // Order should be: console "First", network, react-error
      expect(result[0].event.type).toBe('console');
      expect(result[0].count).toBe(2);
      expect(result[1].event.type).toBe('network');
      expect(result[1].count).toBe(2);
      expect(result[2].event.type).toBe('react-error');
      expect(result[2].count).toBe(1);
    });

    it('should set fingerprint on each group', () => {
      const events: AnyCapturedEvent[] = [
        makeConsoleEvent({ timestamp: 1000 }),
        makeNetworkEvent({ timestamp: 1001 }),
      ];
      const result = deduplicateEvents(events);
      expect(result[0].fingerprint).toBeTruthy();
      expect(result[1].fingerprint).toBeTruthy();
      expect(result[0].fingerprint).not.toBe(result[1].fingerprint);
    });

    it('should set sourceLocation when event has a parseable stack trace', () => {
      const events: AnyCapturedEvent[] = [
        makeConsoleEvent({
          timestamp: 1000,
          message: 'Error',
          stack: SM_STACK_APP_FIRST,
        }),
      ];
      const result = deduplicateEvents(events);
      expect(result[0].sourceLocation).toBeDefined();
      expect(result[0].sourceLocation).toContain('Button.tsx');
    });

    it('should set sourceLocation to undefined when event has no stack', () => {
      const events: AnyCapturedEvent[] = [makeNetworkEvent({ timestamp: 1000 })];
      const result = deduplicateEvents(events);
      expect(result[0].sourceLocation).toBeUndefined();
    });

    it('should set sourceLocation to undefined for event types without stack field', () => {
      const events: AnyCapturedEvent[] = [makeMemoryEvent({ timestamp: 1000 })];
      const result = deduplicateEvents(events);
      expect(result[0].sourceLocation).toBeUndefined();
    });

    it('should group events with different dynamic values but same logical error', () => {
      const events: AnyCapturedEvent[] = [
        makeConsoleEvent({
          timestamp: 1000,
          message: 'Task 550e8400-e29b-41d4-a716-446655440000 failed',
        }),
        makeConsoleEvent({
          timestamp: 2000,
          message: 'Task a1234567-b89c-def0-1234-567890abcdef failed',
        }),
        makeConsoleEvent({
          timestamp: 3000,
          message: 'Task bbbbbbbb-cccc-dddd-eeee-ffffffffffff failed',
        }),
      ];
      const result = deduplicateEvents(events);
      expect(result).toHaveLength(1);
      expect(result[0].count).toBe(3);
      expect(result[0].firstSeen).toBe(1000);
      expect(result[0].lastSeen).toBe(3000);
    });

    it('should handle a mix of all event types', () => {
      const events: AnyCapturedEvent[] = [
        makeConsoleEvent({ timestamp: 1 }),
        makeNetworkEvent({ timestamp: 2 }),
        makeReactErrorEvent({ timestamp: 3 }),
        makeResourceErrorEvent({ timestamp: 4 }),
        makeHmrEvent({ timestamp: 5 }),
        makeWsDisconnectionEvent({ timestamp: 6 }),
        makeNavigationEvent({ timestamp: 7 }),
        makeLongTaskEvent({ timestamp: 8 }),
        makeLoafEvent({ timestamp: 9 }),
        makeWebVitalEvent({ timestamp: 10 }),
        makeMemoryEvent({ timestamp: 11 }),
      ];
      const result = deduplicateEvents(events);
      expect(result).toHaveLength(11);
      for (const group of result) {
        expect(group.count).toBe(1);
      }
    });

    it('should track firstSeen and lastSeen across duplicates', () => {
      const events: AnyCapturedEvent[] = [
        makeMemoryEvent({ timestamp: 100 }),
        makeMemoryEvent({ timestamp: 200 }),
        makeMemoryEvent({ timestamp: 300 }),
      ];
      const result = deduplicateEvents(events);
      expect(result).toHaveLength(1);
      expect(result[0].firstSeen).toBe(100);
      expect(result[0].lastSeen).toBe(300);
      expect(result[0].count).toBe(3);
    });

    it('should interleave groups correctly when duplicates are non-contiguous', () => {
      const events: AnyCapturedEvent[] = [
        makeConsoleEvent({ timestamp: 1, message: 'Alpha' }),
        makeConsoleEvent({ timestamp: 2, message: 'Beta' }),
        makeConsoleEvent({ timestamp: 3, message: 'Alpha' }),
        makeConsoleEvent({ timestamp: 4, message: 'Gamma' }),
        makeConsoleEvent({ timestamp: 5, message: 'Beta' }),
        makeConsoleEvent({ timestamp: 6, message: 'Alpha' }),
      ];
      const result = deduplicateEvents(events);
      expect(result).toHaveLength(3);
      // Insertion order: Alpha, Beta, Gamma
      expect((result[0].event as ConsoleCapturedEvent).message).toBe('Alpha');
      expect(result[0].count).toBe(3);
      expect(result[0].firstSeen).toBe(1);
      expect(result[0].lastSeen).toBe(6);

      expect((result[1].event as ConsoleCapturedEvent).message).toBe('Beta');
      expect(result[1].count).toBe(2);
      expect(result[1].firstSeen).toBe(2);
      expect(result[1].lastSeen).toBe(5);

      expect((result[2].event as ConsoleCapturedEvent).message).toBe('Gamma');
      expect(result[2].count).toBe(1);
    });
  });
});
