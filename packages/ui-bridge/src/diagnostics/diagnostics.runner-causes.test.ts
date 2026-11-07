/**
 * The diagnostic codes for distinct CAUSES must be distinct codes.
 *
 * Before plan 2026-09-20-ui-bridge-observations-… Phase 3, three runner-backing
 * causes shared two codes, one of them borrowed: `RUNNER_REQUIRED` (the build
 * does not serve the route) mapped to `UB-ACTION-REJECTED` as if a guard had
 * refused an action, and `RUNNER_UNAVAILABLE` (could not reach the runner) and
 * `RUNNER_ERROR` (reached it, it answered an error) both mapped to
 * `UB-NET-ERROR`. A consumer branching on the code could not tell them apart.
 */

import { describe, expect, it } from 'vitest';
import {
  DIAGNOSTICS,
  INTERNAL_CODE_TO_CANONICAL,
  UI_BRIDGE_ERROR_CODES,
  UNKNOWN_CODE_DIAGNOSTICS,
  mapInternalErrorCode,
} from './index';
import { UNKNOWN_CODES } from '../observation/observation';

const RUNNER_CAUSES = ['RUNNER_REQUIRED', 'RUNNER_UNAVAILABLE', 'RUNNER_ERROR'] as const;

describe('runner-backing causes map to distinct codes', () => {
  it('no two runner causes share a code', () => {
    const codes = RUNNER_CAUSES.map((c) => INTERNAL_CODE_TO_CANONICAL[c]);
    expect(codes.every((c) => typeof c === 'string')).toBe(true);
    expect(new Set(codes).size).toBe(RUNNER_CAUSES.length);
  });

  it('no runner cause shares its code with ANY other source cause in the table', () => {
    for (const cause of RUNNER_CAUSES) {
      const code = INTERNAL_CODE_TO_CANONICAL[cause];
      const sharers = Object.entries(INTERNAL_CODE_TO_CANONICAL)
        .filter(([other, c]) => other !== cause && c === code)
        .map(([other]) => other);
      expect(sharers, `${cause} -> ${code} is shared`).toEqual([]);
    }
  });

  it('a build that lacks the capability is a capability statement, not an action rejection', () => {
    expect(mapInternalErrorCode('RUNNER_REQUIRED')).toBe('UB-CAPABILITY-UNAVAILABLE');
    expect(mapInternalErrorCode('RUNNER_REQUIRED')).not.toMatch(/^UB-ACTION-/);
  });

  it('unreachable and answered-with-an-error are told apart', () => {
    expect(mapInternalErrorCode('RUNNER_UNAVAILABLE')).toBe('UB-OBS-APP-UNREACHABLE');
    expect(mapInternalErrorCode('RUNNER_ERROR')).toBe('UB-OBS-PRODUCER-FAILED');
  });
});

describe('UnknownCode -> diagnostic code', () => {
  it('covers every UnknownCode with a registered diagnostic code', () => {
    for (const code of UNKNOWN_CODES) {
      const diag = UNKNOWN_CODE_DIAGNOSTICS[code];
      expect(diag, code).toBe(`UB-OBS-${code.toUpperCase().replace(/_/g, '-')}`);
      expect(DIAGNOSTICS[diag], diag).toBeDefined();
    }
  });

  it('is injective — no two unknown causes share a code', () => {
    const codes = Object.values(UNKNOWN_CODE_DIAGNOSTICS);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.length).toBe(UNKNOWN_CODES.length);
  });

  // The reverse direction: a `UB-OBS-*` registry entry that no UnknownCode
  // carries is a diagnostic no envelope can ever emit. Same check as the
  // Python client's tests/test_unknown_code_registry.py and vision-core's
  // tests/unknown_code_registry.rs, so the registry and the closed set are
  // pinned both ways here too.
  it('maps back — every UB-OBS-* registry code is the diagnostic of exactly one UnknownCode', () => {
    const obsCodes = UI_BRIDGE_ERROR_CODES.filter((c) => c.startsWith('UB-OBS-'));
    // A probe that found (almost) nothing would pass vacuously; the same floor
    // as the Rust and Python twins.
    expect(obsCodes.length).toBeGreaterThanOrEqual(9);
    for (const diag of obsCodes) {
      const owners = UNKNOWN_CODES.filter((code) => UNKNOWN_CODE_DIAGNOSTICS[code] === diag);
      expect(owners, `${diag} is the diagnostic of ${owners.length} UnknownCode members`).toHaveLength(1);
    }
  });

  it('registers the capability code the RUNNER_REQUIRED mapping names', () => {
    expect(DIAGNOSTICS['UB-CAPABILITY-UNAVAILABLE']).toBeDefined();
  });
});
