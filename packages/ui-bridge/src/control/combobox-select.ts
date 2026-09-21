/**
 * ONE implementation of "select a value on a custom combobox".
 *
 * ## Why this module exists
 *
 * There are two action paths into this package and they used to disagree about
 * the same element:
 *
 * - `control/action-executor.ts` (`performSelect`) routed a `role="combobox"` /
 *   `aria-expanded` element to a combobox implementation.
 * - `react/commandHandlers.ts` — the path the relay's
 *   `POST /control/element/<id>/action` actually reaches — handled
 *   `HTMLSelectElement` ONLY, and answered `Cannot select on BUTTON`.
 *
 * Meanwhile `serializeRegisteredElement` reports that same node as
 * `role: "combobox", tagName: "button"`. So the payload advertised a contract
 * one action path honoured and the other refused, and a driver could not tell
 * from the element which answer it would get. A verification instrument whose
 * own surfaces disagree cannot be used to decide anything.
 *
 * Both paths now call {@link comboboxSelect}. Copying it a third time would
 * rebuild exactly the divergence this closes.
 *
 * ## Why the outcome is a value, not a resolved promise
 *
 * The previous implementation `console.warn`ed and RESOLVED when the dropdown
 * never opened or the option was not there, so the caller reported
 * `success: true` over a no-op — a false green
 * [`ux-priorities` `a-status-signal-must-observe-the-state-it-names`]. Every
 * dead end is now a typed {@link ComboboxSelectOutcome} the caller must handle.
 *
 * Plan: 2026-09-06-ui-bridge-element-metadata-is-stale-and-misdeclared
 */

import { readAriaLabelAttr } from '../core/a11y';
import type { SelectAction } from './types';

/** Why a combobox select could not be completed. */
export type ComboboxSelectFailure =
  /** No `value` was supplied — nothing to look for. */
  | 'no-value'
  /** The trigger was actuated but no listbox/dropdown ever appeared. */
  | 'dropdown-not-found'
  /** The dropdown opened but carried no option matching the requested value. */
  | 'option-not-found';

/** The result of driving a custom combobox. Never silently successful. */
export type ComboboxSelectOutcome =
  | { ok: true; matchedText: string }
  | { ok: false; reason: ComboboxSelectFailure; message: string };

/** How many animation-frame-spaced attempts to give an async dropdown. */
const MAX_DROPDOWN_ATTEMPTS = 5;
/** Gap between dropdown lookups, in ms. */
const DROPDOWN_ATTEMPT_INTERVAL_MS = 50;

/**
 * Does this node present itself as a combobox?
 *
 * Deliberately the ATTRIBUTE (`role="combobox"` / `aria-expanded`), not the
 * computed ARIA role: this predicate has to agree with what a page author
 * actually wrote, and it is the same test `action-executor.performSelect` has
 * used since the combobox arm was added.
 */
export function isComboboxLike(element: HTMLElement): boolean {
  return element.getAttribute('role') === 'combobox' || element.hasAttribute('aria-expanded');
}

/**
 * Actuate a combobox trigger the way a real user does.
 *
 * A bare `element.click()` — which this implementation used to issue — fires
 * only the synthetic `click` MouseEvent. Radix, Headless UI and most other
 * headless-select libraries open on `pointerdown` and never see `click` for
 * their open logic, so the trigger stayed shut and the retry loop then timed
 * out looking for a dropdown that was never asked to appear.
 */
function actuateTrigger(element: HTMLElement): void {
  const rect =
    typeof element.getBoundingClientRect === 'function'
      ? element.getBoundingClientRect()
      : ({ left: 0, top: 0, width: 0, height: 0 } as DOMRect);
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;

  const make = (type: string, buttons: number): Event => {
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 0,
      buttons,
      clientX,
      clientY,
    };
    // jsdom below a certain version has no PointerEvent constructor. Falling
    // back to MouseEvent keeps the sequence dispatchable there; pointer-only
    // handlers simply do not fire, which is a limitation of the environment
    // rather than a silent difference in this code.
    if (typeof PointerEvent === 'function') {
      return new PointerEvent(type, { ...init, pointerType: 'mouse', isPrimary: true });
    }
    return new MouseEvent(type, init);
  };

  element.dispatchEvent(make('pointerdown', 1));
  element.dispatchEvent(
    new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })
  );
  element.dispatchEvent(make('pointerup', 0));
  element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
  element.click();
}

/**
 * Find the open dropdown/listbox associated with a trigger.
 * Supports: ARIA listbox, Radix, MUI, Select2, Ant Design, Headless UI.
 */
