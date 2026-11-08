/**
 * Phase 18 step 3 (plan 2026-10-13-image-generation-and-visual-judgment):
 * inject-cli's `--throttle` / `--no-cache` flags and the `captureTimeline`
 * CLI-side action, pinned without a browser. The real-Chromium half is
 * `inject-cli-override-smoke.test.ts`, and for the reload frame-1 retry (D4 of
 * plan 2026-11-08-ui-bridge-inject-exec-mode-is-a-second-class-driver)
 * `inject-cli-timeline-reload-smoke.test.ts`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  APPLY_NETWORK_ACTION,
  InjectCliArgError,
  USAGE,
  parseArgs,
  registerNetworkEmulation,
  validateWaitActions,
} from '../src/inject-cli.js';
import {
  NETWORK_PRESETS,
  applyNetworkEmulation,
  cdpConditions,
  parseThrottle,
} from '../src/network-throttle.js';
import {
  CAPTURE_TIMELINE_ACTION,
  captureTimeline,
  parseCaptureTimelinePayload,
  registerTimelineCapture,
  type TimelinePage,
  type TimelineResult,
} from '../src/timeline-capture.js';
import { HandlerRegistry } from '../src/handler-registry.js';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'inject-timeline-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

// A 2x1 PNG: signature + IHDR (width 2, height 1). Enough for pngDimensions.
function png(width: number, height: number): Uint8Array {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return new Uint8Array(buf);
}

describe('--throttle grammar', () => {
  it('accepts the presets with DevTools numbers', () => {
    expect(parseThrottle('slow-3g')).toEqual(NETWORK_PRESETS['slow-3g']);
    expect(parseThrottle('fast-3g')).toMatchObject({ latencyMs: 563, downloadKbps: 1475 });
  });

  it('accepts a full custom profile', () => {
    expect(parseThrottle('latency=300,down=800,up=200')).toEqual({
      name: 'custom',
      latencyMs: 300,
      downloadKbps: 800,
      uploadKbps: 200,
    });
  });

  it.each([
    ['3g', 'expects slow-3g'],
    ['latency=300,down=800', 'missing up'],
    ['latency=300,down=0,up=1', 'down must be an integer'],
    ['latency=x,down=1,up=1', 'latency must be an integer'],
    ['latency=1,down=1,up=1,jitter=2', 'unknown key'],
    ['latency=1,latency=2,down=1,up=1', 'lists latency twice'],
  ])('rejects %s', (raw, msg) => {
    expect(() => parseThrottle(raw)).toThrow(InjectCliArgError);
    expect(() => parseThrottle(raw)).toThrow(msg);
  });

  it('CDP wants BYTES per second, not kilobits', () => {
    expect(cdpConditions(parseThrottle('latency=100,down=800,up=80'))).toEqual({
      offline: false,
      latency: 100,
      downloadThroughput: 100_000,
      uploadThroughput: 10_000,
    });
  });

  it('parseArgs wires --throttle and --no-cache, and refuses a missing or repeated profile', () => {
    const a = parseArgs([
      '--url',
      'http://x/',
      '--exec',
      'find {}',
      '--throttle',
      'slow-3g',
      '--no-cache',
    ]);
    expect(a.throttle?.name).toBe('slow-3g');
    expect(a.noCache).toBe(true);
    expect(() => parseArgs(['--url', 'http://x/', '--exec', 'find {}', '--throttle'])).toThrow(
      'expects a profile'
    );
    expect(() =>
      parseArgs([
        '--url',
        'http://x/',
        '--exec',
        'find {}',
        '--throttle',
        'slow-3g',
        '--throttle',
        'fast-3g',
      ])
    ).toThrow('given twice');
  });

  it('the help names both flags and the timeline action', () => {
    for (const token of [
      '--throttle',
      '--no-cache',
      'captureTimeline',
      'mediaOverride',
      'mediaOverrideRestore',
    ]) {
      expect(USAGE).toContain(token);
    }
  });
});

describe('network emulation is applied through CDP, and only what was sent is stamped', () => {
  function fakePage() {
    const sent: Array<[string, unknown]> = [];
    const page = {
      context: () => ({
        newCDPSession: async () => ({
          send: async (method: string, params?: Record<string, unknown>) => {
            sent.push([method, params]);
            return {};
          },
        }),
      }),
    };
    return { page, sent };
  }

  it('throttle + no-cache sends enable, cache-off and the conditions', async () => {
    const { page, sent } = fakePage();
    const res = await applyNetworkEmulation(page, parseThrottle('slow-3g'), true);
    expect(sent.map(([m]) => m)).toEqual([
      'Network.enable',
      'Network.setCacheDisabled',
      'Network.emulateNetworkConditions',
    ]);
    expect(res).toMatchObject({ name: 'slow-3g', applied: true, cacheDisabled: true });
  });

  it('nothing asked for sends nothing and stamps null', async () => {
    const { page, sent } = fakePage();
    expect(await applyNetworkEmulation(page, null, false)).toBeNull();
    expect(sent).toEqual([]);
  });

  it('a CDP refusal is a thrown error, never a silently unthrottled run', async () => {
    const page = {
      context: () => ({
        newCDPSession: async () => ({
          send: async () => {
            throw new Error('Network.emulateNetworkConditions: not supported');
          },
        }),
      }),
    };
    await expect(applyNetworkEmulation(page, parseThrottle('slow-3g'), false)).rejects.toThrow(
      'not supported'
    );
  });

  it('registers under a private id that reads the transport page', async () => {
    const { page, sent } = fakePage();
    const registry = new HandlerRegistry();
    registerNetworkEmulation(registry, { throttle: parseThrottle('fast-3g'), noCache: false });
    const res = await registry.dispatch(APPLY_NETWORK_ACTION, undefined, { page } as never);
    expect(res).toMatchObject({ name: 'fast-3g', applied: true, cacheDisabled: false });
    expect(sent.at(-1)![0]).toBe('Network.emulateNetworkConditions');
  });
});

// Chromium's own words when the document has no compositor frame yet, as
// Playwright relays them — measured on frame 1 right after a reload commit.
const REFUSAL =
  'page.screenshot: Protocol error (Page.captureScreenshot): Unable to capture screenshot';

describe('captureTimeline', () => {
  /**
   * A fake page. `failFrame` and `refuse` count SCREENSHOT CALLS, not frames:
   * call `failFrame` throws `Target closed`, and `refuse: n` makes n consecutive
   * calls, from call `refuseFromShot` (default 1), throw {@link REFUSAL}.
   */
  function timelinePage(
    opts: { failFrame?: number; settles?: boolean; refuse?: number; refuseFromShot?: number } = {}
  ) {
    let shots = 0;
    const calls: string[] = [];
    const refuseFrom = opts.refuseFromShot ?? 1;
    const page: TimelinePage = {
      evaluate: (async () => ({
        devicePixelRatio: 2,
        innerWidth: 400,
        innerHeight: 300,
        colorScheme: 'light',
      })) as TimelinePage['evaluate'],
      screenshot: async () => {
        shots += 1;
        calls.push(`shot${shots}`);
        if (shots === opts.failFrame) throw new Error('Target closed');
        if (shots >= refuseFrom && shots < refuseFrom + (opts.refuse ?? 0)) {
          throw new Error(REFUSAL);
        }
        return png(800, 600);
      },
      reload: async () => {
        calls.push('reload');
      },
      waitForFunction: async () => {
        calls.push('waitReady');
        if (opts.settles === false) throw new Error('Timeout 10ms exceeded');
      },
    };
    return { page, calls };
  }

  it('grammar: dir, frames and intervalMs are required and bounded', () => {
    expect(parseCaptureTimelinePayload({ dir: 'd', frames: 3, intervalMs: 0 })).toEqual({
      dir: 'd',
      frames: 3,
      intervalMs: 0,
      reload: false,
      readyTimeoutMs: 30_000,
      during: null,
    });
    expect(() => parseCaptureTimelinePayload({ frames: 3, intervalMs: 0 })).toThrow("'dir'");
    expect(() => parseCaptureTimelinePayload({ dir: 'd', frames: 0, intervalMs: 0 })).toThrow(
      'frames'
    );
    expect(() => parseCaptureTimelinePayload({ dir: 'd', frames: 121, intervalMs: 0 })).toThrow(
      'frames'
    );
    expect(() => parseCaptureTimelinePayload({ dir: 'd', frames: 2, intervalMs: 10_001 })).toThrow(
      'intervalMs'
    );
    expect(() =>
      parseCaptureTimelinePayload({ dir: 'd', frames: 2, intervalMs: 1, reload: 'yes' })
    ).toThrow('reload');
    // Validated before any browser launches, like the waits.
    expect(() =>
      validateWaitActions([{ action: CAPTURE_TIMELINE_ACTION, payload: { dir: 'd' } }])
    ).toThrow(InjectCliArgError);
  });

  it('writes one private PNG per frame with measured size and a monotonic offset', async () => {
    const dir = join(tmp(), 'tl');
    const { page, calls } = timelinePage();
    let t = 1000;
    const res = await captureTimeline(
      page,
      { dir, frames: 3, intervalMs: 0, reload: false, readyTimeoutMs: 100 },
      () => (t += 5)
    );
    expect(res.success).toBe(true);
    expect(calls).toEqual(['shot1', 'shot2', 'shot3']);
    expect(res.frames.map((f) => [f.index, f.width, f.height])).toEqual([
      [1, 800, 600],
      [2, 800, 600],
      [3, 800, 600],
    ]);
    const offsets = res.frames.map((f) => f.offsetMs);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
    for (const f of res.frames) {
      expect(readFileSync(f.path!).length).toBe(33);
      expect(statSync(f.path!).mode & 0o777).toBe(0o600);
    }
    expect(res).toMatchObject({
      devicePixelRatio: 2,
      cssViewport: { width: 400, height: 300 },
      runtimeReady: null,
    });
  });

  it('reload: starts at the commit and waits for the runtime to settle again', async () => {
    const { page, calls } = timelinePage();
    const res = await captureTimeline(page, {
      dir: join(tmp(), 'tl'),
      frames: 2,
      intervalMs: 0,
      reload: true,
      readyTimeoutMs: 100,
    });
    expect(calls).toEqual(['reload', 'shot1', 'shot2', 'waitReady']);
    expect(res).toMatchObject({ success: true, reloaded: true, runtimeReady: true });
  });

  it('a frame that cannot be taken fails the step, never closes the gap silently', async () => {
    const { page } = timelinePage({ failFrame: 2 });
    const res = await captureTimeline(page, {
      dir: join(tmp(), 'tl'),
      frames: 3,
      intervalMs: 0,
      reload: false,
      readyTimeoutMs: 100,
    });
    expect(res.success).toBe(false);
    expect(res.frames[1]).toMatchObject({ index: 2, path: null, error: 'Target closed' });
    expect(res.error).toBe('1 of 3 frames failed');
  });

  it('a runtime that never comes back after a reload fails the step', async () => {
    const { page } = timelinePage({ settles: false });
    const res = await captureTimeline(page, {
      dir: join(tmp(), 'tl'),
      frames: 1,
      intervalMs: 0,
      reload: true,
      readyTimeoutMs: 10,
    });
    expect(res).toMatchObject({ success: false, runtimeReady: false });
    expect(res.error).toContain('did not settle');
  });

  it('refuses a non-empty directory instead of mixing runs', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'tl'));
    writeFileSync(join(dir, 'tl', 'old.png'), 'x');
    const { page } = timelinePage();
    await expect(
      captureTimeline(page, {
        dir: join(dir, 'tl'),
        frames: 1,
        intervalMs: 0,
        reload: false,
        readyTimeoutMs: 1,
      })
    ).rejects.toThrow('not empty');
  });

  it('stamps the network emulation, and a relative dir lands under the cell dir in the matrix', async () => {
    const base = tmp();
    const { page } = timelinePage();
    const registry = new HandlerRegistry();
    registerTimelineCapture(registry, () => ({ name: 'slow-3g', applied: true }), base);
    const res = (await registry.dispatch(
      CAPTURE_TIMELINE_ACTION,
      { dir: 'tl', frames: 1, intervalMs: 0 },
      { page } as never
    )) as { dir: string; network: unknown };
    expect(res.dir).toBe(join(base, 'tl'));
    expect(res.network).toEqual({ name: 'slow-3g', applied: true });
  });

  it("grammar: 'during' takes one in-page action and never combines with reload", () => {
    expect(
      parseCaptureTimelinePayload({
        dir: 'd',
        frames: 2,
        intervalMs: 0,
        during: { action: 'mediaOverride', payload: { slotId: 'hero', src: '/c.png' } },
      }).during
    ).toEqual({ action: 'mediaOverride', payload: { slotId: 'hero', src: '/c.png' } });
    for (const during of [null, 'x', { payload: {} }, { action: '' }]) {
      expect(() =>
        parseCaptureTimelinePayload({ dir: 'd', frames: 1, intervalMs: 0, during })
      ).toThrow("'during' must be");
    }
    for (const action of ['captureTimeline', '__inject_cli_capture_frame']) {
      expect(() =>
        parseCaptureTimelinePayload({ dir: 'd', frames: 1, intervalMs: 0, during: { action } })
      ).toThrow('in-page action');
    }
    expect(() =>
      parseCaptureTimelinePayload({
        dir: 'd',
        frames: 1,
        intervalMs: 0,
        reload: true,
        during: { action: 'mediaOverride' },
      })
    ).toThrow("cannot combine 'during' with 'reload'");
  });

  it('runs the during action concurrently and carries its own result', async () => {
    const { page, calls } = timelinePage();
    const seen: Array<[string, unknown]> = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const execute = async (action: string, payload: unknown) => {
      seen.push([action, payload]);
      calls.push('during-start');
      await gate;
      return { success: true, overrideId: 'mo-1' };
    };
    const p = captureTimeline(
      page,
      {
        dir: join(tmp(), 'tl'),
        frames: 2,
        intervalMs: 0,
        reload: false,
        readyTimeoutMs: 1,
        during: { action: 'mediaOverride', payload: { slotId: 'hero' } },
      },
      Date.now,
      execute
    );
    // Frames are taken while the action is still pending.
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual(['during-start', 'shot1', 'shot2']);
    release();
    const res = await p;
    expect(seen).toEqual([['mediaOverride', { slotId: 'hero' }]]);
    expect(res.success).toBe(true);
    expect(res.during).toMatchObject({
      action: 'mediaOverride',
      failed: false,
      result: { overrideId: 'mo-1' },
    });
  });

  it('a during action that fails (returned or thrown) fails the step', async () => {
    for (const execute of [
      async () => ({ success: false, code: 'DECODE_FAILED' }),
      async () => {
        throw new Error('boom');
      },
    ]) {
      const { page } = timelinePage();
      const res = await captureTimeline(
        page,
        {
          dir: join(tmp(), 'tl'),
          frames: 1,
          intervalMs: 0,
          reload: false,
          readyTimeoutMs: 1,
          during: { action: 'mediaOverride', payload: {} },
        },
        Date.now,
        execute
      );
      expect(res.success).toBe(false);
      expect(res.during?.failed).toBe(true);
      expect(res.error).toBe('the concurrent mediaOverride failed');
    }
  });

  it('honours intervalMs between frames', async () => {
    vi.useFakeTimers();
    try {
      const { page } = timelinePage();
      const p = captureTimeline(page, {
        dir: join(tmp(), 'tl'),
        frames: 3,
        intervalMs: 100,
        reload: false,
        readyTimeoutMs: 1,
      });
      await vi.advanceTimersByTimeAsync(250);
      const res = await p;
      expect(res.frames.map((f) => f.offsetMs)).toEqual([0, 100, 200]);
    } finally {
      vi.useRealTimers();
    }
  });

  // D4 (plan 2026-11-08-ui-bridge-inject-exec-mode-is-a-second-class-driver):
  // only Chromium's no-compositor-frame refusal is retried, every 16 ms, until
  // the frame's deadline. Under a fake clock every instant below is a literal.
  async function underFakeClock(run: () => Promise<TimelineResult>): Promise<TimelineResult> {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-11-08T09:00:00.000Z'));
    try {
      const pending = run();
      await vi.runAllTimersAsync();
      return await pending;
    } finally {
      vi.useRealTimers();
    }
  }

  it('D4 reload: frame 1 refused twice is retried, written, and dated by the attempt that succeeded', async () => {
    const dir = join(tmp(), 'tl');
    const { page, calls } = timelinePage({ refuse: 2 });
    const res = await underFakeClock(() =>
      captureTimeline(page, {
        dir,
        frames: 2,
        intervalMs: 100,
        reload: true,
        readyTimeoutMs: 1000,
      })
    );
    expect(calls).toEqual(['reload', 'shot1', 'shot2', 'shot3', 'shot4', 'waitReady']);
    // Refused at 0 and 16 ms, taken at 32 ms; frame 2 keeps its 100 ms due time.
    expect(res.frames).toStrictEqual([
      {
        index: 1,
        path: join(dir, 'frame-1.png'),
        offsetMs: 32,
        capturedAt: '2026-11-08T09:00:00.032Z',
        width: 800,
        height: 600,
        attempts: 3,
      },
      {
        index: 2,
        path: join(dir, 'frame-2.png'),
        offsetMs: 100,
        capturedAt: '2026-11-08T09:00:00.100Z',
        width: 800,
        height: 600,
      },
    ]);
    expect(res.frames[0]!.offsetMs).toBeGreaterThan(0);
    expect(readdirSync(dir).sort()).toEqual(['frame-1.png', 'frame-2.png']);
    expect(res).toMatchObject({ success: true, reloaded: true, runtimeReady: true });
    expect(res.error).toBeUndefined();
  });

  it('D4 reload: a refusal that outlasts readyTimeoutMs fails frame 1 at its deadline, never a silent gap', async () => {
    const dir = join(tmp(), 'tl');
    // Refused at 0, 16, ..., 96 ms; an attempt at 112 ms would be past the
    // 100 ms deadline, so there is none. The page would answer frame 2's call.
    const { page, calls } = timelinePage({ refuse: 7 });
    const res = await underFakeClock(() =>
      captureTimeline(page, {
        dir,
        frames: 2,
        intervalMs: 150,
        reload: true,
        readyTimeoutMs: 100,
      })
    );
    expect(calls).toEqual([
      'reload',
      'shot1',
      'shot2',
      'shot3',
      'shot4',
      'shot5',
      'shot6',
      'shot7',
      'shot8',
      'waitReady',
    ]);
    expect(res.frames).toStrictEqual([
      {
        index: 1,
        path: null,
        offsetMs: 96,
        capturedAt: '2026-11-08T09:00:00.096Z',
        width: null,
        height: null,
        attempts: 7,
        error: REFUSAL,
      },
      {
        index: 2,
        path: join(dir, 'frame-2.png'),
        offsetMs: 150,
        capturedAt: '2026-11-08T09:00:00.150Z',
        width: 800,
        height: 600,
      },
    ]);
    expect(readdirSync(dir)).toEqual(['frame-2.png']);
    expect(res).toMatchObject({
      success: false,
      runtimeReady: true,
      error: '1 of 2 frames failed',
    });
  });

  it('D4: any other error on frame 1 after a reload (Target closed) is not retried and fails as today', async () => {
    const dir = join(tmp(), 'tl');
    const { page, calls } = timelinePage({ failFrame: 1 });
    const res = await underFakeClock(() =>
      captureTimeline(page, {
        dir,
        frames: 2,
        intervalMs: 0,
        reload: true,
        readyTimeoutMs: 1000,
      })
    );
    // A 1000 ms budget, and still one attempt: only the refusal is retried.
    expect(calls).toEqual(['reload', 'shot1', 'shot2', 'waitReady']);
    expect(res.frames[0]).toStrictEqual({
      index: 1,
      path: null,
      offsetMs: 0,
      capturedAt: '2026-11-08T09:00:00.000Z',
      width: null,
      height: null,
      error: 'Target closed',
    });
    expect(res).toMatchObject({
      success: false,
      runtimeReady: true,
      error: '1 of 2 frames failed',
    });
  });

  it('D4 without a reload: frame 2 refused once is retried inside its own slot, and frame 3 keeps its due time', async () => {
    const dir = join(tmp(), 'tl');
    const { page, calls } = timelinePage({ refuse: 1, refuseFromShot: 2 });
    const res = await underFakeClock(() =>
      captureTimeline(page, {
        dir,
        frames: 3,
        intervalMs: 100,
        reload: false,
        readyTimeoutMs: 1,
      })
    );
    expect(calls).toEqual(['shot1', 'shot2', 'shot3', 'shot4']);
    expect(res.frames).toStrictEqual([
      {
        index: 1,
        path: join(dir, 'frame-1.png'),
        offsetMs: 0,
        capturedAt: '2026-11-08T09:00:00.000Z',
        width: 800,
        height: 600,
      },
      {
        index: 2,
        path: join(dir, 'frame-2.png'),
        offsetMs: 116,
        capturedAt: '2026-11-08T09:00:00.116Z',
        width: 800,
        height: 600,
        attempts: 2,
      },
      {
        index: 3,
        path: join(dir, 'frame-3.png'),
        offsetMs: 200,
        capturedAt: '2026-11-08T09:00:00.200Z',
        width: 800,
        height: 600,
      },
    ]);
    expect(res).toMatchObject({ success: true, reloaded: false, runtimeReady: null });
  });

  it('D4 intervalMs 0: frame 2 refused gets a single attempt, its deadline being its own due time', async () => {
    const dir = join(tmp(), 'tl');
    const { page, calls } = timelinePage({ refuse: 1, refuseFromShot: 2 });
    const res = await underFakeClock(() =>
      captureTimeline(page, {
        dir,
        frames: 3,
        intervalMs: 0,
        reload: false,
        readyTimeoutMs: 1,
      })
    );
    expect(calls).toEqual(['shot1', 'shot2', 'shot3']);
    expect(res.frames[1]).toStrictEqual({
      index: 2,
      path: null,
      offsetMs: 0,
      capturedAt: '2026-11-08T09:00:00.000Z',
      width: null,
      height: null,
      error: REFUSAL,
    });
    expect(readdirSync(dir).sort()).toEqual(['frame-1.png', 'frame-3.png']);
    expect(res).toMatchObject({ success: false, error: '1 of 3 frames failed' });
  });
});
