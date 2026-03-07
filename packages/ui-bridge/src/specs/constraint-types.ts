/**
 * Constraint Spec Types
 *
 * Type definitions for concrete, measurable project constraints.
 * Performance budgets, browser support, responsive breakpoints,
 * bundle size limits, and other quantifiable requirements.
 *
 * Distinct from ArchitectureConstraint (high-level pattern constraints).
 * These are specific, measurable, and verifiable targets.
 */

// A performance budget
export interface PerformanceBudget {
  id: string;
  /** What is being measured */
  metric:
    | 'lcp'
    | 'fcp'
    | 'cls'
    | 'fid'
    | 'inp'
    | 'ttfb'
    | 'tti'
    | 'total-blocking-time'
    | 'speed-index'
    | 'custom';
  /** Custom metric name (when metric is 'custom') */
  customMetric?: string;
  /** Maximum allowed value */
  budget: number;
  /** Unit of measurement */
  unit: 'ms' | 's' | 'score' | 'ratio';
  /** Which pages this applies to (empty = all pages) */
  pageIds?: string[];
  description?: string;
}

// Bundle size budget
export interface BundleBudget {
  id: string;
  /** What bundle or chunk */
  target: 'total' | 'initial' | 'chunk' | 'asset';
  /** Specific chunk/asset name (when target is 'chunk' or 'asset') */
  name?: string;
  /** Max size in bytes */
  maxSizeBytes: number;
  /** Whether this is gzipped or raw */
  compressed: boolean;
  description?: string;
}

// Browser/platform support target
export interface BrowserTarget {
  browser:
    | 'chrome'
    | 'firefox'
    | 'safari'
    | 'edge'
    | 'ios-safari'
    | 'android-chrome'
    | 'samsung-internet'
    | 'opera';
  /** Minimum supported version */
  minVersion: string;
  /** Support level */
  support: 'full' | 'partial' | 'none';
}

// Responsive breakpoint
export interface ResponsiveBreakpoint {
  id: string;
  name: string;
  /** Minimum viewport width in px */
  minWidth: number;
  /** Maximum viewport width in px (optional) */
  maxWidth?: number;
  /** Layout expectations at this breakpoint */
  description?: string;
}

// Accessibility constraint
export interface AccessibilityTarget {
  /** WCAG conformance level */
  level: 'A' | 'AA' | 'AAA';
  /** Specific criteria IDs that must pass (e.g., "1.4.3" for contrast) */
  requiredCriteria?: string[];
  /** Minimum contrast ratio for normal text */
  minContrastRatio?: number;
  /** Minimum touch target size in px */
  minTouchTarget?: number;
  description?: string;
}

// Rate limit / capacity constraint
export interface CapacityConstraint {
  id: string;
  /** What system or endpoint */
  target: string;
  /** Maximum concurrent users/requests */
  maxConcurrent?: number;
  /** Maximum requests per time window */
  rateLimit?: {
    requests: number;
    windowSeconds: number;
  };
  /** Maximum response time under load */
  maxResponseTimeMs?: number;
  description?: string;
}

// Main constraint config (the .constraints.uibridge.json format)
export interface ConstraintConfig {
  version: '1.0.0';
  description?: string;
  performance?: PerformanceBudget[];
  bundleBudgets?: BundleBudget[];
  browsers?: BrowserTarget[];
  breakpoints?: ResponsiveBreakpoint[];
  accessibility?: AccessibilityTarget;
  capacity?: CapacityConstraint[];
  metadata?: {
    author?: string;
    createdAt?: string;
    updatedAt?: string;
    [key: string]: unknown;
  };
}

export const CONSTRAINT_FILE_EXTENSION = '.constraints.uibridge.json';
export const CONSTRAINT_CONFIG_VERSION = '1.0.0';
