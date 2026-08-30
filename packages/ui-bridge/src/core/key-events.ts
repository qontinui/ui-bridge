/**
 * Shared keyboard-event primitives.
 *
 * Zero-dependency and browser-safe: pure key-name normalization plus a
 * `KeyboardEvent` dispatch loop, importing nothing. Four call sites share it
 * so the key grammar cannot drift:
 *
 *   - `control/action-executor.ts` — the ELEMENT-scoped `sendKeys` action
 *     (`buildKeyboardEventInit` / `NON_PRINTABLE_KEYS`; it keeps its own
 *     dispatch loop because it interleaves input-value mutation between the
 *     events).
 *   - `server/page-primitives.ts` — the DOCUMENT-scoped `sendKeysToPage`
 *     primitive (this module's `dispatchKeySequence`).
 *   - `react/commandHandlers.ts` — the relay path, via the same primitive and
 *     via `buildKeyboardEventInit` for its own element-scoped `sendKeys` arm.
 *   - `undo/undo-tracker.ts` — the Ctrl+Z / Ctrl+Shift+Z fallback dispatch.
 *
 * EVERY synthetic `KeyboardEvent` in this SDK is constructed from
 * `buildKeyboardEventInit`, which is what guarantees the legacy
 * `keyCode`/`which`/`charCode` fields are present. See its own doc comment for
 * why a missing `keyCode` made handlers silently no-op.
 *
 * WHY A DOCUMENT-SCOPED DISPATCH EXISTS AT ALL: a component that closes on a
 * global key (`document.addEventListener('keydown', …)` — dropdowns, modals,
 * command palettes) has no element to address, so the element-scoped `sendKeys`
 * action cannot reach it. Before this module that branch was untestable and
 * could regress silently.
 *
 * NORMALIZATION IS STRICT BY DESIGN. The convenience string form (`"Escape"`,
 * `"ctrl+Enter"`) is validated against the DOM key-value vocabulary and a
 * misspelling is REJECTED with a named error rather than dispatched as a key no
 * listener will ever match — a dispatch that "succeeds" while doing nothing is
 * exactly the silently-wrong answer this API exists to avoid. The explicit
 * descriptor form (`[{ key: '…' }]`) bypasses vocabulary validation, so an
 * exotic key is still reachable without weakening the default.
 */

/** Modifier flags accepted alongside a key. */
export interface KeyModifiers {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

/** One normalized key press: a DOM `KeyboardEvent.key` value plus modifiers. */
export interface KeyDescriptor {
  key: string;
  modifiers?: KeyModifiers;
}

/**
 * Keys for which browsers do NOT fire `keypress`. Shared with the element-
 * scoped `sendKeys` action so both paths agree on the event triple.
 */
export const NON_PRINTABLE_KEYS: ReadonlySet<string> = new Set([
  'Enter',
  'Tab',
  'Escape',
  'Backspace',
  'Delete',
  'Insert',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
  'Control',
  'Shift',
  'Alt',
  'Meta',
  'CapsLock',
  'NumLock',
  'ScrollLock',
]);

/**
 * Named `KeyboardEvent.key` values the string grammar accepts. Single
 * characters and `F1`–`F24` are accepted separately (see `isKnownKeyName`).
 */
const KNOWN_KEY_NAMES: ReadonlySet<string> = new Set([
  ...NON_PRINTABLE_KEYS,
  'ContextMenu',
  'Clear',
  'Pause',
  'PrintScreen',
  'Help',
  'AltGraph',
  'Cancel',
  'Undo',
  'Redo',
  'Copy',
  'Cut',
  'Paste',
  'Select',
  'Fn',
  'Symbol',
]);

/** Modifier token → flag, for the `"ctrl+shift+Enter"` combo grammar. */
const MODIFIER_TOKENS: Record<string, keyof KeyModifiers> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  ctl: 'ctrl',
  shift: 'shift',
  alt: 'alt',
  option: 'alt',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  super: 'meta',
  win: 'meta',
};

/** Friendly aliases for keys whose DOM value is awkward to type in JSON. */
const KEY_ALIASES: Record<string, string> = {
  space: ' ',
  spacebar: ' ',
  esc: 'Escape',
  del: 'Delete',
  return: 'Enter',
};

