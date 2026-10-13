/**
 * inject-cli's frame flags — `--screenshot`, `--dpr`, `--color-scheme` — and
 * the capture matrix, at the argument and action-loop level (no browser).
 *
 * Plan 2026-10-13-image-generation-and-visual-judgment, Phase 9 items 1 and 4.
 * The real-Chromium read-back (devicePixelRatio, frame size, frame pixels) is
 * `inject-cli-frame-smoke.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  USAGE,
  CAPTURE_FRAME_ACTION,
  InjectCliArgError,
  MAX_DPR,
  MAX_VIEWPORT_SIDE,
  captureMatrix,
  SNAPSHOT_ACTIONS,
  buildCellTransportOptions,
  buildTransportOptions,
  executeActions,
  parseArgs,
  selectMode,
  validateFramePlan,
  type ExecLine,
  type ExecTransport,
} from '../src/inject-cli.js';
import { cellId, expandMatrix, manifestPath } from '../src/capture-matrix.js';

const URL_ = 'http://127.0.0.1:3000/';
const exec = ['--url', URL_, '--exec', 'getControlSnapshot {}'];

describe('USAGE', () => {
  it('documents --screenshot <path> (the Done-when probe anchor for this flag)', () => {
    expect(USAGE).toContain('--screenshot <path>');
    expect(USAGE).toContain('--dpr <n>');
    expect(USAGE).toContain('--color-scheme <dark|light>');
    expect(USAGE).toContain('--capture-matrix <dir>');
  });

  // CONSUMER: qontinui-claude-config's scripts/verify-page-verdict.sh (the
  // /verify-web verdict) reads the frame record's fields BY NAME — it copies
  // the record into each capture, hands "path" to vision-audit with
  // --scale-factor <devicePixelRatio>, and reports "lockstep" — so the names
  // are pinned here, and a rename has to be made on both sides. FrameRecord in
  // src/frame-capture.ts carries the same note.
  it('names every frame-record field its consumer verify-page-verdict.sh reads', () => {
    for (const field of [
      '"path"',
      '"width"',
      '"height"',
      '"devicePixelRatio"',
      '"cssViewport"',
      '"colorScheme"',
      '"capturedAt"',
      '"lockstep"',
      '"verified"',
      '"attempts"',
      '"changedElements"',
      '"frameError"',
    ]) {
      expect(USAGE).toContain(field);
    }
  });

  it('says a frame is raw pixels that data-bridge-redact does not scrub, written owner-only', () => {
    expect(USAGE).toContain('RAW PIXELS');
    expect(USAGE).toContain('data-bridge-redact');
    expect(USAGE).toContain('0700');
    expect(USAGE).toContain('0600');
  });
});

describe('--viewport', () => {
  it('accepts a side of MAX_VIEWPORT_SIDE CSS pixels and refuses one above it', () => {
    expect(parseArgs([...exec, '--viewport', `${MAX_VIEWPORT_SIDE}x720`]).viewports).toEqual([
      { width: MAX_VIEWPORT_SIDE, height: 720 },
    ]);
    expect(() => parseArgs([...exec, '--viewport', `${MAX_VIEWPORT_SIDE + 1}x720`])).toThrow(
      /at most 8192/
    );
    expect(() => parseArgs([...exec, '--viewport', `1280x${MAX_VIEWPORT_SIDE + 1}`])).toThrow(
      InjectCliArgError
    );
    expect(USAGE).toContain(`1..${MAX_VIEWPORT_SIDE} CSS pixels`);
  });
});

describe('--screenshot', () => {
  it('is accepted in Variant A and kept verbatim (the {n} template is expanded per action later)', () => {
    const args = parseArgs([...exec, '--screenshot', '/tmp/f-{n}.png']);
    expect(args.screenshot).toBe('/tmp/f-{n}.png');
    expect(selectMode(args)).toBe('exec');
  });

  it('refuses a missing value, including a flag-shaped one', () => {
    expect(() => parseArgs([...exec, '--screenshot'])).toThrow(InjectCliArgError);
    expect(() => parseArgs([...exec, '--screenshot', '--headed'])).toThrow(InjectCliArgError);
  });

  it('refuses relay mode: a relay tab takes no frame', () => {
    expect(() =>
      parseArgs([
        '--url',
        URL_,
        '--relay',
        'http://127.0.0.1:3001/api/ui-bridge',
        '--screenshot',
        'f.png',
      ])
    ).toThrow(/Variant A/);
  });
});

describe('validateFramePlan', () => {
  const a = (action: string) => ({ action, payload: {} });

  it('is a no-op without --screenshot', () => {
    expect(() => validateFramePlan([a('find')], null)).not.toThrow();
  });

  it('refuses a run with no getControlSnapshot — the flag would silently do nothing', () => {
    expect(() => validateFramePlan([a('find'), a('sleep')], 'f.png')).toThrow(/has\s+none/);
  });

  it('refuses {n} in a directory name, where it is not replaced', () => {
    expect(() => validateFramePlan([a('getControlSnapshot')], '/tmp/{n}/frame.png')).toThrow(
      /directory name/
    );
    expect(() =>
      validateFramePlan([a('getControlSnapshot'), a('getControlSnapshot')], '/tmp/{n}/f-{n}.png')
    ).toThrow(/directory name/);
    expect(() =>
      validateFramePlan([a('getControlSnapshot'), a('getControlSnapshot')], '/tmp/x/f-{n}.png')
    ).not.toThrow();
  });

  it('refuses a fixed path over several snapshots — each frame would overwrite the last', () => {
    expect(() =>
      validateFramePlan([a('getControlSnapshot'), a('find'), a('getControlSnapshot')], 'f.png')
    ).toThrow(/\{n\}/);
  });

  it('accepts a fixed path over one snapshot, and {n} over several', () => {
    expect(() => validateFramePlan([a('getControlSnapshot')], 'f.png')).not.toThrow();
    expect(() =>
      validateFramePlan([a('getControlSnapshot'), a('getControlSnapshot')], 'f-{n}.png')
    ).not.toThrow();
  });
});

describe('--dpr', () => {
  it('accepts integer and fractional ratios and passes them as deviceScaleFactor', () => {
    expect(buildTransportOptions(parseArgs([...exec, '--dpr', '2'])).deviceScaleFactor).toBe(2);
    expect(buildTransportOptions(parseArgs([...exec, '--dpr', '2.625'])).deviceScaleFactor).toBe(
      2.625
    );
  });

  it.each(['0', '-1', 'abc', '0x2', '1e1', String(MAX_DPR + 1), ''])('refuses %j', (bad) => {
    expect(() => parseArgs([...exec, '--dpr', bad])).toThrow(InjectCliArgError);
  });

  it('takes one value outside --capture-matrix, whether as a list or repeated', () => {
    expect(() => parseArgs([...exec, '--dpr', '1,2'])).toThrow(/takes one value/);
    expect(() => parseArgs([...exec, '--dpr', '1', '--dpr', '2'])).toThrow(/takes one value/);
  });
});

describe('--color-scheme', () => {
  it('accepts dark and light and passes them as colorScheme', () => {
    expect(buildTransportOptions(parseArgs([...exec, '--color-scheme', 'dark'])).colorScheme).toBe(
      'dark'
    );
    expect(buildTransportOptions(parseArgs([...exec, '--color-scheme', 'light'])).colorScheme).toBe(
      'light'
    );
  });

  it('refuses anything else, and a list outside the matrix', () => {
    expect(() => parseArgs([...exec, '--color-scheme', 'sepia'])).toThrow(/dark or light/);
    expect(() => parseArgs([...exec, '--color-scheme', 'dark,light'])).toThrow(/takes one value/);
  });
});

describe('--viewport', () => {
  it('sets the one viewport outside the matrix', () => {
    const opts = buildTransportOptions(parseArgs([...exec, '--viewport', '390x844']));
    expect([opts.viewportWidth, opts.viewportHeight]).toEqual([390, 844]);
  });

  it('refuses a zero side and a list outside the matrix', () => {
    expect(() => parseArgs([...exec, '--viewport', '0x844'])).toThrow(/WxH/);
    expect(() => parseArgs([...exec, '--viewport', '390x844,1280x720'])).toThrow(/takes one value/);
  });
});

describe('emulation keys are absent unless asked for', () => {
  it('sets no viewport, deviceScaleFactor or colorScheme by default', () => {
    const opts = buildTransportOptions(parseArgs(exec));
    for (const key of ['viewportWidth', 'viewportHeight', 'deviceScaleFactor', 'colorScheme']) {
      expect(key in opts).toBe(false);
    }
  });
});

describe('--capture-matrix', () => {
  const matrix = ['--url', URL_, '--capture-matrix', '/tmp/m'];

  it('selects matrix mode and makes the three flags lists', () => {
    const args = parseArgs([
      ...matrix,
      '--viewport',
      '390x844,1280x720',
      '--dpr',
      '1',
      '--dpr',
      '2',
      '--color-scheme',
      'light,dark',
    ]);
    expect(selectMode(args)).toBe('matrix');
    expect(args.viewports).toEqual([
      { width: 390, height: 844 },
      { width: 1280, height: 720 },
    ]);
    expect(args.dprs).toEqual([1, 2]);
    expect(args.colorSchemes).toEqual(['light', 'dark']);
  });

  it('wins over --exec (the plan runs in every cell) and needs no --relay', () => {
    expect(selectMode(parseArgs([...matrix, '--exec', 'getControlSnapshot {}']))).toBe('matrix');
  });

  it('refuses a duplicated axis value — two cells would share one id', () => {
    expect(() => parseArgs([...matrix, '--dpr', '2,2'])).toThrow(/lists 2 twice/);
    expect(() => parseArgs([...matrix, '--viewport', '390x844', '--viewport', '390x844'])).toThrow(
      /twice/
    );
  });

  it('refuses --relay and --screenshot', () => {
    expect(() => parseArgs([...matrix, '--relay', 'http://127.0.0.1:3001/api/ui-bridge'])).toThrow(
      /--relay/
    );
    expect(() => parseArgs([...matrix, '--screenshot', 'f.png'])).toThrow(/--screenshot/);
  });

  it('refuses an empty list item', () => {
    expect(() => parseArgs([...matrix, '--dpr', '1,,2'])).toThrow(/empty item/);
  });

  it('builds each cell from every non-axis flag plus that cell’s own axes', () => {
    const args = parseArgs([
      ...matrix,
      '--viewport',
      '390x844,1280x720',
      '--dpr',
      '3',
      '--storage-state',
      'auth.json',
      '--settle-timeout',
      '15000',
    ]);
    const cell = buildCellTransportOptions(args, {
      viewport: { width: 1280, height: 720 },
      dpr: null,
      colorScheme: 'dark',
    });
    expect(cell.viewportWidth).toBe(1280);
    expect(cell.viewportHeight).toBe(720);
    expect('deviceScaleFactor' in cell).toBe(false); // the cell said null: browser default
    expect(cell.colorScheme).toBe('dark');
    expect(cell.storageStatePath).toBe('auth.json');
    expect(cell.settleTimeoutMs).toBe(15000);
  });
});

describe('expandMatrix / cellId', () => {
  it('is the cartesian product, viewport-major, in the order given', () => {
    const cells = expandMatrix({
      viewports: [
        { width: 390, height: 844 },
        { width: 1280, height: 720 },
      ],
      dprs: [1, 2],
      colorSchemes: ['light', 'dark'],
    });
    expect(cells.map(cellId)).toEqual([
      '390x844_dpr1_light',
      '390x844_dpr1_dark',
      '390x844_dpr2_light',
      '390x844_dpr2_dark',
      '1280x720_dpr1_light',
      '1280x720_dpr1_dark',
      '1280x720_dpr2_light',
      '1280x720_dpr2_dark',
    ]);
  });

  it('turns an empty axis into one browser-default value, named as such', () => {
    const cells = expandMatrix({ viewports: [], dprs: [2.625], colorSchemes: [] });
    expect(cells).toEqual([{ viewport: null, dpr: 2.625, colorScheme: null }]);
    expect(cellId(cells[0]!)).toBe('viewport-default_dpr2.625_scheme-default');
  });

  it('writes manifest paths relative and with forward slashes', () => {
    expect(manifestPath('/out/m', '/out/m/390x844_dpr1_light/frame-1.png')).toBe(
      '390x844_dpr1_light/frame-1.png'
    );
  });
});

/** A transport stub: snapshot handlers come back from a script, frames from a callback. */
function stubTransport(frameFor: (path: string) => unknown): ExecTransport & { calls: string[] } {
  const handlers = new Map<string, (p: unknown, c: unknown) => unknown>();
  const ctx = {
    execute: async (action: string) =>
      action === 'getControlSnapshot' ? { elements: [{ id: 'a' }] } : { success: true },
  };
  const t = {
    calls: [] as string[],
    handlerRegistry: { has: (id: string) => handlers.has(id) },
    register(id: string, fn: (p: unknown, c: unknown) => unknown) {
      handlers.set(id, fn);
    },
    async dispatch(id: string, params?: unknown) {
      t.calls.push(id);
      if (id === CAPTURE_FRAME_ACTION) {
        return frameFor((params as { path: string }).path);
      }
      return handlers.get(id)!(params, ctx);
    },
  };
  return t;
}

