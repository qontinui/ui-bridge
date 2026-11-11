/**
 * Element kind: the ONE type inferrer and the ONE verb table.
 *
 * Plan `2026-11-09-an-elements-advertised-verbs-depend-on-which-path-found-it`
 * (D1–D3). An element's advertised `actions` is the vocabulary an agent reads
 * off it, and the runner ENFORCES it: its element-action door refuses any verb
 * an element does not advertise before the SDK is reached
 * (`is_action_advertised`, qontinui-runner `src-tauri/src/mcp/ui_bridge/elements.rs`).
 * The registry, the auto-register hook, the executor's scanned rows and the
 * server's DOM fallback each used to keep their own inferrer and table; they
 * disagreed with each other and with what the dispatchers do, so an element's
 * verbs depended on which path found it. Every producer now maps its node to an
 * `ElementType` here and reads its verbs here.
 *
 * The rule (D3): a verb is advertised iff BOTH web dispatchers
 * (`DefaultActionExecutor` and the relay's `executeElementAction`) perform it
 * on the element, and every other built-in verb is refused there with the
 * typed element-kind refusal. `element-kind.oracle.test.ts` drives every DOM
 * spelling the scanners select through both dispatchers and holds them to this
 * file.
 *
 * An element's verbs come from two places:
 *
 * - Its KIND ({@link inferElementType}): the {@link ELEMENT_KIND_ACTIONS} row
 *   lists what EVERY node of that kind performs.
 * - Its STRUCTURE ({@link structuralActions}): what THIS node performs because
 *   of the HTML element it is and the state it carries, whatever its kind. A
 *   role re-kinds any element without taking its element's behaviour away —
 *   `<input role="combobox">` is a combobox you type into, `<button
 *   aria-expanded>` is a button that toggles — and an owner form is not a
 *   property of any kind at all, yet it is what `submit` needs. The structural
 *   predicates below are the very ones the dispatchers' arms test
 *   (`control/element-arms.ts`), so that half cannot drift from them.
 */

import type { ElementType, MediaType, StandardAction } from './types';

/**
 * Canonical order of an advertised list: the order `StandardAction` declares
 * its members in. A `Record` over the union, so a new verb is a compile error
 * here until it is placed.
 */
const ACTION_ORDER: Record<StandardAction, number> = {
  click: 0,
  hoverClick: 1,
  doubleClick: 2,
  rightClick: 3,
  middleClick: 4,
  type: 5,
  sendKeys: 6,
  clear: 7,
  select: 8,
  focus: 9,
  blur: 10,
  hover: 11,
  unhover: 12,
  scroll: 13,
  scrollIntoView: 14,
  check: 15,
  uncheck: 16,
  toggle: 17,
  setValue: 18,
  drag: 19,
  submit: 20,
  reset: 21,
  autocomplete: 22,
};

/**
 * What both dispatchers perform on ANY element: the pointer verbs (click-like
 * ones pre-check visibility and `disabled`, which is state, not kind), focus,
 * scrolling, drag, and keyboard input. `sendKeys` is on every kind: keyboard
 * input to a canvas, a dialog or a terminal pane is a documented use, and the
 * runner gates it on this list.
 */
const EVERY_ELEMENT: readonly StandardAction[] = [
  'click',
  'hoverClick',
  'doubleClick',
  'rightClick',
  'middleClick',
  'sendKeys',
  'focus',
  'blur',
  'hover',
  'unhover',
  'scroll',
  'scrollIntoView',
  'drag',
];

/** The text verbs: typing into, clearing, setting and autocompleting a text field. */
const TEXT_ENTRY_VERBS: readonly StandardAction[] = ['type', 'clear', 'setValue', 'autocomplete'];

/**
 * What EVERY node of each kind performs. A kind whose native and ARIA
 * spellings the dispatchers treat differently lists only what both take: a
 * `<dialog>` toggles open and a `role="dialog"` div cannot, an `<input
 * type="range">` takes `setValue` and a `role="slider"` div cannot, so neither
 * row names the verb, and the native element gets it from its structure
 * ({@link structuralActions}). An `<input>`'s value verbs depend on its `type`
 * attribute (text, date, file …), so the `input` row names none of them either.
 */
