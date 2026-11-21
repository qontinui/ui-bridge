import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Build-output guard: `@qontinui/ui-bridge-cli-args` is INLINED into this
 * package's bundles, never required at runtime.
 *
 * cli-args has never reached npm past 0.1.0 (its publish 404s), so a published
 * wrapper whose bins still `require`d it — through a `dependencies` entry tsup
 * externalises by default — would crash `ui-bridge-inject`,
 * `ui-bridge-login-web` and `ui-bridge-capture-specs` on startup for every
 * consumer. It is therefore a devDependency and tsup bundles it. This test
 * fails if a runtime reference to it reappears in `dist/`, or if the manifest
 * lists it as a runtime dependency again.
 *
 * The bin roster is read from package.json, so a newly added bin is covered
 * automatically.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(HERE, '..');
const DIST_DIR = join(PKG_DIR, 'dist');
const CLI_ARGS = '@qontinui/ui-bridge-cli-args';
const RUNTIME_BLOCKS = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const;
/** Any quoted module specifier naming the package (or a subpath of it). */
const SPECIFIER = /["'`]@qontinui\/ui-bridge-cli-args(?:\/[^"'`]*)?["'`]/;

const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')) as {
  bin: Record<string, string>;
} & Record<string, Record<string, string> | undefined>;
const BIN_PATHS = Object.values(pkg.bin).map((rel) => resolve(PKG_DIR, rel));

function walk(dir: string, keep: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs, keep));
    else if (keep(entry.name)) out.push(abs);
  }
  return out;
}

const isBundle = (name: string) => /\.(c|m)?js$/.test(name);

/** CI builds before it tests, so this is a no-op there; locally it runs the
 * package's own build rather than inventing a second build path. */
function ensureBuilt(): void {
  const srcNewest = Math.max(
    ...walk(join(PKG_DIR, 'src'), (n) => n.endsWith('.ts') || n.endsWith('.tsx')).map(
      (f) => statSync(f).mtimeMs
    ),
    statSync(join(PKG_DIR, 'package.json')).mtimeMs
  );
  const stale = BIN_PATHS.some((p) => !existsSync(p) || statSync(p).mtimeMs < srcNewest);
  if (!stale) return;
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: PKG_DIR,
    stdio: 'inherit',
    timeout: 600_000,
    shell: process.platform === 'win32',
  });
}

describe('cli-args is bundled into dist, not a runtime dependency', () => {
  beforeAll(() => {
    ensureBuilt();
  }, 600_000);

  it('the manifest does not list cli-args as a runtime dependency', () => {
    for (const block of RUNTIME_BLOCKS) {
      expect(pkg[block]?.[CLI_ARGS], `${CLI_ARGS} is in ${block}`).toBeUndefined();
    }
  });

  it('no built bundle references cli-args as a module specifier', () => {
    // Every bin and both entry formats must exist, or this check proves nothing.
    for (const p of [...BIN_PATHS, join(DIST_DIR, 'index.js'), join(DIST_DIR, 'index.cjs')]) {
      expect(existsSync(p), `${relative(PKG_DIR, p)} missing`).toBe(true);
    }
    const offenders = walk(DIST_DIR, isBundle)
      .filter((f) => SPECIFIER.test(readFileSync(f, 'utf8')))
      .map((f) => relative(PKG_DIR, f));
    expect(offenders).toEqual([]);
  });

  it('every bin carries the inlined parser', () => {
    // Positive control: each bin uses cli-args, so with the import gone its
    // code must be inside the bundle — otherwise the import was dropped, not
    // inlined.
    for (const p of BIN_PATHS) {
      expect(
        readFileSync(p, 'utf8'),
        `${relative(PKG_DIR, p)} lacks the inlined consumeValue`
      ).toMatch(/function consumeValue\b/);
    }
  });
});
