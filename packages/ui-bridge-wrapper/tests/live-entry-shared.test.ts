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

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dist = new URL('../dist/', import.meta.url);
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

/**
 * Load the BUILT entries in a child Node process and return what the probe
 * printed. A child process, not an import in this file: the repo's real-browser
 * placement check (scripts/check-browser-test-placement.mjs) reads every module
 * a test loads, and the root entry's own Node-only loader code would read to it
 * as a real-browser test that runs nowhere.
 */
function probe(source: string, type: 'module' | 'commonjs'): unknown {
  const out = execFileSync(process.execPath, [`--input-type=${type}`, '-e', source], {
    cwd: fileURLToPath(dist),
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split('\n').pop()!);
}

describe('the ./live entry shares classes with the root entry', () => {
  it('ESM: one WrapperTransportError, HandlerRegistry and LiveSessionTransport', () => {
    expect(
      probe(
        `const root = await import('./index.js');
         const live = await import('./live/index.js');
         console.log(JSON.stringify({
           error: live.WrapperTransportError === root.WrapperTransportError,
           registry: live.HandlerRegistry === root.HandlerRegistry,
           transport: live.LiveSessionTransport === root.LiveSessionTransport,
         }));`,
        'module'
      )
    ).toEqual({ error: true, registry: true, transport: true });
  });

  it('CJS: one WrapperTransportError and HandlerRegistry', () => {
    expect(
      probe(
        `const root = require('./index.cjs');
         const live = require('./live/index.cjs');
         console.log(JSON.stringify({
           error: live.WrapperTransportError === root.WrapperTransportError,
           registry: live.HandlerRegistry === root.HandlerRegistry,
         }));`,
        'commonjs'
      )
    ).toEqual({ error: true, registry: true });
  });

  it('a ./live error keeps its code through a root registry', () => {
    expect(
      probe(
        `const root = await import('./index.js');
         const live = await import('./live/index.js');
         const registry = new root.HandlerRegistry();
         registry.register('x', () => {
           throw new live.WrapperTransportError('TAB_NOT_VISIBLE', 'hidden', { retryable: true });
         });
         let code = null;
         try { await registry.dispatch('x'); } catch (e) { code = e.code; }
         console.log(JSON.stringify({ code }));`,
        'module'
      )
    ).toEqual({ code: 'TAB_NOT_VISIBLE' });
  });

  it('the ./live ESM graph imports no Node builtin and no Node-only package', () => {
    // Walked by URL (href keys) and read through fileURLToPath, which turns a
    // file: URL into a native path: a Windows drive letter or a
    // percent-encoded space in the checkout path would break a path built
    // from `url.pathname`.
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