export const ELEMENT_KIND_ACTIONS: Record<ElementType, readonly StandardAction[]> = {
  button: EVERY_ELEMENT,
  input: EVERY_ELEMENT,
  select: [...EVERY_ELEMENT, 'select', 'setValue'],
  // role="checkbox" is clicked when `aria-checked` disagrees; a checkbox
  // <input> is set directly.
  checkbox: [...EVERY_ELEMENT, 'check', 'uncheck', 'toggle'],
  // A role="radio" cannot be unchecked by clicking it (a radio <input> can be
  // set unchecked directly, from its structure), and nothing toggles a radio.
  radio: [...EVERY_ELEMENT, 'check'],
  link: EVERY_ELEMENT,
  form: [...EVERY_ELEMENT, 'submit', 'reset'],
  textarea: [...EVERY_ELEMENT, ...TEXT_ENTRY_VERBS],
  menu: EVERY_ELEMENT,
  menuitem: EVERY_ELEMENT,
  tab: EVERY_ELEMENT,
  dialog: EVERY_ELEMENT,
  // `<details>`, and a `<summary>` opening one.
  disclosure: [...EVERY_ELEMENT, 'toggle'],
  custom: EVERY_ELEMENT,
  switch: [...EVERY_ELEMENT, 'check', 'uncheck', 'toggle'],
  slider: EVERY_ELEMENT,
  combobox: [...EVERY_ELEMENT, 'select'],
  listbox: EVERY_ELEMENT,
  option: EVERY_ELEMENT,
  // role="textbox" and contenteditable: neither dispatcher writes a value into
  // them, so keyboard input (`sendKeys`) is how they are typed into.
  textbox: EVERY_ELEMENT,
  generic: EVERY_ELEMENT,
  image: EVERY_ELEMENT,
  video: EVERY_ELEMENT,
  canvas: EVERY_ELEMENT,
  svg: EVERY_ELEMENT,
  picture: EVERY_ELEMENT,
};

/**
 * The verbs an element of kind `type` advertises: its kind's row plus what its
 * own structure grants, in canonical order. `type` is the kind the element is
 * REGISTERED as, which a caller may have declared rather than had inferred.
 */
export function inferActions(type: ElementType, element: Element): StandardAction[] {
  // A declared `type` arrives from callers' code, so a string outside the union
  // (or one naming an Object.prototype member) reads as an untyped element.
  const row = Object.prototype.hasOwnProperty.call(ELEMENT_KIND_ACTIONS, type)
    ? ELEMENT_KIND_ACTIONS[type]
    : EVERY_ELEMENT;
  const verbs = new Set<StandardAction>([...row, ...structuralActions(element)]);
  return [...verbs].sort((a, b) => ACTION_ORDER[a] - ACTION_ORDER[b]);
}

/**
 * Explicit role → kind, for every role a scanner selects (the auto-register
 * and DOM-fallback selector lists, and the media scanner's `role="img"`) and
 * every role an inferrer used to map. A role absent here does not decide the
 * kind; the tag does. A `Map`, so an attribute value such as `constructor`
 * never resolves through a prototype.
 *
 * `tablist`, `status` and `spinbutton` are explicitly `generic`. Their verbs
 * are exactly `generic`'s, so a kind of their own would buy no capability —
 * and auto-registered ids are derived from the kind (`{type}-{slug}`), so it
 * would rename ids that specs already pin (Radix `TabsList`s among them). A
 * native `<input>` carrying role="spinbutton" keeps the kind its tag gives it
 * (see {@link inferElementType}).
 */
const ROLE_KINDS: ReadonlyMap<string, ElementType> = new Map<string, ElementType>([
  ['button', 'button'],
  ['checkbox', 'checkbox'],
  ['combobox', 'combobox'],
  ['dialog', 'dialog'],
  ['img', 'image'],
  ['link', 'link'],
  ['listbox', 'listbox'],
  ['menu', 'menu'],
  ['menuitem', 'menuitem'],
  ['option', 'option'],
  ['radio', 'radio'],
  ['slider', 'slider'],
  ['spinbutton', 'generic'],
  ['status', 'generic'],
  ['switch', 'switch'],
  ['tab', 'tab'],
  ['tablist', 'generic'],
  ['textbox', 'textbox'],
]);

/**
 * `<input>` types typed `button`. A reset or image `<input>` stays `input`, as
 * both former inferrers typed it: the verbs are the same either way, and its
 * auto-registered id is derived from the kind.
 */
const BUTTON_INPUT_TYPES: ReadonlySet<string> = new Set(['submit', 'button']);

/**
 * The ONE element-type inferrer. Role first, then tag, then contenteditable,
 * else `generic`. It is the union of the two inferrers it replaced (the
 * registry's and the auto-register hook's): it keeps `combobox`, `listbox`,
 * `option`, `switch`, `slider`, `textbox` and `disclosure` distinct, maps
 * `<input type="range">` to `slider`, and keeps the `form`, `dialog` and
 * `menu` arms, so no kind either of them had is lost.
 */
