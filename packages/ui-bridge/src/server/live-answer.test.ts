/**
 * The live-answer classifier reads the TYPE of a relay rejection, never its
 * message (plan 2026-11-08-ui-bridge-relay-and-exec-mode-follow-ups-from-pr-329,
 * Phase 2, D1).
 */

import { describe, expect, it } from 'vitest';
import { OwnerMismatchError, RelayDestroyedError, TabRoutingError } from './command-relay';
import {
  NoLiveAnswer,
  TabReportedFailure,
  cacheFallbackMeta,
  isNoLiveAnswer,
  isTabReportedFailure,
  mayFailOver,
  noLiveAnswerCause,
} from './live-answer';

describe('noLiveAnswerCause', () => {
  it.each([
    ['not_delivered', 'no browser tab is connected to receive it'],
    ['unanswered', 'no tab answered it in time'],
  ] as const)('a NoLiveAnswer(%s) maps to its default cause', (reason, cause) => {
    expect(noLiveAnswerCause('getElement', new NoLiveAnswer('anything at all', reason))).toBe(
      cause
    );
  });

  it('a NoLiveAnswer with its own cause answers that cause', () => {
    const e = new NoLiveAnswer('Command dropped from queue', 'not_delivered', 'it was dropped');
    expect(noLiveAnswerCause('getElement', e)).toBe('it was dropped');
  });

  it('a TabReportedFailure reading like a timeout is a LIVE answer (type over message)', () => {
    const e = new TabReportedFailure('Command getElement timed out after 5ms', undefined, 'tab-a');
    expect(noLiveAnswerCause('getElement', e)).toBeUndefined();
  });

  it('a TabReportedFailure reading like SDK_DISCONNECTED is a LIVE answer', () => {
    const e = new TabReportedFailure('SDK_DISCONNECTED: no tab', undefined, 'tab-a');
    expect(noLiveAnswerCause('getElement', e)).toBeUndefined();
  });

  it("the tab's own `Unknown command action: getElement` is the no-case cause for getElement only", () => {
    const e = new TabReportedFailure('Unknown command action: getElement', undefined, 'tab-a');
    expect(noLiveAnswerCause('getElement', e)).toBe(
      "the tab's UI Bridge SDK has no getElement case"
    );
    expect(noLiveAnswerCause('getElementState', e)).toBeUndefined();
    const longer = new TabReportedFailure('Unknown command action: getElementState');
    expect(noLiveAnswerCause('getElement', longer)).toBeUndefined();
  });

  it('a no-case message on a plain Error is a live answer: only a tab reports a no-case', () => {
    expect(
      noLiveAnswerCause('getElement', new Error('Unknown command action: getElement'))
    ).toBeUndefined();
  });

  it.each([
    ['an OwnerMismatchError', new OwnerMismatchError('tab-a', 'alice', 'bob')],
    ['a plain Error reading like SDK_DISCONNECTED', new Error('SDK_DISCONNECTED: no tab')],
    ['a plain Error reading like a timeout', new Error('Command getElement timed out after 5ms')],
    ['a string', 'SDK_DISCONNECTED: no tab'],
    ['undefined', undefined],
  ])('%s is a live answer (untyped fails closed)', (_label, e) => {
    expect(noLiveAnswerCause('getElement', e)).toBeUndefined();
  });
});

describe('the type guards', () => {
  it('recognise a copy from a second bundle by name and code', () => {
    const copy = Object.assign(new Error('x'), {
      name: 'TabReportedFailure',
      code: 'TAB_REPORTED_FAILURE',
      result: { success: false },
    });
    expect(isTabReportedFailure(copy)).toBe(true);
    const none = Object.assign(new Error('x'), {
      name: 'NoLiveAnswer',
      code: 'NO_LIVE_ANSWER',
      reason: 'unanswered',
      noAnswerCause: 'no tab answered it in time',
    });
    expect(isNoLiveAnswer(none)).toBe(true);
    expect(noLiveAnswerCause('getElement', none)).toBe('no tab answered it in time');
  });

  it('do not take a lookalike name without the code', () => {
    expect(
      isTabReportedFailure(Object.assign(new Error('x'), { name: 'TabReportedFailure' }))
    ).toBe(false);
    expect(isNoLiveAnswer(Object.assign(new Error('x'), { name: 'NoLiveAnswer' }))).toBe(false);
  });

  it('carry what the tab posted', () => {
    const posted = { success: false, error: 'Element x not found' };
    const e = new TabReportedFailure('Element x not found', posted, 'tab-a');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('TabReportedFailure');
    expect(e.message).toBe('Element x not found');
    expect(e.result).toBe(posted);
    expect(e.tabId).toBe('tab-a');
  });
});