function isKnownKeyName(key: string): boolean {
  if (key.length === 1) return true;
  if (KNOWN_KEY_NAMES.has(key)) return true;
  return /^F([1-9]|1[0-9]|2[0-4])$/.test(key);
}

/**
 * Map a key name to a `KeyboardEvent.code` value. Best-effort: named keys map
 * to themselves, letters/digits to `KeyX`/`DigitN`.
 */
export function keyToCode(key: string): string {
  if (!key || typeof key !== 'string') return '';
  if (key.length === 1) {
    const upper = key.toUpperCase();
    if (upper >= 'A' && upper <= 'Z') return `Key${upper}`;
    if (upper >= '0' && upper <= '9') return `Digit${upper}`;
    if (key === ' ') return 'Space';
  }
  return key;
}

/**
 * Legacy `keyCode` values for the named (non-single-character) keys, keyed by
 * their DOM `KeyboardEvent.key` value.
 *
 * WHY THIS TABLE EXISTS. `keyCode` / `which` / `charCode` are deprecated in the
 * UI Events spec, but a very large amount of shipped application code still
 * reads them — `if (e.keyCode === 13)` is still the most common way an app
 * recognizes Enter. A synthetic `KeyboardEvent` constructed without them
 * reports `keyCode === 0`, so every such handler silently no-ops and the
 * dispatch "succeeds" while doing nothing. That is the same silently-wrong
 * answer this module rejects everywhere else, so we populate them.
 *
 * This is the ONE table; `keyToKeyCode` below is its only reader.
 *
 * COVERAGE RULE: every name in `KNOWN_KEY_NAMES` that the legacy model actually
 * assigns a virtual-key code to appears here, so a key the string grammar
 * ACCEPTS never dispatches with `keyCode: 0` for want of a table entry — that
 * would be the same silent no-op this table exists to prevent, reached through
 * the front door. The remaining accepted names (`Undo`, `Redo`, `Copy`, `Cut`,
 * `Paste`, `Fn`, `Symbol`) are deliberately absent: the legacy model assigns
 * them no code, so browsers report 0 for them and `keyToKeyCode` returning 0 is
 * the honest answer rather than a gap. `key-events.legacy-keycode.test.ts` pins
 * both halves of that rule.
 */
const NAMED_KEY_CODES: Readonly<Record<string, number>> = {
  Cancel: 3,
  Backspace: 8,
  Tab: 9,
  Clear: 12,
  Enter: 13,
  Shift: 16,
  Control: 17,
  Alt: 18,
  Pause: 19,
  CapsLock: 20,
  Escape: 27,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Select: 41,
  PrintScreen: 44,
  Insert: 45,
  Delete: 46,
  Help: 47,
  Meta: 91,
  ContextMenu: 93,
  NumLock: 144,
  ScrollLock: 145,
  AltGraph: 225,
};

/**
 * Map a key name to its legacy `keyCode` value.
 *
 * Mirrors `keyToCode`'s best-effort conventions:
 *   - a single letter/digit/character reports its UPPERCASE character code
 *     (the legacy model is physical-key shaped, so `a` and `A` share 65);
 *   - a named key comes from `NAMED_KEY_CODES`;
 *   - `F1`–`F24` map to 112–135.
 *
 * Returns 0 for a key we cannot place, which is exactly what the platform
 * reports for an unidentified key — never a fabricated code.
 *
 * Punctuation is a deliberate approximation: it reports the character's own
 * code rather than the US-layout virtual-key code (`;` → 59, not 186), because
 * the layout-specific table is not derivable from a `key` value alone. That
 * matches `keyToCode`, which likewise returns punctuation unchanged instead of
 * inventing `Semicolon`.
 */
export function keyToKeyCode(key: string): number {
  if (!key || typeof key !== 'string') return 0;
  if (key.length === 1) {
    return key.toUpperCase().charCodeAt(0);
  }
  const named = NAMED_KEY_CODES[key];
  if (named !== undefined) return named;
  const fn = /^F([1-9]|1[0-9]|2[0-4])$/.exec(key);
  if (fn) return 111 + Number(fn[1]);
  return 0;
}

