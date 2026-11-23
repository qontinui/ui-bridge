import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  linkSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { missingOutputMessage } from '../../../test-support/build-if-stale.mjs';
import { runDensityCli, sameFileOnDisk, type DensityCliIo } from './density-cli';

/**
 * `ui-bridge-density measure`, run as the built bin (dist/density-cli.js) over
 * a synthetic control snapshot — from a file and from standard input, in the
 * relay's `{ success, data, _meta }` envelope and in the bare form the
 * wrapper's `--capture-matrix` writes — plus the usage errors.
 *
 * Every id and text here is synthetic (plan D5). Every expected value is a
 * literal spelled in this file.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change, Phases 2 and 3.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(HERE, '..');
const BIN = join(PKG_DIR, 'dist', 'density-cli.js');
const VERSION = (
  JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')) as { version: string }
).version;

/** A bare snapshot: one registered value row, unscrolled, at 360x740. */
const BARE = {
  timestamp: 1763900000000,
  snapshotId: 'snap-synthetic-1',
  viewport: {
    viewportWidth: 360,
    viewportHeight: 740,
    scrollX: 0,
    scrollY: 0,
    documentWidth: 360,
    documentHeight: 1200,
    container: 'viewport',
  },
  elements: [
    {
      id: 'app.orders.open-1',
      type: 'generic',
      label: 'open order',
      tagName: 'div',
      category: 'content',
      identifier: { xpath: '/html/body/div[1]' },
      state: {
        visible: true,
        rect: { x: 0, y: 100, width: 360, height: 40, top: 100, left: 0, right: 360, bottom: 140 },
        textContent: 'Order 4711',
        scrollWidth: 360,
        clientWidth: 360,
        computedStyles: {
          fontSize: '14px',
          lineHeight: '20px',
          position: 'static',
          overflow: 'visible',
        },
      },
    },
  ],
  components: [],
};

const ENVELOPE = { success: true, data: BARE, _meta: { stale: false, cacheAgeMs: 12 } };

const EXPECTED_VALUE = {
  scope: 'registered',
  cell: { role: 'buyer', viewport: { width: 360, height: 740 }, fixture: null },
  viewport: {
    width: 360,
    height: 740,
    scrollX: 0,
    scrollY: 0,
    documentWidth: 360,
    documentHeight: 1200,
    container: 'viewport',
  },
  bases: {
    foldBasis: 'measured',
    pinBasis: 'registered-only',
    scrollBasis: 'page',
    scroller: null,
    contentCap: { status: 'unreported', contentRows: 1 },
  },
  coverage: { considered: 1, measured: 1, unmeasured: [] },
  probe: null,
  items: 1,
  structureResolved: true,
  structure: {
    structureResolved: true,
    structureBy: { xpath: 1, geometry: 0 },
    leaves: { count: 1, unknown: 0 },
    unattributedChars: 0,
    pins: { pinTopPx: 0, pinBottomPx: 0, usableHeightPx: 740, items: 0 },
    kinds: {
      byBasis: {
        declared: {},
        landmark: {},
        role: {},
        'author-id': {},
        shape: {},
        other: { other: 1 },
      },
      unresolvedRules: [],
    },
    blocks: {
      byBasis: { declared: 0, path: 0, heading: 0 },
      shown: 0,
      total: 0,
      truncated: false,
      list: [],
      unresolved: [],
      unblockedLeaves: 1,
    },
  },
  snapshotId: 'snap-synthetic-1',
  observedAt: '2025-11-23T12:13:20.000Z',
  targetsHash: null,
};

let dir: string;

