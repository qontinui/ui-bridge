import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { missingOutputMessage } from '../../../test-support/build-if-stale.mjs';

/**
 * `ui-bridge-density` types its interruption in every verb (served policy
 * `verification-and-evidence` `a-typed-verdict-tool-types-its-interruption`):
 * SIGINT, SIGTERM or SIGHUP before a verdict prints one typed document naming
 * the verb and the step it reached, and exits `128 + n`; after the verdict is
 * printed, a signal adds a note on stderr that the verdict stands, and the run
 * exits with the verdict's own code.
 *
 * Run against the built bin (dist/density-cli.js). Skipped on Windows, where a
 * child cannot be sent a catchable SIGTERM or SIGHUP (a kill there is
 * unconditional), so CI's Linux run is the one that counts.
 *
 * Every id and text here is synthetic (plan D5).
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change, Phase 6.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(resolve(HERE, '..'), 'dist', 'density-cli.js');

let dir = '';

/** A bare snapshot of `rows` registered value rows at 360 x 740. */
function snapshot(rows: number) {
  return {
    timestamp: 1763900000000,
    snapshotId: 'snap-synthetic-signal',
    viewport: {
      viewportWidth: 360,
      viewportHeight: 740,
      scrollX: 0,
      scrollY: 0,
      documentWidth: 360,
      documentHeight: 100 + rows * 40,
      container: 'viewport',
    },
    elements: Array.from({ length: rows }, (_, i) => ({
      id: `app.rows.row-${i}`,
      type: 'generic',
      tagName: 'div',
      category: 'content',
      identifier: { xpath: `/html/body/main/div[${i + 1}]` },
      text: `Row ${i}`,
      state: {
        visible: true,
        rect: { x: 0, y: 100 + i * 40, width: 360, height: 40 },
        textContent: `Row ${i}`,
        computedStyles: {
          fontSize: '14px',
          lineHeight: '20px',
          position: 'static',
          overflow: 'visible',
        },
      },
    })),
    components: [],
  };
}

const TARGETS = {
  schema: 'ui-bridge/density-targets@1',
  surface: '/rows',
  profile: 'audience_profile/synthetic@1',
  roles: [
    {
      role: 'buyer',
      asks: [
        {
          id: 'B1',
          rank: 1,
          weight: 1,
          kind: 'state',
          question: 'Which rows are open?',
          source: { doc: 'audience_profile/synthetic@1', quote: 'Buyers read the rows.' },
          answer: { idPrefix: 'app.rows.' },
        },
      ],
    },
  ],
};

/** One rule with a null limit: the verdict is `unknown`, exit 3. */
const BUDGET = {
  schema: 'ui-bridge/density-budget@1',
  source: null,
  matrix: [],
  rules: [{ id: 'items', quantity: 'cell.items', max: null }],
};

/** 2000 such rules: an answer far larger than a pipe holds (64 KiB on Linux). */
const BIG_BUDGET = {
  ...BUDGET,
  rules: Array.from({ length: 2000 }, (_, i) => ({
    id: `items-${i}`,
    quantity: 'cell.items',
    max: null,
  })),
};

beforeAll(() => {
  // Built once by vitest.global-setup.ts before any worker starts.
  expect(existsSync(BIN), missingOutputMessage(BIN)).toBe(true);
  dir = mkdtempSync(join(tmpdir(), 'ui-bridge-density-signal-'));
  writeFileSync(join(dir, 'targets.json'), JSON.stringify(TARGETS));
  writeFileSync(join(dir, 'budget.json'), JSON.stringify(BUDGET));
  writeFileSync(join(dir, 'snapshot.json'), JSON.stringify(snapshot(3)));
  writeFileSync(join(dir, 'big-budget.json'), JSON.stringify(BIG_BUDGET));
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/**
 * Spawn the bin with the step trace on; `reached` resolves once the run has
 * reached `step`. With `drain: false` stdout is not read until `drain()`, so a
 * report larger than the pipe holds keeps the run alive after it printed.
 */
function spawnTraced(args: string[], step: string, drain = true) {
  const child = spawn(process.execPath, [BIN, ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, UI_BRIDGE_DENSITY_TRACE: '1' },
  });
  let stdout = '';
  let stderr = '';
  const readOut = () =>
    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString('utf8');
    });
  if (drain) readOut();
  // 'close', not 'exit': stdio is drained only by then.
  const closed = new Promise<number | null>((r) => child.on('close', (code) => r(code)));
  const reached = new Promise<void>((ready) => {
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString('utf8');
      if (stderr.includes(`ui-bridge-density: step ${step}\n`)) ready();
    });
  });
  return {
    child,
    closed,
    reached,
    drain: readOut,
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

describe.skipIf(process.platform === 'win32')('ui-bridge-density interrupted', () => {
  it.each([
    ['SIGTERM', 143],
    ['SIGINT', 130],
    ['SIGHUP', 129],
  ] as const)(
    'measure: %s while reading the snapshot prints a typed verdict naming the step and exits %i',
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

  it('assert: SIGTERM while reading the snapshot names the verb and the step, exit 143', async () => {
    const run = spawnTraced(
      ['assert', '--budget', join(dir, 'budget.json'), '--snapshot', '-', '--role', 'buyer'],
      'read-snapshot'
    );
    await run.reached;
    run.child.kill('SIGTERM');
    expect(await run.closed).toBe(143);
    expect(JSON.parse(run.stdout())).toEqual({
      command: 'assert',
      interrupted: { signal: 'SIGTERM', step: 'read-snapshot' },
    });
  }, 60_000);

  it('lint: SIGINT while reading the profile text names the verb and the step, exit 130', async () => {
    const run = spawnTraced(
      ['lint', '--targets', join(dir, 'targets.json'), '--profile-text', '-'],
      'read-profile'
    );
    await run.reached;
    run.child.kill('SIGINT');
    expect(await run.closed).toBe(130);
    expect(JSON.parse(run.stdout())).toEqual({
      command: 'lint',
      interrupted: { signal: 'SIGINT', step: 'read-profile' },
    });
  }, 60_000);

  it('a signal after the verdict is printed notes that it stands, and keeps the verdict and its code', async () => {
    // The answer to 2000 rules is larger than a pipe holds, and stdout is not
    // read: the run has printed its verdict and is waiting for it to flush.
    const run = spawnTraced(
      [
        'assert',
        '--budget',
        join(dir, 'big-budget.json'),
        '--snapshot',
        join(dir, 'snapshot.json'),
        '--role',
        'buyer',
      ],
      'print',
      false
    );
    await run.reached;
    run.child.kill('SIGTERM');
    // Let the handler run before the reader frees the pipe.
    await new Promise((r) => setTimeout(r, 200));
    run.drain();
    expect(await run.closed).toBe(3);
    expect(run.stderr()).toContain(
      'ui-bridge-density: SIGTERM after the verdict was printed; the verdict stands\n'
    );
    const doc = JSON.parse(run.stdout()) as {
      command: string;
      counts: unknown;
      interrupted?: unknown;
    };
    expect(doc.command).toBe('assert');
    expect(doc.interrupted).toBeUndefined();
    expect(doc.counts).toEqual({ pass: 0, fail: 0, unknown: 2000 });
  }, 60_000);
});
