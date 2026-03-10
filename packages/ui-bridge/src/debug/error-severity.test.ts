/**
 * Error Severity Classification Tests
 */

import { describe, it, expect } from 'vitest';
import {
  classifyEvent,
  classifyEvents,
  filterBySeverity,
  SEVERITY_RANK,
  DEFAULT_NOISE_PATTERNS,
} from './error-severity';
import type {
  ConsoleCapturedEvent,
  NetworkCapturedEvent,
  ReactErrorCapturedEvent,
  ResourceErrorCapturedEvent,
  HmrCapturedEvent,
  WsDisconnectionCapturedEvent,
  LongTaskCapturedEvent,
  LoafCapturedEvent,
  NavigationCapturedEvent,
  WebVitalCapturedEvent,
  MemoryCapturedEvent,
  AnyCapturedEvent,
} from './browser-capture-types';

// ---------------------------------------------------------------------------
// Mock event builders
// ---------------------------------------------------------------------------

const BASE = { timestamp: Date.now(), url: 'http://localhost:3001/app' } as const;

function makeConsoleEvent(
  level: ConsoleCapturedEvent['level'],
  message: string,
  stack?: string
): ConsoleCapturedEvent {
  return { ...BASE, type: 'console', level, message, stack };
}

function makeNetworkEvent(
  kind: NetworkCapturedEvent['kind'],
  requestUrl: string,
  opts: { status?: number; statusText?: string; method?: string; durationMs?: number } = {}
): NetworkCapturedEvent {
  return {
    ...BASE,
    type: 'network',
    method: opts.method ?? 'GET',
    requestUrl,
    status: opts.status,
    statusText: opts.statusText,
    durationMs: opts.durationMs ?? 100,
    kind,
  };
}

function makeReactErrorEvent(message: string): ReactErrorCapturedEvent {
  return { ...BASE, type: 'react-error', message };
}

function makeResourceErrorEvent(tagName: string, resourceUrl: string): ResourceErrorCapturedEvent {
  return { ...BASE, type: 'resource-error', tagName, resourceUrl };
}

function makeHmrEvent(level: HmrCapturedEvent['level'], message: string): HmrCapturedEvent {
  return { ...BASE, type: 'hmr', level, message };
}

function makeWsDisconnectionEvent(reconnectAttempt?: number): WsDisconnectionCapturedEvent {
  return {
    ...BASE,
    type: 'ws-disconnection',
    previousState: 'open',
    newState: 'closed',
    reconnectAttempt,
  };
}

function makeLongTaskEvent(durationMs: number): LongTaskCapturedEvent {
  return { ...BASE, type: 'long-task', durationMs };
}

function makeLoafEvent(durationMs: number, blockingDurationMs: number): LoafCapturedEvent {
  return { ...BASE, type: 'long-animation-frame', durationMs, blockingDurationMs, scripts: [] };
}

function makeNavigationEvent(): NavigationCapturedEvent {
  return { ...BASE, type: 'navigation', from: '/a', to: '/b', trigger: 'pushState' };
}

function makeWebVitalEvent(): WebVitalCapturedEvent {
  return { ...BASE, type: 'web-vital', metric: 'LCP', value: 1200 };
}

function makeMemoryEvent(): MemoryCapturedEvent {
  return {
    ...BASE,
    type: 'memory',
    usedJSHeapSize: 50_000_000,
    totalJSHeapSize: 100_000_000,
    jsHeapSizeLimit: 2_000_000_000,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SEVERITY_RANK', () => {
  it('has correct numeric ordering', () => {
    expect(SEVERITY_RANK.crash).toBe(0);
    expect(SEVERITY_RANK.error).toBe(1);
    expect(SEVERITY_RANK.warning).toBe(2);
    expect(SEVERITY_RANK.noise).toBe(3);
  });

  it('crash is most severe (lowest rank number)', () => {
    expect(SEVERITY_RANK.crash).toBeLessThan(SEVERITY_RANK.error);
    expect(SEVERITY_RANK.error).toBeLessThan(SEVERITY_RANK.warning);
    expect(SEVERITY_RANK.warning).toBeLessThan(SEVERITY_RANK.noise);
  });
});