function run(
  args: string[],
  input?: string
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

interface Report {
  command: string;
  producer: { id: string; version: string; package: string };
  cells: Array<{
    cell: unknown;
    observation: {
      status: string;
      value?: unknown;
      unknown?: { code: string };
      provenance: { producer: unknown; source: Record<string, unknown> };
    };
  }>;
  next: string[];
  captureOut?: { path: string; written: boolean; reason: string | null };
}

function measured(stdout: string): Report {
  const report = JSON.parse(stdout) as Report;
  expect(report.command).toBe('measure');
  expect(report.producer).toEqual({
    id: 'sdk/density',
    version: VERSION,
    package: '@qontinui/ui-bridge-headless',
  });
  expect(report.cells).toHaveLength(1);
  const obs = report.cells[0]!.observation;
  expect(obs.status).toBe('measured');
  expect(obs.value).toEqual(EXPECTED_VALUE);
  expect(obs.provenance.producer).toEqual({ id: 'sdk/density', version: VERSION });
  expect(obs.provenance.source).toEqual({
    package: '@qontinui/ui-bridge-headless',
    schema: 'ui-bridge/density-capture@1',
    snapshotId: 'snap-synthetic-1',
    targetsHash: null,
  });
  expect(report.cells[0]!.cell).toEqual(EXPECTED_VALUE.cell);
  expect(report.next).toEqual(['write-targets']);
  return report;
}

beforeAll(() => {
  // Built once by vitest.global-setup.ts before any worker starts.
  expect(existsSync(BIN), missingOutputMessage(BIN)).toBe(true);
  dir = mkdtempSync(join(tmpdir(), 'ui-bridge-density-cli-'));
  writeFileSync(join(dir, 'bare.json'), JSON.stringify(BARE));
  writeFileSync(join(dir, 'envelope.json'), JSON.stringify(ENVELOPE));
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('ui-bridge-density measure', () => {
  it('reads the bare snapshot from a file', () => {
    const r = run(['measure', '--snapshot', join(dir, 'bare.json'), '--role', 'buyer']);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    measured(r.stdout);
  }, 60_000);

  it('reads the relay envelope from a file', () => {
    const r = run(['measure', '--snapshot', join(dir, 'envelope.json'), '--role', 'buyer']);
    expect(r.status).toBe(0);
    measured(r.stdout);
  }, 60_000);

  it('reads the bare snapshot from standard input', () => {
    const r = run(['measure', '--snapshot', '-', '--role', 'buyer'], JSON.stringify(BARE));
    expect(r.status).toBe(0);
    measured(r.stdout);
  }, 60_000);

  it('reads the relay envelope from standard input', () => {
    const r = run(['measure', '--snapshot', '-', '--role', 'buyer'], JSON.stringify(ENVELOPE));
    expect(r.status).toBe(0);
    measured(r.stdout);
  }, 60_000);

  it('--fixture names the cell', () => {
    const r = run([
      'measure',
      '--snapshot',
      join(dir, 'bare.json'),
      '--role',
      'buyer',
      '--fixture',
      'empty-cart',
    ]);
    expect(r.status).toBe(0);
    const report = JSON.parse(r.stdout) as Report;
    expect(report.cells[0]!.cell).toEqual({
      role: 'buyer',
      viewport: { width: 360, height: 740 },
      fixture: 'empty-cart',
    });
  }, 60_000);

  it('--capture-out writes the text-free capture', () => {
    const out = join(dir, 'capture.json');
    const r = run([
      'measure',
      '--snapshot',
      join(dir, 'bare.json'),
      '--role',
      'buyer',
      '--capture-out',
      out,
    ]);
    expect(r.status).toBe(0);
    const report = JSON.parse(r.stdout) as Report;
    expect(report.captureOut).toEqual({ path: out, written: true, reason: null });
    const written = readFileSync(out, 'utf8');
    const capture = JSON.parse(written) as {
      schema: string;
      items: Array<{ id: string; chars: number }>;
    };
    expect(capture.schema).toBe('ui-bridge/density-capture@1');
    expect(capture.items.map((i) => [i.id, i.chars])).toEqual([['app.orders.open-1', 10]]);
    // The snapshot's text is not in the capture.
    expect(written).not.toContain('Order 4711');
  }, 60_000);

  it('a stale relay answer is unknown{stale_input}, still exit 0, and asks for a capture', () => {
    const stale = { ...ENVELOPE, _meta: { stale: true, cacheAgeMs: 90_000 } };
    const out = join(dir, 'stale-capture.json');
    const r = run(
      ['measure', '--snapshot', '-', '--role', 'buyer', '--capture-out', out],
      JSON.stringify(stale)
    );
    expect(r.status).toBe(0);
    const report = JSON.parse(r.stdout) as Report;
    expect(report.cells[0]!.observation.status).toBe('unknown');
    expect(report.cells[0]!.observation.unknown?.code).toBe('stale_input');
    expect(report.cells[0]!.cell).toEqual({ role: 'buyer', viewport: null, fixture: null });
    expect(report.next).toEqual(['write-targets', 'capture']);
    expect(report.captureOut).toEqual({
      path: out,
      written: false,
      reason: 'the cell answered unknown, so there is no capture to write',
    });
    expect(existsSync(out)).toBe(false);
  }, 60_000);
});

/** A targets file whose buyer probe reads the open-order row, with no review block. */
const TARGETS = {
  schema: 'ui-bridge/density-targets@1',
  surface: '/',
  profile: 'audience_profile/synthetic@1',
  roles: [
    {
      role: 'buyer',
      probe: { id: 'app.orders.open-1', includes: 'Order' },
      asks: [
        {
          id: 'B1',
          rank: 1,
          weight: 5,
          kind: 'state',
          question: 'Which of my open orders need action today?',
          source: {
            doc: 'audience_profile/synthetic@1',
            quote: 'Buyers act on open orders daily.',
          },
          answer: { idPrefix: 'app.orders.open-' },
        },
      ],
    },
  ],
};

describe('ui-bridge-density measure --targets', () => {
  it('checks the role probe and, with no review block, asks for a review', () => {
    writeFileSync(join(dir, 'targets.json'), JSON.stringify(TARGETS));
    const r = run([
      'measure',
      '--snapshot',
      join(dir, 'bare.json'),
      '--role',
      'buyer',
      '--targets',
      join(dir, 'targets.json'),
    ]);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const report = JSON.parse(r.stdout) as Report;
    const value = report.cells[0]!.observation.value as { probe: unknown; targetsHash: string };
    expect(value.probe).toEqual({ role: 'buyer', id: 'app.orders.open-1', matched: true });
    expect(value.targetsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(report.next).toEqual(['review-targets']);
  }, 60_000);

  it('a probe that does not match is unknown{input_missing}', () => {
    const other = {
      ...TARGETS,
      roles: [{ ...TARGETS.roles[0]!, probe: { id: 'app.orders.open-1', includes: 'Supplier' } }],
    };
    writeFileSync(join(dir, 'targets-other.json'), JSON.stringify(other));
    const r = run([
      'measure',
      '--snapshot',
      join(dir, 'bare.json'),
      '--role',
      'buyer',
      '--targets',
      join(dir, 'targets-other.json'),
    ]);
    expect(r.status).toBe(0);
    const report = JSON.parse(r.stdout) as Report;
    expect(report.cells[0]!.observation.unknown?.code).toBe('input_missing');
    expect(report.next).toEqual(['review-targets', 'capture']);
  }, 60_000);

  it('a role the targets do not declare is a usage error', () => {
    writeFileSync(join(dir, 'targets.json'), JSON.stringify(TARGETS));
    const r = run([
      'measure',
      '--snapshot',
      join(dir, 'bare.json'),
      '--role',
      'supplier',
      '--targets',
      join(dir, 'targets.json'),
    ]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--role supplier is not declared');
  }, 60_000);
});

describe('runDensityCli, in process', () => {
  /** An in-memory I/O: files by path, captured streams, recorded writes. */
  function memoryIo(files: Record<string, string>, stdin = '') {
    const out = { stdout: '', stderr: '', written: {} as Record<string, string> };
    const io: DensityCliIo = {
      readFile: (p) => {
        const text = files[p];
        if (text === undefined) throw new Error(`ENOENT: ${p}`);
        return text;
      },
      readStdin: async () => stdin,
      writeFile: (p, t) => {
        out.written[p] = t;
      },
      stdout: (t) => {
        out.stdout += t;
      },
      stderr: (t) => {
        out.stderr += t;
      },
    };
    return { io, out };
  }

  it('measure answers the capture summary as one Observation from sdk/density', async () => {
    const { io, out } = memoryIo({ 'snap.json': JSON.stringify(ENVELOPE) });
    const steps: string[] = [];
    const code = await runDensityCli(
      ['measure', '--snapshot', 'snap.json', '--role', 'buyer', '--capture-out', 'cap.json'],
      io,
      (s) => steps.push(s)
    );
    expect(code).toBe(0);
    expect(out.stderr).toBe('');
    const report = measured(out.stdout);
    expect(report.captureOut).toEqual({ path: 'cap.json', written: true, reason: null });
    expect(Object.keys(out.written)).toEqual(['cap.json']);
    expect(steps).toEqual(['parse-args', 'read-snapshot', 'capture', 'write-capture', 'print']);
  });

  it('a snapshot with a UTF-8 byte-order mark is read', async () => {
    const { io, out } = memoryIo({
      'bom.json': String.fromCharCode(0xfeff) + JSON.stringify(BARE),
    });
    const code = await runDensityCli(['measure', '--snapshot', 'bom.json', '--role', 'buyer'], io);
    expect(code).toBe(0);
    measured(out.stdout);
  });

  it('a --capture-out write that fails is a usage error, with nothing on stdout', async () => {
    const { io, out } = memoryIo({ 'snap.json': JSON.stringify(BARE) });
    io.writeFile = () => {
      throw new Error('ENOENT: no such file or directory');
    };
    const code = await runDensityCli(
      ['measure', '--snapshot', 'snap.json', '--role', 'buyer', '--capture-out', 'no/dir/c.json'],
      io
    );
    expect(code).toBe(2);
    expect(out.stdout).toBe('');
    expect(out.stderr).toContain('--capture-out no/dir/c.json: ENOENT');
  });

  it('-h in a value position is the value, not a request for help', async () => {
    const { io, out } = memoryIo({ 'snap.json': JSON.stringify(BARE) });
    const code = await runDensityCli(['measure', '--snapshot', 'snap.json', '--role', '-h'], io);
    expect(code).toBe(0);
    const report = JSON.parse(out.stdout) as Report;
    expect((report.cells[0]!.cell as { role: string }).role).toBe('-h');
  });

  it('--help after a verb prints the usage', async () => {
    const { io, out } = memoryIo({});
    expect(await runDensityCli(['measure', '--help'], io)).toBe(0);
    expect(out.stdout).toContain('ui-bridge-density — reach per role');
  });

  it('a whitespace-only value is a usage error', async () => {
    const { io, out } = memoryIo({ 'snap.json': JSON.stringify(BARE) });
    const code = await runDensityCli(['measure', '--snapshot', 'snap.json', '--role', '  '], io);
    expect(code).toBe(2);
    expect(out.stderr).toContain('--role expects a value');
  });

  it('--capture-out naming the snapshot file is a usage error, and nothing is written', async () => {
    const { io, out } = memoryIo({ 'snap.json': JSON.stringify(BARE) });
    const code = await runDensityCli(
      ['measure', '--snapshot', 'snap.json', '--role', 'buyer', '--capture-out', './snap.json'],
      io
    );
    expect(code).toBe(2);
    expect(out.written).toEqual({});
    expect(out.stderr).toContain('is the --snapshot file; refusing to overwrite an input');
  });

  it('a flag given twice is a usage error', async () => {
    const { io, out } = memoryIo({ 'snap.json': JSON.stringify(BARE) });
    const code = await runDensityCli(
      ['measure', '--snapshot', 'snap.json', '--role', 'buyer', '--role', 'supplier'],
      io
    );
    expect(code).toBe(2);
    expect(out.stderr).toContain('--role is given more than once');
  });

  it('--capture-out - is a usage error (stdout already carries the report)', async () => {
    const { io, out } = memoryIo({ 'snap.json': JSON.stringify(BARE) });
    const code = await runDensityCli(
      ['measure', '--snapshot', 'snap.json', '--role', 'buyer', '--capture-out', '-'],
      io
    );
    expect(code).toBe(2);
    expect(out.stderr).toContain('--capture-out takes a file path, not -');
  });

  it('the bin refuses --capture-out that is a hard link to --snapshot, and the snapshot is untouched', () => {
    const snap = join(dir, 'guarded.json');
    const alias = join(dir, 'guarded-alias.json');
    writeFileSync(snap, JSON.stringify(BARE));
    linkSync(snap, alias);
    const before = readFileSync(snap, 'utf8');
    const r = run(['measure', '--snapshot', snap, '--role', 'buyer', '--capture-out', alias]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('is the --snapshot file; refusing to overwrite an input');
    expect(readFileSync(snap, 'utf8')).toBe(before);
  }, 60_000);

  it('the bin refuses --capture-out naming the file standard input was redirected from', () => {
    const snap = join(dir, 'redirected.json');
    writeFileSync(snap, JSON.stringify(BARE));
    const before = readFileSync(snap, 'utf8');
    const fd = openSync(snap, 'r');
    try {
      const r = spawnSync(
        process.execPath,
        [BIN, 'measure', '--snapshot', '-', '--role', 'buyer', '--capture-out', snap],
        { encoding: 'utf8', stdio: [fd, 'pipe', 'pipe'], timeout: 60_000 }
      );
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('is the --snapshot file; refusing to overwrite an input');
    } finally {
      closeSync(fd);
    }
    expect(readFileSync(snap, 'utf8')).toBe(before);
  }, 60_000);

  it('sameFileOnDisk sees a hard link to the snapshot as the snapshot', () => {
    const a = join(dir, 'linked-a.json');
    const b = join(dir, 'linked-b.json');
    writeFileSync(a, '{}');
    linkSync(a, b);
    expect(sameFileOnDisk(a, b)).toBe(true);
    expect(sameFileOnDisk(a, join(dir, 'bare.json'))).toBe(false);
    expect(sameFileOnDisk(a, join(dir, 'does-not-exist.json'))).toBe(false);
  });

  it('a missing snapshot file is a usage error naming it', async () => {
    const { io, out } = memoryIo({});
    const code = await runDensityCli(['measure', '--snapshot', 'gone.json', '--role', 'buyer'], io);
    expect(code).toBe(2);
    expect(out.stdout).toBe('');
    expect(out.stderr).toContain('--snapshot gone.json: ENOENT: gone.json');
  });
});

// Windows has no catchable SIGTERM (a kill is unconditional), so CI's Linux run is the one that counts.
describe.skipIf(process.platform === 'win32')('ui-bridge-density interrupted', () => {
  /** Spawn `measure` with the trace on; resolves once the run reaches `step`. */
  function spawnTraced(args: string[], step: string) {
    const child = spawn(process.execPath, [BIN, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, UI_BRIDGE_DENSITY_TRACE: '1' },
    });
    let stdout = '';
    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString('utf8');
    });
    // 'close', not 'exit': stdio is drained only by then.
    const closed = new Promise<number | null>((r) => child.on('close', (code) => r(code)));
    const reached = new Promise<void>((ready) => {
      let stderr = '';
      child.stderr.on('data', (c: Buffer) => {
        stderr += c.toString('utf8');
        if (stderr.includes(`ui-bridge-density: step ${step}\n`)) ready();
      });
    });
    return { child, closed, reached, stdout: () => stdout };
  }

  it.each([
    ['SIGTERM', 143],
    ['SIGINT', 130],
    ['SIGHUP', 129],
  ] as const)(
    '%s while reading the snapshot prints a typed verdict naming the step and exits %i',
    async (signal, code) => {
      // Standard input stays open, so the run parks at read-snapshot. The
      // handlers are installed before the first step, which the trace names.
      const run = spawnTraced(['measure', '--snapshot', '-', '--role', 'buyer'], 'read-snapshot');
      await run.reached;
      run.child.kill(signal);
      expect(await run.closed).toBe(code);
      expect(JSON.parse(run.stdout())).toEqual({
        command: 'measure',
        interrupted: { signal, step: 'read-snapshot' },
      });
    },
    60_000
  );

  // The signal-after-answer arm (exit 0, the answer whole) is not pinned here:
  // the run normally exits before a signal sent after its 'print' step lands,
  // so such a test would pass whatever the handler does. It was observed on
  // Linux against the built bin instead (PR body).
});

describe('ui-bridge-density usage', () => {
  it('an unknown flag is a usage error: exit 2, named on stderr, nothing on stdout', () => {
    const r = run(['measure', '--snapshot', join(dir, 'bare.json'), '--role', 'buyer', '--colour']);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('Unknown flag: --colour');
  }, 60_000);

  it('no argument is a usage error: exit 2 with the usage text', () => {
    const r = run([]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('a verb is required');
    expect(r.stderr).toContain('ui-bridge-density measure --snapshot <file|-> --role <role>');
  }, 60_000);

  it('measure without --role is a usage error', () => {
    const r = run(['measure', '--snapshot', join(dir, 'bare.json')]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('measure: --role is required');
  }, 60_000);

  it('a snapshot file that is not JSON is a usage error', () => {
    writeFileSync(join(dir, 'broken.json'), '{ not json');
    const r = run(['measure', '--snapshot', join(dir, 'broken.json'), '--role', 'buyer']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('is not JSON');
  }, 60_000);

  it('a verb of a later release says so', () => {
    const r = run(['fit']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("the verb 'fit' is not in this release");
  }, 60_000);

  it('--version prints the package version', () => {
    const r = run(['--version']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`ui-bridge-density ${VERSION}\n`);
  }, 60_000);

  it('--help prints the usage on stdout and exits 0', () => {
    const r = run(['--help']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('ui-bridge-density — reach per role');
  }, 60_000);
});

/** A page with a pinned header, a section holding a heading and a row, and a note with its own id. */
function structuredElement(
  id: string,
  tagName: string,
  xpath: string,
  rect: [number, number, number, number],
  textContent: string,
  position = 'static'
) {
  const [x, y, width, height] = rect;
  return {
    id,
    type: 'generic',
    tagName,
    category: 'content',
    identifier: { xpath },
    state: {
      visible: true,
      rect: { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height },
      textContent,
      scrollWidth: width,
      clientWidth: width,
      computedStyles: { fontSize: '14px', lineHeight: '20px', position, overflow: 'visible' },
    },
  };
}

const STRUCTURED = {
  ...BARE,
  elements: [
    structuredElement(
      'app.header',
      'header',
      '/html/body/header',
      [0, 0, 360, 48],
      'Shop',
      'fixed'
    ),
    structuredElement(
      'app.orders',
      'section',
      '/html/body/main/section',
      [0, 60, 360, 200],
      'Open orders Order 4711'
    ),
    structuredElement(
      'app.orders.title',
      'h2',
      '/html/body/main/section/h2',
      [0, 60, 360, 28],
      'Open orders'
    ),
    structuredElement(
      'app.orders.open-1',
      'div',
      '/html/body/main/section/div',
      [0, 100, 360, 20],
      'Order 4711'
    ),
    structuredElement('app.note', 'p', '//*[@id="note"]', [0, 300, 360, 20], 'Synthetic note'),
  ],
};

describe('ui-bridge-density measure: the structure summary', () => {
  it('reports leaves, kinds by kindBy, blocks and the structureBy counts', () => {
    writeFileSync(join(dir, 'structured.json'), JSON.stringify(STRUCTURED));
    writeFileSync(
      join(dir, 'targets-classify.json'),
      JSON.stringify({
        schema: 'ui-bridge/density-targets@1',
        surface: '/',
        profile: 'audience_profile/synthetic@1',
        classify: [{ match: { idPrefix: 'app.orders.open-' }, kind: 'value' }],
        roles: [{ role: 'buyer', asks: [] }],
      })
    );
    const r = run([
      'measure',
      '--snapshot',
      join(dir, 'structured.json'),
      '--role',
      'buyer',
      '--targets',
      join(dir, 'targets-classify.json'),
    ]);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const report = JSON.parse(r.stdout) as Report;
    const value = report.cells[0]!.observation.value as { structure: unknown };
    expect(value.structure).toEqual({
      structureResolved: true,
      // The note's xpath is its own id, which names no ancestor.
      structureBy: { xpath: 4, geometry: 1 },
      leaves: { count: 4, unknown: 0 },
      unattributedChars: 0,
      pins: { pinTopPx: 48, pinBottomPx: 0, usableHeightPx: 692, items: 1 },
      kinds: {
        byBasis: {
          declared: { value: 1 },
          landmark: { chrome: 1 },
          role: { heading: 1, prose: 1 },
          'author-id': {},
          shape: {},
          other: {},
        },
        unresolvedRules: [],
      },
      blocks: {
        byBasis: { declared: 0, path: 1, heading: 0 },
        shown: 1,
        total: 1,
        truncated: false,
        list: [
          {
            id: 'path:/html/body/main/section',
            by: 'path',
            members: 2,
            topPx: 60,
            heightPx: 48,
            pitchPx: null,
            parent: null,
          },
        ],
        unresolved: [],
        unblockedLeaves: 2,
      },
    });
  }, 60_000);
});
