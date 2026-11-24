/**
 * `react/history-commands.ts` — every payload spelling and every answer arm of
 * the two history reads, with literal expectations (plan
 * 2026-11-08-relayed-ui-bridge-actions-have-no-browser-case, Phase 2, D5).
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { ElementLogEntry } from '../core/types';
import { getGlobalEffectStore, resetGlobalEffectStore } from '../control/effect-store';
import type { EffectRecordEntry } from '../control/effect-store';
import {
  ELEMENT_HISTORY_PAYLOAD_SHAPE,
  RECENT_EFFECTS_PAYLOAD_SHAPE,
  elementHistoryCommand,
  isHistoryCommandFailure,
  recentEffectsCommand,
  type ElementHistorySource,
} from './history-commands';

const ENTRY = {
  id: 'eel-1',
  elementId: 'dom-go',
  eventType: 'element:stateChanged',
  level: 'info',
  timestamp: 1,
  message: 'State changed: dom-go',
} as ElementLogEntry;

/** A registry that records what it was asked. */
function logRegistry(hasLog?: boolean) {
  const calls: unknown[][] = [];
  const registry: ElementHistorySource = {
    getElementHistory: (...args: unknown[]) => {
      calls.push(args);
      return [ENTRY];
    },
    ...(hasLog === undefined ? {} : { hasElementHistory: () => hasLog }),
  };
  return { registry, calls };
}

const refusal = (error: string, expectedPayload: string) => ({
  success: false,
  error,
  failureDetails: { errorCode: 'INVALID_REQUEST', message: error, expectedPayload },
});

const UNAVAILABLE = {
  success: false,
  error:
    'getElementHistory: this registry keeps no element history (it was built without an ' +
    'element event log), so an empty list would be "cannot see" read as "nothing happened".',
  code: 'UB-CAPABILITY-UNAVAILABLE',
  data: { code: 'capability_unavailable_in_build', reason: 'registry_has_no_history' },
};

afterEach(() => resetGlobalEffectStore());

describe('elementHistoryCommand · payload grammar', () => {
  it.each([
    ['{elementId}', { elementId: 'dom-go' }, ['dom-go', undefined]],
    ['{id}', { id: 'dom-go' }, ['dom-go', undefined]],
    [
      '{elementId, options}',
      { elementId: 'dom-go', options: { limit: 2 } },
      ['dom-go', { limit: 2 }],
    ],
    ['elementId wins over id', { elementId: 'dom-go', id: 'dom-other' }, ['dom-go', undefined]],
  ])('%s reads the log with the literal arguments', (_l, payload, args) => {
    const { registry, calls } = logRegistry(true);
    expect(elementHistoryCommand(payload, registry)).toEqual([ENTRY]);
    expect(calls).toEqual([args]);
  });

  it.each([
    ['a string', 'dom-go', 'getElementHistory: the payload must be a JSON object'],
    ['null', null, 'getElementHistory: the payload must be a JSON object'],
    ['an array', ['dom-go'], 'getElementHistory: the payload must be a JSON object'],
    ['no id', {}, 'getElementHistory: "elementId" must be a non-empty string'],
    ['an empty id', { elementId: '' }, 'getElementHistory: "elementId" must be a non-empty string'],
    ['a numeric id', { elementId: 7 }, 'getElementHistory: "elementId" must be a non-empty string'],
    [
      'array options',
      { elementId: 'dom-go', options: [] },
      'getElementHistory: "options", when given, must be a JSON object',
    ],
    [
      'string options',
      { elementId: 'dom-go', options: 'desc' },
      'getElementHistory: "options", when given, must be a JSON object',
    ],
  ])('%s is refused INVALID_REQUEST and the log is not read', (_l, payload, error) => {
    const { registry, calls } = logRegistry(true);
    const answer = elementHistoryCommand(payload, registry);
    expect(answer).toEqual(refusal(error, ELEMENT_HISTORY_PAYLOAD_SHAPE));
    expect(isHistoryCommandFailure(answer)).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe('elementHistoryCommand · a registry that keeps no history', () => {
  it('no getElementHistory method: UB-CAPABILITY-UNAVAILABLE, never []', () => {
    const answer = elementHistoryCommand({ elementId: 'dom-go' }, {});
    expect(answer).toEqual(UNAVAILABLE);
    expect(isHistoryCommandFailure(answer)).toBe(true);
  });

  it('hasElementHistory() === false: the same envelope, and the log is not read', () => {
    const { registry, calls } = logRegistry(false);
    expect(elementHistoryCommand({ elementId: 'dom-go' }, registry)).toEqual(UNAVAILABLE);
    expect(calls).toEqual([]);
  });

  it('a registry that does not say (no hasElementHistory) is read', () => {
    const { registry } = logRegistry(undefined);
    const answer = elementHistoryCommand({ elementId: 'dom-go' }, registry);
    expect(answer).toEqual([ENTRY]);
    expect(isHistoryCommandFailure(answer)).toBe(false);
  });
});

describe('recentEffectsCommand · the limit coercion', () => {
  const A = { action: 'a', timestamp: 1 } as EffectRecordEntry;
  const B = { action: 'b', timestamp: 2 } as EffectRecordEntry;
  const C = { action: 'c', timestamp: 3 } as EffectRecordEntry;

  it.each([
    ['no payload', undefined, [C, B, A]],
    ['null', null, [C, B, A]],
    ['{}', {}, [C, B, A]],
    ['a number', { limit: 2 }, [C, B]],
    ['a numeric string', { limit: '1' }, [C]],
    ['a padded numeric string', { limit: ' 2 ' }, [C, B]],
    ['an empty string', { limit: '' }, [C, B, A]],
    ['a blank string', { limit: '   ' }, [C, B, A]],
    ['a non-numeric string', { limit: 'many' }, [C, B, A]],
    ['Infinity', { limit: Infinity }, [C, B, A]],
    ['NaN', { limit: NaN }, [C, B, A]],
    ['zero', { limit: 0 }, []],
    ['a negative number', { limit: -1 }, []],
  ])('%s answers the literal newest-first slice', (_l, payload, expected) => {
    getGlobalEffectStore().record(A);
    getGlobalEffectStore().record(B);
    getGlobalEffectStore().record(C);
    expect(recentEffectsCommand(payload)).toEqual(expected);
  });

  it.each([
    ['a string', '5'],
    ['an array', [5]],
  ])('%s payload is refused INVALID_REQUEST', (_l, payload) => {
    expect(recentEffectsCommand(payload)).toEqual(
      refusal('getRecentEffects: the payload must be a JSON object', RECENT_EFFECTS_PAYLOAD_SHAPE)
    );
  });
});
