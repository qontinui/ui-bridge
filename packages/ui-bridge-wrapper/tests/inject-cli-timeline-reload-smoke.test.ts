/**
 * Real Chromium: `captureTimeline {"reload":true}` captures frame 1, end to end
 * through the same functions the bin runs (`parseArgs`, `validateWaitActions`,
 * `buildTransportOptions`, `registerTimelineCapture`, `executeActions`).
 *
 * The defect this pins (plan 2026-11-08-ui-bridge-inject-exec-mode-is-a-second-class-driver,
 * Phase 1): right after `page.reload({ waitUntil: 'commit' })` the renderer is
 * still evaluating the ~645 KB injected runtime at document start, the new
 * document has no compositor frame yet, and Chromium can refuse frame 1 with
 * `Protocol error (Page.captureScreenshot): Unable to capture screenshot` while
 * frames 2-4 are written. A fake page cannot see that (its first screenshot
 * always succeeds), so this runs the real one.
 *
 * WHETHER THE REFUSAL ARRIVES DEPENDS ON THE PLAYWRIGHT DRIVING CHROMIUM, AND
 * EVEN THEN IT IS A RACE. Measured 2026-11-08 on one box, first screenshot
 * after each reload commit: Playwright 1.65.0 (also what `npx -p playwright`
 * resolves for a published-wrapper user) was refused on 2 of 12 against
 * Chromium 158, and on 5 of 6 at authoring; Playwright 1.59.1 on 0 of 36
 * across Chromium 147, 156 and 158. The workspace lock resolves Playwright
 * 1.65.0 (213dfdf moved it off 1.59.1 for exactly this), and CI installs the
 * browser that version pins, so this smoke CAN fail against the defect:
 * without the retry it was red on 1 of 3 runs at red-first and on 1 of 8 at the
 * review of 213dfdf, and green on the rest, because each run draws the race
 * afresh. A green run is therefore not by itself proof the retry ran; each run
 * logs which path it took (frame 1's `attempts`). The deterministic proof of
 * the retry rule is the unit suite (`inject-cli-network-timeline.test.ts`);
 * this pins that the rule meets the refusal Chromium actually sends.
 *
 * Gated on a Playwright Chromium being installed, as the other smokes are.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTransport } from '../src/create-transport.js';
import {
  buildTransportOptions,
  executeActions,
  parseArgs,
  validateWaitActions,
  type ExecLine,
} from '../src/inject-cli.js';
import { registerTimelineCapture, type TimelineResult } from '../src/timeline-capture.js';
import { chromiumAvailable } from '../../../test-support/chromium-gate.mjs';

const PLAYWRIGHT_AVAILABLE = chromiumAvailable();

// The plan's exec-mode acceptance fixture (Phase 6), served on its own port.
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>exec-mode fixture</title></head><body>
<h1>Exec-mode fixture</h1>
<button data-testid="go" aria-pressed="false" onclick="this.setAttribute('aria-pressed', this.getAttribute('aria-pressed')==='true'?'false':'true')">Toggle</button>
<button data-testid="busy" disabled>Busy</button>
<input data-testid="query" placeholder="Search" />
</body></html>`;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let server: Server;
let url: string;
let dir: string;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  dir = mkdtempSync(join(tmpdir(), 'inject-timeline-reload-smoke-'));
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!PLAYWRIGHT_AVAILABLE)('captureTimeline reload (real Chromium)', () => {
  it('frame 1 after the reload commit is written, with frames 2-4, and the step succeeds', async () => {
    const tl = join(dir, 'tl');
    const payload = { dir: tl, frames: 4, intervalMs: 200, reload: true };
    const args = parseArgs([
      '--url',
      url,
      '--exec',
      `captureTimeline ${JSON.stringify(payload)}`,
      '--quiet',
    ]);
    validateWaitActions(args.execActions);
    const transport = createTransport({ kind: 'injected', options: buildTransportOptions(args) });
    registerTimelineCapture(transport, () => null);

    const lines: ExecLine[] = [];
    let anyError: boolean;
    try {
      await transport.ready();
      anyError = await executeActions(
        transport,
        args.execActions,
        () => null,
        (line) => lines.push(line)
      );
    } finally {
      await transport.close().catch(() => {});
    }

    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    const result = line.result as TimelineResult;
    const shown = JSON.stringify(line);
    expect(line.action).toBe('captureTimeline');
    expect(line.error, shown).toBeUndefined();
    expect(anyError, shown).toBe(false);
    expect(result, shown).toMatchObject({
      success: true,
      dir: tl,
      reloaded: true,
      intervalMs: 200,
      runtimeReady: true,
    });
    expect(result.error, shown).toBeUndefined();
    expect(result.frames.map((f) => f.index)).toEqual([1, 2, 3, 4]);
    for (const f of result.frames) {
      expect(f.error, shown).toBeUndefined();
      expect(f.path, shown).toBe(join(tl, `frame-${f.index}.png`));
      // `attempts` is present only when a frame needed more than one.
      if (f.attempts !== undefined) expect(f.attempts, shown).toBeGreaterThan(1);
      expect(Array.from(readFileSync(f.path!).subarray(0, 8))).toEqual(PNG_SIGNATURE);
    }
    expect(readdirSync(tl).sort()).toEqual([
      'frame-1.png',
      'frame-2.png',
      'frame-3.png',
      'frame-4.png',
    ]);

    // Evidence, not an assertion: whether THIS run met Chromium's refusal (the
    // retry path) or was handed frame 1 at the first attempt — it is a race.
    const first = result.frames[0]!;
    console.info(
      `[timeline-reload-smoke] frame 1: offsetMs=${first.offsetMs} attempts=${first.attempts ?? 1}`
    );
  }, 60_000);
});
