/**
 * Public-entry contract for the §4.6 redaction predicates.
 *
 * `verdictOf` / `isValueRedacted` / `isContentRedacted` and the
 * `REDACTED_VALUE` sentinel are the SDK's one redaction choke point
 * (`core/redaction.ts`). A host that reads the live DOM over its own
 * transport — the qontinui-runner's `/tree` subtree read — must apply that
 * verdict through the package's public entries instead of re-deriving the
 * boundary walk, or the two copies drift and one door serves what another
 * withholds. No barrel re-exported `./redaction` before this, so none of them
 * resolved from `@qontinui/ui-bridge` or `@qontinui/ui-bridge/core`.
 *
 * `readValuePrimitive` is the read-value primitive that gates every element
 * with `isValueRedacted`; `@qontinui/ui-bridge/control` exports it so a host
 * can call it instead of an ungated copy.
 *
 * The `RedactionVerdict` type export is pinned by the type-level half,
 * `redaction-exports.test-d.ts` (a type has no runtime value to compare).
 *
 * Plan: 2026-11-13-the-runners-ui-bridge-subtree-read-serves-redacted-attributes-raw
 */

import { describe, expect, it } from 'vitest';
import * as root from '../index';
import * as core from './index';
import * as control from '../control/index';
import { REDACTED_VALUE, verdictOf, isValueRedacted, isContentRedacted } from './redaction';
import { readValuePrimitive } from '../server/page-primitives';

describe('§4.6 redaction predicates on the public entries', () => {
  it.each([
    ['@qontinui/ui-bridge', root],
    ['@qontinui/ui-bridge/core', core],
  ])('%s re-exports the core/redaction bindings', (_entry, mod) => {
    expect(mod.verdictOf).toBe(verdictOf);
    expect(mod.isValueRedacted).toBe(isValueRedacted);
    expect(mod.isContentRedacted).toBe(isContentRedacted);
    expect(mod.REDACTED_VALUE).toBe(REDACTED_VALUE);
  });

  it('the sentinel is the literal a redacted wire field carries', () => {
    expect(REDACTED_VALUE).toBe('[REDACTED]');
    expect(root.REDACTED_VALUE).toBe('[REDACTED]');
    expect(core.REDACTED_VALUE).toBe('[REDACTED]');
  });
});

describe('the gated readValue primitive on the public entries', () => {
  it.each([
    ['@qontinui/ui-bridge', root],
    ['@qontinui/ui-bridge/control', control],
  ])('%s exports readValuePrimitive itself, not a copy', (_entry, mod) => {
    expect(mod.readValuePrimitive).toBe(readValuePrimitive);
  });
});