describe('classifyEvent', () => {
  // -----------------------------------------------------------------------
  // Console events
  // -----------------------------------------------------------------------
  describe('console events', () => {
    it('classifies unhandledrejection as crash', () => {
      const result = classifyEvent(
        makeConsoleEvent('unhandledrejection', 'Uncaught TypeError: x is not a function')
      );
      expect(result.severity).toBe('crash');
      expect(result.reason).toContain('unhandled promise rejection');
    });

    it('classifies console.error as error', () => {
      const result = classifyEvent(makeConsoleEvent('error', 'Something went wrong'));
      expect(result.severity).toBe('error');
      expect(result.reason).toContain('console.error');
    });

    it('classifies console.warn as warning', () => {
      const result = classifyEvent(makeConsoleEvent('warn', 'Deprecated API usage'));
      expect(result.severity).toBe('warning');
      expect(result.reason).toContain('console.warn');
    });

    describe('noise pattern matching', () => {
      it('classifies React dev warnings as noise', () => {
        const result = classifyEvent(
          makeConsoleEvent('warn', 'Warning: Each child in a list should have a unique "key" prop')
        );
        expect(result.severity).toBe('noise');
        expect(result.reason).toContain('noise pattern');
      });

      it('classifies unmounted component warnings as noise', () => {
        const result = classifyEvent(
          makeConsoleEvent(
            'warn',
            "Warning: Can't perform a React state update on an unmounted component"
          )
        );
        expect(result.severity).toBe('noise');
      });

      it('classifies componentWillMount renamed warning as noise', () => {
        const result = classifyEvent(
          makeConsoleEvent(
            'warn',
            'Warning: componentWillMount has been renamed, and is not recommended'
          )
        );
        expect(result.severity).toBe('noise');
      });

      it('classifies ResizeObserver loop as noise', () => {
        const result = classifyEvent(
          makeConsoleEvent('error', 'ResizeObserver loop completed with undelivered notifications')
        );
        expect(result.severity).toBe('noise');
      });

      it('classifies HMR connected message as noise', () => {
        const result = classifyEvent(makeConsoleEvent('warn', '[vite] connected.'));
        expect(result.severity).toBe('noise');
      });

      it('classifies browser extension errors as noise', () => {
        const result = classifyEvent(
          makeConsoleEvent('error', 'Error from chrome-extension://abcdef/background.js')
        );
        expect(result.severity).toBe('noise');
      });

      it('classifies source map warnings as noise', () => {
        const result = classifyEvent(
          makeConsoleEvent('warn', 'DevTools failed to load source map for something.js.map')
        );
        expect(result.severity).toBe('noise');
      });

      it('classifies Fast Refresh messages as noise', () => {
        const result = classifyEvent(
          makeConsoleEvent('warn', 'Fast Refresh - Full reload required')
        );
        expect(result.severity).toBe('noise');
      });

      it('classifies findDOMNode deprecated warning as noise', () => {
        const result = classifyEvent(
          makeConsoleEvent('warn', 'Warning: findDOMNode is deprecated in StrictMode')
        );
        expect(result.severity).toBe('noise');
      });

      it('demotes unhandledrejection to noise if it matches a noise pattern', () => {
        // Even crashes get demoted if the message is a known noise pattern
        const result = classifyEvent(
          makeConsoleEvent(
            'unhandledrejection',
            'ResizeObserver loop completed with undelivered notifications'
          )
        );
        expect(result.severity).toBe('noise');
      });

      it('demotes console.error to noise if it matches a noise pattern', () => {
        const result = classifyEvent(
          makeConsoleEvent(
            'error',
            'Download the React DevTools for a better development experience'
          )
        );
        expect(result.severity).toBe('noise');
      });
    });
  });

  // -----------------------------------------------------------------------
  // Network events
  // -----------------------------------------------------------------------
  describe('network events', () => {
    it('classifies network-error as error', () => {
      const result = classifyEvent(
        makeNetworkEvent('network-error', 'https://api.example.com/data')
      );
      expect(result.severity).toBe('error');
      expect(result.reason).toBe('network-error');
    });

    it('classifies timeout as error', () => {
      const result = classifyEvent(
        makeNetworkEvent('timeout', 'https://api.example.com/data', { durationMs: 30000 })
      );
      expect(result.severity).toBe('error');
      expect(result.reason).toBe('timeout');
    });

    it('classifies CORS error as error', () => {
      const result = classifyEvent(makeNetworkEvent('cors', 'https://api.example.com/data'));
      expect(result.severity).toBe('error');
      expect(result.reason).toBe('CORS error');
    });

    it('classifies 5xx as error', () => {
      const result = classifyEvent(
        makeNetworkEvent('http-error', 'https://api.example.com/data', { status: 500 })
      );
      expect(result.severity).toBe('error');
      expect(result.reason).toBe('HTTP 500');
    });

    it('classifies 502 as error', () => {
      const result = classifyEvent(
        makeNetworkEvent('http-error', 'https://api.example.com/data', { status: 502 })
      );
      expect(result.severity).toBe('error');
      expect(result.reason).toBe('HTTP 502');
    });

    it('classifies 503 as error', () => {
      const result = classifyEvent(
        makeNetworkEvent('http-error', 'https://api.example.com/data', { status: 503 })
      );
      expect(result.severity).toBe('error');
    });

    it('classifies 5xx on critical endpoint as crash', () => {
      const result = classifyEvent(
        makeNetworkEvent('http-error', 'https://app.com/api/v1/auth/login', { status: 500 })
      );
      expect(result.severity).toBe('crash');
      expect(result.reason).toContain('critical endpoint');
    });

    it('classifies 5xx on /api/v1/organizations/ as crash', () => {
      const result = classifyEvent(
        makeNetworkEvent('http-error', 'https://app.com/api/v1/organizations/123', { status: 503 })
      );
      expect(result.severity).toBe('crash');
    });

    it('classifies 5xx on /_next/data/ as crash', () => {
      const result = classifyEvent(
        makeNetworkEvent('http-error', 'https://app.com/_next/data/abc.json', { status: 500 })
      );
      expect(result.severity).toBe('crash');
    });

    it('classifies 5xx on /graphql as crash', () => {
      const result = classifyEvent(
        makeNetworkEvent('http-error', 'https://app.com/graphql', { status: 500 })
      );
      expect(result.severity).toBe('crash');
    });

    it('classifies network-error on critical endpoint as crash', () => {
      const result = classifyEvent(
        makeNetworkEvent('network-error', 'https://app.com/api/v1/auth/me')
      );
      expect(result.severity).toBe('crash');
      expect(result.reason).toContain('critical endpoint');
    });

    it('classifies timeout on critical endpoint as crash', () => {
      const result = classifyEvent(
        makeNetworkEvent('timeout', 'https://app.com/api/v1/organizations/1')
      );
      expect(result.severity).toBe('crash');
    });

    it('classifies 4xx as warning', () => {
      const result = classifyEvent(
        makeNetworkEvent('http-error', 'https://api.example.com/data', { status: 400 })
      );
      expect(result.severity).toBe('warning');
      expect(result.reason).toBe('HTTP 400');
    });

    it('classifies 401 as warning', () => {
      const result = classifyEvent(
        makeNetworkEvent('http-error', 'https://api.example.com/data', { status: 401 })
      );
      expect(result.severity).toBe('warning');
    });

    it('classifies 404 as warning', () => {
      const result = classifyEvent(
        makeNetworkEvent('http-error', 'https://api.example.com/data', { status: 404 })
      );
      expect(result.severity).toBe('warning');
      expect(result.reason).toBe('HTTP 404');
    });

    it('classifies 422 as warning', () => {
      const result = classifyEvent(
        makeNetworkEvent('http-error', 'https://api.example.com/data', { status: 422 })
      );
      expect(result.severity).toBe('warning');
    });

    it('classifies abort as noise', () => {
      const result = classifyEvent(
        makeNetworkEvent('abort', 'https://api.example.com/search?q=test')
      );
      expect(result.severity).toBe('noise');
      expect(result.reason).toContain('aborted');
    });

    it('classifies common asset 404 as noise (favicon)', () => {
      const result = classifyEvent(
        makeNetworkEvent('http-error', 'https://app.com/favicon.ico', { status: 404 })
      );
      expect(result.severity).toBe('noise');
      expect(result.reason).toContain('common asset');
    });

    it('classifies common asset 404 as noise (manifest.json)', () => {
      const result = classifyEvent(
        makeNetworkEvent('http-error', 'https://app.com/manifest.json', { status: 404 })
      );
      expect(result.severity).toBe('noise');
    });

    it('classifies common asset 404 as noise (robots.txt)', () => {
      const result = classifyEvent(
        makeNetworkEvent('http-error', 'https://app.com/robots.txt', { status: 404 })
      );
      expect(result.severity).toBe('noise');
    });

    it('classifies common asset 404 as noise (source map)', () => {
      const result = classifyEvent(
        makeNetworkEvent('http-error', 'https://app.com/bundle.js.map', { status: 404 })
      );
      expect(result.severity).toBe('noise');
    });

    it('classifies common asset 404 as noise (apple-touch-icon)', () => {
      const result = classifyEvent(
        makeNetworkEvent('http-error', 'https://app.com/apple-touch-icon.png', { status: 404 })
      );
      expect(result.severity).toBe('noise');
    });

    it('classifies common asset 404 as noise (sitemap)', () => {
      const result = classifyEvent(
        makeNetworkEvent('http-error', 'https://app.com/sitemap.xml', { status: 404 })
      );
      expect(result.severity).toBe('noise');
    });

    it('does NOT classify non-asset 404 as noise', () => {
      const result = classifyEvent(
        makeNetworkEvent('http-error', 'https://api.example.com/users/123', { status: 404 })
      );
      expect(result.severity).toBe('warning');
    });

    it('classifies http-error without status as warning', () => {
      const result = classifyEvent(makeNetworkEvent('http-error', 'https://api.example.com/data'));
      expect(result.severity).toBe('warning');
      expect(result.reason).toBe('network issue');
    });
  });

  // -----------------------------------------------------------------------
  // React error events
  // -----------------------------------------------------------------------
  describe('react-error events', () => {
    it('classifies react-error as crash', () => {
      const result = classifyEvent(makeReactErrorEvent('Cannot read properties of undefined'));
      expect(result.severity).toBe('crash');
      expect(result.reason).toContain('React error boundary');
    });

    it('always returns crash regardless of message content', () => {
      const result = classifyEvent(makeReactErrorEvent('Minor rendering issue'));
      expect(result.severity).toBe('crash');
    });
  });

  // -----------------------------------------------------------------------
  // Resource error events
  // -----------------------------------------------------------------------
  describe('resource-error events', () => {
    it('classifies script load failure as error', () => {
      const result = classifyEvent(makeResourceErrorEvent('SCRIPT', 'https://app.com/bundle.js'));
      expect(result.severity).toBe('error');
      expect(result.reason).toContain('script load failed');
    });

    it('classifies script (lowercase) load failure as error', () => {
      const result = classifyEvent(makeResourceErrorEvent('script', 'https://app.com/bundle.js'));
      expect(result.severity).toBe('error');
    });

    it('classifies link (stylesheet) load failure as error', () => {
      const result = classifyEvent(makeResourceErrorEvent('LINK', 'https://app.com/styles.css'));
      expect(result.severity).toBe('error');
      expect(result.reason).toContain('stylesheet load failed');
    });

    it('classifies img load failure as warning', () => {
      const result = classifyEvent(makeResourceErrorEvent('IMG', 'https://app.com/photo.jpg'));
      expect(result.severity).toBe('warning');
      expect(result.reason).toContain('img load failed');
    });

    it('classifies video load failure as warning', () => {
      const result = classifyEvent(makeResourceErrorEvent('VIDEO', 'https://app.com/clip.mp4'));
      expect(result.severity).toBe('warning');
      expect(result.reason).toContain('video load failed');
    });

    it('classifies audio load failure as warning', () => {
      const result = classifyEvent(makeResourceErrorEvent('AUDIO', 'https://app.com/sound.mp3'));
      expect(result.severity).toBe('warning');
      expect(result.reason).toContain('audio load failed');
    });

    it('classifies source element load failure as warning', () => {
      const result = classifyEvent(makeResourceErrorEvent('SOURCE', 'https://app.com/media.webm'));
      expect(result.severity).toBe('warning');
      expect(result.reason).toContain('source load failed');
    });

    it('classifies unknown tag resource error as warning', () => {
      const result = classifyEvent(makeResourceErrorEvent('IFRAME', 'https://app.com/embed'));
      expect(result.severity).toBe('warning');
      expect(result.reason).toContain('iframe resource load failed');
    });
  });

  // -----------------------------------------------------------------------
  // HMR events
  // -----------------------------------------------------------------------
  describe('hmr events', () => {
    it('classifies HMR error as error', () => {
      const result = classifyEvent(makeHmrEvent('error', 'Syntax error in App.tsx'));
      expect(result.severity).toBe('error');
      expect(result.reason).toContain('HMR compilation error');
    });

    it('classifies HMR warning as warning', () => {
      const result = classifyEvent(makeHmrEvent('warning', 'Unused variable in utils.ts'));
      expect(result.severity).toBe('warning');
      expect(result.reason).toContain('HMR warning');
    });
  });

  // -----------------------------------------------------------------------
  // WebSocket disconnection events
  // -----------------------------------------------------------------------
  describe('ws-disconnection events', () => {
    it('classifies first disconnection (no reconnectAttempt) as warning', () => {
      const result = classifyEvent(makeWsDisconnectionEvent(undefined));
      expect(result.severity).toBe('warning');
      expect(result.reason).toContain('WebSocket disconnection');
    });

    it('classifies reconnectAttempt=0 as warning (first attempt)', () => {
      const result = classifyEvent(makeWsDisconnectionEvent(0));
      expect(result.severity).toBe('warning');
    });

    it('classifies reconnect attempt > 0 as noise', () => {
      const result = classifyEvent(makeWsDisconnectionEvent(1));
      expect(result.severity).toBe('noise');
      expect(result.reason).toContain('reconnect attempt 1');
    });

    it('classifies high reconnect attempt as noise', () => {
      const result = classifyEvent(makeWsDisconnectionEvent(5));
      expect(result.severity).toBe('noise');
      expect(result.reason).toContain('reconnect attempt 5');
    });
  });

  // -----------------------------------------------------------------------
  // Long task events
  // -----------------------------------------------------------------------
  describe('long-task events', () => {
    it('classifies <100ms as noise', () => {
      const result = classifyEvent(makeLongTaskEvent(50));
      expect(result.severity).toBe('noise');
      expect(result.reason).toContain('<100ms');
    });

    it('classifies exactly 100ms as noise (under threshold)', () => {
      const result = classifyEvent(makeLongTaskEvent(100));
      expect(result.severity).toBe('noise');
      expect(result.reason).toContain('under threshold');
    });

    it('classifies 250ms as noise (under 500ms threshold)', () => {
      const result = classifyEvent(makeLongTaskEvent(250));
      expect(result.severity).toBe('noise');
      expect(result.reason).toContain('under threshold');
    });

    it('classifies 499ms as noise', () => {
      const result = classifyEvent(makeLongTaskEvent(499));
      expect(result.severity).toBe('noise');
    });

    it('classifies >=500ms as warning', () => {
      const result = classifyEvent(makeLongTaskEvent(500));
      expect(result.severity).toBe('warning');
      expect(result.reason).toContain('500ms');
    });

    it('classifies 1000ms as warning', () => {
      const result = classifyEvent(makeLongTaskEvent(1000));
      expect(result.severity).toBe('warning');
      expect(result.reason).toContain('1000ms');
    });

    it('rounds duration in reason string', () => {
      const result = classifyEvent(makeLongTaskEvent(512.7));
      expect(result.reason).toContain('513ms');
    });
  });

  // -----------------------------------------------------------------------
  // Long animation frame events
  // -----------------------------------------------------------------------
  describe('long-animation-frame events', () => {
    it('classifies blockingDuration >= 200ms as warning', () => {
      const result = classifyEvent(makeLoafEvent(300, 200));
      expect(result.severity).toBe('warning');
      expect(result.reason).toContain('blocking 200ms');
    });

    it('classifies blockingDuration > 200ms as warning', () => {
      const result = classifyEvent(makeLoafEvent(500, 350));
      expect(result.severity).toBe('warning');
      expect(result.reason).toContain('blocking 350ms');
    });

    it('classifies blockingDuration < 200ms as noise', () => {
      const result = classifyEvent(makeLoafEvent(300, 100));
      expect(result.severity).toBe('noise');
      expect(result.reason).toContain('low blocking duration');
    });

    it('classifies blockingDuration = 0 as noise', () => {
      const result = classifyEvent(makeLoafEvent(100, 0));
      expect(result.severity).toBe('noise');
    });

    it('classifies blockingDuration = 199 as noise', () => {
      const result = classifyEvent(makeLoafEvent(300, 199));
      expect(result.severity).toBe('noise');
    });

    it('rounds blocking duration in reason string', () => {
      const result = classifyEvent(makeLoafEvent(400, 234.6));
      expect(result.reason).toContain('235ms');
    });
  });

  // -----------------------------------------------------------------------
  // Always-noise event types
  // -----------------------------------------------------------------------
  describe('always-noise event types', () => {
    it('classifies navigation as noise', () => {
      const result = classifyEvent(makeNavigationEvent());
      expect(result.severity).toBe('noise');
      expect(result.reason).toContain('navigation');
    });

    it('classifies web-vital as noise', () => {
      const result = classifyEvent(makeWebVitalEvent());
      expect(result.severity).toBe('noise');
      expect(result.reason).toContain('web vital');
    });

    it('classifies memory as noise', () => {
      const result = classifyEvent(makeMemoryEvent());
      expect(result.severity).toBe('noise');
      expect(result.reason).toContain('memory');
    });
  });
});

