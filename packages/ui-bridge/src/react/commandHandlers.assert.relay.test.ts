/**
 * `ai/assert` and `ai/assert/batch` must reach the assertion executor whole
 * over the relay.
 *
 * The relay's listener once rebuilt every request as `{ target, type, expected }`,
 * so `attributeName` and `propertyName` never arrived and the executor threw
 * `Cannot read properties of undefined (reading 'toLowerCase')`. The fix
 * routes both commands through `normalizeAssertion` / `normalizeAssertionBatch`.
 *
 * One case per `AssertionRequest` field, plus the batch's `stopOnFailure`, a
 * `SearchCriteria` target and a bare-string entry. Each enters through
 * `createRelayHandlers` (server half), crosses JSON, and lands in the listener's
 * `executeCommand`. The executor is spied, so what is compared is exactly the
 * request it received. Every expectation is a hand-written literal.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { AssertionExecutor } from '../ai/assertions';
import { relayIntoListener } from './__tests__/relay-into-listener';

const EMPTY_BATCH = {
  passed: true,
  results: [],
  passedCount: 0,
  failedCount: 0,
  totalCount: 0,
  mode: 'all',
};

afterEach(() => {
  vi.restoreAllMocks();
});

/** Every field of `AssertionRequest` besides `target` and `type`, with a distinctive value. */
const FIELD_CASES: Array<[string, Record<string, unknown>]> = [
  ['expected', { type: 'hasText', expected: 'Save' }],
  ['attributeName', { type: 'attribute', attributeName: 'aria-label', expected: 'x' }],
  ['propertyName', { type: 'cssProperty', propertyName: 'border-top-color', expected: 'red' }],
  [
    'allowedValues',
    { type: 'cssPropertyInSet', propertyName: 'hyphens', allowedValues: ['manual', 'auto'] },
  ],
  [
    'range',
    { type: 'cssPropertyRange', propertyName: 'outline-offset', range: { min: 1, max: 4 } },
  ],
  ['tokenPath', { type: 'tokenCompliance', propertyName: '--tone', tokenPath: 'color.tone' }],
  ['timeout', { type: 'exists', timeout: 1234 }],
  ['message', { type: 'exists', message: 'the save button must exist' }],
  ['fuzzy', { type: 'exists', fuzzy: true }],
  ['relatedTarget', { type: 'noOverlap', relatedTarget: 'cancel' }],
  ['relatedTarget (criteria)', { type: 'noOverlap', relatedTarget: { text: 'Cancel' } }],
  ['minGap', { type: 'minSpacing', relatedTarget: 'cancel', minGap: 17 }],
  ['target (SearchCriteria)', { type: 'exists', target: { text: 'Save', role: 'button' } }],
];

describe('ai/assert over the relay keeps every field', () => {
  it.each(FIELD_CASES)('%s reaches AssertionExecutor.assert', async (_name, fields) => {
    const assert = vi
      .spyOn(AssertionExecutor.prototype, 'assert')
      .mockResolvedValue({ passed: true } as never);
    const request = { target: 'save', ...fields };

    await relayIntoListener().aiAssert(request as never, {} as never);

    expect(assert).toHaveBeenCalledTimes(1);
    expect(assert.mock.calls[0][0]).toEqual(request);
  });

  it('a bare natural-language assertion is parsed, not stringified', async () => {
    const assert = vi
      .spyOn(AssertionExecutor.prototype, 'assert')
      .mockResolvedValue({ passed: true } as never);

    await relayIntoListener().aiAssert(
      { assertion: 'the save button exists', timeout: 99 } as never,
      {} as never
    );

    const got = assert.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(got.type).toBe('exists');
    expect(got.timeout).toBe(99);
  });
});

describe('ai/assert/batch over the relay keeps every field', () => {
  it.each(FIELD_CASES)('%s reaches AssertionExecutor.assertBatch', async (_name, fields) => {
    const assertBatch = vi
      .spyOn(AssertionExecutor.prototype, 'assertBatch')
      .mockResolvedValue(EMPTY_BATCH as never);
    const entry = { target: 'save', ...fields };

    await relayIntoListener().aiAssertBatch({ assertions: [entry] } as never, {} as never);

    expect(assertBatch).toHaveBeenCalledTimes(1);
    expect(assertBatch.mock.calls[0][0].assertions).toEqual([entry]);
  });

  it('stopOnFailure and mode reach the executor', async () => {
    const assertBatch = vi
      .spyOn(AssertionExecutor.prototype, 'assertBatch')
      .mockResolvedValue(EMPTY_BATCH as never);

    await relayIntoListener().aiAssertBatch(
      { assertions: [{ target: 'a', type: 'exists' }], mode: 'any', stopOnFailure: true } as never,
      {} as never
    );

    const got = assertBatch.mock.calls[0][0];
    expect(got.stopOnFailure).toBe(true);
    expect(got.mode).toBe('any');
  });

  it('mode defaults to all', async () => {
    const assertBatch = vi
      .spyOn(AssertionExecutor.prototype, 'assertBatch')
      .mockResolvedValue(EMPTY_BATCH as never);

    await relayIntoListener().aiAssertBatch(
      { assertions: [{ target: 'a', type: 'exists' }] } as never,
      {} as never
    );

    expect(assertBatch.mock.calls[0][0].mode).toBe('all');
  });

  it('a bare-string entry is an NL assertion beside a structured one that keeps its fields', async () => {
    const assertBatch = vi
      .spyOn(AssertionExecutor.prototype, 'assertBatch')
      .mockResolvedValue(EMPTY_BATCH as never);

    await relayIntoListener().aiAssertBatch(
      {
        assertions: [
          'the save button exists',
          { target: 'save', type: 'attribute', attributeName: 'lang', expected: 'de' },
        ],
      } as never,
      {} as never
    );

    const [first, second] = assertBatch.mock.calls[0][0].assertions as unknown as Array<
      Record<string, unknown>
    >;
    expect(first.type).toBe('exists');
    expect(second.attributeName).toBe('lang');
  });
});