describe('cacheFallbackMeta', () => {
  it("keeps #329's reason byte for byte by default", () => {
    expect(cacheFallbackMeta('getElement', 'no tab answered it in time')).toEqual({
      fallback: true,
      reason:
        "Relay command 'getElement' got no live answer (no tab answered it in time) — answered from the cached snapshot, which can be stale or another tab's.",
    });
  });

  it('names another cache when told to', () => {
    expect(cacheFallbackMeta('getConsoleErrors', 'x', 'the last console-errors read').reason).toBe(
      "Relay command 'getConsoleErrors' got no live answer (x) — answered from the last console-errors read, which can be stale or another tab's."
    );
  });
});

/**
 * A `NoLiveAnswer` from a second copy of the module (a duplicated bundle): a
 * plain `Error` carrying only the name, code and fields, never `instanceof`.
 */
function duckNoLiveAnswer(reason: 'not_delivered' | 'unanswered', extra: object = {}): Error {
  return Object.assign(new Error('from another bundle'), {
    name: 'NoLiveAnswer',
    code: 'NO_LIVE_ANSWER',
    reason,
    noAnswerCause: 'a cause',
    noTransport: false,
    evicted: false,
    ...extra,
  });
}

describe('mayFailOver (Phase 3, D3)', () => {
  it('a duck-typed copy is not an instance of the class (the rows below test the name/code path)', () => {
    expect(duckNoLiveAnswer('not_delivered')).not.toBeInstanceOf(NoLiveAnswer);
  });

  const unanswered = new NoLiveAnswer('Command x timed out', 'unanswered');
  const notDelivered = new NoLiveAnswer('nothing carried it', 'not_delivered');

  it.each([
    ['not_delivered, a write', 'click', notDelivered, true],
    ['not_delivered, a read', 'getElement', notDelivered, true],
    ['unanswered, a declared read', 'getElement', unanswered, true],
    ['unanswered, a write', 'click', unanswered, false],
    ['unanswered, an unclassified action (absent means write)', 'someNewAction', unanswered, false],
    [
      'the no-case failure for this action',
      'click',
      new TabReportedFailure('Unknown command action: click'),
      true,
    ],
    [
      "another action's no-case failure",
      'click',
      new TabReportedFailure('Unknown command action: clickElement'),
      false,
    ],
    [
      'a failure the tab reported',
      'getElement',
      new TabReportedFailure('Element x not found'),
      false,
    ],
    ['an untyped error', 'getElement', new Error('SDK_DISCONNECTED: No browser connected'), false],
    ['an ownership refusal', 'getElement', new OwnerMismatchError('tab-a', 'u1', 'u2'), false],
    [
      'a routing refusal',
      'getElement',
      new TabRoutingError('TAB_NOT_FOUND', 'tab-z', [], 'tabId "tab-z" is not in connectedTabs'),
      false,
    ],
    ['a destroyed relay', 'getElement', new RelayDestroyedError(), false],
    [
      'an eviction under load, a declared read',
      'getElement',
      new NoLiveAnswer('Command evicted: too many pending commands', 'unanswered', 'evicted', {
        evicted: true,
      }),
      false,
    ],
    [
      'a duck-typed not_delivered copy (a second bundle)',
      'click',
      duckNoLiveAnswer('not_delivered'),
      true,
    ],
    [
      'a duck-typed unanswered copy, a declared read',
      'getElement',
      duckNoLiveAnswer('unanswered'),
      true,
    ],
    ['a duck-typed unanswered copy, a write', 'click', duckNoLiveAnswer('unanswered'), false],
    [
      'a duck-typed evicted copy, a declared read',
      'getElement',
      duckNoLiveAnswer('unanswered', { evicted: true }),
      false,
    ],
  ])('%s', (_label, action, e, expected) => {
    expect(mayFailOver(action, e)).toBe(expected);
  });
});
