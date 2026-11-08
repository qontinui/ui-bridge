/**
 * The element-command payload grammar, enumerated
 * (plan 2026-11-08-ui-bridge-inject-exec-mode-is-a-second-class-driver, D2/D3).
 *
 * Every accepted spelling, every refusal arm, and the field-agreement rule —
 * each with its expected value spelled out, so a reader can check the grammar
 * against this file without reading the parser.
 */

import { describe, expect, it } from 'vitest';
import {
  ELEMENT_ACTION_PAYLOAD_SHAPE,
  ELEMENT_READ_PAYLOAD_SHAPE,
  readElementActionPayload,
  readElementIdPayload,
} from './element-command-payload';

/** The literal every executeElementAction refusal must carry (Phase 6, run B line 2). */
const SHAPE_PREFIX = '{"id":"<elementId>","request":{"action":"<action>"';

function refused(payload: unknown) {
  const reading = readElementActionPayload(payload);
  if (reading.ok) throw new Error(`expected a refusal, got ${JSON.stringify(reading)}`);
  return reading;
}

describe('readElementActionPayload · accepted spellings', () => {
  it('canonical {id, request}: the request object is the request, unchanged', () => {
    const request = { action: 'focus' };
    const reading = readElementActionPayload({ id: 'q', request });
    expect(reading).toEqual({ ok: true, id: 'q', request: { action: 'focus' } });
    expect(reading.ok && reading.request).toBe(request);
  });

  it('"elementId" in place of "id"', () => {
    expect(readElementActionPayload({ elementId: 'q', request: { action: 'focus' } })).toEqual({
      ok: true,
      id: 'q',
      request: { action: 'focus' },
    });
  });

  it('"id" and "elementId" both present and equal', () => {
    expect(
      readElementActionPayload({ id: 'q', elementId: 'q', request: { action: 'click' } })
    ).toEqual({ ok: true, id: 'q', request: { action: 'click' } });
  });

  it('flat: the payload minus the id IS the request, so value/text/clear/params/fromSnapshotId carry through', () => {
    expect(
      readElementActionPayload({
        id: 'q',
        action: 'type',
        text: 'hello',
        clear: true,
        value: 'v',
        params: { delay: 5 },
        fromSnapshotId: 'snap-1',
      })
    ).toEqual({
      ok: true,
      id: 'q',
      request: {
        action: 'type',
        text: 'hello',
        clear: true,
        value: 'v',
        params: { delay: 5 },
        fromSnapshotId: 'snap-1',
      },
    });
  });

  it('"elementId" + flat', () => {
    expect(readElementActionPayload({ elementId: 'q', action: 'focus' })).toEqual({
      ok: true,
      id: 'q',
      request: { action: 'focus' },
    });
  });

  it('flat drag fields stay on the request root, where the drag case reads them', () => {
    expect(
      readElementActionPayload({ id: 'src', action: 'drag', targetId: 'dst', steps: 4 })
    ).toEqual({ ok: true, id: 'src', request: { action: 'drag', targetId: 'dst', steps: 4 } });
  });

  it('a request plus an AGREEING top-level action is accepted', () => {
    expect(
      readElementActionPayload({ id: 'q', action: 'click', request: { action: 'click' } })
    ).toEqual({ ok: true, id: 'q', request: { action: 'click' } });
  });

  it('a request field present at both levels with the SAME value is accepted', () => {
    expect(
      readElementActionPayload({
        id: 'q',
        text: 'x',
        params: { a: [1, { b: 2 }] },
        request: { action: 'type', text: 'x', params: { a: [1, { b: 2 }] } },
      })
    ).toEqual({
      ok: true,
      id: 'q',
      request: { action: 'type', text: 'x', params: { a: [1, { b: 2 }] } },
    });
  });

  it.each([
    ['settleTimeout', 250],
    ['skipSettle', true],
    ['targetTabId', 'tab-a'],
  ])('dispatcher key "%s" beside "request" is tolerated', (key, value) => {
    expect(
      readElementActionPayload({ id: 'q', request: { action: 'click' }, [key]: value })
    ).toEqual({ ok: true, id: 'q', request: { action: 'click' } });
  });
});

