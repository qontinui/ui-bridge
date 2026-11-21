/** One package to build when stale. Paths in `outputs` are relative to `dir`. */
export interface BuildStep {
  /** Package directory relative to the repo root, e.g. `packages/ui-bridge-headless`. */
  dir: string;
  /** Required outputs relative to `dir`, e.g. `dist/cli.js`. */
  outputs: readonly string[];
  /** Repo-relative package dirs whose sources this package bundles. */
  inlines?: readonly string[];
}

export declare const REPO_ROOT: string;
/** `@qontinui/ui-bridge-cli-args`, which ui-bridge-headless and ui-bridge-wrapper inline. */
export declare const CLI_ARGS: BuildStep;
/** Why `step` needs a build, or null when its dist is fresh. */
export declare function staleReason(step: BuildStep): string | null;
/** Build each stale step, in order, with `npm run build -w <dir>`; throws on failure. */
export declare function buildIfStale(steps: readonly BuildStep[]): void;
/** The message a test shows when an output it needs is missing. */
export declare function missingOutputMessage(path: string): string;
