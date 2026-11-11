/**
 * The "did you mean" verb table (plan
 * 2026-10-22-runner-ui-bridge-makes-an-agent-guess-its-own-vocabulary, D3 /
 * Phase 8). The table is asserted as LITERALS so an edited or dropped entry
 * goes red here. The same literals are asserted against `@qontinui/ui-bridge`
 * (this package keeps a package-local copy: `@qontinui/ui-bridge` is only an
 * optional peer). The runner's Rust copy (`action_vocabulary.rs`) mirrors this
 * table; no test spans the copies.
 */

import { describe, it, expect } from 'vitest';
import {
  ACTION_VERB_SYNONYMS,
  describeUnknownAction,
  foldVerb,
  suggestAction,
} from './actionVocabulary';

describe('ACTION_VERB_SYNONYMS', () => {
  it('is exactly the D3 table', () => {
    expect(ACTION_VERB_SYNONYMS).toEqual({
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
      double: ['doubleClick'],
      right: ['rightClick'],
      middle: ['middleClick'],
      mouseover: ['hover'],
      mouseenter: ['hover'],
      mouseleave: ['unhover'],
      mouseout: ['unhover'],
      scrollTo: ['scrollIntoView'],
    });
  });
});

describe('suggestAction', () => {
  it('suggests nothing, and does not throw, for a verb that is not a string', () => {
    for (const bad of [undefined, null, 42, { action: 'click' }]) {
      expect(suggestAction(bad as unknown as string, ['click'])).toBeUndefined();
    }
  });

  const terminalInput = ['focus', 'blur', 'type', 'sendKeys', 'clear'];
  const button = ['focus', 'blur', 'click', 'hoverClick'];
  const nativeButton = ['focus', 'blur', 'press', 'longPress', 'doubleTap'];

  it('picks the first candidate the element accepts', () => {
    expect(suggestAction('press', terminalInput)).toBe('sendKeys');
    expect(suggestAction('press', button)).toBe('click');
    expect(suggestAction('tap', button)).toBe('click');
    expect(suggestAction('tap', nativeButton)).toBe('press');
    expect(suggestAction('click', nativeButton)).toBe('press');
    expect(suggestAction('fill', terminalInput)).toBe('type');
    expect(suggestAction('typeText', terminalInput)).toBe('type');
    expect(suggestAction('dblclick', ['doubleClick'])).toBe('doubleClick');
    expect(suggestAction('contextmenu', ['rightClick'])).toBe('rightClick');
    expect(suggestAction('middleclick', ['middleClick'])).toBe('middleClick');
    expect(suggestAction('mouseover', ['hover'])).toBe('hover');
    expect(suggestAction('mouseleave', ['hover', 'unhover'])).toBe('unhover');
    expect(suggestAction('mouseOut', ['hover', 'unhover'])).toBe('unhover');
    // An element whose advertised list lacks `unhover` is never told to use it.
    expect(suggestAction('mouseleave', ['hover', 'click'])).toBeUndefined();
    expect(suggestAction('scrollTo', ['scrollIntoView'])).toBe('scrollIntoView');
  });

  // D4 (plan 2026-11-09-an-elements-advertised-verbs-depend-on-which-path-found-it):
  // every web element accepts `sendKeys`, so the keyboard verbs' candidates are
  // ordered by element kind. A text-entry element (it accepts `type`) keeps
  // `sendKeys` first; any other puts `click` first. The table above is unchanged.
  it('orders the keyboard candidates by element: sendKeys on text entry, click elsewhere', () => {
    const buttonWithKeys = ['click', 'hoverClick', 'sendKeys', 'focus', 'blur'];
    const inputWithClick = ['click', 'type', 'sendKeys', 'clear', 'focus'];
    expect(suggestAction('press', buttonWithKeys)).toBe('click');
    expect(suggestAction('press', ['sendKeys', 'click'])).toBe('click');
    expect(suggestAction('keyDown', buttonWithKeys)).toBe('click');
    expect(suggestAction('key', buttonWithKeys)).toBe('click');
    expect(suggestAction('press', inputWithClick)).toBe('sendKeys');
    expect(suggestAction('keypress', inputWithClick)).toBe('sendKeys');
    expect(suggestAction('PRESS', ['TYPE', 'sendKeys', 'click'])).toBe('sendKeys');
    // With only one of the two accepted, that one, whatever the element.
    expect(suggestAction('press', ['sendKeys', 'focus'])).toBe('sendKeys');
    expect(suggestAction('press', ['click', 'type'])).toBe('click');
    // Other candidate lists are untouched by the reorder.
    expect(suggestAction('tap', ['press', 'click'])).toBe('click');
  });

  // A text box typed with keys (an ARIA textbox, a contenteditable) accepts no
  // `type`, so only the caller can say what it is: `keyboardEntry`.
  it('keyboardEntry keeps sendKeys first on a text box that accepts no type', () => {
    const textBox = ['click', 'hoverClick', 'sendKeys', 'focus', 'blur'];
    expect(suggestAction('press', textBox)).toBe('click');
    expect(suggestAction('press', textBox, { keyboardEntry: true })).toBe('sendKeys');
    expect(suggestAction('keyDown', textBox, { keyboardEntry: true })).toBe('sendKeys');
    expect(suggestAction('press', ['click', 'focus'], { keyboardEntry: true })).toBe('click');
    expect(
      describeUnknownAction('press', { accepted: textBox, keyboardEntry: true }).didYouMean
    ).toBe('sendKeys');
  });

  it('matches the synonym key case-insensitively', () => {
    expect(suggestAction('PRESS', terminalInput)).toBe('sendKeys');
    expect(suggestAction('DblClick', ['doubleClick'])).toBe('doubleClick');
  });

  it('fixes the case of an exact accepted verb', () => {
    expect(suggestAction('sendkeys', terminalInput)).toBe('sendKeys');
    expect(suggestAction('CLICK', button)).toBe('click');
  });

  it('ignores separators and surrounding whitespace, as the runner does', () => {
    expect(suggestAction('send_keys', terminalInput)).toBe('sendKeys');
    expect(suggestAction('Send-Keys', terminalInput)).toBe('sendKeys');
    expect(suggestAction(' sendKeys ', terminalInput)).toBe('sendKeys');
    expect(suggestAction('scroll_into_view', ['scrollIntoView'])).toBe('scrollIntoView');
    expect(suggestAction('dbl_click', ['doubleClick'])).toBe('doubleClick');
    expect(suggestAction('   ', terminalInput)).toBeUndefined();
    expect(foldVerb(' Scroll_Into-View ')).toBe('scrollintoview');
  });

  it('takes the first accepted verb when two fold alike', () => {
    expect(suggestAction('SENDKEYS', ['send_keys', 'sendKeys'])).toBe('send_keys');
  });

  it("names the canonical verb for the runner's built-in aliases", () => {
    expect(suggestAction('double', ['doubleClick'])).toBe('doubleClick');
    expect(suggestAction('right', ['rightClick'])).toBe('rightClick');
    expect(suggestAction('middle', ['middleClick'])).toBe('middleClick');
  });

  it('never corrects a verb the element accepts exactly', () => {
    expect(suggestAction('press', nativeButton)).toBeUndefined();
    expect(suggestAction('click', ['click', 'press'])).toBeUndefined();
  });

  it('never suggests a verb the element would also reject', () => {
    expect(suggestAction('press', ['focus', 'blur'])).toBeUndefined();
    expect(suggestAction('fill', button)).toBeUndefined();
    expect(suggestAction('frobnicate', terminalInput)).toBeUndefined();
    expect(suggestAction('constructor', terminalInput)).toBeUndefined();
  });
});

