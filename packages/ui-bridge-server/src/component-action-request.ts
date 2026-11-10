/**
 * The one field list this package's component-action hops read the request by.
 *
 * It copies `COMPONENT_ACTION_REQUEST_FIELDS` from `@qontinui/ui-bridge`
 * (`src/server/component-action-invocation.ts`). This package cannot import that
 * list at runtime. It resolves `@qontinui/ui-bridge` by range (`>=0.29.0`), and
 * no published version exports the list. Two things keep the copy in step:
 *   - the type, which makes the copy exhaustive against `ComponentActionRequest`,
 *     so a field added to the interface fails this package's typecheck until it
 *     is listed here;
 *   - `component-action-request.test.ts`, which compares the copy with the
 *     engine's list.
 */

import type { ComponentActionRequest } from '@qontinui/ui-bridge/control';

export const COMPONENT_ACTION_REQUEST_FIELDS: Readonly<Record<keyof ComponentActionRequest, true>> =
  {
    action: true,
    params: true,
    requestId: true,
    timeoutMs: true,
    verifyEffect: true,
  };

/**
 * The request fields `source` carries, each as it is, and no other key: the
 * request out of a payload that mixes it with keys of its own transport. The
 * executor validates each field it reads. The list is read by own key, at call
 * time, so a prototype name such as `toString` is never a field.
 */
export function componentActionRequestFields(source: object): ComponentActionRequest {
  return Object.fromEntries(
    Object.entries(source).filter(([key]) =>
      Object.prototype.hasOwnProperty.call(COMPONENT_ACTION_REQUEST_FIELDS, key)
    )
  ) as unknown as ComponentActionRequest;
}
