/**
 * The relay client's command memory — plan
 * `2026-11-09-a-dead-relay-tab-stays-the-operators-primary-and-a-command-sent-during-a-stream-reopen-is-lost`,
 * Phase 4 (D3, D4).
 *
 * One page instance runs a command once however many times it is delivered.
 * For 60 s after that run settles, every later delivery gets its outcome, so a
 * redelivery can be answered even when the first answer never reached the
 * relay. After that the outcome is released, and a later delivery gets nothing:
 * it is neither run nor answered. The keys are bounded separately: at most the
 * last 512 and nothing older than 10 minutes, whichever binds first. The key a
 * delivery is deduped on is its original command's id.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createCommandDedupe, dedupeKeyOf } from './command-dedupe';

/** A run that counts its calls and resolves to `<key>#<call number>`. */
function countingRun(key: string, counter: { runs: number }) {
  return () => {
    counter.runs++;
    return Promise.resolve(`${key}#${counter.runs}`);
  };
}

describe('createCommandDedupe', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs a key once and hands every later delivery inside the window that same outcome', async () => {
    const dedupe = createCommandDedupe<string>();
    const counter = { runs: 0 };
    await expect(dedupe.outcomeOf('c1', countingRun('c1', counter))).resolves.toBe('c1#1');
    await expect(dedupe.outcomeOf('c1', countingRun('c1', counter))).resolves.toBe('c1#1');
    expect(counter.runs).toBe(1);
    await expect(dedupe.outcomeOf('c2', countingRun('c2', counter))).resolves.toBe('c2#2');
    expect(counter.runs).toBe(2);
  });

  it('a delivery while the first run is still going gets its outcome when it settles', async () => {
    const dedupe = createCommandDedupe<string>();
    let finish: (value: string) => void = () => {};
    const firstRun = new Promise<string>((resolve) => {
      finish = resolve;
    });
    let runs = 0;
    const first = dedupe.outcomeOf('c1', () => {
      runs++;
      return firstRun;
    });
    const second = dedupe.outcomeOf('c1', () => {
      runs++;
      return Promise.resolve('second run');
    });
    finish('first run');

    await expect(first).resolves.toBe('first run');
    await expect(second).resolves.toBe('first run');
    expect(runs).toBe(1);
  });

  it('remembers at most 512 keys: the 513th evicts the oldest', async () => {
    const dedupe = createCommandDedupe<string>();
    const counter = { runs: 0 };
    for (let i = 0; i < 512; i++) await dedupe.outcomeOf(`k${i}`, countingRun(`k${i}`, counter));
    expect(counter.runs).toBe(512);
    await dedupe.outcomeOf('k0', countingRun('k0', counter));
    await dedupe.outcomeOf('k511', countingRun('k511', counter));
    expect(counter.runs).toBe(512);

    await dedupe.outcomeOf('k512', countingRun('k512', counter));
    expect(counter.runs).toBe(513);
    await dedupe.outcomeOf('k1', countingRun('k1', counter));
    expect(counter.runs).toBe(513);
    await expect(dedupe.outcomeOf('k0', countingRun('k0', counter))).resolves.toBe('k0#514');
  });

  it('forgets a key 10 minutes after its first delivery, and not a millisecond sooner', async () => {
    const dedupe = createCommandDedupe<string>();
    const counter = { runs: 0 };
    await dedupe.outcomeOf('c1', countingRun('c1', counter));
    vi.advanceTimersByTime(599_999);
    // Long past its outcome's 60 s, the key still blocks a re-run.
    expect(dedupe.outcomeOf('c1', countingRun('c1', counter))).toBeNull();
    expect(counter.runs).toBe(1);
    vi.advanceTimersByTime(1);
    await expect(dedupe.outcomeOf('c1', countingRun('c1', counter))).resolves.toBe('c1#2');
  });

  it("a repeat delivery does not extend a key's 10 minutes", async () => {
    const dedupe = createCommandDedupe<string>();
    const counter = { runs: 0 };
    await dedupe.outcomeOf('c1', countingRun('c1', counter));
    vi.advanceTimersByTime(300_000);
    expect(dedupe.outcomeOf('c1', countingRun('c1', counter))).toBeNull();
    vi.advanceTimersByTime(300_000);
    await expect(dedupe.outcomeOf('c1', countingRun('c1', counter))).resolves.toBe('c1#2');
  });
});

describe('createCommandDedupe · a run outcome is kept 60 s after the run settles', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a delivery 59 s after the run settled gets its outcome', async () => {
    const dedupe = createCommandDedupe<string>();
    const counter = { runs: 0 };
    await dedupe.outcomeOf('c1', countingRun('c1', counter));
    vi.advanceTimersByTime(59_000);
    await expect(dedupe.outcomeOf('c1', countingRun('c1', counter))).resolves.toBe('c1#1');
    expect(counter.runs).toBe(1);
  });

  it('61 s after, the outcome is released: the delivery gets nothing and runs nothing', async () => {
    const dedupe = createCommandDedupe<string>();
    const counter = { runs: 0 };
    await dedupe.outcomeOf('c1', countingRun('c1', counter));
    vi.advanceTimersByTime(61_000);
    expect(dedupe.outcomeOf('c1', countingRun('c1', counter))).toBeNull();
    expect(counter.runs).toBe(1);
  });

  it('the 60 s start when the run settles, not when it starts', async () => {
    const dedupe = createCommandDedupe<string>();
    let finish: (value: string) => void = () => {};
    const slowRun = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const first = dedupe.outcomeOf('c1', () => slowRun);
    vi.advanceTimersByTime(30_000);
    finish('slow run');
    await first;

    vi.advanceTimersByTime(59_000);
    await expect(dedupe.outcomeOf('c1', () => Promise.resolve('again'))).resolves.toBe('slow run');
    vi.advanceTimersByTime(2_000);
    expect(dedupe.outcomeOf('c1', () => Promise.resolve('again'))).toBeNull();
  });

  it('releaseOutcomes() drops every kept outcome at once, and the keys still block a re-run', async () => {
    const dedupe = createCommandDedupe<string>();
    const counter = { runs: 0 };
    await dedupe.outcomeOf('c1', countingRun('c1', counter));
    await dedupe.outcomeOf('c2', countingRun('c2', counter));
    dedupe.releaseOutcomes();

    expect(dedupe.outcomeOf('c1', countingRun('c1', counter))).toBeNull();
    expect(dedupe.outcomeOf('c2', countingRun('c2', counter))).toBeNull();
    expect(counter.runs).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('dedupeKeyOf', () => {
  it('keys a redelivered alias on its original, and anything else on its own id', () => {
    expect(dedupeKeyOf({ commandId: 'a1', redeliveryOf: 'c1' })).toBe('c1');
    expect(dedupeKeyOf({ commandId: 'c1' })).toBe('c1');
    expect(dedupeKeyOf({ commandId: 'c1', redeliveryOf: '' })).toBe('c1');
    expect(dedupeKeyOf({ commandId: 'c1', redeliveryOf: 42 })).toBe('c1');
  });
});