/** Which event of the `keydown` → `keypress` → `keyup` triple is being built. */
export type KeyEventType = 'keydown' | 'keypress' | 'keyup';

/**
 * Build the `KeyboardEventInit` for one synthetic key event.
 *
 * This is the ONE construction site for synthetic keyboard events in this SDK.
 * Every dispatch path — the document-scoped `dispatchKeySequence` below, the
 * element-scoped `sendKeys` action in `control/action-executor.ts`, the relay
 * path in `react/commandHandlers.ts`, and the undo/redo fallback in
 * `undo/undo-tracker.ts` — routes through it so the modern fields (`key`,
 * `code`, modifiers) and the legacy fields (`keyCode`, `which`, `charCode`)
 * cannot drift apart.
 *
 * The legacy triple follows the browsers exactly:
 *   - `keydown` / `keyup` — `keyCode` is the virtual key code, `charCode` is 0.
 *   - `keypress`          — `keyCode`, `charCode` and `which` are all the
 *                           character's own code point, so a handler doing
 *                           `String.fromCharCode(e.which)` recovers the typed
 *                           character with its case intact.
 *
 * `which` always mirrors `keyCode`, which is what `e.which || e.keyCode`
 * feature-probes expect.
 */
export function buildKeyboardEventInit(
  key: string,
  mods?: KeyModifiers,
  type: KeyEventType = 'keydown'
): KeyboardEventInit {
  const m = mods ?? {};
  const isKeypress = type === 'keypress';
  // On `keypress` the legacy model reports the CHARACTER, not the physical
  // key — `b` is 98 there and 66 on keydown.
  const charCode = isKeypress && key.length === 1 ? key.charCodeAt(0) : 0;
  const keyCode = isKeypress ? charCode : keyToKeyCode(key);

  return {
    key,
    code: keyToCode(key),
    bubbles: true,
    cancelable: true,
    ctrlKey: !!m.ctrl,
    shiftKey: !!m.shift,
    altKey: !!m.alt,
    metaKey: !!m.meta,
    keyCode,
    which: keyCode,
    charCode,
  };
}

/** Outcome of normalizing a caller-supplied `keys` parameter. */
export type KeyNormalizeResult = { ok: true; keys: KeyDescriptor[] } | { ok: false; error: string };

/**
 * Parse one combo token of the string grammar: optional `+`-joined modifier
 * prefixes followed by a key name (`"Escape"`, `"ctrl+Enter"`, `"a"`, `"+"`).
 */
function parseKeyCombo(token: string): KeyNormalizeResult {
  const raw = token.trim();
  if (!raw) return { ok: false, error: 'empty key token' };
  // `"+"` (and any all-separator token) is the literal plus key, not a combo.
  if (/^\++$/.test(raw)) return { ok: true, keys: [{ key: '+' }] };

  const parts = raw.split('+');
  const modifiers: KeyModifiers = {};
  let key = parts[parts.length - 1];
  for (const part of parts.slice(0, -1)) {
    const flag = MODIFIER_TOKENS[part.trim().toLowerCase()];
    if (!flag) {
      return {
        ok: false,
        error: `unknown modifier "${part}" in key combo "${raw}" (valid: ${Object.keys(
          MODIFIER_TOKENS
        ).join(', ')})`,
      };
    }
    modifiers[flag] = true;
  }

  key = KEY_ALIASES[key.toLowerCase()] ?? key;
  if (!isKnownKeyName(key)) {
    return {
      ok: false,
      error:
        `unknown key name "${key}" in "${raw}". Use a DOM KeyboardEvent.key value ` +
        `(e.g. "Escape", "Enter", "Tab", "ArrowDown", "F5", or a single character), ` +
        `or pass the explicit descriptor form [{ "key": "${key}" }] to bypass this check.`,
    };
  }
  return { ok: true, keys: [{ key, modifiers }] };
}

