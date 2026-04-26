/**
 * Target Decomposer Tests
 */

import { describe, it, expect } from 'vitest';
import { decomposeTarget, isSoftTypeHint } from './target-decomposer';

describe('decomposeTarget', () => {
  describe('basic element text extraction', () => {
    it('should extract simple element text', () => {
      const result = decomposeTarget('Save');
      expect(result.elementText).toBe('Save');
    });

    it('should strip noise words', () => {
      const result = decomposeTarget('the save button');
      expect(result.elementText).toBe('save');
      expect(result.elementType).toBe('button');
    });

    it('should handle multi-word element text', () => {
      const result = decomposeTarget('Start Extraction');
      expect(result.elementText).toBe('Start Extraction');
    });
  });

  describe('element type extraction', () => {
    it('should extract button type', () => {
      const result = decomposeTarget('close button');
      expect(result.elementType).toBe('button');
      expect(result.elementText).toBe('close');
    });

    it('should extract input type', () => {
      const result = decomposeTarget('email input');
      expect(result.elementType).toBe('input');
      expect(result.elementText).toBe('email');
    });

    it('should extract tab type', () => {
      const result = decomposeTarget('Terminal 1 tab');
      expect(result.elementType).toBe('tab');
      expect(result.elementText).toBe('Terminal 1');
    });

    it('should extract field as input', () => {
      const result = decomposeTarget('username field');
      expect(result.elementType).toBe('input');
      expect(result.elementText).toBe('username');
    });

    it('should extract dropdown as select', () => {
      const result = decomposeTarget('country dropdown');
      expect(result.elementType).toBe('select');
      expect(result.elementText).toBe('country');
    });

    it('should extract checkbox type', () => {
      const result = decomposeTarget('agree to terms checkbox');
      expect(result.elementType).toBe('checkbox');
      expect(result.elementText).toBe('agree to terms');
    });

    it('should extract switch/toggle', () => {
      const result = decomposeTarget('dark mode toggle');
      expect(result.elementType).toBe('switch');
      expect(result.elementText).toBe('dark mode');
    });

    it('should extract link type', () => {
      const result = decomposeTarget('forgot password link');
      expect(result.elementType).toBe('link');
      expect(result.elementText).toBe('forgot password');
    });
  });

  describe('spatial relation extraction', () => {
    it('should extract "near" relation', () => {
      const result = decomposeTarget('close button near Terminal 1 tab');
      expect(result.elementText).toBe('close');
      expect(result.elementType).toBe('button');
      expect(result.spatial).toEqual({
        relation: 'near',
        referenceDescription: 'Terminal 1 tab',
      });
    });

    it('should extract "above" relation', () => {
      const result = decomposeTarget('error message above the submit button');
      expect(result.spatial).toEqual({
        relation: 'above',
        referenceDescription: 'submit button',
      });
    });

    it('should extract "below" relation', () => {
      const result = decomposeTarget('help text below email input');
      expect(result.spatial).toEqual({
        relation: 'below',
        referenceDescription: 'email input',
      });
    });

    it('should extract "left of" relation', () => {
      const result = decomposeTarget('icon left of the search input');
      expect(result.spatial).toEqual({
        relation: 'leftOf',
        referenceDescription: 'search input',
      });
    });

    it('should extract "right of" relation', () => {
      const result = decomposeTarget('badge right of username');
      expect(result.spatial).toEqual({
        relation: 'rightOf',
        referenceDescription: 'username',
      });
    });

    it('should extract "next to" relation', () => {
      const result = decomposeTarget('delete button next to item 3');
      expect(result.spatial).toEqual({
        relation: 'near',
        referenceDescription: 'item 3',
      });
    });
  });

  describe('container extraction', () => {
    it('should extract "in the X" container', () => {
      const result = decomposeTarget('email input in the login form');
      expect(result.container).toBe('login form');
      expect(result.elementText).toBe('email');
      expect(result.elementType).toBe('input');
    });

    it('should extract "within the X" container', () => {
      const result = decomposeTarget('save button within the settings panel');
      expect(result.container).toBe('settings panel');
    });

    it('should convert "inside X" to container (not spatial)', () => {
      const result = decomposeTarget('submit button inside the dialog');
      expect(result.container).toBe('dialog');
      expect(result.spatial).toBeUndefined();
    });

    it('should not false-positive on "sign in"', () => {
      const result = decomposeTarget('sign in button');
      // "in" here is part of "sign in", not a container preposition
      expect(result.container).toBeUndefined();
      expect(result.elementType).toBe('button');
    });

    it('should not false-positive on "log in"', () => {
      const result = decomposeTarget('log in link');
      expect(result.container).toBeUndefined();
    });
  });

  describe('ordinal extraction', () => {
    it('should extract word ordinal', () => {
      const result = decomposeTarget('third item');
      expect(result.ordinal).toBe(3);
      expect(result.elementText).toBe('item');
    });

    it('should extract "first"', () => {
      const result = decomposeTarget('first button');
      expect(result.ordinal).toBe(1);
    });

    it('should extract "last"', () => {
      const result = decomposeTarget('last item in the list');
      expect(result.ordinal).toBe(-1);
      expect(result.container).toBe('list');
    });

    it('should extract numeric ordinal', () => {
      const result = decomposeTarget('2nd row');
      expect(result.ordinal).toBe(2);
    });

    it('should extract large numeric ordinal', () => {
      const result = decomposeTarget('11th item');
      expect(result.ordinal).toBe(11);
    });
  });

  describe('state filter extraction', () => {
    it('should extract "disabled" state', () => {
      const result = decomposeTarget('the disabled save button');
      expect(result.stateFilter).toBe('disabled');
      expect(result.elementText).toBe('save');
      expect(result.elementType).toBe('button');
    });

    it('should extract "active" state', () => {
      const result = decomposeTarget('active tab');
      expect(result.stateFilter).toBe('active');
      expect(result.elementType).toBe('tab');
    });

    it('should extract "selected" state', () => {
      const result = decomposeTarget('selected checkbox');
      expect(result.stateFilter).toBe('selected');
      expect(result.elementType).toBe('checkbox');
    });

    it('should extract "focused" state', () => {
      const result = decomposeTarget('the focused input');
      expect(result.stateFilter).toBe('focused');
      expect(result.elementType).toBe('input');
    });
  });

  describe('complex combinations', () => {
    it('should handle type + spatial', () => {
      const result = decomposeTarget('close button near Terminal 1 tab');
      expect(result.elementText).toBe('close');
      expect(result.elementType).toBe('button');
      expect(result.spatial?.relation).toBe('near');
      expect(result.spatial?.referenceDescription).toBe('Terminal 1 tab');
    });

    it('should handle type + container', () => {
      const result = decomposeTarget('the email input in the login form');
      expect(result.elementText).toBe('email');
      expect(result.elementType).toBe('input');
      expect(result.container).toBe('login form');
    });

    it('should handle ordinal + container', () => {
      const result = decomposeTarget('third item in the list');
      expect(result.elementText).toBe('item');
      expect(result.ordinal).toBe(3);
      expect(result.container).toBe('list');
    });

    it('should handle state + type', () => {
      const result = decomposeTarget('disabled save button');
      expect(result.stateFilter).toBe('disabled');
      expect(result.elementType).toBe('button');
      expect(result.elementText).toBe('save');
    });

    it('should handle state + type + container', () => {
      const result = decomposeTarget('disabled submit button in the form');
      expect(result.stateFilter).toBe('disabled');
      expect(result.elementType).toBe('button');
      expect(result.container).toBe('form');
      expect(result.elementText).toBe('submit');
    });

    it('should handle all components together', () => {
      const result = decomposeTarget('the disabled first close button near the header');
      expect(result.stateFilter).toBe('disabled');
      expect(result.ordinal).toBe(1);
      expect(result.elementType).toBe('button');
      expect(result.spatial?.relation).toBe('near');
      expect(result.elementText).toBe('close');
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      const result = decomposeTarget('');
      expect(result.elementText).toBe('');
    });

    it('should handle just a type', () => {
      const result = decomposeTarget('button');
      expect(result.elementType).toBe('button');
      expect(result.elementText).toBe('');
    });

    it('should handle text with no keywords', () => {
      const result = decomposeTarget('Submit');
      expect(result.elementText).toBe('Submit');
      expect(result.elementType).toBeUndefined();
    });

    it('should handle quoted text preservation', () => {
      const result = decomposeTarget('Start Extraction button');
      expect(result.elementText).toBe('Start Extraction');
      expect(result.elementType).toBe('button');
    });
  });

  // ---------------------------------------------------------------------------
  // Disclosure family — table-driven coverage
  //
  // Verifies the new synonym table recognises disclosure widgets and that
  // multi-word phrases ("details toggle") win precedence over the bare
  // "toggle" → switch synonym.
  // ---------------------------------------------------------------------------
  describe('disclosure family', () => {
    it('should map "details toggle" to disclosure (multi-word beats bare toggle)', () => {
      const result = decomposeTarget('Advanced details toggle');
      expect(result.elementType).toBe('disclosure');
      expect(result.elementText).toBe('Advanced');
    });

    it('should map "disclosure" to disclosure', () => {
      const result = decomposeTarget('Settings disclosure');
      expect(result.elementType).toBe('disclosure');
      expect(result.elementText).toBe('Settings');
    });

    it('should map "accordion" to disclosure', () => {
      const result = decomposeTarget('FAQ accordion');
      expect(result.elementType).toBe('disclosure');
      expect(result.elementText).toBe('FAQ');
    });

    it('should map "collapsible" to disclosure', () => {
      const result = decomposeTarget('Logs collapsible');
      expect(result.elementType).toBe('disclosure');
      expect(result.elementText).toBe('Logs');
    });

    it('should map "expander" to disclosure', () => {
      const result = decomposeTarget('More expander');
      expect(result.elementType).toBe('disclosure');
      expect(result.elementText).toBe('More');
    });

    it('should map "expandable" to disclosure', () => {
      const result = decomposeTarget('Notes expandable');
      expect(result.elementType).toBe('disclosure');
      expect(result.elementText).toBe('Notes');
    });

    it('should map bare "expand" verb to disclosure (soft hint)', () => {
      const result = decomposeTarget('expand Logs');
      expect(result.elementType).toBe('disclosure');
      expect(isSoftTypeHint(result)).toBe(true);
      expect(result.elementText).toBe('Logs');
    });

    it('should map bare "collapse" verb to disclosure (soft hint)', () => {
      const result = decomposeTarget('collapse Sidebar');
      expect(result.elementType).toBe('disclosure');
      expect(isSoftTypeHint(result)).toBe(true);
      expect(result.elementText).toBe('Sidebar');
    });

    it('should map bare "details" to disclosure (soft hint)', () => {
      const result = decomposeTarget('Job details');
      expect(result.elementType).toBe('disclosure');
      expect(isSoftTypeHint(result)).toBe(true);
      expect(result.elementText).toBe('Job');
    });

    it('should preserve label across "open the X accordion"', () => {
      const result = decomposeTarget('open the Pricing accordion');
      expect(result.elementType).toBe('disclosure');
      expect(result.elementText).toBe('open Pricing');
    });

    it('should preserve label across "click the X details toggle"', () => {
      const result = decomposeTarget('click the Advanced details toggle');
      expect(result.elementType).toBe('disclosure');
      expect(result.elementText).toBe('click Advanced');
    });
  });

  // ---------------------------------------------------------------------------
  // Soft-hint flag — table-driven coverage
  //
  // Verifies that isSoftTypeHint() returns true only for synonym entries
  // explicitly marked softHint, and false for hard pins.
  // ---------------------------------------------------------------------------
  describe('soft-hint flag', () => {
    it.each([
      // [description, expectedSoftHint, expectedType]
      ['save button', false, 'button'],
      ['email input', false, 'input'],
      ['Terminal 1 tab', false, 'tab'],
      ['country dropdown', false, 'select'],
      ['agree to terms checkbox', false, 'checkbox'],
      ['settings icon', true, 'button'],
      ['dark mode toggle', true, 'switch'],
      ['Advanced details toggle', false, 'disclosure'],
      ['Job details', true, 'disclosure'],
      ['expand Sidebar', true, 'disclosure'],
      ['collapse Logs', true, 'disclosure'],
      ['FAQ accordion', false, 'disclosure'],
    ])('decomposeTarget(%j).softHint = %j, type = %j', (input, expectedSoft, expectedType) => {
      const result = decomposeTarget(input);
      expect(result.elementType).toBe(expectedType);
      expect(isSoftTypeHint(result)).toBe(expectedSoft);
    });
  });

  // ---------------------------------------------------------------------------
  // Synonym table coverage — every synonym should produce its declared type
  // ---------------------------------------------------------------------------
  describe('synonym table coverage', () => {
    it.each([
      // textarea
      ['notes text area', 'textarea'],
      ['notes text field', 'textarea'],
      ['notes text box', 'textarea'],
      // input
      ['username input', 'input'],
      ['username field', 'input'],
      ['username textbox', 'input'],
      // select
      ['country drop down', 'select'],
      ['country dropdown', 'select'],
      ['country combo box', 'select'],
      ['country combobox', 'select'],
      ['country select', 'select'],
      // checkbox / radio
      ['terms check box', 'checkbox'],
      ['terms checkbox', 'checkbox'],
      ['option radio button', 'radio'],
      ['option radio', 'radio'],
      // links
      ['help link', 'link'],
      ['help hyperlink', 'link'],
      ['help anchor', 'link'],
      // navigation
      ['Profile menu item', 'menuitem'],
      ['Profile menuitem', 'menuitem'],
      ['Profile menu', 'menu'],
      // disclosure
      ['Section disclosure', 'disclosure'],
      ['Section accordion', 'disclosure'],
      ['Section collapsible', 'disclosure'],
      ['Section expander', 'disclosure'],
      ['Section expandable', 'disclosure'],
      ['Section details panel', 'disclosure'],
      // switch
      ['darkmode switch', 'switch'],
      // misc
      ['volume slider', 'slider'],
      ['username label', 'label'],
      ['Section heading', 'heading'],
    ])('decomposeTarget(%j).elementType = %j', (input, expected) => {
      const result = decomposeTarget(input);
      expect(result.elementType).toBe(expected);
    });
  });
});