const FRAME = {
  path: '/abs/f-1.png',
  format: 'png',
  width: 800,
  height: 600,
  devicePixelRatio: 2,
  cssViewport: { width: 400, height: 300 },
  colorScheme: 'dark',
  capturedAt: '2026-10-13T12:00:00.000Z',
  lockstep: { verified: true, attempts: 1, changedElements: 0 },
};

describe('executeActions', () => {
  it('pairs a frame with each snapshot action, keeps `action` the first key, and leaves other actions alone', async () => {
    const lines: string[] = [];
    const t = stubTransport((path) => ({
      snapshot: { elements: [{ id: 'a' }] },
      frame: { ...FRAME, path },
    }));
    const anyError = await executeActions(
      t,
      [
        { action: 'getControlSnapshot', payload: {} },
        { action: 'find', payload: { text: 'x' } },
        { action: 'getControlSnapshot', payload: {} },
      ],
      (position, action) => (SNAPSHOT_ACTIONS.has(action) ? `/abs/f-${position}.png` : null),
      (line: ExecLine) => lines.push(JSON.stringify(line))
    );
    expect(anyError).toBe(false);
    expect(t.calls).toEqual([CAPTURE_FRAME_ACTION, 'find', CAPTURE_FRAME_ACTION]);
    expect(lines.every((l) => l.startsWith('{"action":'))).toBe(true);
    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed[0].frame.path).toBe('/abs/f-1.png');
    expect(parsed[2].frame.path).toBe('/abs/f-3.png');
    expect('frame' in parsed[1]).toBe(false);
  });

  it('reports a failed frame as frame:null + frameError beside the snapshot, and as a failed run', async () => {
    const lines: ExecLine[] = [];
    const t = stubTransport(() => ({
      snapshot: { elements: [{ id: 'a' }] },
      frame: null,
      frameError: { code: 'FRAME_CAPTURE_FAILED', message: 'screenshot failed: boom' },
    }));
    const anyError = await executeActions(
      t,
      [{ action: 'getControlSnapshot', payload: {} }],
      () => '/abs/f.png',
      (line) => lines.push(line)
    );
    expect(anyError).toBe(true);
    expect(lines[0]).toEqual({
      action: 'getControlSnapshot',
      result: { elements: [{ id: 'a' }] },
      frame: null,
      frameError: { code: 'FRAME_CAPTURE_FAILED', message: 'screenshot failed: boom' },
    });
    // NOT on the `error` key: the snapshot itself succeeded.
    expect('error' in lines[0]!).toBe(false);
  });

  it('puts a thrown capture on the error key, like any thrown action', async () => {
    const lines: ExecLine[] = [];
    const t = stubTransport(() => {
      throw new Error('runtime gone');
    });
    const anyError = await executeActions(
      t,
      [{ action: 'getControlSnapshot', payload: {} }],
      () => '/abs/f.png',
      (line) => lines.push(line)
    );
    expect(anyError).toBe(true);
    expect(lines[0]!.error?.message).toMatch(/runtime gone/);
    expect('frame' in lines[0]!).toBe(false);
  });
});

describe('captureMatrix output directory', () => {
  const plan = [{ action: 'getControlSnapshot', payload: {} }];

  it('refuses a non-empty directory before any browser launches, and never clears it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'matrix-nonempty-'));
    try {
      writeFileSync(join(dir, 'keep.txt'), 'mine');
      const args = parseArgs(['--url', URL_, '--capture-matrix', dir]);
      await expect(captureMatrix(args, plan)).rejects.toThrow(/not empty .*Pass an\s+empty/s);
      expect(readdirSync(dir)).toEqual(['keep.txt']);
      expect(readFileSync(join(dir, 'keep.txt'), 'utf8')).toBe('mine');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a file at that path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'matrix-file-'));
    try {
      const file = join(dir, 'matrix');
      writeFileSync(file, 'x');
      const args = parseArgs(['--url', URL_, '--capture-matrix', file]);
      await expect(captureMatrix(args, plan)).rejects.toThrow(/is a file, not a directory/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
