/**
 * The lockstep frame capture, against a fake page — no browser.
 *
 * Each case pins one arm of `captureFrameInLockstep`: a verified pair, a retry
 * that settles, a pair that never settles (returned, but `verified: false`), an
 * element list that cannot be compared (UNKNOWN, not a pass), a screenshot that
 * fails (the snapshot still stands), a frame whose size disagrees with the
 * page's own DPR, and a write that fails. The real-Chromium half is
 * `inject-cli-frame-smoke.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  existsSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  captureFrameInLockstep,
  expandFramePath,
  frameTokenInDirectory,
  frameTokenInFileName,
  geometryDelta,
  pngDimensions,
  snapshotGeometry,
  type FramePage,
  type PageMetrics,
} from '../src/frame-capture.js';

/** A PNG header only — signature, IHDR length, `IHDR`, width, height. Enough for the size read. */
function pngHeader(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(33);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(buf.buffer);
  view.setUint32(8, 13);
  buf.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  view.setUint32(16, width);
  view.setUint32(20, height);
  return buf;
}

const snap = (boxes: Record<string, [number, number, number, number]>) => ({
  timestamp: Math.random(), // varies on every call; must not affect the comparison
  elements: Object.entries(boxes).map(([id, [x, y, width, height]]) => ({
    id,
    bbox: { x, y, width, height },
    visible: true,
  })),
});

/** A fake page whose metrics and screenshot are fixed, recording every screenshot call. */
function fakePage(metrics: PageMetrics, png: Uint8Array | Error): FramePage & { shots: number } {
  const page = {
    shots: 0,
    async evaluate<R>(): Promise<R> {
      return metrics as unknown as R;
    },
    async screenshot(): Promise<Uint8Array> {
      page.shots += 1;
      if (png instanceof Error) throw png;
      return png;
    },
  };
  return page;
}

const DPR2: PageMetrics = {
  devicePixelRatio: 2,
  innerWidth: 400,
  innerHeight: 300,
  colorScheme: 'dark',
};
const FIXED_NOW = () => new Date('2026-10-13T12:00:00.000Z');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'frame-capture-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('pngDimensions', () => {
  it('reads width and height from the IHDR chunk', () => {
    expect(pngDimensions(pngHeader(800, 600))).toEqual({ width: 800, height: 600 });
  });

  it('refuses bytes that are not a PNG', () => {
    expect(() => pngDimensions(new TextEncoder().encode('GIF89a-not-a-png-at-all!!'))).toThrow(
      /not a PNG/
    );
  });

  it('refuses a PNG whose first chunk is not IHDR', () => {
    const buf = pngHeader(1, 1);
    buf.set([0x49, 0x44, 0x41, 0x54], 12); // IDAT where IHDR belongs
    expect(() => pngDimensions(buf)).toThrow(/IHDR/);
  });
});

describe('expandFramePath', () => {
  it('replaces every {n} in the FILE NAME with the action position', () => {
    expect(expandFramePath('/tmp/f-{n}.png', 3)).toBe('/tmp/f-3.png');
    expect(expandFramePath('/tmp/f-{n}-{n}.png', 12)).toBe('/tmp/f-12-12.png');
    expect(expandFramePath('f-{n}.png', 4)).toBe('f-4.png');
  });

  it('leaves a {n} in a directory name alone (validateFramePlan refuses such a template)', () => {
    expect(expandFramePath('/tmp/{n}/f-{n}.png', 12)).toBe('/tmp/{n}/f-12.png');
    expect(expandFramePath('C:\\shots\\{n}\\f-{n}.png', 2)).toBe('C:\\shots\\{n}\\f-2.png');
    expect(frameTokenInDirectory('/tmp/{n}/f.png')).toBe(true);
    expect(frameTokenInDirectory('C:\\shots\\{n}\\f.png')).toBe(true);
    expect(frameTokenInDirectory('/tmp/f-{n}.png')).toBe(false);
    expect(frameTokenInFileName('/tmp/{n}/f.png')).toBe(false);
    expect(frameTokenInFileName('/tmp/f-{n}.png')).toBe(true);
  });

  it('leaves a path without {n} unchanged', () => {
    expect(expandFramePath('/tmp/frame.png', 1)).toBe('/tmp/frame.png');
  });
});

