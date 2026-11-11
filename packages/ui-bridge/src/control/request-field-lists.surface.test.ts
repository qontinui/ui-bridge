/**
 * The control entry (browser-safe, not `./server`) publishes the request-field
 * lists, so an out-of-repo consumer reads the same lists the transports do.
 * Pinned literally, key for key: adding a request field is a reviewed edit here.
 */

import { describe, expect, it } from 'vitest';
import * as control from './index';
import { COMPONENT_ACTION_REQUEST_FIELDS as ENGINE_COMPONENT_FIELDS } from '../server/component-action-invocation';

describe('control entry request-field exports', () => {
  it('exports the component-action helpers', () => {
    expect(typeof control.componentActionInvocation).toBe('function');
    expect(typeof control.componentActionRequestFromWire).toBe('function');
    expect(typeof control.componentActionRequestFields).toBe('function');
  });

  it('COMPONENT_ACTION_REQUEST_FIELDS lists exactly the five fields', () => {
    expect(Object.keys(control.COMPONENT_ACTION_REQUEST_FIELDS).sort()).toEqual(
      ['action', 'params', 'requestId', 'timeoutMs', 'verifyEffect'].sort()
    );
    expect(control.COMPONENT_ACTION_REQUEST_FIELDS).toBe(ENGINE_COMPONENT_FIELDS);
  });

  it('CONTROL_ACTION_REQUEST_FIELDS lists exactly the 13 ControlActionRequest fields', () => {
    expect(Object.keys(control.CONTROL_ACTION_REQUEST_FIELDS).sort()).toEqual(
      [
        'action',
        'params',
        'waitOptions',
        'windowLabel',
        'requestId',
        'captureAfter',
        'retryOptions',
        'waitAfter',
        'waitAfterTimeout',
        'waitAfterMinStable',
        'verifyEffect',
        'fromSnapshotId',
        'includeResolutionAlternates',
      ].sort()
    );
    for (const v of Object.values(control.CONTROL_ACTION_REQUEST_FIELDS)) expect(v).toBe(true);
  });
});
