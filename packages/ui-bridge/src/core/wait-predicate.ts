/**
 * Shared guard for the `waitForElementRegistered` predicate, used by both the
 * browser dispatcher (`react/commandHandlers.ts`) and the server handler
 * (`server/handlers.ts`) so the two arms cannot drift.
 */

/** The predicate fields that identify an element. */
export interface WaitPredicateFields {
  id?: unknown;
  label?: unknown;
  testId?: unknown;
  selector?: unknown;
}

/**
 * True when the predicate names at least one non-empty identifying field.
 * A predicate naming none constrains nothing — every registered element
 * matches it — so a wait on it would report the FIRST registered element as
 * a success. Callers refuse such a predicate instead.
 */
export function predicateNamesAField(predicate: WaitPredicateFields | null | undefined): boolean {
  if (!predicate || typeof predicate !== 'object') return false;
  return (['id', 'label', 'testId', 'selector'] as const).some((key) => {
    const value = predicate[key];
    return typeof value === 'string' && value.length > 0;
  });
}

export const EMPTY_WAIT_PREDICATE_MESSAGE =
  'waitForElementRegistered: predicate must name at least one non-empty field ' +
  '(id, label, testId or selector); an empty predicate would match any registered element';