export function inferElementType(element: Element): ElementType {
  const role = element.getAttribute('role');
  const byRole = role === null ? undefined : ROLE_KINDS.get(role);
  // A role="img" on a media tag keeps the media kind the media scanner gives it.
  if (byRole === 'image') return mediaTagKind(element) ?? 'image';
  // A spinbutton role on a native <input> (a number field) keeps its tag's kind.
  if (role === 'spinbutton' && element instanceof HTMLInputElement) return inputKind(element);
  if (byRole !== undefined) return byRole;
  const byTag = tagKind(element);
  if (byTag !== undefined) return byTag;
  if (isContentEditable(element)) return 'textbox';
  return 'generic';
}

function tagKind(element: Element): ElementType | undefined {
  switch (element.localName) {
    case 'a':
      return 'link';
    case 'button':
      return 'button';
    case 'input':
      return inputKind(element as HTMLInputElement);
    case 'textarea':
      return 'textarea';
    case 'select':
      return 'select';
    case 'option':
      return 'option';
    case 'form':
      return 'form';
    case 'details':
      return 'disclosure';
    case 'summary':
      // Only a summary that opens a <details> discloses anything.
      return disclosureDetails(element) ? 'disclosure' : undefined;
    case 'dialog':
      return 'dialog';
    default:
      return mediaTagKind(element);
  }
}

/** An `<input>` by its `type`: a checkbox, radio, button or range, else a field. */
function inputKind(input: HTMLInputElement): ElementType {
  const type = input.type;
  if (type === 'checkbox') return 'checkbox';
  if (type === 'radio') return 'radio';
  if (BUTTON_INPUT_TYPES.has(type)) return 'button';
  if (type === 'range') return 'slider';
  return 'input';
}

/** The media tags, as the media scanner (`react/media-capture.ts`) types them. */
function mediaTagKind(element: Element): ElementType | undefined {
  switch (element.localName) {
    case 'img':
      // An <img> inside a <picture> is the picture's one row.
      return element.parentElement?.localName === 'picture' ? 'picture' : 'image';
    case 'picture':
      return 'picture';
    case 'svg':
      return 'svg';
    case 'video':
      return 'video';
    case 'canvas':
      return 'canvas';
    default:
      return undefined;
  }
}

/**
 * Editable by its own attribute. The attribute, not `isContentEditable`, which
 * jsdom does not implement — and the scanners select on the attribute too.
 */
function isContentEditable(element: Element): boolean {
  const value = element.getAttribute('contenteditable');
  return value !== null && value.toLowerCase() !== 'false';
}

/**
 * The kind a MEDIA registration reports. Every media type but a CSS background
 * image is itself an `ElementType`; a background image paints on an element of
 * any kind, so it reports that element's own kind.
 */
export function mediaElementKind(mediaType: MediaType, element: Element): ElementType {
  return mediaType === 'background-image' ? inferElementType(element) : mediaType;
}

/**
 * The ARIA role each kind implies, for a node that carries no `role` of its
 * own: what a reader comparing roles (a search criterion, an effect's
 * predicted change) should treat the kind as. A `Record` over the union, so a
 * new kind is a compile error until it is mapped.
 */
const IMPLIED_ARIA_ROLES: Record<ElementType, string | undefined> = {
  button: 'button',
  input: 'textbox',
  select: 'combobox',
  checkbox: 'checkbox',
  radio: 'radio',
  link: 'link',
  form: undefined,
  textarea: 'textbox',
  menu: 'menu',
  menuitem: 'menuitem',
  tab: 'tab',
  dialog: 'dialog',
  disclosure: 'group',
  custom: undefined,
  switch: 'switch',
  slider: 'slider',
  combobox: 'combobox',
  listbox: 'listbox',
  option: 'option',
  textbox: 'textbox',
  generic: undefined,
  image: 'img',
  video: undefined,
  canvas: undefined,
  svg: 'img',
  picture: 'img',
};

/** The ARIA role a kind implies (`input` → `textbox`), or `undefined`. */
export function impliedAriaRole(type: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(IMPLIED_ARIA_ROLES, type)
    ? IMPLIED_ARIA_ROLES[type as ElementType]
    : undefined;
}

