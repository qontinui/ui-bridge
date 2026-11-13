/**
 * Type-level half of `redaction-exports.test.ts`: the opaque `RedactionVerdict`
 * type resolves from `@qontinui/ui-bridge` and `@qontinui/ui-bridge/core`.
 * A type has no runtime value, so the vitest half cannot see it. This file is
 * typechecked by `npm run typecheck` instead (tsconfig includes `.test-d.ts`,
 * vitest does not run it; see `redaction.brand.test-d.ts` for the mechanism).
 * Dropping the `export type { RedactionVerdict }` line from `core/index.ts`
 * fails both imports below with TS2305.
 *
 * Plan: 2026-11-13-the-runners-ui-bridge-subtree-read-serves-redacted-attributes-raw
 */

import type { RedactionVerdict } from './redaction';
import type { RedactionVerdict as CoreRedactionVerdict } from './index';
import type { RedactionVerdict as RootRedactionVerdict } from '../index';

/** Compiles only when `T` is exactly `true`. */
type Assert<T extends true> = T;

/** `true` only when `A` and `B` are the identical type, not merely assignable. */
type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// Each entry names the module's own branded verdict, not a lookalike shape.
type CoreVerdictIsTheModules = Assert<Same<CoreRedactionVerdict, RedactionVerdict>>;
type RootVerdictIsTheModules = Assert<Same<RootRedactionVerdict, RedactionVerdict>>;

export type { CoreVerdictIsTheModules, RootVerdictIsTheModules };

// `readValuePrimitive`'s result types resolve from the control entry, so a host
// that maps the result onto its own transport can name them.
import type { ReadValueResult, ReadValueHit, PrimitiveResult } from '../server/page-primitives';
import type {
  ReadValueResult as ControlReadValueResult,
  ReadValueHit as ControlReadValueHit,
  PrimitiveResult as ControlPrimitiveResult,
} from '../control/index';

type ControlReadValueResultIsTheModules = Assert<Same<ControlReadValueResult, ReadValueResult>>;
type ControlReadValueHitIsTheModules = Assert<Same<ControlReadValueHit, ReadValueHit>>;
type ControlPrimitiveResultIsTheModules = Assert<
  Same<ControlPrimitiveResult<ReadValueResult>, PrimitiveResult<ReadValueResult>>
>;

export type {
  ControlReadValueResultIsTheModules,
  ControlReadValueHitIsTheModules,
  ControlPrimitiveResultIsTheModules,
};
