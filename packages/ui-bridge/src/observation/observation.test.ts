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
