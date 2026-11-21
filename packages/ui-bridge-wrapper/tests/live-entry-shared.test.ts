/**
 * `./live` and the package root share ONE copy of their common classes.
 *
 * With `splitting: false` each entry bundled its own WrapperTransportError and
 * HandlerRegistry, so a `./live` error thrown through a root registry failed
 * `instanceof` and was rewrapped HANDLER_ERROR, losing its code. tsup now
 * splits shared modules into chunks; this reads the BUILT entries (the global
 * setup builds the package first) and checks identity per format, and that the
 * `./live` graph stays Node-free.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dist = new URL('../dist/', import.meta.url);
const require = createRequire(import.meta.url);
const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
/** Node-only packages the browser-safe entry must never reach either. */
const NODE_ONLY_PACKAGES = new Set([
  'playwright',
  'playwright-core',
  'ws',
  '@qontinui/ui-bridge-headless',
]);
function nodeOnly(spec: string): boolean {
  if (builtins.has(spec)) return true;
  const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!;
  return NODE_ONLY_PACKAGES.has(pkg);
}

describe('the ./live entry shares classes with the root entry', () => {
  it('ESM: one WrapperTransportError, HandlerRegistry and LiveSessionTransport', async () => {
    const root = await import(new URL('index.js', dist).href);
    const live = await import(new URL('live/index.js', dist).href);
    expect(live.WrapperTransportError).toBe(root.WrapperTransportError);
    expect(live.HandlerRegistry).toBe(root.HandlerRegistry);
    expect(live.LiveSessionTransport).toBe(root.LiveSessionTransport);
  });

  it('CJS: one WrapperTransportError and HandlerRegistry', () => {
    const root = require(fileURLToPath(new URL('index.cjs', dist)));
    const live = require(fileURLToPath(new URL('live/index.cjs', dist)));
    expect(live.WrapperTransportError).toBe(root.WrapperTransportError);
    expect(live.HandlerRegistry).toBe(root.HandlerRegistry);
  });

  it('a ./live error keeps its code through a root registry', async () => {
    const root = await import(new URL('index.js', dist).href);
    const live = await import(new URL('live/index.js', dist).href);
    const registry = new root.HandlerRegistry();
    registry.register('x', () => {
      throw new live.WrapperTransportError('TAB_NOT_VISIBLE', 'hidden', { retryable: true });
    });
    await expect(registry.dispatch('x')).rejects.toMatchObject({ code: 'TAB_NOT_VISIBLE' });
  });

  it('the ./live ESM graph imports no Node builtin and no Node-only package', () => {
    // Walked by URL (href keys), read through fileURLToPath. (The path bug the
    // review caught was the CJS test's `require(url.pathname)`, which breaks on
    // a Windows drive letter or a percent-encoded space; both now go through
    // fileURLToPath.)
    const seen = new Set<string>();
    const queue = [new URL('live/index.js', dist).href];
    const found: string[] = [];
    while (queue.length > 0) {
      const href = queue.shift()!;
      if (seen.has(href)) continue;
      seen.add(href);
      const code = readFileSync(fileURLToPath(href), 'utf8');
      for (const m of code.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
        const spec = m[1]!;
        if (spec.startsWith('.')) {
          queue.push(new URL(spec, href).href);
        } else if (nodeOnly(spec)) {
          found.push(`${href}: ${spec}`);
        }
      }
    }
    expect(nodeOnly('playwright-core/lib/server')).toBe(true); // the detector itself
    expect(nodeOnly('@qontinui/ui-bridge-headless')).toBe(true);
    expect(seen.size).toBeGreaterThan(1); // it does reach the shared chunk
    expect(found).toEqual([]);
    expect(readdirSync(dist).some((f) => /^chunk-.*\.js$/.test(f))).toBe(true);
  });
});
