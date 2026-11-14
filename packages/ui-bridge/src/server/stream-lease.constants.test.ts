/**
 * `STREAM_LEASE_MS` is a numeric literal (plan
 * 2026-11-09-a-dead-relay-tab-stays-the-operators-primary-and-a-command-sent-during-a-stream-reopen-is-lost,
 * Phase 2): qontinui-web restates the lease beside its other transport
 * cadences, reading the bundled `name = <numeric literal>;`.
 *
 * Kept apart from stream-lease.test.ts, which imports no lease module, so that
 * file still runs case by case against a relay that predates one.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STREAM_LEASE_MS } from './stream-lease';

describe('relay stream lease · STREAM_LEASE_MS', () => {
  it('is declared as the numeric literal 50_000 (qontinui-web restates it)', () => {
    expect(STREAM_LEASE_MS).toBe(50_000);
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(here, 'stream-lease.ts'), 'utf8');
    expect(source).toMatch(/^export const STREAM_LEASE_MS = 50_000;$/m);
  });
});
