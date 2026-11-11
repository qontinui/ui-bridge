/**
 * Which arm of a built-in verb runs on an element — or the typed element-kind
 * refusal when none does.
 *
 * Shared by both web dispatchers, `DefaultActionExecutor`
 * (`action-executor.ts`) and the relay's `executeElementAction`
 * (`react/commandHandlers.ts`), so one element gets one answer whichever door
 * it was driven through — the arrangement `combobox-select.ts` and
 * `resolveOwnerForm` set. Before this module the two disagreed: the relay
 * refused `setValue` on a `<select>` and `check` on `role="switch"`, had no
 * details, dialog or `aria-expanded` toggle and no `autocomplete`, and turned a
 * form-less `submit` into a click; the executor reported success for `clear`
 * and `check` on elements they never touched, and clicked any element it was
 * asked to `toggle`.
 *
 * Each arm keys on the predicate `core/element-kind.ts` advertises the verb
 * from — its structural half, or the role its kind table names — so a verb is
 * advertised exactly where an arm takes it. `element-kind.oracle.test.ts`
 * holds the arms and the table to each other on every DOM spelling.
 *
 * An outcome is a VALUE, not a throw: the executor throws its own typed error
 * from a refusal, and the relay returns its own failure envelope. Both carry
 * {@link ELEMENT_KIND_REFUSAL} as `failureDetails.context.refusal`, the marker
 * a caller keys on instead of the message.
 */

import {
  checkableInput,
  clearControl,
  disclosureDetails,
  formattedValueInput,
  hasExpandedState,
  nativeDialog,
  resolveOwnerForm,
  textEntryControl,
  typeControl,
  valueControl,
} from '../core/element-kind';
import { sdkDispatch } from '../core/sdk-dispatch';
import { isComboboxLike } from './combobox-select';
import { applyValueMutation } from './value-mutation';

/** The marker an element-kind refusal carries as `failureDetails.context.refusal`. */
export const ELEMENT_KIND_REFUSAL = 'element-kind';

/** A built-in verb has no arm for this element: nothing was dispatched. */
export interface ElementKindRefusal {
  readonly ok: false;
  readonly refusal: typeof ELEMENT_KIND_REFUSAL;
  /** Names the verb, the element and what the verb applies to. */
  readonly message: string;
}

/** An arm that runs (`ok: true`, with what it needs), or the refusal. */
export type ArmOutcome<T> = ({ readonly ok: true } & T) | ElementKindRefusal;

/** `<input type="file">`, `<div role="slider">`, `<button>` — the element as a caller would recognise it. */
export function describeElement(element: Element): string {
  const tag = element.localName;
  const role = element.getAttribute('role');
  if (role) return `<${tag} role="${role}">`;
  if (element instanceof HTMLInputElement) return `<input type="${element.type}">`;
  return `<${tag}>`;
}

function refused(action: string, element: Element, appliesTo: string): ElementKindRefusal {
  return {
    ok: false,
    refusal: ELEMENT_KIND_REFUSAL,
    message: `${action} is not supported on ${describeElement(element)} — it applies to ${appliesTo}.`,
  };
}

const TEXT_ENTRY_TARGETS =
  'a text <input> (text, search, email, url, tel, password or number) or a <textarea>';

const FORMATTED_VALUE_TARGETS = 'a date, time or colour <input>';

/** `autocomplete`: the text field it types the search text into. */
export function textEntryArm(
  element: HTMLElement,
  action: 'autocomplete'
): ArmOutcome<{ control: HTMLInputElement | HTMLTextAreaElement }> {
  const control = textEntryControl(element);
  return control ? { ok: true, control } : refused(action, element, TEXT_ENTRY_TARGETS);
}

/**
 * `type`: append the text to a text field, or — on a date, time or colour
 * `<input>`, whose value the browser sanitizes whole — make the text its whole
 * value. `clearFirst` empties a text field before appending (`clear: true`).
 */
export function typeArm(
  element: HTMLElement
): ArmOutcome<{ apply: (text: string, clearFirst: boolean) => void }> {
  const control = typeControl(element);
  if (!control) {
    return refused('type', element, `${TEXT_ENTRY_TARGETS}, or ${FORMATTED_VALUE_TARGETS}`);
  }
  const whole = formattedValueInput(control) !== null;
  return {
    ok: true,
    apply: (text, clearFirst) =>
      applyValueMutation(control, {
        value: text,
        mode: whole ? 'replace' : clearFirst ? 'clear-then-append' : 'append',
        blur: false,
      }),
  };
}

/**
 * `clear`: empty a text field, a date, time or colour `<input>` (a colour has
 * no empty value and returns to `#000000`), or a file `<input>`'s selection.
 */
export function clearArm(element: HTMLElement): ArmOutcome<{ apply: () => void }> {
  const control = clearControl(element);
  if (!control) {
    return refused(
      'clear',
      element,
      `${TEXT_ENTRY_TARGETS}, ${FORMATTED_VALUE_TARGETS}, or a file <input>`
    );
  }
  return {
    ok: true,
    apply: () => applyValueMutation(control, { value: '', mode: 'clear', blur: false }),
  };
}

