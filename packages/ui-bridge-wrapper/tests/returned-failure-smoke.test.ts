import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { existsSync, readdirSync, statSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumAvailable } from '../../../test-support/chromium-gate.mjs';

/**
 * Real Chromium: `ui-bridge-inject --exec` surfaces a RETURNED failure.
 *
 * The browser half of `returned-failure.test.ts`, whose doc comment has the
 * history: a failed action used to come back under `result` with exit 0. This
 * runs the BUILT bin against a real page, because the defect lived in the
 * bin's exit code and stdout, which no in-process test observes. It lives in a
 * `*-smoke` file so ci.yml's browser-smokes job runs it; gated on Chromium
 * like every real-Chromium test (`test-support/chromium-gate.mjs`).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(HERE, '..');
const BIN = resolve(PKG_DIR, 'dist/inject-cli.cjs');

// ---------------------------------------------------------------------------
// Browser: the BUILT bin, against a real page
// ---------------------------------------------------------------------------

const PLAYWRIGHT_AVAILABLE = chromiumAvailable(import.meta.url);

/** Newest mtime under `src/` — used to detect a dist built from older sources. */
function newestSourceMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestSourceMtime(abs));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
      newest = Math.max(newest, statSync(abs).mtimeMs);
  }
  return newest;
}

/** Same convention as bin-symlink.test.ts: build if dist is missing or stale. */
function ensureBuilt(): void {
  if (existsSync(BIN) && statSync(BIN).mtimeMs >= newestSourceMtime(join(PKG_DIR, 'src'))) return;
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: PKG_DIR,
    stdio: 'inherit',
    timeout: 600_000,
  });
}

const PAGE_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>returned-failure fixture</title></head>
<body>
  <main>
    <h1>returned-failure fixture</h1>
    <button id="ok-button" type="button" onclick="this.textContent='CLICKED'">Click me</button>
  </main>
</body>
</html>`;

let server: Server;
let pageUrl: string;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE_HTML);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  pageUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

interface Line {
  action: string;
  result?: Record<string, unknown>;
  error?: { code: string; message: string; source: string; details?: unknown };
}

/**
 * Spawn the built bin ASYNCHRONOUSLY. It must not be `spawnSync`: the fixture
 * page is served by `server` in THIS process, and a sync spawn blocks this
 * event loop for the child's whole lifetime — so the child's Chromium would
 * hang on `page.goto` until the navigation timed out, and the bin would exit 1
 * having printed nothing. That failure mode looks exactly like the bug under
 * test passing, which is worth a comment.
 */
async function runBin(
  execArgs: string[]
): Promise<{ status: number | null; lines: Line[]; stderr: string }> {
  const child = spawn(process.execPath, [BIN, '--url', pageUrl, '--quiet', ...execArgs], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (c: string) => (stdout += c));
  child.stderr.on('data', (c: string) => (stderr += c));
  const status = await new Promise<number | null>((res, rej) => {
    child.on('error', rej);
    child.on('close', (code) => res(code));
  });
  const lines = stdout
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Line);
  return { status, lines, stderr };
}

const CLICK_MISSING = 'executeElementAction {"id":"no-such-element","request":{"action":"click"}}';
const CLICK_OK = 'executeElementAction {"id":"dom-ok-button","request":{"action":"click"}}';
const STATE_OK = 'getElementState {"id":"dom-ok-button"}';

describe.skipIf(!PLAYWRIGHT_AVAILABLE)(
  'ui-bridge-inject --exec surfaces a RETURNED failure',
  () => {
    beforeAll(() => {
      ensureBuilt();
    }, 600_000);

    it('puts a returned failure on the error channel and exits non-zero, without aborting the rest', async () => {
      const { status, lines, stderr } = await runBin([
        '--exec',
        CLICK_MISSING,
        '--exec',
        CLICK_OK,
        '--exec',
        STATE_OK,
      ]);

      // (1) The defect itself: this used to be exit 0.
      expect(status, `a failed action must not look like a successful run\n${stderr}`).not.toBe(0);
      expect(status).toBe(1);

      // (2) One line per action, still — a failure does not eat a line, and it
      //     does not abort the actions after it. This is what a caller pairing
      //     N actions with N lines depends on.
      expect(lines).toHaveLength(3);

      const [failed, clicked, state] = lines;

      // (3) The failure is on the documented error channel...
      expect(failed.error).toBeDefined();
      expect(failed.error?.code).toBe('ELEMENT_NOT_FOUND');
      expect(failed.error?.source).toBe('returned');
      // ...machine-readable, not flattened into a string...
      expect((failed.error?.details as { errorCode: string }).errorCode).toBe('ELEMENT_NOT_FOUND');
      // ...and the original result is still there, unmodified (additive).
      expect(failed.result?.success).toBe(false);

      // (4) The actions AFTER the failure really ran, and really acted on the
      //     page: the click landed, so the button's text changed.
      expect(clicked.error).toBeUndefined();
      expect(clicked.result?.success).toBe(true);
      expect(state.error).toBeUndefined();
      expect(state.result?.textContent).toBe('CLICKED');
    }, 180_000);

    it('leaves the success path untouched: same shape, no error key, exit 0', async () => {
      const { status, lines, stderr } = await runBin(['--exec', CLICK_OK]);
      expect(status, stderr).toBe(0);
      expect(lines).toHaveLength(1);
      expect(Object.keys(lines[0]).sort()).toEqual(['action', 'result']);
      expect(lines[0].result?.success).toBe(true);
    }, 180_000);
  }
);
