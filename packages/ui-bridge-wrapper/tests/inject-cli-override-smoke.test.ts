/**
 * Real Chromium: an asset swapped IN SITU through the injected runtime, seen in
 * the pixels, timed under a throttled network, and restored — Phase 18 of plan
 * 2026-10-13-image-generation-and-visual-judgment, end to end through the same
 * functions the bin runs.
 *
 * What is proved on the page and in the frame, not inferred:
 *   - `mediaOverride` answers only after the candidate DECODED, with the page's
 *     own `currentSrc` naming it; the frame then shows the candidate's colour
 *     where the original's was;
 *   - inside a `<picture>` the candidate wins over the original `<source>`;
 *   - under `--throttle` the swap cannot complete faster than the emulated
 *     latency (Chromium applied it, measured, not assumed);
 *   - `captureTimeline` records frames with increasing offsets;
 *   - `mediaOverrideRestore` puts every attribute back (the DOM reads back
 *     byte-identical), its `verified` is the RENDERED state (the slot's
 *     `currentSrc` back on the original), and `mediaOverrideList` is empty
 *     afterwards;
 *   - an offscreen `loading="lazy"` slot still decodes the candidate (it is
 *     loaded eagerly for the override) and gets `lazy` back on restore;
 *   - a background override keeps an inline style the app wrote meanwhile.
 *
 * Gated on a Playwright Chromium being installed, as the other smokes are.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTransport } from '../src/create-transport.js';
import {
  APPLY_NETWORK_ACTION,
  SNAPSHOT_ACTIONS,
  buildTransportOptions,
  executeActions,
  parseArgs,
  registerFrameCapture,
  registerNetworkEmulation,
  type ExecLine,
} from '../src/inject-cli.js';
import { registerTimelineCapture } from '../src/timeline-capture.js';
import { chromiumAvailable } from '../../../test-support/chromium-gate.mjs';

const PLAYWRIGHT_AVAILABLE = chromiumAvailable();

/** A solid-colour 8-bit RGB PNG. */
function solidPng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).map((_, i) => rgb[i % 3]!)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Read one pixel of an 8-bit RGB/RGBA PNG Chromium wrote. */
function pixel(buf: Buffer, x: number, y: number): number[] {
  const width = buf.readUInt32BE(16);
  const colorType = buf[25]!;
  const bpp = colorType === 6 ? 4 : 3;
  const idat: Buffer[] = [];
  for (let off = 8; off < buf.length; ) {
    const len = buf.readUInt32BE(off);
    if (buf.toString('ascii', off + 4, off + 8) === 'IDAT')
      idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const rows: Buffer[] = [];
  for (let r = 0; r <= y; r++) {
    const filter = raw[r * (stride + 1)]!;
    const out = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const v = raw[r * (stride + 1) + 1 + i]!;
      const a = i >= bpp ? out[i - bpp]! : 0;
      const b = r > 0 ? rows[r - 1]![i]! : 0;
      const c = i >= bpp && r > 0 ? rows[r - 1]![i - bpp]! : 0;
      let p: number;
      if (filter === 0) p = v;
      else if (filter === 1) p = v + a;
      else if (filter === 2) p = v + b;
      else if (filter === 3) p = v + ((a + b) >> 1);
      else {
        const q = a + b - c;
        const pa = Math.abs(q - a);
        const pb = Math.abs(q - b);
        const pc = Math.abs(q - c);
        p = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[i] = p & 0xff;
    }
    rows.push(out);
  }
  return Array.from(rows[y]!.subarray(x * bpp, x * bpp + 3));
}

const RED = solidPng(100, 100, [255, 0, 0]);
const GREEN = solidPng(100, 100, [0, 200, 0]);

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>override</title>
<style>html,body{margin:0;background:#fff} img{display:block;width:100px;height:100px}
#hero{position:absolute;left:20px;top:20px} picture img{position:absolute;left:200px;top:20px}</style>
</head><body>
<img id="hero" data-ui-bridge-image-slot="hero" src="/orig.png" alt="hero">
<picture data-ui-bridge-image-slot="pic"><source type="image/png" srcset="/orig.png"><img src="/orig.png" alt="pic"></picture>
</body></html>`;

const LAZY_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>lazy</title>
<style>html,body{margin:0;background:#fff} img{display:block;width:100px;height:100px}
#far{position:absolute;left:20px;top:6000px} #bg{width:100px;height:100px}</style>
</head><body>
<div id="bg" data-ui-bridge-image-slot="bg" style="background-image: url(/orig.png)"></div>
<img id="far" data-ui-bridge-image-slot="far" src="/orig.png" loading="lazy" alt="far">
</body></html>`;

const DENSE_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>dense</title>
<style>html,body{margin:0;background:#fff} img{display:block;width:100px;height:100px}</style>
</head><body>
<img data-ui-bridge-image-slot="dense" src="/orig.png" srcset="/orig.png 200w" sizes="100px" alt="dense">
</body></html>`;

let server: Server;
let url: string;
let dir: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith('/orig.png')) {
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      res.end(RED);
    } else if (req.url?.startsWith('/cand.png')) {
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      res.end(GREEN);
    } else {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        req.url?.startsWith('/dense') ? DENSE_PAGE : req.url?.startsWith('/lazy') ? LAZY_PAGE : PAGE
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  dir = mkdtempSync(join(tmpdir(), 'inject-override-smoke-'));
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!PLAYWRIGHT_AVAILABLE)('in-situ asset override (real Chromium)', () => {
  it('swaps, is seen in the frame, survives a throttled timeline, and restores exactly', async () => {
    const args = parseArgs([
      '--url',
      url,
      '--viewport',
      '400x200',
      '--throttle',
      'latency=600,down=20000,up=20000',
      '--no-cache',
      '--exec',
      'getControlSnapshot {}',
      '--quiet',
    ]);
    const transport = createTransport({ kind: 'injected', options: buildTransportOptions(args) });
    let network: unknown = null;
    registerFrameCapture(transport);
    registerNetworkEmulation(transport, args);
    registerTimelineCapture(transport, () => network);
    transport.register('__dom', (_p: unknown, ctx: unknown) =>
      (ctx as { page: { evaluate<R>(fn: () => R): Promise<R> } }).page.evaluate(
        () => document.body.innerHTML
      )
    );

    const lines: ExecLine[] = [];
    let swapMs = 0;
    let domBefore: string | undefined;
    let domAfter: string | undefined;
    try {
      await transport.ready();
      network = await transport.dispatch(APPLY_NETWORK_ACTION);
      expect(network).toMatchObject({ applied: true, latencyMs: 600, cacheDisabled: true });
      domBefore = (await transport.dispatch('__dom')) as string;

      const plan = [
        { action: 'mediaOverride', payload: { slotId: 'hero', src: `${url}cand.png` } },
        // The <picture> candidate ARRIVES while the timeline records it.
        {
          action: 'captureTimeline',
          payload: {
            dir: join(dir, 'tl'),
            frames: 8,
            intervalMs: 150,
            during: { action: 'mediaOverride', payload: { slotId: 'pic', src: `${url}cand.png` } },
          },
        },
        { action: 'getControlSnapshot', payload: {} },
        { action: 'mediaOverrideRestore', payload: {} },
        { action: 'mediaOverrideList', payload: {} },
      ];
      const started = Date.now();
      const anyError = await executeActions(
        transport,
        plan,
        (position, action) =>
          SNAPSHOT_ACTIONS.has(action) ? join(dir, `frame-${position}.png`) : null,
        (line, position) => {
          if (position === 1) swapMs = Date.now() - started;
          lines.push(line);
        }
      );
      expect(anyError, JSON.stringify(lines.filter((l) => l.error))).toBe(false);
      domAfter = (await transport.dispatch('__dom')) as string;
    } finally {
      await transport.close().catch(() => {});
    }

    const [hero, timeline, snap, restore, list] = lines;
    // 1. Ready only once decoded, with the page's own currentSrc.
    expect(hero!.result).toMatchObject({
      success: true,
      ready: { decoded: true, currentSrc: `${url}cand.png`, naturalWidth: 100 },
      originals: { 'img.src': '/orig.png' },
    });
    // The throttle is real: the candidate cannot arrive faster than its latency.
    expect(swapMs).toBeGreaterThanOrEqual(600);
    // 2. The timeline recorded the <picture> candidate ARRIVING over the
    //    throttled network: the original (red) first, the candidate (green)
    //    last, and the override itself answered only once decoded — inside
    //    <picture>, beating the original <source>.
    const tl = timeline!.result as {
      success: boolean;
      network: { latencyMs: number };
      frames: { offsetMs: number; path: string }[];
      during: { result: unknown; answeredAtMs: number; failed: boolean };
    };
    expect(tl).toMatchObject({ success: true, network: { latencyMs: 600 } });
    expect(tl.during.failed).toBe(false);
    expect(tl.during.result).toMatchObject({
      success: true,
      target: { inPicture: true },
      ready: { currentSrc: `${url}cand.png` },
    });
    expect(tl.during.answeredAtMs).toBeGreaterThanOrEqual(600);
    expect(tl.frames.map((f) => f.offsetMs)).toEqual(
      [...tl.frames.map((f) => f.offsetMs)].sort((a, b) => a - b)
    );
    expect(pixel(readFileSync(tl.frames[0]!.path), 250, 70)).toEqual([255, 0, 0]);
    expect(pixel(readFileSync(tl.frames.at(-1)!.path), 250, 70)).toEqual([0, 200, 0]);
    // 3. The settled frame shows the candidate (green) where both originals were red.
    const frame = readFileSync(snap!.frame!.path);
    expect(pixel(frame, 70, 70)).toEqual([0, 200, 0]);
    expect(pixel(frame, 250, 70)).toEqual([0, 200, 0]);
    // 5. Restored, verified against the rendered page, nothing left active,
    //    and the DOM is the DOM it was.
    const restored = (restore!.result as { restored: { verified: boolean; status: string }[] })
      .restored;
    expect(restored).toHaveLength(2);
    expect(restored.every((r) => r.verified && r.status === 'restored')).toBe(true);
    expect(list!.result).toMatchObject({ success: true, active: [] });
    expect(domAfter).toBe(domBefore);
  }, 60_000);

  it('reports the candidate in pixels, never scaled by the slot’s previous srcset density', async () => {
    // The slot's ORIGINAL selection has density 2 (a 200w source in a 100px
    // slot). Chromium keeps that density on the element after a src-only
    // swap, so the slot's own naturalWidth reads the 100px candidate as 50 —
    // a resolution judgment built on it would be off by the old density.
    const args = parseArgs([
      '--url',
      `${url}dense`,
      '--viewport',
      '400x200',
      '--exec',
      'getControlSnapshot {}',
      '--quiet',
    ]);
    const transport = createTransport({ kind: 'injected', options: buildTransportOptions(args) });
    const lines: ExecLine[] = [];
    try {
      await transport.ready();
      const anyError = await executeActions(
        transport,
        [
          { action: 'mediaOverride', payload: { slotId: 'dense', src: `${url}cand.png` } },
          { action: 'mediaOverrideRestore', payload: {} },
        ],
        () => null,
        (line) => lines.push(line)
      );
      expect(anyError, JSON.stringify(lines.filter((l) => l.error))).toBe(false);
    } finally {
      await transport.close().catch(() => {});
    }
    expect(lines[0]!.result).toMatchObject({
      success: true,
      applied: { 'img.src': `${url}cand.png`, 'img.srcset': null, 'img.sizes': null },
      ready: { currentSrc: `${url}cand.png`, naturalWidth: 100, naturalHeight: 100 },
    });
  }, 60_000);

  it('an offscreen lazy slot decodes the candidate and gets lazy back; a background keeps the app’s inline style', async () => {
    const args = parseArgs([
      '--url',
      `${url}lazy`,
      '--viewport',
      '400x200',
      '--exec',
      'getControlSnapshot {}',
      '--quiet',
    ]);
    const transport = createTransport({ kind: 'injected', options: buildTransportOptions(args) });
    type Page = { evaluate<R, A>(fn: (a: A) => R, arg: A): Promise<R> };
    transport.register('__eval', (p: unknown, ctx: unknown) =>
      (ctx as { page: Page }).page.evaluate(
        (what: string) => {
          const far = document.getElementById('far') as HTMLImageElement;
          const bg = document.getElementById('bg') as HTMLElement;
          if (what === 'state') {
            return {
              loading: far.getAttribute('loading'),
              currentSrc: far.currentSrc,
              opacity: bg.style.getPropertyValue('opacity'),
              bgImage: getComputedStyle(bg).backgroundImage,
            };
          }
          bg.style.setProperty('opacity', '0.5');
          return null;
        },
        (p as { what: string }).what
      )
    );
    const lines: ExecLine[] = [];
    let during: unknown;
    let after: unknown;
    try {
      await transport.ready();
      const run = async (action: string, payload: unknown): Promise<void> => {
        const anyError = await executeActions(
          transport,
          [{ action, payload }],
          () => null,
          (line) => lines.push(line)
        );
        expect(anyError, JSON.stringify(lines.filter((l) => l.error))).toBe(false);
      };
      await run('mediaOverride', { slotId: 'far', src: `${url}cand.png`, decodeTimeoutMs: 5000 });
      await run('mediaOverride', { slotId: 'bg', backgroundImage: `${url}cand.png` });
      during = await transport.dispatch('__eval', { what: 'state' });
      // The app writes an inline style while the override is up.
      await transport.dispatch('__eval', { what: 'app-write' });
      await run('mediaOverrideRestore', {});
      after = await transport.dispatch('__eval', { what: 'state' });
    } finally {
      await transport.close().catch(() => {});
    }
    expect(lines[0]!.result).toMatchObject({
      success: true,
      applied: { 'img.loading': 'eager' },
      originals: { 'img.loading': 'lazy' },
      ready: { currentSrc: `${url}cand.png`, naturalWidth: 100 },
    });
    expect(lines[1]!.result).toMatchObject({ success: true, mode: 'background' });
    expect(during).toMatchObject({ loading: 'eager', currentSrc: `${url}cand.png` });
    expect((during as { bgImage: string }).bgImage).toContain('cand.png');
    const restored = (lines[2]!.result as { restored: { verified: boolean; status: string }[] })
      .restored;
    expect(restored).toHaveLength(2);
    expect(restored.every((r) => r.verified && r.status === 'restored')).toBe(true);
    expect(after).toMatchObject({ loading: 'lazy', currentSrc: `${url}orig.png`, opacity: '0.5' });
    expect((after as { bgImage: string }).bgImage).toContain('orig.png');
    expect((after as { bgImage: string }).bgImage).not.toContain('cand.png');
  }, 60_000);
});