describe('classifyEvents', () => {
  it('returns an empty array for empty input', () => {
    expect(classifyEvents([])).toEqual([]);
  });

  it('returns classified events with correct structure', () => {
    const events: AnyCapturedEvent[] = [
      makeConsoleEvent('error', 'Something broke'),
      makeNavigationEvent(),
    ];
    const classified = classifyEvents(events);

    expect(classified).toHaveLength(2);

    expect(classified[0].event).toBe(events[0]);
    expect(classified[0].severity).toBe('error');
    expect(typeof classified[0].reason).toBe('string');

    expect(classified[1].event).toBe(events[1]);
    expect(classified[1].severity).toBe('noise');
    expect(typeof classified[1].reason).toBe('string');
  });

  it('classifies a mixed batch correctly', () => {
    const events: AnyCapturedEvent[] = [
      makeReactErrorEvent('Component crashed'),
      makeConsoleEvent('error', 'API call failed'),
      makeConsoleEvent('warn', 'Deprecation notice'),
      makeConsoleEvent('warn', 'Warning: Each child in a list should have a unique key'),
      makeNetworkEvent('abort', 'https://api.example.com/cancel'),
      makeNavigationEvent(),
    ];
    const classified = classifyEvents(events);

    expect(classified.map((c) => c.severity)).toEqual([
      'crash',
      'error',
      'warning',
      'noise',
      'noise',
      'noise',
    ]);
  });

  it('preserves original event references', () => {
    const events: AnyCapturedEvent[] = [makeConsoleEvent('error', 'Test error')];
    const classified = classifyEvents(events);
    expect(classified[0].event).toBe(events[0]);
  });
});

