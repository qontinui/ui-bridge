/**
 * Type-level test for the argument order of `getElementState`
 * (`server/types.ts`). Typechecked by `npm run typecheck` (tsconfig includes
 * `.test-d.ts`; vitest does not run it) — see `core/redaction.brand.test-d.ts`
 * for the mechanism.
 *
 * 0.47.0 shipped `getElementState(id, query?, context?)`. It is
 * `(id, context?, query?)` again, the order of every caller before 0.47.0. A
 * TypeScript caller written against 0.47.0 is told so at compile time:
 * `ElementStateQuery` and `HandlerContext` share no key, so neither is
 * accepted in the other's slot. A JavaScript caller is not told, and runs with
 * the two swapped — see the note on `UIBridgeServerHandlers.getElementState`.
 * Each `@ts-expect-error` below fails the typecheck (TS2578, an unused
 * directive) the day the two types grow a key in common and the swapped call
 * compiles silently.
 */

import type { ElementStateQuery, HandlerContext, UIBridgeServerHandlers } from './types';

declare const getElementState: UIBridgeServerHandlers['getElementState'];
declare const query: ElementStateQuery;
declare const context: HandlerContext;

// The order this release takes, and the shorter calls it keeps.
void getElementState('save', context, query);
void getElementState('save', undefined, query);
void getElementState('save', context);
void getElementState('save');

// @ts-expect-error a query is not a HandlerContext: 0.47.0's (id, query, context)
void getElementState('save', query, context);
// @ts-expect-error a query is not a HandlerContext: 0.47.0's (id, query)
void getElementState('save', query);