/**
 * Normalize a caller-supplied `keys` parameter into descriptors.
 *
 * Accepted forms:
 *   - `"Escape"` / `"ctrl+Enter"`  — ONE key press (validated).
 *   - `["Escape", "Tab"]`          — a sequence of validated combo tokens.
 *   - `[{ key: 'Escape', modifiers: { shift: true } }]` — explicit, unvalidated.
 *
 * A bare string is deliberately ONE key, never a character sequence: the whole
 * point of this API is named keys like `Escape`, and silently re-reading
 * `"Escape"` as six characters is the misinterpretation class this rejects.
 * Type characters with `typeInto` or the element-scoped `sendKeys` action.
 */
export function normalizeKeyDescriptors(raw: unknown): KeyNormalizeResult {
  if (typeof raw === 'string') return parseKeyCombo(raw);

  if (Array.isArray(raw)) {
    if (raw.length === 0) return { ok: false, error: "'keys' array must not be empty" };
    const out: KeyDescriptor[] = [];
    for (const entry of raw) {
      if (typeof entry === 'string') {
        const parsed = parseKeyCombo(entry);
        if (!parsed.ok) return parsed;
        out.push(...parsed.keys);
        continue;
      }
      if (entry && typeof entry === 'object') {
        const key = (entry as { key?: unknown }).key;
        if (typeof key !== 'string' || key.length === 0) {
          return {
            ok: false,
            error: `key descriptor must carry a non-empty string 'key' (got ${JSON.stringify(entry)})`,
          };
        }
        const mods = (entry as { modifiers?: KeyModifiers }).modifiers;
        out.push({ key, modifiers: mods && typeof mods === 'object' ? mods : {} });
        continue;
      }
      return {
        ok: false,
        error: `key entry must be a string or a { key, modifiers? } object (got ${JSON.stringify(entry)})`,
      };
    }
    return { ok: true, keys: out };
  }

  return {
    ok: false,
    error:
      '\'keys\' is required and must be a string ("Escape", "ctrl+Enter"), ' +
      'an array of such strings, or an array of { key, modifiers? } descriptors',
  };
}

/** Per-key dispatch outcome — `defaultPrevented` proves a listener consumed it. */
export interface KeyDispatchOutcome {
  key: string;
  defaultPrevented: boolean;
}

/**
 * Dispatch a `keydown` → (`keypress`) → `keyup` triple per descriptor on an
 * arbitrary `EventTarget` (an element, `document`, or `window`).
 *
 * Events bubble and are cancelable, so a `document`-level dispatch reaches
 * `document` listeners in the target phase and `window` listeners by bubbling —
 * which is exactly what a global Escape-to-close handler registers.
 */
export async function dispatchKeySequence(
  target: EventTarget,
  keys: readonly KeyDescriptor[],
  options?: { delay?: number }
): Promise<KeyDispatchOutcome[]> {
  const delay = options?.delay ?? 0;
  const outcomes: KeyDispatchOutcome[] = [];

  for (const desc of keys) {
    const mods = desc.modifiers ?? {};

    const keydown = new KeyboardEvent('keydown', buildKeyboardEventInit(desc.key, mods, 'keydown'));
    target.dispatchEvent(keydown);

    if (
      desc.key.length === 1 &&
      !NON_PRINTABLE_KEYS.has(desc.key) &&
      !mods.ctrl &&
      !mods.alt &&
      !mods.meta
    ) {
      target.dispatchEvent(
        new KeyboardEvent('keypress', buildKeyboardEventInit(desc.key, mods, 'keypress'))
      );
    }

    target.dispatchEvent(
      new KeyboardEvent('keyup', buildKeyboardEventInit(desc.key, mods, 'keyup'))
    );
    outcomes.push({ key: desc.key, defaultPrevented: keydown.defaultPrevented });

    if (delay > 0) {
      await new Promise<void>((r) => setTimeout(r, delay));
    }
  }

  return outcomes;
}

// ============================================================================
// Dispatch targets — the ONE target vocabulary, default, and resolver
// ============================================================================

