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
import { describe, expect, it } from 'vitest';

const dist = new URL('../dist/', import.meta.url);
const require = createRequire(import.meta.url);
const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

describe('the ./live entry shares classes with the root entry', () => {
  it('ESM: one WrapperTransportError, HandlerRegistry and LiveSessionTransport', async () => {
    const root = await import(new URL('index.js', dist).href);
    const live = await import(new URL('live/index.js', dist).href);
    expect(live.WrapperTransportError).toBe(root.WrapperTransportError);
    expect(live.HandlerRegistry).toBe(root.HandlerRegistry);
    expect(live.LiveSessionTransport).toBe(root.LiveSessionTransport);
  });

  it('CJS: one WrapperTransportError and HandlerRegistry', () => {
    const root = require(new URL('index.cjs', dist).pathname);
    const live = require(new URL('live/index.cjs', dist).pathname);
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

  it('the ./live ESM graph imports no Node builtin', () => {
    const seen = new Set<string>();
    const queue = ['live/index.js'];
    const found: string[] = [];
    while (queue.length > 0) {
      const rel = queue.shift()!;
      if (seen.has(rel)) continue;
      seen.add(rel);
      const code = readFileSync(new URL(rel, dist), 'utf8');
      for (const m of code.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
        const spec = m[1]!;
        if (spec.startsWith('.')) {
          queue.push(
            new URL(spec, new URL(rel, dist)).pathname.slice(new URL(dist).pathname.length)
          );
        } else if (builtins.has(spec)) {
          found.push(`${rel}: ${spec}`);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(1); // it does reach the shared chunk
    expect(found).toEqual([]);
    expect(readdirSync(dist).some((f) => /^chunk-.*\.js$/.test(f))).toBe(true);
  });
});
