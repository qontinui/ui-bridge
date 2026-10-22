/**
 * Action-verb vocabulary: the "did you mean" table for unknown element actions.
 *
 * Plan `2026-10-22-runner-ui-bridge-makes-an-agent-guess-its-own-vocabulary`,
 * D3 / Phase 8. An agent that sends a near-miss verb (`press` to a web input,
 * `fill` instead of `type`, `dblclick`) used to get the global action list or a
 * bare `Unknown action: <verb>`. It now gets the element's own accepted verbs
 * and, where one exists, a single suggestion.
 *
 * Each entry maps a commonly-guessed verb to an ORDERED list of candidates. The
 * suggestion is the first candidate the element actually accepts, so `press`
 * resolves to `sendKeys` on a text input and to `click` on a button, and a
 * suggestion is never a verb the element would also reject. Candidate lists
 * name both the web verb (`click`) and the native one (`press`); the
 * per-element accepted filter chooses between them.
 *
 * DUPLICATE OF `@qontinui/ui-bridge` `src/control/actionVocabulary.ts` —
 * DELIBERATELY NOT AN IMPORT. `@qontinui/ui-bridge` is an OPTIONAL
 * peerDependency of this package (see the header of `core/abortable.ts`), so a
 * consumer may install `@qontinui/ui-bridge-native` alone. The runner's
 * Phase 1 copy (in flight, `src-tauri/src/mcp/ui_bridge/action_vocabulary.rs`)
 * mirrors this table. Each copy's tests assert the entries as literals; keep
 * them in sync.
 */

/** Commonly-guessed verb → ordered canonical candidates. */
export const ACTION_VERB_SYNONYMS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  press: ['sendKeys', 'click'],
  keypress: ['sendKeys', 'click'],
  keyPress: ['sendKeys', 'click'],
  pressKey: ['sendKeys', 'click'],
  key: ['sendKeys', 'click'],
  keydown: ['sendKeys', 'click'],
  keyDown: ['sendKeys', 'click'],
  fill: ['type'],
  input: ['type'],
  enter: ['type'],
  write: ['type'],
  typeText: ['type'],
  tap: ['click', 'press'],
  activate: ['click', 'press'],
  click: ['press'],
  rightclick: ['rightClick'],
  contextmenu: ['rightClick'],
  contextMenu: ['rightClick'],
  middleclick: ['middleClick'],
  dblclick: ['doubleClick'],
  dblClick: ['doubleClick'],
  mouseover: ['hover'],
  mouseenter: ['hover'],
  scrollTo: ['scrollIntoView'],
});

/** Lower-cased lookup over {@link ACTION_VERB_SYNONYMS} (a `Map`, so `constructor` never resolves). */
const SYNONYMS_BY_LOWER = new Map<string, readonly string[]>(
  Object.entries(ACTION_VERB_SYNONYMS).map(([verb, candidates]) => [verb.toLowerCase(), candidates])
);

/**
 * Suggest the verb the caller most likely meant.
 *
 * - A verb the element accepts EXACTLY is never corrected (`undefined`), so
 *   `press` keeps its native meaning on an element that advertises `press`.
 * - A case-insensitive exact match fixes the case (`sendkeys` → `sendKeys`).
 * - Otherwise the first synonym candidate the element accepts, spelled as the
 *   element spells it.
 * - Otherwise `undefined`.
 */
export function suggestAction(requested: string, accepted: readonly string[]): string | undefined {
  if (accepted.includes(requested)) return undefined;
  const lower = requested.toLowerCase();
  const byLower = new Map(accepted.map((verb) => [verb.toLowerCase(), verb]));
  const caseFixed = byLower.get(lower);
  if (caseFixed !== undefined) return caseFixed;
  for (const candidate of SYNONYMS_BY_LOWER.get(lower) ?? []) {
    const match = byLower.get(candidate.toLowerCase());
    if (match !== undefined) return match;
  }
  return undefined;
}

/** The structured half of an unknown-action refusal. */
export interface UnknownActionHint {
  /** Human-readable refusal naming the accepted verbs and the suggestion. */
  message: string;
  /** The suggested verb, when one exists. */
  didYouMean?: string;
  /** The verbs listed as accepted (de-duplicated, in the order given). */
  supportedActions: string[];
}

/**
 * Build the refusal for an unknown action.
 *
 * `accepted` is the element's own accepted list: its advertised `actions` plus
 * its custom actions, or — when the element advertises none — every verb the
 * executor runs (which is then genuinely what it accepts). The suggestion is
 * drawn ONLY from `accepted`, so it is never a verb the element would reject.
 * `elementId` is omitted when the target is not a known element.
 */
export function describeUnknownAction(
  requested: string,
  options: { accepted: readonly string[]; elementId?: string }
): UnknownActionHint {
  const supportedActions = Array.from(new Set(options.accepted));
  const didYouMean = suggestAction(requested, supportedActions);
  const subject = options.elementId !== undefined ? ` for element '${options.elementId}'` : '';
  const listLabel = options.elementId !== undefined ? 'This element accepts' : 'Supported';
  const message =
    `Unknown action '${requested}'${subject}. ${listLabel}: ${supportedActions.join(', ')}.` +
    (didYouMean !== undefined ? ` Did you mean '${didYouMean}'?` : '');
  return didYouMean !== undefined
    ? { message, didYouMean, supportedActions }
    : { message, supportedActions };
}

/**
 * The structured fields of a hint, for a failure's `context` bag — with no
 * `didYouMean` key at all when there is no suggestion.
 */
export function unknownActionContext(hint: UnknownActionHint): {
  supportedActions: string[];
  didYouMean?: string;
} {
  return hint.didYouMean !== undefined
    ? { supportedActions: hint.supportedActions, didYouMean: hint.didYouMean }
    : { supportedActions: hint.supportedActions };
}
