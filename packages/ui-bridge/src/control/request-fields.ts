/**
 * Every field of `ControlActionRequest`, as a runtime list.
 *
 * The type makes the list exhaustive: a field added to the interface and not
 * here, or listed here and not on the interface, fails to compile. A consumer
 * outside this repo that reads or forwards a control action request by field
 * name reads it through this list instead of keeping a copy that drifts.
 */

import type { ControlActionRequest } from './types';

export const CONTROL_ACTION_REQUEST_FIELDS: Readonly<Record<keyof ControlActionRequest, true>> = {
  action: true,
  params: true,
  waitOptions: true,
  windowLabel: true,
  requestId: true,
  captureAfter: true,
  retryOptions: true,
  waitAfter: true,
  waitAfterTimeout: true,
  waitAfterMinStable: true,
  verifyEffect: true,
  fromSnapshotId: true,
  includeResolutionAlternates: true,
};
