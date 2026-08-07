/**
 * The version ranges the scaffold writes for the three UI Bridge packages.
 *
 * Bounded on BOTH ends — `>=<floor> <1` — which is the form
 * `docs/wrappers/authoring-guide.md` tells community wrapper authors to use.
 * The scaffold is the executable half of that guidance: whatever it emits is
 * what every generated wrapper ships with, so the two must not drift.
 *
 * Both failure modes the guide names are real, and the scaffold has now hit
 * each of them:
 *
 * - **Unbounded above** (`*`, or a bare `>=0.4.0`) silently accepts a future
 *   `1.0.0`, handing the consumer a broken tree instead of a warning.
 * - **A stale ceiling** is what these specs used to be: all three were
 *   `^0.1.0`, i.e. `>=0.1.0 <0.2.0`, frozen at the versions current when the
 *   scaffold was written. A standalone (non-`--monorepo`) scaffold therefore
 *   installed `@qontinui/ui-bridge@0.1.1` against an engine already at
 *   0.22.0, `ui-bridge-wrapper@0.1.5` against 0.7.1, and
 *   `ui-bridge-headless@0.1.0` against 0.4.0 — while the templates are
 *   written against the CURRENT APIs.
 *
 * The floors below are the release lines the templates are authored against.
 * `<1` is the honest upper bound while UI Bridge is pre-1.0, since a minor may
 * still carry a breaking change.
 *
 * `tests/dep-specs.test.ts` asserts each range still admits the live workspace
 * version of its package. To be exact about what that buys: it catches a stale
 * CEILING — the thing that actually broke here — not a stale floor. `>=0.1.0
 * <1` would keep admitting 0.22.0 forever and the test would keep passing,
 * which is correct, because a low floor is merely generous rather than wrong.
 * `^0.1.0` was caught because its ceiling is `<0.2.0`.
 *
 * NOTE: these ranges resolve to `@qontinui/ui-bridge-wrapper@0.7.1` and
 * `@qontinui/ui-bridge-headless@0.4.0`, and both of those published tarballs
 * declare `@qontinui/ui-bridge-cli-args`, which has never been published. Until
 * that first publish happens a standalone scaffold cannot `npm install` at all.
 * That break is not caused by these specs — it hits every direct consumer of
 * wrapper and headless identically — but the old stale `^0.1.0` did MASK it,
 * because wrapper 0.1.5 / headless 0.1.0 predate the cli-args dependency.
 */
export const REGISTRY_DEP_SPECS: Readonly<Record<string, string>> = {
  '@qontinui/ui-bridge': '>=0.22.0 <1',
  '@qontinui/ui-bridge-wrapper': '>=0.7.0 <1',
  '@qontinui/ui-bridge-headless': '>=0.4.0 <1',
};

/**
 * `--monorepo` scaffolds live beside the packages they depend on, so they link
 * to the local workspace copy instead of resolving from the registry.
 */
export const WORKSPACE_DEP_SPEC = 'workspace:*';

/** The spec the scaffold writes for `name`, given the scaffold's mode. */
export function depSpecFor(
  name: keyof typeof REGISTRY_DEP_SPECS | string,
  monorepo: boolean
): string {
  if (monorepo) return WORKSPACE_DEP_SPEC;
  const spec = REGISTRY_DEP_SPECS[name];
  if (!spec) throw new Error(`no dep spec declared for ${name} — add one to REGISTRY_DEP_SPECS`);
  return spec;
}
