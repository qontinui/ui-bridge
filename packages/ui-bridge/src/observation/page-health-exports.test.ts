/**
 * Public-entry contract for the shared snapshot -> page-health step.
 *
 * `diagnoseSnapshotPageHealth` / `pageHealthInputFromSnapshot` are the one
 * snapshot -> `PageHealthInput` mapping every in-package transport uses
 * (server handler, relay handler, in-app `pageHealth` command). A host that
 * answers page health over its own transport — the qontinui-runner webview's
 * `pageHealth` IPC — must reach the same step through the package's public
 * entries instead of restating it, or the two copies drift (the `?? []`
 * hazard: "could not see" becoming "saw nothing").
 *
 * Plan: 2026-09-20-ui-bridge-observations-distinguish-cannot-see-from-not-present-and-carry-provenance
 */

import { describe, expect, it } from 'vitest';
import * as root from '../index';
import * as observation from './index';
import { diagnoseSnapshotPageHealth, pageHealthInputFromSnapshot } from '../server/page-health';

describe('page-health snapshot step on the public entries', () => {
  it.each([
    ['@qontinui/ui-bridge', root],
    ['@qontinui/ui-bridge/observation', observation],
  ])('%s exports the shared step itself, not a copy', (_entry, mod) => {
    expect(mod.diagnoseSnapshotPageHealth).toBe(diagnoseSnapshotPageHealth);
    expect(mod.pageHealthInputFromSnapshot).toBe(pageHealthInputFromSnapshot);
  });

  it('a snapshot with no elements stays missing (no `?? []`)', () => {
    expect(observation.pageHealthInputFromSnapshot({ components: [] }).elements).toBeUndefined();
    const obs = observation.diagnoseSnapshotPageHealth(() => ({ components: [] }));
    expect(obs.status).toBe('unknown');
    expect(obs.status === 'unknown' && obs.unknown.code).toBe('input_missing');
  });

  it('a snapshot that throws is unknown{producer_failed}, not a throw', () => {
    const obs = observation.diagnoseSnapshotPageHealth(() => {
      throw new Error('boom');
    });
    expect(obs.status).toBe('unknown');
    expect(obs.status === 'unknown' && obs.unknown.code).toBe('producer_failed');
  });
});