describe('filterBySeverity', () => {
  // Build a representative set of events at all severity levels
  const crashEvent = makeReactErrorEvent('Crash');
  const errorEvent = makeConsoleEvent('error', 'An error');
  const warningEvent = makeConsoleEvent('warn', 'A warning');
  const noiseEvent = makeNavigationEvent();

  const allEvents: AnyCapturedEvent[] = [crashEvent, errorEvent, warningEvent, noiseEvent];

  it('filters to only crashes when minSeverity is crash', () => {
    const result = filterBySeverity(allEvents, 'crash');
    expect(result).toEqual([crashEvent]);
  });

  it('filters to crash + error when minSeverity is error', () => {
    const result = filterBySeverity(allEvents, 'error');
    expect(result).toEqual([crashEvent, errorEvent]);
  });

  it('filters to crash + error + warning when minSeverity is warning', () => {
    const result = filterBySeverity(allEvents, 'warning');
    expect(result).toEqual([crashEvent, errorEvent, warningEvent]);
  });

  it('returns all events when minSeverity is noise', () => {
    const result = filterBySeverity(allEvents, 'noise');
    expect(result).toEqual(allEvents);
  });

  it('returns empty array when no events match', () => {
    const onlyNoise: AnyCapturedEvent[] = [noiseEvent, makeMemoryEvent()];
    const result = filterBySeverity(onlyNoise, 'crash');
    expect(result).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(filterBySeverity([], 'crash')).toEqual([]);
    expect(filterBySeverity([], 'noise')).toEqual([]);
  });

  it('preserves event order', () => {
    const events: AnyCapturedEvent[] = [
      makeConsoleEvent('warn', 'warn1'),
      makeConsoleEvent('error', 'err1'),
      makeConsoleEvent('warn', 'warn2'),
      makeReactErrorEvent('crash1'),
    ];
    const result = filterBySeverity(events, 'warning');
    expect(result).toHaveLength(4);
    expect((result[0] as ConsoleCapturedEvent).message).toBe('warn1');
    expect((result[1] as ConsoleCapturedEvent).message).toBe('err1');
    expect((result[2] as ConsoleCapturedEvent).message).toBe('warn2');
    expect((result[3] as ReactErrorCapturedEvent).message).toBe('crash1');
  });

  it('handles duplicates', () => {
    const event = makeConsoleEvent('error', 'duplicate');
    const result = filterBySeverity([event, event, event], 'error');
    expect(result).toHaveLength(3);
  });

  describe('real-world scenarios', () => {
    it('filters a realistic mixed event stream', () => {
      const events: AnyCapturedEvent[] = [
        makeConsoleEvent('error', 'ResizeObserver loop completed with undelivered notifications'), // noise
        makeNetworkEvent('http-error', 'https://app.com/favicon.ico', { status: 404 }), // noise
        makeNetworkEvent('abort', 'https://api.example.com/search'), // noise
        makeConsoleEvent('error', 'Failed to fetch user profile'), // error
        makeNetworkEvent('http-error', 'https://app.com/api/v1/auth/me', { status: 500 }), // crash
        makeConsoleEvent('warn', 'Deprecated API'), // warning
        makeLongTaskEvent(50), // noise
        makeLongTaskEvent(600), // warning
        makeWebVitalEvent(), // noise
        makeMemoryEvent(), // noise
      ];

      const crashOnly = filterBySeverity(events, 'crash');
      expect(crashOnly).toHaveLength(1);

      const errorsUp = filterBySeverity(events, 'error');
      expect(errorsUp).toHaveLength(2); // crash + error

      const warningsUp = filterBySeverity(events, 'warning');
      expect(warningsUp).toHaveLength(4); // crash + error + 2 warnings

      const everything = filterBySeverity(events, 'noise');
      expect(everything).toHaveLength(10);
    });
  });
});