export function findOpenDropdown(trigger: HTMLElement): Element | null {
  // 1. ARIA listbox via aria-controls/aria-owns
  const listboxId = trigger.getAttribute('aria-controls') || trigger.getAttribute('aria-owns');
  if (listboxId) {
    const el = document.getElementById(listboxId);
    if (el) return el;
  }

  // 2. Radix / shadcn popper
  const radixListbox = document.querySelector(
    '[data-radix-popper-content-wrapper] [role="listbox"], [data-state="open"] [role="listbox"]'
  );
  if (radixListbox) return radixListbox;

  // 3. Generic ARIA listbox
  const ariaListbox = document.querySelector('[role="listbox"]');
  if (ariaListbox) return ariaListbox;

  // 4. MUI Select (renders a popover with role="presentation" containing <ul role="listbox">)
  const muiListbox = document.querySelector(
    '.MuiPopover-root [role="listbox"], .MuiPopper-root [role="listbox"], .MuiMenu-list'
  );
  if (muiListbox) return muiListbox;

  // 5. Select2 (jQuery-based, renders .select2-results__options)
  const select2Dropdown = document.querySelector(
    '.select2-container--open .select2-results__options'
  );
  if (select2Dropdown) return select2Dropdown;

  // 6. Ant Design (renders .ant-select-dropdown with .ant-select-item)
  const antDropdown = document.querySelector(
    '.ant-select-dropdown:not(.ant-select-dropdown-hidden)'
  );
  if (antDropdown) return antDropdown;

  // 7. Headless UI listbox
  const headlessListbox = document.querySelector(
    '[data-headlessui-state~="open"] [role="listbox"]'
  );
  if (headlessListbox) return headlessListbox;

  // 8. Generic open dropdown (last resort)
  return document.querySelector('[role="menu"][data-state="open"], .dropdown-menu.show');
}

/**
 * Find a matching option element within a dropdown container.
 * Handles various option patterns across frameworks.
 */
export function findDropdownOption(
  dropdown: Element,
  targetValue: string,
  byLabel?: boolean
): HTMLElement | null {
  const targetLower = targetValue.toLowerCase();

  const optionSelectors = [
    '[role="option"]', // ARIA standard
    '.ant-select-item-option', // Ant Design
    '.select2-results__option', // Select2
    '.MuiMenuItem-root', // MUI
    '[data-headlessui-state] [role="option"]', // Headless UI
    'li[data-value]', // Generic data-value
  ];

  for (const selector of optionSelectors) {
    const candidates = dropdown.querySelectorAll<HTMLElement>(selector);
    if (candidates.length === 0) continue;

    for (const opt of candidates) {
      const optDataValue = opt.getAttribute('data-value') ?? '';
      const optText = opt.textContent?.trim() ?? '';

      // Match by data-value, text content, or aria-label
      if (byLabel || !optDataValue) {
        if (optText === targetValue || optText.toLowerCase() === targetLower) {
          return opt;
        }
      } else {
        if (optDataValue === targetValue || optDataValue.toLowerCase() === targetLower) {
          return opt;
        }
      }

      const ariaLabel = readAriaLabelAttr(opt);
      if (ariaLabel && ariaLabel.toLowerCase() === targetLower) {
        return opt;
      }
    }
  }

  return null;
}

/**
 * Drive a custom combobox: actuate the trigger, wait for the listbox, click the
 * matching option. Resolves to a typed outcome — never to an unqualified
 * success.
 */
export function comboboxSelect(
  element: HTMLElement,
  options?: SelectAction
): Promise<ComboboxSelectOutcome> {
  const targetValue = Array.isArray(options?.value) ? options.value[0] : options?.value;
  if (!targetValue) {
    return Promise.resolve({
      ok: false,
      reason: 'no-value',
      message: "select on a combobox requires a 'value' parameter (the option to choose).",
    });
  }

  actuateTrigger(element);

  return new Promise<ComboboxSelectOutcome>((resolve) => {
    let attempts = 0;

    const tryFindOption = (): void => {
      attempts++;
      const dropdown = findOpenDropdown(element);

      if (!dropdown && attempts < MAX_DROPDOWN_ATTEMPTS) {
        setTimeout(tryFindOption, DROPDOWN_ATTEMPT_INTERVAL_MS);
        return;
      }

      if (!dropdown) {
        resolve({
          ok: false,
          reason: 'dropdown-not-found',
          message:
            `The combobox trigger was actuated but no listbox appeared within ` +
            `${MAX_DROPDOWN_ATTEMPTS} attempts, so "${targetValue}" was never offered. ` +
            `The control did not open — this is not a completed selection.`,
        });
        return;
      }

      const matched = findDropdownOption(dropdown, targetValue, options?.byLabel);
      if (!matched) {
        resolve({
          ok: false,
          reason: 'option-not-found',
          message: `The combobox opened but carries no option matching "${targetValue}".`,
        });
        return;
      }

      matched.click();
      resolve({ ok: true, matchedText: matched.textContent?.trim() ?? targetValue });
    };

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(tryFindOption);
    } else {
      setTimeout(tryFindOption, 0);
    }
  });
}
