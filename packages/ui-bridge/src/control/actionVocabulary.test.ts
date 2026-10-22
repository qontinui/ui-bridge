/**
 * The "did you mean" verb table (plan
 * 2026-10-22-runner-ui-bridge-makes-an-agent-guess-its-own-vocabulary, D3 /
 * Phase 8). The table is asserted as LITERALS so an edited or dropped entry
 * goes red here. The same literals are asserted against `@qontinui/ui-bridge-native`'s package-local
 * copy. The
 * runner's Phase 1 copy (in flight) mirrors this table.
 */

import { describe, it, expect } from 'vitest';
import {
  ACTION_VERB_SYNONYMS,
  UnknownActionError,
  describeUnknownAction,
  suggestAction,
  unknownActionContext,
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
      mouseover: ['hover'],
      mouseenter: ['hover'],
      scrollTo: ['scrollIntoView'],
    });
  });
});

describe('suggestAction', () => {
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
    expect(suggestAction('scrollTo', ['scrollIntoView'])).toBe('scrollIntoView');
  });

  it('matches the synonym key case-insensitively', () => {
    expect(suggestAction('PRESS', terminalInput)).toBe('sendKeys');
    expect(suggestAction('DblClick', ['doubleClick'])).toBe('doubleClick');
  });

  it('fixes the case of an exact accepted verb', () => {
    expect(suggestAction('sendkeys', terminalInput)).toBe('sendKeys');
    expect(suggestAction('CLICK', button)).toBe('click');
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

describe('unknownActionContext / UnknownActionError', () => {
  it('carries no didYouMean key when there is no suggestion', () => {
    const none = describeUnknownAction('frobnicate', { accepted: ['click'] });
    expect(unknownActionContext(none)).toEqual({ supportedActions: ['click'] });
    expect('didYouMean' in unknownActionContext(none)).toBe(false);
    expect(Object.keys(new UnknownActionError(none))).not.toContain('didYouMean');
  });

  it('carries the suggestion and code when there is one', () => {
    const hint = describeUnknownAction('tap', { accepted: ['press'] });
    expect(unknownActionContext(hint)).toEqual({
      supportedActions: ['press'],
      didYouMean: 'press',
    });
    const err = new UnknownActionError(hint);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(hint.message);
    expect({ ...err }).toMatchObject({ code: 'UNKNOWN_ACTION', didYouMean: 'press' });
  });
});