describe('snapshotGeometry / geometryDelta', () => {
  it('keys each element by id on its box and visibility, ignoring snapshot timestamps', () => {
    const a = snapshotGeometry(snap({ a: [0, 0, 10, 10], b: [10, 0, 10, 10] }));
    const b = snapshotGeometry(snap({ a: [0, 0, 10, 10], b: [10, 0, 10, 10] }));
    expect(a?.size).toBe(2);
    expect(geometryDelta(a, b)).toBe(0);
  });

  it('reads a {data:{elements}} envelope', () => {
    expect(snapshotGeometry({ data: snap({ a: [1, 2, 3, 4] }) })?.get('a')).toBe('1,2,3,4|true');
  });

  it('counts a moved box, an added id and a removed id', () => {
    const before = snapshotGeometry(
      snap({ a: [0, 0, 10, 10], b: [10, 0, 10, 10], c: [0, 9, 1, 1] })
    );
    const after = snapshotGeometry(
      snap({ a: [0, 5, 10, 10], b: [10, 0, 10, 10], d: [3, 3, 3, 3] })
    );
    // a moved, c removed, d added.
    expect(geometryDelta(before, after)).toBe(3);
  });

  it('answers null — UNKNOWN — when either side carries no element list', () => {
    expect(snapshotGeometry({ notElements: [] })).toBeNull();
    expect(geometryDelta(null, snapshotGeometry(snap({ a: [0, 0, 1, 1] })))).toBeNull();
  });
});

