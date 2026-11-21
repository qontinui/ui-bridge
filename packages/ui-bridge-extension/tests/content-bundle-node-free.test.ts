/**
 * The BUILT extension bundles must be Node-free.
 *
 * A content script or service worker has no `require`. esbuild turns an
 * external Node builtin into `__require("<builtin>")`, which throws "Dynamic
 * require of ... is not supported" the moment the enclosing module
 * initialises. That is how the live relay silently failed to load: it imported
 * the wrapper's package root, whose init pulled `module`, `fs`, `crypto` and
 * `path` (plan 2026-11-21-vision-capture-cannot-frame-a-websocket-transport-app,
 * Phase 4 follow-up). The relay now imports the browser-safe
 * `@qontinui/ui-bridge-wrapper/live` entry; this test keeps it that way.
 *
 * It reads `dist/`, so it needs `npm run build` first — CI's order (build,
 * typecheck, test). A missing bundle FAILS rather than skipping: an absent
 * build is not evidence the bundle is clean.
 */

import { existsSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const BUNDLES = [
  'dist/content/live-relay.js',
  'dist/content/index.js',
  'dist/background/service-worker.js',
  'dist/popup/popup.js',
  'dist/sidepanel/sidepanel.js',
];

const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

/** Every `require("x")` / `__require("x")` whose specifier is a Node builtin. */
export function nodeBuiltinRequires(code: string): string[] {
  const found: string[] = [];
  for (const m of code.matchAll(/\b(?:__)?require\(\s*["']([^"']+)["']\s*\)/g)) {
    if (builtins.has(m[1]!)) found.push(m[0]);
  }
  return found;
}

/** Node-only globals read as values in a browser bundle. */
export function nodeGlobalAccess(code: string): string[] {
  return [
    ...code.matchAll(
      /\b(?:Buffer\.(?:from|alloc|concat|isBuffer)|process\.(?:cwd|argv|exit|versions|platform|pid)|__dirname|__filename)\b/g
    ),
  ].map((m) => m[0]);
}

describe('built extension bundles are Node-free', () => {
  it('the detector catches the shape that broke the relay', () => {
    expect(nodeBuiltinRequires('import_module = __require("module");')).toEqual([
      '__require("module")',
    ]);
    expect(nodeBuiltinRequires('x = require("node:fs")')).toEqual(['require("node:fs")']);
    expect(nodeBuiltinRequires('__require("./local")')).toEqual([]);
    expect(nodeGlobalAccess('Buffer.from(b).toString("base64")')).toEqual(['Buffer.from']);
  });

  it('dist/content/live-relay.js actually bundles the wrapper live entry', () => {
    // Positive control: a relay built before the wrapper had a dist/ leaves the
    // import unbundled (esbuild only warns inside a try) — Node-free, and dead.
    const path = new URL('../dist/content/live-relay.js', import.meta.url);
    expect(existsSync(path), 'dist/content/live-relay.js is missing — build first').toBe(true);
    const code = readFileSync(path, 'utf8');
    expect(code).not.toMatch(/import\(\s*["']@qontinui\/ui-bridge-wrapper/);
    expect(code).toContain("Transport kind 'live' requires runnerUrl");
    expect(code).toContain('getScreenshot');
  });

  for (const rel of BUNDLES) {
    it(`${rel} carries no Node builtin require and no Node-only global`, () => {
      const path = new URL(`../${rel}`, import.meta.url);
      expect(
        existsSync(path),
        `${rel} is missing — run \`npm run build -w packages/ui-bridge-extension\` (after the wrapper build) first`
      ).toBe(true);
      const code = readFileSync(path, 'utf8');
      expect(nodeBuiltinRequires(code)).toEqual([]);
      expect(nodeGlobalAccess(code)).toEqual([]);
    });
  }

  it('dist/content/live-relay.js loads the wrapper and registers in a context with no require', async () => {
    // Run the built IIFE the way a content script runs: a fresh global with
    // browser-shaped stubs and NO `require`. Before the fix this logged
    // `failed to load wrapper module Error: Dynamic require of "module" is not
    // supported` and never opened a socket.
    const path = new URL('../dist/content/live-relay.js', import.meta.url);
    expect(existsSync(path), 'dist/content/live-relay.js is missing — build first').toBe(true);
    const logs: string[] = [];
    const sent: string[] = [];
    class FakeWebSocket {
      readyState = 0;
      private readonly l: Record<string, Array<(ev?: unknown) => void>> = {};
      constructor() {
        setTimeout(() => {
          this.readyState = 1;
          for (const f of this.l['open'] ?? []) f();
        }, 1);
      }
      send(data: string): void {
        sent.push(data);
        const frame = JSON.parse(data) as { type: string; appId?: string };
        if (frame.type === 'register') {
          const ack = { type: 'registered', appId: frame.appId, connId: 1, acceptedAt: 0 };
          setTimeout(() => {
            for (const f of this.l['message'] ?? []) f({ data: JSON.stringify(ack) });
          }, 1);
        }
      }
      close(): void {}
      addEventListener(type: string, f: (ev?: unknown) => void): void {
        (this.l[type] ??= []).push(f);
      }
    }
    const log =
      (level: string) =>
      (...args: unknown[]) =>
        logs.push([level, ...args.map(String)].join(' '));
    const context: Record<string, unknown> = {
      console: { info: log('info'), warn: log('warn'), error: log('error'), log: log('log') },
      chrome: {
        storage: {
          local: {
            get: async (key: string) =>
              key === 'qontinui_live_relay_enabled' ? { [key]: true } : {},
          },
        },
        runtime: { onMessage: { addListener: () => undefined }, sendMessage: async () => ({}) },
      },
      location: {
        host: 'example.com',
        pathname: '/a',
        origin: 'https://example.com',
        href: 'https://example.com/a',
      },
      document: { title: 'Example', visibilityState: 'visible' },
      WebSocket: FakeWebSocket,
      setTimeout,
      clearTimeout,
      queueMicrotask,
    };
    context['window'] = context;
    context['globalThis'] = context;
    createContext(context);
    runInContext(readFileSync(path, 'utf8'), context);

    for (let i = 0; i < 200 && !logs.some((l) => l.includes('connected to')); i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(logs.filter((l) => l.startsWith('error'))).toEqual([]);
    expect(sent.length).toBeGreaterThan(0);
    expect(JSON.parse(sent[0]!)).toMatchObject({
      type: 'register',
      appId: 'example.com-a',
      capabilities: ['screenshot'],
    });
  });
});