/**
 * Where a non-element-scoped key dispatch lands.
 *
 * This vocabulary is deliberately here, in the shared module, rather than
 * beside any one endpoint: THREE surfaces need it and they must not disagree
 * about where a key goes.
 *
 *   - `server/page-primitives.ts` → `POST /control/page/send-keys` (ui-bridge)
 *   - `react/commandHandlers.ts`  → the same primitive over the relay
 *   - the runner's `dispatch_key` → `POST /ui-bridge/control/key`
 *     (`qontinui-runner/src-tauri/src/mcp/ui_bridge/keyboard.rs` plus
 *     `src/hooks/ui-bridge-events/useControlEvents.ts`), which still carries a
 *     hand-rolled copy of this switch and a `window` default. That copy is the
 *     third duplicate this module exists to retire — see the note on
 *     `DEFAULT_KEY_DISPATCH_TARGET`.
 */
export type KeyDispatchTarget = 'document' | 'body' | 'window' | 'activeElement';

/** Every accepted target, in canonical spelling. */
export const KEY_DISPATCH_TARGETS: readonly KeyDispatchTarget[] = [
  'document',
  'body',
  'window',
  'activeElement',
];

/**
 * The default dispatch target: `document`.
 *
 * WHY `document` AND NOT `window`. Real keyboard input is delivered at the
 * focused node and propagates upward, so every global handler in practice sits
 * on `document` or on `window`. Those two are NOT interchangeable for a
 * synthetic dispatch, and the asymmetry runs one way only:
 *
 *   - dispatched at `document` → propagation path is `[document, window]`, so
 *     BOTH `document` listeners and `window` listeners fire.
 *   - dispatched at `window`   → propagation path is `[window]` alone. A
 *     `document.addEventListener('keydown', …)` handler NEVER fires.
 *
 * `document` is therefore a strict superset of `window` delivery, which is why
 * changing a default from `window` to `document` cannot break a caller that
 * relied on reaching a `window` listener — it still reaches it — while a
 * `window` default silently fails every Escape-to-close panel whose only close
 * path is a `document` listener. A dispatch that reports success while
 * reaching nothing is the failure class this whole module exists to avoid.
 *
 * `window` stays available as an explicit opt-in for a caller that wants to
 * prove a handler is bound at the window level specifically.
 *
 * `activeElement` remains opt-in for a different reason: it is the only target
 * that can land text in a focused field, and on a runner that field is often a
 * terminal bound to a live session.
 */
export const DEFAULT_KEY_DISPATCH_TARGET: KeyDispatchTarget = 'document';

/** Why a target could not be resolved — mapped to an error code by callers. */
export type KeyTargetFailure = 'unknown-target' | 'unavailable';

/** Outcome of resolving a caller-supplied `target` to a live `EventTarget`. */
export type KeyTargetResult =
  | { ok: true; target: KeyDispatchTarget; node: EventTarget }
  | { ok: false; error: string; reason: KeyTargetFailure };

/**
 * Resolve a caller-supplied `target` to the node to dispatch on.
 *
 * An unrecognized target is REJECTED BY NAME, never silently coerced to the
 * default: a caller who typed `"docuemnt"` and got a `window` dispatch would
 * read "success" off a request that reached nothing. Omitting `target`
 * entirely is the only path to the default.
 */
export function resolveKeyTarget(raw: unknown): KeyTargetResult {
  const requested = raw ?? DEFAULT_KEY_DISPATCH_TARGET;
  if (
    typeof requested !== 'string' ||
    !KEY_DISPATCH_TARGETS.includes(requested as KeyDispatchTarget)
  ) {
    return {
      ok: false,
      reason: 'unknown-target',
      error: `'target' must be one of ${KEY_DISPATCH_TARGETS.join(' | ')} (got ${JSON.stringify(raw)})`,
    };
  }
  const target = requested as KeyDispatchTarget;

  let node: EventTarget | null = null;
  switch (target) {
    case 'window':
      node = typeof window !== 'undefined' ? window : null;
      break;
    case 'body':
      node = typeof document !== 'undefined' ? document.body : null;
      break;
    case 'activeElement':
      node = typeof document !== 'undefined' ? (document.activeElement ?? document.body) : null;
      break;
    case 'document':
      node = typeof document !== 'undefined' ? document : null;
      break;
  }

  if (!node) {
    return {
      ok: false,
      reason: 'unavailable',
      error: `dispatch target "${target}" is not available in this context`,
    };
  }
  return { ok: true, target, node };
}