describe('captureFrameInLockstep', () => {
  it('pairs a stable snapshot with its frame: verified on the first round, every field read off the page and PNG', async () => {
    const page = fakePage(DPR2, pngHeader(800, 600));
    const stable = snap({ hero: [10, 20, 100, 50] });
    let snapshots = 0;
    const out = await captureFrameInLockstep({
      page,
      takeSnapshot: async () => {
        snapshots += 1;
        return stable;
      },
      path: join(dir, 'sub', 'frame.png'),
      now: FIXED_NOW,
    });

    expect(out.frameError).toBeUndefined();
    expect(out.snapshot).toBe(stable);
    expect(out.frame).toEqual({
      path: join(dir, 'sub', 'frame.png'),
      format: 'png',
      width: 800,
      height: 600,
      devicePixelRatio: 2,
      cssViewport: { width: 400, height: 300 },
      colorScheme: 'dark',
      capturedAt: '2026-10-13T12:00:00.000Z',
      lockstep: { verified: true, attempts: 1, changedElements: 0 },
    });
    // Snapshot BEFORE and AFTER the one frame.
    expect(snapshots).toBe(2);
    expect(page.shots).toBe(1);
    // The parent directory is created and the PNG bytes are written verbatim.
    expect(Array.from(readFileSync(join(dir, 'sub', 'frame.png')))).toEqual(
      Array.from(pngHeader(800, 600))
    );
  });

  it('retries a round whose layout moved and verifies the next one', async () => {
    const page = fakePage(DPR2, pngHeader(800, 600));
    const seq = [
      snap({ a: [0, 0, 10, 10] }), // round 1 before
      snap({ a: [0, 40, 10, 10] }), // round 1 after — moved
      snap({ a: [0, 40, 10, 10] }), // round 2 before
      snap({ a: [0, 40, 10, 10] }), // round 2 after — settled
    ];
    let i = 0;
    const out = await captureFrameInLockstep({
      page,
      takeSnapshot: async () => seq[i++],
      path: join(dir, 'f.png'),
    });
    expect(out.frame?.lockstep).toEqual({ verified: true, attempts: 2, changedElements: 0 });
    expect(out.snapshot).toBe(seq[2]);
    expect(page.shots).toBe(2);
  });

  it('returns a pair that never settles as verified:false with the moved-element count — never as a clean pairing', async () => {
    const page = fakePage(DPR2, pngHeader(800, 600));
    let y = 0;
    const out = await captureFrameInLockstep({
      page,
      takeSnapshot: async () => snap({ spinner: [0, (y += 7), 10, 10], still: [50, 50, 5, 5] }),
      path: join(dir, 'f.png'),
      maxAttempts: 3,
    });
    expect(out.frame?.lockstep).toEqual({ verified: false, attempts: 3, changedElements: 1 });
    expect(page.shots).toBe(3);
    expect(existsSync(join(dir, 'f.png'))).toBe(true);
  });

  it('cannot verify a snapshot with no element list: changedElements null, no pointless retries', async () => {
    const page = fakePage(DPR2, pngHeader(800, 600));
    const out = await captureFrameInLockstep({
      page,
      takeSnapshot: async () => ({ success: true }),
      path: join(dir, 'f.png'),
    });
    expect(out.frame?.lockstep).toEqual({ verified: false, attempts: 1, changedElements: null });
    expect(page.shots).toBe(1);
  });

  it('keeps the snapshot and reports FRAME_CAPTURE_FAILED when the screenshot throws', async () => {
    const stable = snap({ a: [0, 0, 1, 1] });
    const out = await captureFrameInLockstep({
      page: fakePage(DPR2, new Error('Target closed')),
      takeSnapshot: async () => stable,
      path: join(dir, 'f.png'),
    });
    expect(out.snapshot).toBe(stable);
    expect(out.frame).toBeNull();
    expect(out.frameError?.code).toBe('FRAME_CAPTURE_FAILED');
    expect(out.frameError?.message).toMatch(/Target closed/);
    expect(existsSync(join(dir, 'f.png'))).toBe(false);
  });

  it('refuses a frame whose size disagrees with the page DPR (FRAME_SCALE_MISMATCH) and writes nothing', async () => {
    // A CSS-scale screenshot of a DPR-2 page: 400x300 where 800x600 was due.
    const out = await captureFrameInLockstep({
      page: fakePage(DPR2, pngHeader(400, 300)),
      takeSnapshot: async () => snap({ a: [0, 0, 1, 1] }),
      path: join(dir, 'f.png'),
    });
    expect(out.frame).toBeNull();
    expect(out.frameError?.code).toBe('FRAME_SCALE_MISMATCH');
    expect(existsSync(join(dir, 'f.png'))).toBe(false);
  });

  it('accepts Chromium rounding a fractional DPR product', async () => {
    // 390 x 2.625 = 1023.75; Chromium emits 1024.
    const out = await captureFrameInLockstep({
      page: fakePage(
        { devicePixelRatio: 2.625, innerWidth: 390, innerHeight: 844, colorScheme: 'light' },
        pngHeader(1024, 2216)
      ),
      takeSnapshot: async () => snap({ a: [0, 0, 1, 1] }),
      path: join(dir, 'f.png'),
    });
    expect(out.frameError).toBeUndefined();
    expect(out.frame?.devicePixelRatio).toBe(2.625);
  });

  // Frames are raw pixels of possibly authenticated pages: owner-only on disk.
  it.skipIf(process.platform === 'win32')(
    'writes the frame 0600, in directories it creates 0700',
    async () => {
      const out = await captureFrameInLockstep({
        page: fakePage(DPR2, pngHeader(800, 600)),
        takeSnapshot: async () => snap({ a: [0, 0, 1, 1] }),
        path: join(dir, 'made', 'here', 'frame.png'),
      });
      expect(out.frameError).toBeUndefined();
      const mode = (p: string) => statSync(p).mode & 0o777;
      expect(mode(join(dir, 'made'))).toBe(0o700);
      expect(mode(join(dir, 'made', 'here'))).toBe(0o700);
      expect(mode(join(dir, 'made', 'here', 'frame.png'))).toBe(0o600);
    }
  );

  it.skipIf(process.platform === 'win32')(
    'narrows an existing file it overwrites to 0600',
    async () => {
      const path = join(dir, 'frame.png');
      writeFileSync(path, 'old');
      chmodSync(path, 0o644);
      await captureFrameInLockstep({
        page: fakePage(DPR2, pngHeader(800, 600)),
        takeSnapshot: async () => snap({ a: [0, 0, 1, 1] }),
        path,
      });
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
  );

  it('reports a write failure as FRAME_CAPTURE_FAILED', async () => {
    const blocker = join(dir, 'not-a-dir');
    writeFileSync(blocker, 'x');
    const out = await captureFrameInLockstep({
      page: fakePage(DPR2, pngHeader(800, 600)),
      takeSnapshot: async () => snap({ a: [0, 0, 1, 1] }),
      path: join(blocker, 'f.png'), // parent is a FILE
    });
    expect(out.frame).toBeNull();
    expect(out.frameError?.code).toBe('FRAME_CAPTURE_FAILED');
    expect(out.frameError?.message).toMatch(/could not write/);
  });

  it('propagates a snapshot failure: no snapshot means no capture at all', async () => {
    await expect(
      captureFrameInLockstep({
        page: fakePage(DPR2, pngHeader(800, 600)),
        takeSnapshot: async () => {
          throw new Error('runtime gone');
        },
        path: join(dir, 'f.png'),
      })
    ).rejects.toThrow(/runtime gone/);
  });
});
