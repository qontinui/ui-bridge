/**
 * Registry getElementState() — form control snapshot tests
 *
 * Verifies that `<select>` snapshots carry the full option list (value/label/selected)
 * and that form-control state (checked) is populated correctly for native inputs and
 * ARIA-role checkboxes/switches. `getElementState` is not exported from the registry,
 * so the tests reach it indirectly via `registry.registerElement(...).getState()` —
 * see `core/registry.ts:760` where the getter is wired up.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry, resetGlobalRegistry } from '../registry';

describe('getElementState — select + form-control coverage', () => {
  let registry: UIBridgeRegistry;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    resetGlobalRegistry();
  });

  describe('<select> availableOptions', () => {
    it('captures full option list with `selected` flag when one option is selected via the `selected` attribute', () => {
      const select = document.createElement('select');
      select.innerHTML = `
        <option value="a">Alpha</option>
        <option value="b" selected>Bravo</option>
        <option value="c">Charlie</option>
      `;
      container.appendChild(select);

      const registered = registry.registerElement('sel-1', select, { type: 'select' });
      const state = registered.getState();

      expect(state.availableOptions).toBeDefined();
      expect(state.availableOptions).toHaveLength(3);
      expect(state.availableOptions![0]).toEqual({ value: 'a', label: 'Alpha', selected: false });
      expect(state.availableOptions![1]).toEqual({ value: 'b', label: 'Bravo', selected: true });
      expect(state.availableOptions![2]).toEqual({ value: 'c', label: 'Charlie', selected: false });
      expect(state.selectedOptions).toEqual(['b']);
      expect(state.value).toBe('b');
    });

    it('moves the `selected: true` flag when select.value is changed', () => {
      const select = document.createElement('select');
      select.innerHTML = `
        <option value="a">Alpha</option>
        <option value="b" selected>Bravo</option>
        <option value="c">Charlie</option>
      `;
      container.appendChild(select);

      const registered = registry.registerElement('sel-2', select, { type: 'select' });

      select.value = 'c';

      const state = registered.getState();
      expect(state.availableOptions).toHaveLength(3);
      expect(state.availableOptions![0].selected).toBe(false);
      expect(state.availableOptions![1].selected).toBe(false);
      expect(state.availableOptions![2].selected).toBe(true);
      expect(state.selectedOptions).toEqual(['c']);
      expect(state.value).toBe('c');
    });

    it('reports multiple `selected: true` entries for <select multiple>', () => {
      const select = document.createElement('select');
      select.multiple = true;
      select.innerHTML = `
        <option value="red" selected>Red</option>
        <option value="green">Green</option>
        <option value="blue" selected>Blue</option>
      `;
      container.appendChild(select);

      const registered = registry.registerElement('sel-multi', select, { type: 'select' });
      const state = registered.getState();

      expect(state.availableOptions).toHaveLength(3);
      expect(state.availableOptions!.filter((o) => o.selected)).toHaveLength(2);
      expect(state.availableOptions![0]).toEqual({ value: 'red', label: 'Red', selected: true });
      expect(state.availableOptions![1].selected).toBe(false);
      expect(state.availableOptions![2]).toEqual({ value: 'blue', label: 'Blue', selected: true });
      expect(state.selectedOptions).toEqual(['red', 'blue']);
    });

    it('uses the `label` attribute when present, overriding textContent', () => {
      const select = document.createElement('select');
      const opt = document.createElement('option');
      opt.value = 'x';
      opt.setAttribute('label', 'Label Attr Wins');
      opt.textContent = 'Plain Text';
      select.appendChild(opt);
      container.appendChild(select);

      const registered = registry.registerElement('sel-label', select, { type: 'select' });
      const state = registered.getState();

      expect(state.availableOptions).toHaveLength(1);
      expect(state.availableOptions![0].label).toBe('Label Attr Wins');
    });

    it('falls back to trimmed textContent when no `label` attribute is set', () => {
      const select = document.createElement('select');
      const opt = document.createElement('option');
      opt.value = 'y';
      opt.textContent = '   Trimmed Text   ';
      select.appendChild(opt);
      container.appendChild(select);

      const registered = registry.registerElement('sel-text', select, { type: 'select' });
      const state = registered.getState();

      expect(state.availableOptions).toHaveLength(1);
      expect(state.availableOptions![0].label).toBe('Trimmed Text');
    });
  });

  describe('form-control checked state', () => {
    it('populates `checked` and `value` for a native checkbox', () => {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = 'accept-terms';
      checkbox.checked = true;
      container.appendChild(checkbox);

      const registered = registry.registerElement('cb-1', checkbox, { type: 'checkbox' });
      const state = registered.getState();

      expect(state.checked).toBe(true);
      expect(state.value).toBe('accept-terms');
    });

    it('derives `checked` from aria-checked="true" on an ARIA switch role', () => {
      const sw = document.createElement('div');
      sw.setAttribute('role', 'switch');
      sw.setAttribute('aria-checked', 'true');
      container.appendChild(sw);

      const registered = registry.registerElement('switch-1', sw, { type: 'switch' });
      const state = registered.getState();

      expect(state.checked).toBe(true);
      expect(state.ariaChecked).toBe(true);
    });
  });
});