/** `setValue`: how to write a whole value into this element. */
export function setValueArm(element: HTMLElement): ArmOutcome<{ apply: (value: string) => void }> {
  const control = valueControl(element);
  if (control) {
    return {
      ok: true,
      apply: (value) => applyValueMutation(control, { value, mode: 'replace', blur: false }),
    };
  }
  if (element instanceof HTMLSelectElement) {
    return {
      ok: true,
      apply: (value) => {
        element.value = value;
        element.dispatchEvent(new Event('change', { bubbles: true }));
      },
    };
  }
  return refused(
    'setValue',
    element,
    `${TEXT_ENTRY_TARGETS}, a range, colour, date, time or hidden <input>, or a <select>`
  );
}

/** `select`: a native `<select>`, or a combobox driven through its popup. */
export function selectArm(
  element: HTMLElement
): ArmOutcome<{ arm: 'native'; control: HTMLSelectElement } | { arm: 'combobox' }> {
  if (element instanceof HTMLSelectElement) return { ok: true, arm: 'native', control: element };
  if (isComboboxLike(element)) return { ok: true, arm: 'combobox' };
  return refused(
    'select',
    element,
    'a <select> or a combobox (role="combobox", or a control carrying aria-expanded)'
  );
}

/** The ARIA roles whose checked state a click flips, read from `aria-checked`. */
const ARIA_CHECKED_ROLES: ReadonlySet<string> = new Set(['switch', 'checkbox']);

/**
 * `check` / `uncheck`. A checkbox or radio `<input>` is set directly; an ARIA
 * switch or checkbox is clicked when `aria-checked` disagrees, as a user would.
 * An ARIA radio can be checked but never unchecked by clicking it.
 */
export function checkArm(
  element: HTMLElement,
  checked: boolean
): ArmOutcome<{ apply: () => void }> {
  const input = checkableInput(element);
  if (input) {
    return {
      ok: true,
      apply: () => {
        if (input.checked === checked) return;
        input.checked = checked;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      },
    };
  }
  const role = element.getAttribute('role');
  if ((role !== null && ARIA_CHECKED_ROLES.has(role)) || (role === 'radio' && checked)) {
    return {
      ok: true,
      apply: () => {
        const isChecked = element.getAttribute('aria-checked') === 'true';
        if (isChecked !== checked) sdkDispatch(() => element.click());
      },
    };
  }
  return refused(
    checked ? 'check' : 'uncheck',
    element,
    checked
      ? 'a checkbox or radio <input>, or role="checkbox", "radio" or "switch"'
      : 'a checkbox or radio <input>, or role="checkbox" or "switch"'
  );
}

/**
 * `toggle`. Every arm flips a state the element has; an element with none is
 * refused rather than clicked, so a toggle that changed nothing never reports
 * success.
 */
export function toggleArm(element: HTMLElement): ArmOutcome<{ apply: () => void }> {
  // A checkbox <input>: flip `checked` and fire `change`.
  const input = checkableInput(element);
  if (input?.type === 'checkbox') {
    return {
      ok: true,
      apply: () => {
        input.checked = !input.checked;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      },
    };
  }

  // `<details>`, or the `<summary>` that opens one: flip the `open` property
  // (not the attribute, so React's controlled pattern does not diverge from the
  // DOM) and fire the native `toggle` event onToggle listeners expect.
  const details = disclosureDetails(element);
  if (details) {
    return {
      ok: true,
      apply: () => {
        details.open = !details.open;
        details.dispatchEvent(new Event('toggle', { bubbles: false }));
      },
    };
  }

  // `<dialog>`: showModal() / close() are the idiomatic API.
  const dialog = nativeDialog(element);
  if (dialog) {
    return {
      ok: true,
      apply: () => {
        if (dialog.open) {
          dialog.close();
        } else if (typeof dialog.showModal === 'function') {
          dialog.showModal();
        } else {
          // Rare: a polyfilled <dialog> without showModal — just flip the
          // attribute so downstream consumers see the state change.
          dialog.setAttribute('open', '');
          dialog.dispatchEvent(new Event('close', { bubbles: false }));
        }
      },
    };
  }

  // Anything carrying aria-expanded (disclosure buttons): flip the attribute so
  // screen readers reflect the state, then click so the framework's own handler
  // runs and manages the region it controls.
  if (hasExpandedState(element)) {
    return {
      ok: true,
      apply: () => {
        const next = element.getAttribute('aria-expanded') === 'true' ? 'false' : 'true';
        element.setAttribute('aria-expanded', next);
        sdkDispatch(() => element.click());
      },
    };
  }

  // An ARIA switch or checkbox flips on click.
  const role = element.getAttribute('role');
  if (role !== null && ARIA_CHECKED_ROLES.has(role)) {
    return { ok: true, apply: () => sdkDispatch(() => element.click()) };
  }

  return refused(
    'toggle',
    element,
    'a checkbox <input>, <details> or its <summary>, <dialog>, a control carrying ' +
      'aria-expanded, or role="checkbox" or "switch"'
  );
}

/** `submit` / `reset`: the form they act on — the element's own, or its owner. */
export function formOwnerArm(
  element: HTMLElement,
  action: 'submit' | 'reset'
): ArmOutcome<{ form: HTMLFormElement }> {
  const form = resolveOwnerForm(element);
  return form
    ? { ok: true, form }
    : refused(
        action,
        element,
        'a <form>, or an element inside one or owned by one through form="…" — this one has no owner form'
      );
}
