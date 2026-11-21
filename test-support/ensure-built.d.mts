/** True when an output is missing, or the oldest output predates the newest build input. */
export declare function isStale(pkgDir: string, outputs: readonly string[]): boolean;
/**
 * Build the package with its own `npm run build` when `outputs` are stale, one
 * build at a time per package (an exclusive lockfile in os.tmpdir()). See
 * ensure-built.mjs for the staleness rule.
 */
export declare function ensureBuilt(pkgDir: string, outputs: readonly string[]): void;