describe('readElementActionPayload · refusals', () => {
  it('a top-level action DISAGREEING with request.action is refused', () => {
    const r = refused({ id: 'q', action: 'click', request: { action: 'focus' } });
    expect(r.message).toContain(
      'names two actions: "action" is the string "click" but "request.action" is the string "focus"'
    );
    expect(r.elementId).toBe('q');
  });

  it('"id" and "elementId" disagreeing is refused, naming neither as the target', () => {
    const r = refused({ id: 'a', elementId: 'b', request: { action: 'click' } });
    expect(r.message).toContain('names two elements: "id" is "a" but "elementId" is "b"');
    expect(r.elementId).toBe('');
  });

  it('a missing id is refused', () => {
    const r = refused({ request: { action: 'click' } });
    expect(r.message).toContain('names no element: "id" (or "elementId") is missing');
    expect(r.receivedKeys).toEqual(['request']);
  });

  it.each([[{ id: 'q' }], [{ elementId: 'q' }]])('a missing action is refused: %j', (payload) => {
    const r = refused(payload);
    expect(r.message).toContain(
      'names no action: "request.action" (or a flat top-level "action") is missing'
    );
    expect(r.elementId).toBe('q');
  });

  it('{} names both missing halves at once', () => {
    const r = refused({});
    expect(r.message).toContain('names no element');
    expect(r.message).toContain('names no action');
    expect(r.receivedKeys).toEqual([]);
  });

  it.each([
    ['a string', 'click', 'the string "click"'],
    ['null', null, 'null'],
    ['an array', ['click'], 'an array'],
  ])('a request that is %s is refused', (_label, request, described) => {
    const r = refused({ id: 'q', request });
    expect(r.message).toContain(`"request" must be an object, got ${described}`);
  });

  it.each([
    ['empty', '', 'an empty string'],
    ['absent', undefined, 'nothing'],
    ['a number', 5, 'number 5'],
  ])('request.action %s is refused', (_label, action, described) => {
    const r = refused({ id: 'q', request: action === undefined ? {} : { action } });
    expect(r.message).toContain(`"request.action" must be a non-empty string, got ${described}`);
  });

  it('a flat action that is not a non-empty string is refused', () => {
    expect(refused({ id: 'q', action: '' }).message).toContain(
      '"action" must be a non-empty string, got an empty string'
    );
  });

  it.each([
    ['null', null, 'null'],
    ['an array', [{ id: 'q' }], 'an array'],
    ['a string', 'executeElementAction q click', 'the string "executeElementAction q click"'],
    ['undefined', undefined, 'nothing'],
    ['a number', 7, 'number 7'],
  ])('a payload that is %s is refused with no received keys', (_label, payload, described) => {
    const r = refused(payload);
    expect(r.message).toContain(`must be a JSON object, got ${described}`);
    expect(r.receivedKeys).toEqual([]);
    expect(r.elementId).toBe('');
  });

  it.each([
    [
      { id: '', request: { action: 'click' } },
      '"id" must be a non-empty string, got an empty string',
    ],
    [
      { elementId: '', action: 'click' },
      '"elementId" must be a non-empty string, got an empty string',
    ],
    [{ id: 42, request: { action: 'click' } }, '"id" must be a non-empty string, got number 42'],
  ])('an empty or non-string id is refused: %j', (payload, problem) => {
    expect(refused(payload).message).toContain(problem);
  });

  it('a request field at BOTH levels with different values is refused (text)', () => {
    const r = refused({ id: 'q', text: 'x', request: { action: 'type', text: 'y' } });
    expect(r.message).toContain('"text" is at both levels with different values');
  });

  it.each(['value', 'text', 'clear', 'params', 'fromSnapshotId'])(
    'request field "%s" present ONLY at the top level beside "request" is refused',
    (key) => {
      const r = refused({ id: 'q', request: { action: 'type' }, [key]: 'x' });
      expect(r.message).toContain(
        `"${key}" is at the top level beside "request", where nothing reads it — put it inside "request"`
      );
    }
  );

  it('any other key beside "request" is refused too: no field is silently dropped', () => {
    const r = refused({ id: 'src', request: { action: 'drag' }, targetId: 'dst' });
    expect(r.message).toContain('"targetId" is at the top level beside "request"');
  });

  it('every problem is named, not just the first', () => {
    const r = refused({
      id: 'a',
      elementId: 'b',
      request: { action: 'type' },
      text: 'x',
      clear: true,
    });
    expect(r.message).toContain('names two elements');
    expect(r.message).toContain('"text" is at the top level');
    expect(r.message).toContain('"clear" is at the top level');
    expect(r.receivedKeys).toEqual(['id', 'elementId', 'request', 'text', 'clear']);
  });

  it('a refusal names keys, never the values they carry (a typed value can be a secret)', () => {
    const r = refused({
      id: 'q',
      text: 'hunter2',
      request: { action: 'type', text: 'correct-horse' },
    });
    expect(r.message).not.toContain('hunter2');
    expect(r.message).not.toContain('correct-horse');
  });

  it.each([
    [null],
    [{}],
    [{ elementId: 'q' }],
    [{ id: 'q', request: 'click' }],
    [{ id: 'a', elementId: 'b', action: 'click' }],
    [{ id: 'q', request: { action: 'type' }, text: 'x' }],
  ])('every refusal names the canonical shape and both accepted spellings: %j', (payload) => {
    const { message } = refused(payload);
    expect(message.startsWith('executeElementAction payload refused: ')).toBe(true);
    expect(message).toContain(SHAPE_PREFIX);
    expect(message).toContain(ELEMENT_ACTION_PAYLOAD_SHAPE);
    expect(message).toContain('"elementId" in place of "id"');
    expect(message).toContain('a flat {"id":"<elementId>","action":"<action>", …}');
  });
});

