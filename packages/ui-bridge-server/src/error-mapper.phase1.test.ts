/**
 * Phase 1 — Diagnostic discipline: APIResponse.code via error-mapper.
 *
 * Plan: 2026-05-18-ui-bridge-diagnostic-discipline-plan.md §8 (Phase 1).
 *
 * The `error()` / `wrapError()` helpers across `handlers.ts`,
 * `relay-handlers.ts` and the framework adapters now route their loose
 * legacy code string through `mapInternalErrorCode`, so `APIResponse.code`
 * is always a canonical `UiBridgeErrorCode` on `success: false`. This test
 * fires the mapper over every internal code string actually used in the
 * server handlers (the full set of `error(msg, 'X')` second arguments) and
 * asserts each result is a valid catalog code.
 */

import { describe, it, expect } from 'vitest';
import { toCanonicalErrorCode, mapThrownError } from './error-mapper';
import { UI_BRIDGE_ERROR_CODES } from '@qontinui/ui-bridge/diagnostics';

const VALID = new Set<string>(UI_BRIDGE_ERROR_CODES);

// Every loose internal code string passed as `error(msg, 'X')` / `code: 'X'`
// across handlers.ts + relay-handlers.ts + adapters (audited 2026-05-18).
const INTERNAL_CODES = [
  'NOT_FOUND',
  'NOT_IMPLEMENTED',
  'INVALID_REQUEST',
  'VALIDATION_ERROR',
  'RUNNER_REQUIRED',
  'RUNNER_UNAVAILABLE',
  'RUNNER_ERROR',
  'COMMAND_FAILED',
  'HEADLESS_SPAWN_UNSUPPORTED_ON_RELAY',
  'HEADLESS_SPAWN_DISABLED',
  'HEADLESS_PEER_MISSING',
  'HEADLESS_LAUNCH_FAILED',
  'CDP_DISABLED',
  'UNAUTHORIZED',
  'INTERNAL_ERROR',
  'RENDER_LOG_ERROR',
  'SNAPSHOT_ERROR',
  'ELEMENTS_ERROR',
  'ELEMENT_ERROR',
  'ELEMENT_STATE_ERROR',
  'COMPONENTS_ERROR',
  'COMPONENT_ERROR',
  'COMPONENT_STATE_ERROR',
  'COMPONENT_ACTION_ERROR',
  'FIND_ERROR',
  'DISCOVER_ERROR',
  'WORKFLOWS_ERROR',
  'WORKFLOW_ERROR',
  'WORKFLOW_STATUS_ERROR',
  'ACTION_HISTORY_ERROR',
  'METRICS_ERROR',
  'HIGHLIGHT_ERROR',
  'ELEMENT_TREE_ERROR',
  'AI_SEARCH_ERROR',
  'AI_FIND_ERROR',
  'AI_EXECUTE_ERROR',
  'AI_ASSERT_ERROR',
  'AI_ASSERT_BATCH_ERROR',
  'AI_SEMANTIC_SEARCH_ERROR',
  'SEMANTIC_SNAPSHOT_ERROR',
  'SEMANTIC_DIFF_ERROR',
  'PAGE_SUMMARY_ERROR',
  'PAGE_HEALTH_ERROR',
  'SCREEN_ANALYSIS_ERROR',
  'ELEMENT_HISTORY_ERROR',
  'QUERY_ERROR',
  'WAIT_ERROR',
];

describe('Phase 1 — APIResponse.code error-mapper', () => {
  it('every internal handler code maps to a valid canonical UiBridgeErrorCode', () => {
    for (const code of INTERNAL_CODES) {
      const mapped = toCanonicalErrorCode(code, 'some failure message');
      expect(VALID.has(mapped), `${code} -> ${mapped} must be a catalog code`).toBe(true);
      expect(mapped).toMatch(/^UB-/);
    }
  });

  it('canonical codes pass through unchanged (idempotent)', () => {
    for (const code of UI_BRIDGE_ERROR_CODES) {
      expect(toCanonicalErrorCode(code)).toBe(code);
    }
  });

  it('semantic mappings are correct for the load-bearing codes', () => {
    expect(toCanonicalErrorCode('NOT_FOUND')).toBe('UB-ELEM-NOT-FOUND');
    expect(toCanonicalErrorCode('VALIDATION_ERROR')).toBe('UB-VALIDATION-ERROR');
    expect(toCanonicalErrorCode('INVALID_REQUEST')).toBe('UB-VALIDATION-ERROR');
    expect(toCanonicalErrorCode('NOT_IMPLEMENTED')).toBe('UB-UNSUPPORTED-ACTION');
    expect(toCanonicalErrorCode('RUNNER_UNAVAILABLE')).toBe('UB-NET-ERROR');
  });

  it('falls back to message heuristic when no code given', () => {
    expect(toCanonicalErrorCode(undefined, 'Element not found: btn-1')).toBe(
      'UB-ELEM-NOT-FOUND'
    );
    expect(toCanonicalErrorCode(undefined, 'request timed out')).toBe(
      'UB-ACTION-TIMEOUT'
    );
    expect(toCanonicalErrorCode(undefined, 'totally opaque')).toBe('UB-UNKNOWN-ERROR');
  });

  it('mapThrownError uses the Error message', () => {
    expect(mapThrownError(new Error('element not found anywhere'))).toBe(
      'UB-ELEM-NOT-FOUND'
    );
    expect(mapThrownError('disconnected from network')).toBe('UB-NET-ERROR');
  });

  it('an unknown code with no message resolves to UB-UNKNOWN-ERROR (never undefined)', () => {
    const mapped = toCanonicalErrorCode('SOME_BRAND_NEW_CODE');
    expect(VALID.has(mapped)).toBe(true);
    expect(mapped).toBe('UB-UNKNOWN-ERROR');
  });
});
