/**
 * Verification Layers Types
 *
 * Multi-layer execution matrix enabling verification across UI, API, FS, and DB layers.
 * Inspired by testergizer-open-core's multi-layer execution matrix pattern.
 */

import type { SpecAssertion, SpecAssertionResult } from '../specs/types';

// =============================================================================
// Layers
// =============================================================================

export type VerificationLayer = 'ui' | 'api' | 'fs' | 'db';

// =============================================================================
// Layer-Specific Assertions
// =============================================================================

/**
 * UI assertion — delegates to existing SpecAssertion system.
 */
export interface UiAssertion {
  type: 'ui';
  assertion: SpecAssertion;
}

/**
 * API (HTTP) assertion — validates endpoint responses.
 */
export interface ApiAssertion {
  type: 'api';
  /** Full URL or path (resolved against base URL if configured). */
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** Request body (for POST/PUT/PATCH). */
  body?: unknown;
  /** Request headers. */
  headers?: Record<string, string>;
  /** Expected HTTP status code. */
  expectedStatus?: number;
  /** JSON path assertions on response body. Keys are dot-paths, values are expected values. */
  expectedBody?: Record<string, unknown>;
  /** Request timeout in ms. */
  timeout?: number;
}

/**
 * Filesystem assertion — validates file existence and content.
 * Requires Tauri IPC (runner context).
 */
export interface FsAssertion {
  type: 'fs';
  /** Absolute or relative file path. */
  path: string;
  /** What to check. */
  check: 'exists' | 'notExists' | 'contentContains' | 'contentEquals' | 'sizeGreaterThan';
  /** Expected value (string for content checks, number for size). */
  expected?: string | number;
}

/**
 * Database assertion — validates query results.
 * Requires Tauri IPC (runner context).
 */
export interface DbAssertion {
  type: 'db';
  /** SQL query to execute. */
  query: string;
  /** Named connection reference from runner config. */
  connectionRef?: string;
  /** Expected number of rows returned. */
  expectedRows?: number;
  /** Expected values in result rows (partial match). */
  expectedValues?: Record<string, unknown>[];
}

/**
 * Union of all layer-specific assertion types.
 */
export type LayeredAssertionPayload = UiAssertion | ApiAssertion | FsAssertion | DbAssertion;

/**
 * A single assertion within the execution matrix.
 */
export interface LayeredAssertion {
  /** Unique ID within the matrix. */
  id: string;
  /** Human-readable description. */
  description: string;
  /** Which layer this assertion runs on. */
  layer: VerificationLayer;
  /** The layer-specific assertion payload. */
  assertion: LayeredAssertionPayload;
}

// =============================================================================
// Execution Matrix
// =============================================================================

/**
 * Execution strategy for running assertions across layers.
 */
export type ExecutionStrategy =
  | 'parallel' // All layers run concurrently
  | 'sequential' // Layers run one after another
  | 'ui-first'; // UI layer runs first, then remaining layers in parallel

export interface ExecutionMatrix {
  /** Unique matrix ID. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Description. */
  description?: string;
  /** Assertions across layers. */
  layers: LayeredAssertion[];
  /** How to orchestrate layer execution. */
  strategy: ExecutionStrategy;
  /** Optional metadata. */
  metadata?: {
    author?: string;
    tags?: string[];
  };
}

// =============================================================================
// Results
// =============================================================================

export interface LayerAssertionResult {
  assertionId: string;
  layer: VerificationLayer;
  passed: boolean;
  /** Layer-specific result details. */
  details: UiLayerResult | ApiLayerResult | FsLayerResult | DbLayerResult;
  durationMs: number;
}

export interface UiLayerResult {
  type: 'ui';
  assertionResult: SpecAssertionResult;
}

export interface ApiLayerResult {
  type: 'api';
  status: number;
  statusText: string;
  body?: unknown;
  /** Which expected body paths matched/failed. */
  bodyMatches?: Record<string, { expected: unknown; actual: unknown; matched: boolean }>;
}

export interface FsLayerResult {
  type: 'fs';
  exists: boolean;
  content?: string;
  size?: number;
}

export interface DbLayerResult {
  type: 'db';
  rowCount: number;
  rows?: Record<string, unknown>[];
}

export interface LayerSummary {
  layer: VerificationLayer;
  totalAssertions: number;
  passedCount: number;
  failedCount: number;
  durationMs: number;
}

export interface MatrixExecutionResult {
  matrixId: string;
  matrixName: string;
  strategy: ExecutionStrategy;
  assertionResults: LayerAssertionResult[];
  layerSummaries: LayerSummary[];
  overallPassed: boolean;
  totalAssertions: number;
  passedCount: number;
  failedCount: number;
  durationMs: number;
  timestamp: number;
}

// =============================================================================
// Constants
// =============================================================================

export const MATRIX_FILE_EXTENSION = '.matrix.uibridge.json';