describe('readElementIdPayload', () => {
  it.each([
    [{ id: 'q' }],
    [{ elementId: 'q' }],
    [{ id: 'q', elementId: 'q' }],
    [{ id: 'q', settleTimeout: 100, skipSettle: true, targetTabId: 'tab-a' }],
  ])('accepts %j as {id: "q"}', (payload) => {
    expect(readElementIdPayload('getElement', payload)).toEqual({ ok: true, id: 'q' });
  });

  it.each([
    [{}, 'names no element: "id" (or "elementId") is missing'],
    [{ id: '' }, '"id" must be a non-empty string, got an empty string'],
    [{ id: 'a', elementId: 'b' }, 'names two elements: "id" is "a" but "elementId" is "b"'],
    [{ id: 'q', includeState: true }, '"includeState" is not read by getElement'],
    [{ id: 'q', a: 1, b: 2 }, '"a", "b" are not read by getElement'],
    [null, 'must be a JSON object, got null'],
    ['q', 'must be a JSON object, got the string "q"'],
  ])('refuses %j', (payload, problem) => {
    const reading = readElementIdPayload('getElement', payload);
    expect(reading.ok).toBe(false);
    if (reading.ok) return;
    expect(reading.message).toContain(problem);
    expect(reading.message.startsWith('getElement payload refused: ')).toBe(true);
    expect(reading.message).toContain(ELEMENT_READ_PAYLOAD_SHAPE);
    expect(reading.message).toContain('"elementId" in place of "id"');
  });

  it('names the command it was given', () => {
    const reading = readElementIdPayload('getElementState', {});
    expect(!reading.ok && reading.message.startsWith('getElementState payload refused: ')).toBe(
      true
    );
  });
});
