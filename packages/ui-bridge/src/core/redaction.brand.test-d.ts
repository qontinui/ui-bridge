/**
 * Type-level test for the §4.6 opaque brands. This file has NO runtime tests —
 * it is not picked up by vitest (whose include is `.test.ts` / `.test.tsx`,
 * not `.test-d.ts`) but IS typechecked by `tsc --noEmit` (tsconfig excludes
 * `.test.ts` / `.test.tsx`, again NOT `.test-d.ts`, while its include glob
 * covers all of `src`). So the assertions below run as part of
 * `npm run typecheck`.
 *
 * Each `@ts-expect-error` asserts that a forgery does NOT compile. If a brand
 * is ever weakened to a plain type alias (or the verdict to a bare object), the
 * forged assignment starts compiling, the directive becomes UNUSED, and tsc
 * fails with TS2578 ("Unused '@ts-expect-error' directive"). That loud failure
 * is the point — the brand's unforgeability is enforced by the build, not by
 * convention. (Verified during Phase 2: flipping `Scrubbed<T>` to `T` turns
 * typecheck red on the first directive; restoring the brand turns it green.)
 */

import type { Scrubbed, RedactionVerdict } from './redaction';

// A raw string must NOT be assignable to the opaque brand — this is the whole
// mechanism (Phase 3 declares wire fields as `Scrubbed<string>`).
// @ts-expect-error raw string is not assignable to the opaque Scrubbed brand
const x: Scrubbed<string> = 'secret';

// The verdict token must NOT be hand-constructible from bare booleans — that is
// the bare-boolean bypass the brand exists to prevent.
// @ts-expect-error a verdict cannot be forged from a plain {value, content} literal
const v: RedactionVerdict = { value: false, content: false };

// Reference both bindings so this stays clean under any future `noUnusedLocals`.
void x;
void v;
