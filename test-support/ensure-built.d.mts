/** A package that must be built before another is, because the other inlines it. */
export interface Prerequisite {
  pkgDir: string;
  outputs: readonly string[];
}

export interface EnsureBuiltOptions {
  /** Built first, each under its own lock; their build inputs count as this package's. */
  prerequisites?: readonly Prerequisite[];
  /** Further files or directories whose mtimes count as build inputs. */
  extraInputs?: readonly string[];
  /** Defaults to `npm run build`; tests of this helper override it. */
  buildCommand?: string;
  /** Defaults to BUILD_TIMEOUT_MS. */
  timeoutMs?: number;
}

export declare const BUILD_TIMEOUT_MS: number;
/** How old a lock must be before it is stolen from a live holder: 2x BUILD_TIMEOUT_MS. */
export declare const LOCK_EXPIRY_MS: number;
/** How long a failed build's marker makes callers fail fast. */
export declare const FAILURE_TTL_MS: number;
/** `@qontinui/ui-bridge-cli-args`, which ui-bridge-headless and ui-bridge-wrapper inline. */
export declare const CLI_ARGS_PREREQUISITE: Prerequisite;

/** Newest mtime across the package's build inputs. */
export declare function newestInputMtime(pkgDir: string, options?: EnsureBuiltOptions): number;
/** True when an output is missing, or the oldest output predates the newest build input. */
export declare function isStale(
  pkgDir: string,
  outputs: readonly string[],
  options?: EnsureBuiltOptions
): boolean;
/** The build lockfile for a package directory. */
export declare function lockPathFor(pkgDir: string): string;
/**
 * Build the package with its own `npm run build` when `outputs` are stale, one
 * build at a time per package. See ensure-built.mjs for the rules.
 */
export declare function ensureBuilt(
  pkgDir: string,
  outputs: readonly string[],
  options?: EnsureBuiltOptions
): void;