/**
 * Kinds a person or an agent NAMES interchangeably. The inferrer keeps them
 * apart, because their verbs differ (a native `<input>` takes `type`, an ARIA
 * `textbox` does not), but "the email field" means either, and before the
 * inferrers converged the registry path reported every role="textbox" as
 * `input` and every role="combobox" or "listbox" as `select`. So a reader that
 * matches a type a caller named — a query, a filter, a criterion, a selector,
 * a style rule — matches the name's whole family; a reader that classifies an
 * element by its own type reads the precise kind.
 */
const NAMED_TYPE_FAMILIES: readonly (readonly ElementType[])[] = [
  ['input', 'textbox'],
  ['select', 'combobox', 'listbox'],
];

/** The kinds a caller-named type answers to, lower-cased: its family, else itself. */
export function namedTypeFamily(named: string): readonly string[] {
  const lower = named.toLowerCase();
  return (
    NAMED_TYPE_FAMILIES.find((family) => (family as readonly string[]).includes(lower)) ?? [lower]
  );
}

/** Whether an element of kind `type` answers to the caller-named type `named`. */
export function answersToNamedType(type: string | undefined, named: string): boolean {
  return type !== undefined && namedTypeFamily(named).includes(type.toLowerCase());
}

// ---------------------------------------------------------------------------
// Structure: the predicates the dispatchers' arms test (control/element-arms.ts)
// ---------------------------------------------------------------------------

/** `<input>` types a caller types text into. */
const TEXT_ENTRY_INPUT_TYPES: ReadonlySet<string> = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
]);

/**
 * `<input>` types whose value is one formatted value — a date, a time, a
 * colour — that the browser sanitizes whole: a string it cannot parse becomes
 * the empty value (`#000000` for a colour, which has no empty value). Both
 * dispatchers type into one ({@link typeControl}) by writing the typed text as
 * the whole value, since appending characters to a valid date only produces
 * one the browser throws away; typing `10:30` into a time input sets 10:30.
 * `clear` empties one (a colour returns to `#000000`), and `setValue` writes
 * one. `autocomplete` does not apply: a date or colour field offers no
 * suggestion list to pick from.
 */
const FORMATTED_VALUE_INPUT_TYPES: ReadonlySet<string> = new Set([
  'color',
  'date',
  'datetime-local',
  'month',
  'week',
  'time',
]);

/**
 * `<input>` types whose value is only ever SET whole (`setValue`): a range
 * position or a hidden value, plus the formatted ones above. Typing
 * characters into a range or hidden input is no user gesture.
 */
const VALUE_INPUT_TYPES: ReadonlySet<string> = new Set([
  'range',
  'hidden',
  ...FORMATTED_VALUE_INPUT_TYPES,
]);

/**
 * The text field `autocomplete` (and `sendKeys`' value editing) writes to: a
 * `<textarea>`, or an `<input>` of a text-entry type. Not a checkbox, radio,
 * file or button `<input>` — their `value` is not text a user types — not a
 * date, time or colour `<input>` (see {@link typeControl}), and not a
 * contenteditable, whose text is not a `value` at all.
 */
export function textEntryControl(element: Element): HTMLInputElement | HTMLTextAreaElement | null {
  if (element instanceof HTMLTextAreaElement) return element;
  if (element instanceof HTMLInputElement && TEXT_ENTRY_INPUT_TYPES.has(element.type)) {
    return element;
  }
  return null;
}

/** A date, time or colour `<input>` ({@link FORMATTED_VALUE_INPUT_TYPES}). */
export function formattedValueInput(element: Element): HTMLInputElement | null {
  return element instanceof HTMLInputElement && FORMATTED_VALUE_INPUT_TYPES.has(element.type)
    ? element
    : null;
}

/**
 * The field `type` writes to: a text field ({@link textEntryControl}), which
 * the typed text is appended to, or a date, time or colour `<input>`
 * ({@link formattedValueInput}), whose whole value the typed text becomes.
 */
export function typeControl(element: Element): HTMLInputElement | HTMLTextAreaElement | null {
  return textEntryControl(element) ?? formattedValueInput(element);
}

/** A file `<input>`. */
export function fileInput(element: Element): HTMLInputElement | null {
  return element instanceof HTMLInputElement && element.type === 'file' ? element : null;
}

/**
 * The field `clear` empties: any field `type` writes to, or a file `<input>`,
 * whose selection it empties (the one value a script may write to a file
 * input is the empty string).
 */
export function clearControl(element: Element): HTMLInputElement | HTMLTextAreaElement | null {
  return typeControl(element) ?? fileInput(element);
}

