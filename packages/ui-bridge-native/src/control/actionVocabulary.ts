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
 * consumer may install `@qontinui/ui-bridge-native` alone. The runner carries a
 * Rust copy (`src-tauri/src/mcp/ui_bridge/action_vocabulary.rs`), which folds
 * spelling the same way {@link foldVerb} does. No test spans the copies: each
 * copy's tests assert the entries as literals; keep them in sync.
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
  // The runner's built-in aliases. Not SDK verbs, so a caller who sends one is
  // told the canonical verb instead of getting no suggestion.
  double: ['doubleClick'],
  right: ['rightClick'],
  middle: ['middleClick'],
  mouseover: ['hover'],
  mouseenter: ['hover'],
  scrollTo: ['scrollIntoView'],
});

/**
 * A verb reduced to what spelling cannot change: trimmed, lower-cased, no `_`
 * or `-`. `send_keys`, `Send-Keys` and ` sendkeys ` all fold to `sendkeys`,
 * matching the runner's `fold_verb`.
 */
export function foldVerb(verb: string): string {
  return verb.trim().replace(/[_-]/g, '').toLowerCase();
}

/** Folded lookup over {@link ACTION_VERB_SYNONYMS} (a `Map`, so `constructor` never resolves). */
const SYNONYMS_BY_FOLDED = new Map<string, readonly string[]>(
  Object.entries(ACTION_VERB_SYNONYMS).map(([verb, candidates]) => [foldVerb(verb), candidates])
);

/**
 * Suggest the verb the caller most likely meant.
 *
 * - A verb the element accepts EXACTLY is never corrected (`undefined`), so
 *   `press` keeps its native meaning on an element that advertises `press`.
 * - A spelling-only difference is fixed (`sendkeys`, `send_keys` or
 *   ` sendKeys ` → `sendKeys`); see {@link foldVerb}.
 * - Otherwise the first synonym candidate the element accepts, spelled as the
 *   element spells it, the keyboard verbs' candidates ordered for the element
 *   ({@link orderForElement}).
 * - Otherwise `undefined`.
 */
export function suggestAction(requested: unknown, accepted: readonly string[]): string | undefined {
  // The verb arrives off the wire: a body with no `action`, or a non-string
  // one, gets the refusal with no suggestion instead of a TypeError here.
  if (typeof requested !== 'string') return undefined;
  if (requested.trim() === '' || accepted.includes(requested)) return undefined;
  const folded = foldVerb(requested);
  const byFolded = new Map<string, string>();
  for (const verb of accepted) {
    const key = foldVerb(verb);
    if (!byFolded.has(key)) byFolded.set(key, verb);
  }
  const spellingFixed = byFolded.get(folded);
  if (spellingFixed !== undefined) return spellingFixed;
  for (const candidate of orderForElement(SYNONYMS_BY_FOLDED.get(folded) ?? [], byFolded)) {
    const match = byFolded.get(foldVerb(candidate));
    if (match !== undefined) return match;
  }
  return undefined;
}

/**
 * The keyboard verbs' candidates (`press` → `sendKeys`, `click`), ordered by
 * what the element is. Every web element accepts `sendKeys`, so the fixed
 * order would answer `press` on a button with `sendKeys`. On an element that
 * takes text entry — it accepts `type` — a key press is keyboard input, so
 * `sendKeys` leads; on any other element `click` does. The synonym table keeps
 * its one fixed order; only the suggestion reorders.
 */
function orderForElement(
  candidates: readonly string[],
  byFolded: ReadonlyMap<string, string>
): readonly string[] {
  if (byFolded.has(foldVerb('type'))) return candidates;
  const keys = candidates.indexOf('sendKeys');
  const click = candidates.indexOf('click');
  if (keys === -1 || click === -1 || click < keys) return candidates;
  const reordered = [...candidates];
  reordered[keys] = 'click';
  reordered[click] = 'sendKeys';
  return reordered;
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
 * Render a wire verb for the refusal text without ever throwing. `String()` on
 * a parsed JSON object whose own `toString` is not a function (e.g.
 * `{"toString":"x"}`) throws, which would turn the refusal into a crash.
 */
function renderVerb(requested: unknown): string {
  if (typeof requested === 'string') return requested;
  try {
    return JSON.stringify(requested) ?? String(requested);
  } catch {
    return '<non-string>';
  }
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
  requested: unknown,
  options: { accepted: readonly string[]; elementId?: string }
): UnknownActionHint {
  const supportedActions = Array.from(new Set(options.accepted));
  const didYouMean = suggestAction(requested, supportedActions);
  const subject = options.elementId !== undefined ? ` for element '${options.elementId}'` : '';
  const listLabel = options.elementId !== undefined ? 'This element accepts' : 'Supported';
  const message =
    `Unknown action '${renderVerb(requested)}'${subject}. ${listLabel}: ${supportedActions.join(', ')}.` +
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
