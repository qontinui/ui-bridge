/** One package to build when stale. Paths in `outputs` and `extraInputs` are relative to `dir`. */
export interface BuildStep {
  /** Package directory relative to the repo root (or absolute), e.g. `packages/ui-bridge-headless`. */
  dir: string;
  /** Required outputs relative to `dir`, e.g. `dist/cli.js`. */
  outputs: readonly string[];
  /** Package dirs (repo-relative or absolute) whose sources this package bundles. */
  inlines?: readonly string[];
  /** Further build inputs relative to `dir` (files, or directories walked like src/). */
  extraInputs?: readonly string[];
  /** Tests of this helper only: replaces `npm run build -w <dir>`; runs in `dir`. */
  command?: string;
}

export declare const REPO_ROOT: string;
/** `@qontinui/ui-bridge-cli-args`, which ui-bridge-headless and ui-bridge-wrapper inline. */
export declare const CLI_ARGS: BuildStep;
/** The build timeout: QONTINUI_TEST_BUILD_TIMEOUT_MS (clamped to 2147483647) when positive, else 10 min. */
export declare function buildTimeoutMs(): number;
/** Why `step` needs a build, or null when its dist is fresh. */
export declare function staleReason(step: BuildStep): string | null;
/**
 * Build each stale step, in order. Rejects when a build exits non-zero (the
 * error carries `buildPid`, the build's own pid) or leaves its step stale.
 */
export declare function buildIfStale(
  steps: readonly BuildStep[],
  timeoutMs?: number
): Promise<void>;
/** The message a test shows when an output it needs is missing. */
export declare function missingOutputMessage(path: string): string;