describe('DEFAULT_NOISE_PATTERNS', () => {
  it('is a non-empty array of strings', () => {
    expect(Array.isArray(DEFAULT_NOISE_PATTERNS)).toBe(true);
    expect(DEFAULT_NOISE_PATTERNS.length).toBeGreaterThan(0);
    for (const pattern of DEFAULT_NOISE_PATTERNS) {
      expect(typeof pattern).toBe('string');
    }
  });

  it('includes React dev mode patterns', () => {
    expect(DEFAULT_NOISE_PATTERNS).toContain('Warning: Each child in a list should have a unique');
    expect(DEFAULT_NOISE_PATTERNS).toContain('Warning: findDOMNode is deprecated');
  });

  it('includes HMR patterns', () => {
    expect(DEFAULT_NOISE_PATTERNS).toContain('[HMR]');
    expect(DEFAULT_NOISE_PATTERNS).toContain('[vite] connected');
  });

  it('includes browser extension patterns', () => {
    expect(DEFAULT_NOISE_PATTERNS).toContain('chrome-extension://');
    expect(DEFAULT_NOISE_PATTERNS).toContain('moz-extension://');
    expect(DEFAULT_NOISE_PATTERNS).toContain('safari-extension://');
  });

  it('includes ResizeObserver patterns', () => {
    expect(DEFAULT_NOISE_PATTERNS).toContain('ResizeObserver loop');
  });
});
