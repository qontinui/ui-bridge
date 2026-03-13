/**
 * Error Fingerprinting & Deduplication
 *
 * Groups identical or near-identical browser events by computing
 * a fingerprint from the error message + top stack frame.
 * 50 identical errors in a render loop become 1 error with count=50.
 */

import type { AnyCapturedEvent } from './browser-capture-types';
import { getEventStack } from './shared-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FingerprintedEvent {
  /** Stable fingerprint hash for grouping */
  fingerprint: string;
  /** The representative event (first occurrence) */
  event: AnyCapturedEvent;
  /** Number of occurrences */
  count: number;
  /** First seen timestamp */
  firstSeen: number;
  /** Last seen timestamp */
  lastSeen: number;
  /** Extracted source location (file:line) if available */
  sourceLocation?: string;
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

/** UUID v4 pattern (global + case-insensitive for replace-all) */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** UUID v4 pattern (non-global, safe for .test() calls) */
const UUID_TEST_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Hex addresses like 0x1a2b3c or standalone hex strings 8+ chars (global for replace-all) */
const HEX_RE = /\b0x[0-9a-f]+\b|\b[0-9a-f]{8,}\b/gi;

/** ISO timestamps: 2024-01-15T10:30:00.000Z and similar */
const TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.\d]*Z?/g;

/** Unix timestamps (10 or 13 digit numbers) */
const UNIX_TS_RE = /\b\d{10,13}\b/g;

/** Standalone numbers (object IDs, ports, counts, etc.) */
const NUMBER_RE = /\b\d+\b/g;

/**
 * Normalize a message string by replacing dynamic values with placeholders.
 * This ensures the same logical error always produces the same fingerprint
 * regardless of specific IDs, timestamps, or counts.
 */
function normalizeMessage(message: string): string {
  return message
    .replace(UUID_RE, '<uuid>')
    .replace(TIMESTAMP_RE, '<timestamp>')
    .replace(HEX_RE, '<hex>')
    .replace(UNIX_TS_RE, '<number>')
    .replace(NUMBER_RE, '<n>');
}

/**
 * Normalize a URL path by stripping query params and replacing
 * dynamic path segments (UUIDs, numeric IDs) with placeholders.
 */
function normalizeUrlPath(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').map((seg) => {
      if (UUID_TEST_RE.test(seg)) {
        return '<uuid>';
      }
      if (/^\d+$/.test(seg)) return '<id>';
      return seg;
    });
    return `${parsed.origin}${segments.join('/')}`;
  } catch {
    // Not a valid URL, normalize as a plain string
    return normalizeMessage(url);
  }
}

// ---------------------------------------------------------------------------
// Stack trace parsing
// ---------------------------------------------------------------------------

/** Patterns for frames we skip (framework internals, node_modules, etc.) */
const SKIP_FRAME_PATTERNS = [
  /node_modules/,
  /react-dom/,
  /react\.development/,
  /react\.production/,
  /scheduler\./,
  /webpack-internal/,
  /webpack:\/\//,
  /turbopack-internal/,
  /__webpack_/,
  /^native code$/,
  /^<anonymous>$/,
  /\(native\)/,
  /extensions::/,
  /chrome-extension:\/\//,
  /moz-extension:\/\//,
];

/**
 * V8 stack frame: "    at FunctionName (file:line:col)" or "    at file:line:col"
 */
const V8_FRAME_RE = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/;

/**
 * SpiderMonkey (Firefox): "functionName@file:line:col"
 */
const SPIDERMONKEY_FRAME_RE = /^(.+?)@(.+?):(\d+):(\d+)$/;

/**
 * JavaScriptCore (Safari): "functionName@file:line:col" (same format as SpiderMonkey)
 * or just "file:line:col"
 */
const JSC_BARE_RE = /^(.+?):(\d+):(\d+)$/;

interface ParsedFrame {
  functionName: string | undefined;
  file: string;
  line: string;
  col: string;
}

function parseFrame(line: string): ParsedFrame | null {
  const trimmed = line.trim();

  // V8 format
  const v8 = trimmed.match(V8_FRAME_RE);
  if (v8) {
    return { functionName: v8[1], file: v8[2], line: v8[3], col: v8[4] };
  }

  // SpiderMonkey / JSC format
  const sm = trimmed.match(SPIDERMONKEY_FRAME_RE);
  if (sm) {
    return { functionName: sm[1], file: sm[2], line: sm[3], col: sm[4] };
  }

  // Bare file:line:col
  const bare = trimmed.match(JSC_BARE_RE);
  if (bare) {
    return { functionName: undefined, file: bare[1], line: bare[2], col: bare[3] };
  }

  return null;
}

function isAppFrame(frame: ParsedFrame): boolean {
  return !SKIP_FRAME_PATTERNS.some((pat) => pat.test(frame.file));
}

/**
 * Extract the filename from a full path or URL.
 * Strips protocol, host, query params, and leading path noise.
 */
