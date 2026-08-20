/**
 * Shared keyboard-event primitives.
 *
 * Zero-dependency and browser-safe: pure key-name normalization plus a
 * `KeyboardEvent` dispatch loop, importing nothing. Three call sites share it
 * so the key grammar cannot drift:
 *
 *   - `control/action-executor.ts` — the ELEMENT-scoped `sendKeys` action
 *     (`keyToCode` / `NON_PRINTABLE_KEYS`; it keeps its own dispatch loop
 *     because it interleaves input-value mutation between the events).
 *   - `server/page-primitives.ts` — the DOCUMENT-scoped `sendKeysToPage`
 *     primitive (this module's `dispatchKeySequence`).
 *   - `react/commandHandlers.ts` — the relay path, via the same primitive.
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

/** Outcome of normalizing a caller-supplied `keys` parameter. */
export type KeyNormalizeResult =
  | { ok: true; keys: KeyDescriptor[] }
  | { ok: false; error: string };

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
      "'keys' is required and must be a string (\"Escape\", \"ctrl+Enter\"), " +
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
    const eventInit: KeyboardEventInit = {
      key: desc.key,
      code: keyToCode(desc.key),
      bubbles: true,
      cancelable: true,
      ctrlKey: !!mods.ctrl,
      shiftKey: !!mods.shift,
      altKey: !!mods.alt,
      metaKey: !!mods.meta,
    };

    const keydown = new KeyboardEvent('keydown', eventInit);
    target.dispatchEvent(keydown);

    if (
      desc.key.length === 1 &&
      !NON_PRINTABLE_KEYS.has(desc.key) &&
      !mods.ctrl &&
      !mods.alt &&
      !mods.meta
    ) {
      target.dispatchEvent(new KeyboardEvent('keypress', eventInit));
    }

    target.dispatchEvent(new KeyboardEvent('keyup', eventInit));
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
  if (typeof requested !== 'string' || !KEY_DISPATCH_TARGETS.includes(requested as KeyDispatchTarget)) {
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
