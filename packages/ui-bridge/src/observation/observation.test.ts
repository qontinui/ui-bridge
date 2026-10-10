/**
 * Wire-shape tests for the Observation envelope.
 *
 * These assert the SERIALIZED JSON directly — never a round trip through the
 * TS type — because the defect this envelope closes is a key that silently
 * went missing on the wire (coord finding 489ed69e lesson 1: `null` is a
 * statement, an absent key is not).
 */

import { describe, expect, it } from 'vitest';
import { Observation, ObservationError, UNKNOWN_CODES, isUnknownCode } from './observation';

const producer = { id: 'sdk/test', version: '0.0.0-test' };

function wire(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

describe('Observation provenance — every key always present', () => {
  it('states null for confidence, cache, observedAt and source rather than omitting them', () => {
    const obs = wire(Observation.measured({ n: 1 }, Observation.provenance({ producer })));
    const prov = obs.provenance as Record<string, unknown>;
    for (const key of [
      'producer',
      'observedAt',
      'evaluatedAt',
      'coverage',
      'confidence',
      'cache',
      'source',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(prov, key), key).toBe(true);
    }
    expect(prov.confidence).toBeNull();
    expect(prov.cache).toBeNull();
    expect(prov.observedAt).toBeNull();
    expect(prov.source).toBeNull();
    expect(typeof prov.evaluatedAt).toBe('string');
    expect(prov.coverage).toEqual({ considered: 0, measured: 0, unmeasured: [] });
  });

  it('keeps cache.storedAt present as null on a miss', () => {
    const obs = wire(
      Observation.measured(
        1,
        Observation.provenance({
          producer,
          cache: { hit: false, storedAt: null, keyInputs: ['mutation_id', 'request'] },
        })
      )
    );
    const cache = (obs.provenance as { cache: Record<string, unknown> }).cache;
    expect(Object.prototype.hasOwnProperty.call(cache, 'storedAt')).toBe(true);
    expect(cache.storedAt).toBeNull();
    expect(cache.keyInputs).toEqual(['mutation_id', 'request']);
  });

  it('renders times as RFC3339 and non-finite confidence as null, finite as clamped', () => {
    const at = Date.UTC(2026, 8, 30, 12, 0, 0);
    const p = Observation.provenance({
      producer,
      observedAt: at,
      evaluatedAt: at,
      confidence: NaN,
    });
    expect(p.observedAt).toBe('2026-09-30T12:00:00.000Z');
    expect(p.evaluatedAt).toBe('2026-09-30T12:00:00.000Z');
    expect(wire(p).confidence).toBeNull();
    expect(Observation.provenance({ producer, confidence: Infinity }).confidence).toBeNull();
    expect(Observation.provenance({ producer, confidence: 0.42 }).confidence).toBe(0.42);
    expect(Observation.provenance({ producer, confidence: 1.5 }).confidence).toBe(1);
  });
});

describe('Observation status arms', () => {
  it('measured carries value and no unknown key', () => {
    const obs = wire(Observation.measured([1, 2], Observation.provenance({ producer })));
    expect(obs.status).toBe('measured');
    expect(obs.value).toEqual([1, 2]);
    expect('unknown' in obs).toBe(false);
    expect(Object.keys(obs).sort()).toEqual(['provenance', 'status', 'value']);
  });

  it('measured over non-empty unmeasured coverage is legal (the degraded case)', () => {
    const prov = Observation.provenance({
      producer,
      coverage: {
        considered: 5,
        measured: 2,
        unmeasured: [{ dimension: 'geometry', count: 3, code: 'input_missing' }],
      },
    });
    expect(Observation.measured('x', prov).status).toBe('measured');
  });

  it('absent over full coverage has neither value nor unknown', () => {
    const obs = wire(
      Observation.absent(
        Observation.provenance({ producer, coverage: Observation.fullCoverage(4) })
      )
    );
    expect(Object.keys(obs).sort()).toEqual(['provenance', 'status']);
    expect(obs.status).toBe('absent');
  });

  it('absent over UNMEASURED coverage throws — "absent" is never asserted over what was not looked at', () => {
    const prov = Observation.provenance({
      producer,
      coverage: {
        considered: 5,
        measured: 2,
        unmeasured: [{ dimension: 'geometry', count: 3, code: 'input_missing' }],
      },
    });
    expect(() => Observation.absent(prov)).toThrow(ObservationError);
    expect(() => Observation.absent(prov)).toThrow(/unmeasured/);
  });

  it('unknown carries a code and detail and never a value', () => {
    const obs = wire(
      Observation.unknown(
        'producer_not_run',
        'nothing registered',
        Observation.provenance({ producer })
      )
    );
    expect(obs.status).toBe('unknown');
    expect(obs.unknown).toEqual({ code: 'producer_not_run', detail: 'nothing registered' });
    expect('value' in obs).toBe(false);
    expect(Object.keys(obs).sort()).toEqual(['provenance', 'status', 'unknown']);
  });

  it('unknown refuses a code outside the closed set', () => {
    expect(() =>
      Observation.unknown('nope' as never, 'x', Observation.provenance({ producer }))
    ).toThrow(ObservationError);
  });

  it('the envelope never contains a verdict word', () => {
    const body = JSON.stringify(
      Observation.unknown('input_missing', 'no elements', Observation.provenance({ producer }))
    );
    expect(body).not.toMatch(/healthy|unhealthy|degraded/);
  });
});

describe('UnknownCode', () => {
  it('is the closed set of the wire contract, in contract order', () => {
    expect(UNKNOWN_CODES).toEqual([
      'app_unreachable',
      'capability_unavailable_in_build',
      'producer_failed',
      'producer_not_run',
      'input_missing',
      'below_confidence_floor',
      'model_reply_unparseable',
      'needs_multi_frame_input',
      'stale_input',
    ]);
    expect(isUnknownCode('stale_input')).toBe(true);
    expect(isUnknownCode('healthy')).toBe(false);
  });
});

describe('constructors refuse what the Rust canon refuses', () => {
  const cov = (over: Partial<Record<string, unknown>>) =>
    ({ considered: 1, measured: 1, unmeasured: [], ...over }) as never;

  it('refuses negative or non-integer counts', () => {
    for (const bad of [
      cov({ considered: -1 }),
      cov({ measured: 1.5 }),
      cov({ unmeasured: [{ dimension: 'geometry', count: -2, code: 'input_missing' }] }),
      cov({ unmeasured: [{ dimension: 'geometry', count: 0.5, code: 'input_missing' }] }),
    ]) {
      expect(() => Observation.provenance({ producer, coverage: bad })).toThrow(ObservationError);
    }
  });

  it('refuses an unmeasured entry whose code is not an UnknownCode', () => {
    expect(() =>
      Observation.provenance({
        producer,
        coverage: cov({ unmeasured: [{ dimension: 'geometry', count: 1, code: 'nope' }] }),
      })
    ).toThrow(/not an UnknownCode/);
  });

  it('refuses a source that is not an object or null', () => {
    for (const bad of [[], 'snap-1', 3]) {
      expect(() => Observation.provenance({ producer, source: bad as never })).toThrow(
        /source must be a JSON object or null/
      );
    }
    expect(Observation.provenance({ producer, source: { snapshotId: 's' } }).source).toEqual({
      snapshotId: 's',
    });
  });

  it('refuses measured(undefined) — the value key would vanish from the wire', () => {
    expect(() => Observation.measured(undefined, Observation.provenance({ producer }))).toThrow(
      ObservationError
    );
    // null is a value and stays legal.
    expect(Observation.measured(null, Observation.provenance({ producer })).status).toBe(
      'measured'
    );
  });

  it('re-checks a hand-built provenance handed to a constructor', () => {
    const good = Observation.provenance({ producer });
    expect(() => Observation.measured(1, { ...good, confidence: 2 })).toThrow(/confidence/);
    expect(() => Observation.absent({ ...good, source: [] as never })).toThrow(/source/);
    expect(() =>
      Observation.unknown('input_missing', 'x', {
        ...good,
        coverage: { considered: -1, measured: 0, unmeasured: [] },
      })
    ).toThrow(/non-negative integer/);
  });
});

describe('timestamps and cache inputs are checked like the Rust canon', () => {
  const good = () => Observation.provenance({ producer });

  it('refuses a non-RFC3339 evaluatedAt / observedAt handed to a constructor', () => {
    for (const bad of ['yesterday', '2026-09-30', '2026-09-30T12:00:00', '2026-13-40T99:00:00Z']) {
      expect(() => Observation.measured(1, { ...good(), evaluatedAt: bad })).toThrow(/evaluatedAt/);
      expect(() => Observation.measured(1, { ...good(), observedAt: bad })).toThrow(/observedAt/);
    }
  });

  it('accepts Z and numeric offsets, with or without fractions', () => {
    for (const ok of [
      '2026-09-30T12:00:00Z',
      '2026-09-30T12:00:00.123Z',
      '2026-09-30T14:00:00+02:00',
      '2026-09-30T12:00:00.5-05:30',
    ]) {
      expect(Observation.measured(1, { ...good(), observedAt: ok, evaluatedAt: ok }).status).toBe(
        'measured'
      );
    }
  });

  it('refuses a non-RFC3339 cache.storedAt and non-string keyInputs', () => {
    expect(() =>
      Observation.measured(1, {
        ...good(),
        cache: { hit: true, storedAt: 'last tuesday', keyInputs: ['mutation_id'] },
      })
    ).toThrow(/storedAt/);
    expect(() =>
      Observation.measured(1, {
        ...good(),
        cache: { hit: true, storedAt: null, keyInputs: ['mutation_id', 7 as never] },
      })
    ).toThrow(/keyInputs/);
    expect(() =>
      Observation.provenance({
        producer,
        cache: { hit: false, storedAt: null, keyInputs: [{} as never] },
      })
    ).toThrow(/keyInputs/);
  });
});

describe('Observation provenance — hand-built timestamps are calendar-checked', () => {
  const withStoredAt = (storedAt: string) => {
    const prov = Observation.provenance({ producer });
    return { ...prov, cache: { hit: true, storedAt, keyInputs: ['request'] } };
  };

  it.each([
    '2026-02-30T00:00:00Z',
    '2026-04-31T00:00:00+01:00',
    '2026-01-01T24:00:00Z',
    '2026-13-01T00:00:00Z',
    '2026-01-01T00:00:00+24:00',
  ])('refuses the impossible instant %s instead of rolling it over', (bad) => {
    expect(() => Observation.measured(1, withStoredAt(bad) as never)).toThrow(ObservationError);
  });

  it.each(['2024-02-29T23:59:59Z', '2026-06-30T23:59:60Z', '2026-01-01t00:00:00.5-05:30'])(
    'accepts the valid instant %s',
    (good) => {
      expect(() => Observation.measured(1, withStoredAt(good) as never)).not.toThrow();
    }
  );
});