/**
 * The field `setValue` writes a whole value into: a text field
 * ({@link textEntryControl}) or a value `<input>` (range, colour, date, time,
 * hidden). A `<select>` takes `setValue` too, through its own arm. A file
 * `<input>` does not: its value is a file list, never a string.
 */
export function valueControl(element: Element): HTMLInputElement | HTMLTextAreaElement | null {
  const text = textEntryControl(element);
  if (text) return text;
  if (element instanceof HTMLInputElement && VALUE_INPUT_TYPES.has(element.type)) return element;
  return null;
}

/** A checkbox or radio `<input>`, which `check` / `uncheck` set directly. */
export function checkableInput(element: Element): HTMLInputElement | null {
  return element instanceof HTMLInputElement &&
    (element.type === 'checkbox' || element.type === 'radio')
    ? element
    : null;
}

/**
 * The `<details>` a `toggle` on this node opens or closes: the node itself, or
 * the `<details>` whose `<summary>` it is.
 */
export function disclosureDetails(element: Element): HTMLDetailsElement | null {
  if (element instanceof HTMLDetailsElement) return element;
  if (element.localName === 'summary' && element.parentElement instanceof HTMLDetailsElement) {
    return element.parentElement;
  }
  return null;
}

/** A native `<dialog>`, which `toggle` opens and closes. */
export function nativeDialog(element: Element): HTMLDialogElement | null {
  return typeof HTMLDialogElement !== 'undefined' && element instanceof HTMLDialogElement
    ? element
    : null;
}

/**
 * The node carries `aria-expanded`: it controls a collapsible region, so
 * `toggle` flips it. The ATTRIBUTE, as an author wrote it. It does NOT make
 * the node a combobox — an accordion or disclosure trigger carries it too, and
 * `select` on one would click it open and report success — see
 * {@link opensListbox}.
 */
export function hasExpandedState(element: Element): boolean {
  return element.hasAttribute('aria-expanded');
}

/**
 * The node opens a listbox `select` can pick an option from: `role="combobox"`,
 * or `aria-haspopup="listbox"` (a select-only trigger such as MUI's
 * `role="button"` Select). Not `aria-haspopup="menu"` or `"true"` (which ARIA
 * defines as `menu`): a menu's items are `menuitem`s, not options, so a
 * `select` on its trigger has nothing to choose. The ATTRIBUTES, as an author
 * wrote them; `control/combobox-select.ts` `isComboboxLike` is this predicate.
 */
export function opensListbox(element: Element): boolean {
  return (
    element.getAttribute('role') === 'combobox' ||
    element.getAttribute('aria-haspopup')?.trim().toLowerCase() === 'listbox'
  );
}

/**
 * The form `element` submits or resets: itself, else its OWNER form — which a
 * control's `form="…"` attribute can point away from its `closest('form')` —
 * else the enclosing one. Shared by both dispatchers.
 */
export function resolveOwnerForm(element: Element): HTMLFormElement | null {
  if (element instanceof HTMLFormElement) return element;
  // A `form="…"` attribute decides the owner outright — one naming a missing
  // id means NO owner (the browser submits nothing), not the enclosing form.
  if ('form' in element && element.hasAttribute('form')) {
    const owner = (element as { form?: unknown }).form;
    return owner instanceof HTMLFormElement ? owner : null;
  }
  return element.closest('form');
}

/**
 * What THIS node performs because of the HTML element it is and the state it
 * carries, whatever kind it was inferred or declared as. Each line is the
 * predicate of one dispatcher arm (`control/element-arms.ts`).
 */
export function structuralActions(element: Element): StandardAction[] {
  const verbs: StandardAction[] = [];
  if (textEntryControl(element)) verbs.push(...TEXT_ENTRY_VERBS);
  else if (formattedValueInput(element)) verbs.push('type', 'clear', 'setValue');
  else if (valueControl(element)) verbs.push('setValue');
  if (fileInput(element)) verbs.push('clear');
  if (element instanceof HTMLSelectElement) verbs.push('select', 'setValue');
  const checkable = checkableInput(element);
  if (checkable) {
    verbs.push('check', 'uncheck');
    if (checkable.type === 'checkbox') verbs.push('toggle');
  }
  if (disclosureDetails(element) || nativeDialog(element)) verbs.push('toggle');
  if (hasExpandedState(element)) verbs.push('toggle');
  if (opensListbox(element)) verbs.push('select');
  if (resolveOwnerForm(element)) verbs.push('submit', 'reset');
  return verbs;
}