function extractFilename(file: string): string {
  // Remove query params and hash
  let clean = file.split('?')[0].split('#')[0];

  // Remove protocol + host
  clean = clean.replace(/^https?:\/\/[^/]+/, '');

  // Remove common prefixes
  clean = clean.replace(/^\/_next\/static\/[^/]+\//, '');

  // Keep the last meaningful path segments (up to 2 directories + filename)
  const parts = clean.split('/').filter(Boolean);
  if (parts.length > 3) {
    return parts.slice(-3).join('/');
  }
  return parts.join('/') || clean;
}

/**
 * Extract source location (file:line) from a stack trace string.
 * Works with V8 (Chrome), SpiderMonkey (Firefox), and JavaScriptCore (Safari) stack formats.
 * Returns the first app-level frame, skipping node_modules and framework internals.
 */
export function extractSourceLocation(stack?: string): string | undefined {
  if (!stack) return undefined;

  const lines = stack.split('\n');

  for (const line of lines) {
    const frame = parseFrame(line);
    if (frame && isAppFrame(frame)) {
      const filename = extractFilename(frame.file);
      return `${filename}:${frame.line}`;
    }
  }

  // Fallback: return the first parseable frame even if it's not "app-level"
  for (const line of lines) {
    const frame = parseFrame(line);
    if (frame) {
      const filename = extractFilename(frame.file);
      return `${filename}:${frame.line}`;
    }
  }

  return undefined;
}

/**
 * Extract the top stack frame location for fingerprinting purposes.
 * Returns a normalized "file:line" string or empty string if unavailable.
 */
function topFrameForFingerprint(stack?: string): string {
  return extractSourceLocation(stack) ?? '';
}

// ---------------------------------------------------------------------------
// Fingerprint computation
// ---------------------------------------------------------------------------

/**
 * Compute a fingerprint for a console event.
 */
function fingerprintConsole(event: AnyCapturedEvent & { type: 'console' }): string {
  const normalized = normalizeMessage(event.message);
  const frame = topFrameForFingerprint(event.stack);
  return `console:${event.level}|${normalized}|${frame}`;
}

/**
 * Compute a fingerprint for a network event.
 */
function fingerprintNetwork(event: AnyCapturedEvent & { type: 'network' }): string {
  const path = normalizeUrlPath(event.requestUrl);
  return `network:${event.method}|${path}|${event.status ?? event.kind}`;
}

/**
 * Compute a fingerprint for a React error boundary event.
 */
function fingerprintReactError(event: AnyCapturedEvent & { type: 'react-error' }): string {
  const normalized = normalizeMessage(event.message);
  const frame = topFrameForFingerprint(event.stack);
  return `react-error|${normalized}|${frame}`;
}

/**
 * Compute a fingerprint for a resource error event.
 */
function fingerprintResourceError(event: AnyCapturedEvent & { type: 'resource-error' }): string {
  const path = normalizeUrlPath(event.resourceUrl);
  return `resource-error:${event.tagName}|${path}`;
}

/**
 * Compute a fingerprint for an HMR event.
 */
function fingerprintHmr(event: AnyCapturedEvent & { type: 'hmr' }): string {
  const normalized = normalizeMessage(event.message);
  return `hmr:${event.level}|${normalized}|${event.moduleName ?? ''}`;
}

/**
 * Compute a fingerprint for a WebSocket disconnection event.
 */
function fingerprintWsDisconnection(
  event: AnyCapturedEvent & { type: 'ws-disconnection' }
): string {
  return `ws-disconnection:${event.previousState}->${event.newState}`;
}

/**
 * Compute a fingerprint for an event.
 * Normalizes dynamic values (timestamps, UUIDs, hex addresses, object IDs)
 * so that the same logical error always gets the same fingerprint.
 */
export function computeFingerprint(event: AnyCapturedEvent): string {
  switch (event.type) {
    case 'console':
      return fingerprintConsole(event);
    case 'network':
      return fingerprintNetwork(event);
    case 'react-error':
      return fingerprintReactError(event);
    case 'resource-error':
      return fingerprintResourceError(event);
    case 'hmr':
      return fingerprintHmr(event);
    case 'ws-disconnection':
      return fingerprintWsDisconnection(event);
    case 'navigation':
      return `navigation:${event.trigger}|${normalizeUrlPath(event.to)}`;
    case 'long-task':
      return `long-task:${Math.round(event.durationMs / 50) * 50}ms`;
    case 'long-animation-frame': {
      const scripts = event.scripts
        .map((s) => `${s.invoker}@${extractFilename(s.sourceURL)}`)
        .join(',');
      return `loaf:${Math.round(event.durationMs / 50) * 50}ms|${scripts}`;
    }
    case 'web-vital':
      return `web-vital:${event.metric}`;
    case 'memory':
      return `memory:snapshot`;
    case 'freeze':
      return `freeze:${Math.round(event.gapMs / 500) * 500}ms`;
    case 'dom-metrics':
      return `dom-metrics:${Math.round(event.nodeCount / 1000) * 1000}`;
    default: {
      // Exhaustive check: ensures all BrowserEventType variants are handled
      const _exhaustive: never = event;
      return `unknown:${(_exhaustive as AnyCapturedEvent).type}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * Deduplicate a list of events into fingerprinted groups.
 * Events with the same fingerprint are merged: the first occurrence is kept
 * as the representative event, and the count reflects total occurrences.
 *
 * Results are ordered by first occurrence (preserving input order).
 */
export function deduplicateEvents(events: AnyCapturedEvent[]): FingerprintedEvent[] {
  const groups = new Map<string, FingerprintedEvent>();
  const insertionOrder: string[] = [];

  for (const event of events) {
    const fingerprint = computeFingerprint(event);

    const existing = groups.get(fingerprint);
    if (existing) {
      existing.count += 1;
      existing.lastSeen = event.timestamp;
    } else {
      const sourceLocation = extractSourceLocation(getEventStack(event));
      groups.set(fingerprint, {
        fingerprint,
        event,
        count: 1,
        firstSeen: event.timestamp,
        lastSeen: event.timestamp,
        sourceLocation,
      });
      insertionOrder.push(fingerprint);
    }
  }

  // Return in insertion order (order of first occurrence)
  return insertionOrder.map((fp) => groups.get(fp)!);
}