describe('describeUnknownAction', () => {
  it('renders a non-string verb without throwing, even one shadowing toString', () => {
    const bad = JSON.parse('{"toString":"x"}') as unknown;
    const hint = describeUnknownAction(bad, { accepted: ['click'], elementId: 'save' });
    expect(hint.message).toContain(`Unknown action '{"toString":"x"}'`);
    expect(hint.didYouMean).toBeUndefined();
    expect(describeUnknownAction(undefined, { accepted: ['click'] }).message).toContain(
      "Unknown action 'undefined'"
    );
  });

  it('names the element, its verbs and the suggestion', () => {
    const hint = describeUnknownAction('press', {
      elementId: 'terminal.command-bar-input',
      accepted: ['focus', 'type', 'sendKeys'],
    });
    expect(hint.didYouMean).toBe('sendKeys');
    expect(hint.supportedActions).toEqual(['focus', 'type', 'sendKeys']);
    expect(hint.message).toBe(
      "Unknown action 'press' for element 'terminal.command-bar-input'. " +
        "This element accepts: focus, type, sendKeys. Did you mean 'sendKeys'?"
    );
  });

  it('suggests only from the accepted list, never a verb the element rejects', () => {
    const hint = describeUnknownAction('fill', { elementId: 'b', accepted: ['click'] });
    expect(hint).toEqual({
      message: "Unknown action 'fill' for element 'b'. This element accepts: click.",
      supportedActions: ['click'],
    });
    expect('didYouMean' in hint).toBe(false);
  });

  it('omits the suggestion when there is none and labels a global list', () => {
    const hint = describeUnknownAction('frobnicate', { accepted: ['click', 'click', 'type'] });
    expect(hint).toEqual({
      message: "Unknown action 'frobnicate'. Supported: click, type.",
      supportedActions: ['click', 'type'],
    });
  });
});
