/**
 * How this package reads a component-action request off its transports.
 *
 * `@qontinui/ui-bridge` does the same for its own server
 * (`src/server/component-action-invocation.ts`). This package keeps its own
 * because it resolves `@qontinui/ui-bridge` by range (`>=0.29.0`), and no
 * published version exports that module. Two things differ here, both because
 * the installed `@qontinui/ui-bridge` may be older or newer than this package:
 *   - The whole-request hops (the direct handler and the WebSocket handler)
 *     hand the request on minus their own keys, not by the field list. So a
 *     field that a later `@qontinui/ui-bridge` adds is carried, even though this
 *     package's list predates it.
 *   - `requestId` and `verifyEffect` are checked here as well as at the
 *     executor (`withCheckedFields`), because no released executor validates
 *     `requestId`.
 */

import type { ComponentActionRequest } from '@qontinui/ui-bridge/control';

/**
 * Every field of `ComponentActionRequest`.
 *
 * The type makes the list exhaustive: a field added to the interface fails
 * this package's typecheck until it is listed here, and
 * `component-action-request.test.ts` compares the list with the engine's. The
 * route reads it to tell a request field from an action parameter.
 */
export const COMPONENT_ACTION_REQUEST_FIELDS: Readonly<Record<keyof ComponentActionRequest, true>> =
  {
    action: true,
    params: true,
    requestId: true,
    timeoutMs: true,
    verifyEffect: true,
  };

/**
 * Whether a key of the route's body is hoisted onto the request. `params` is
 * merged instead. `action` is a request field, but the route's `:actionId`
 * names the action, so a body key called `action` stays an action argument.
 * The list is read by own key, at call time, so a prototype name such as
 * `toString` is never a field.
 */
function isHoistedField(key: string): boolean {
  return (
    key !== 'action' &&
    key !== 'params' &&
    Object.prototype.hasOwnProperty.call(COMPONENT_ACTION_REQUEST_FIELDS, key)
  );
}

/**
 * `request` without a `requestId` that is not a string, or a `verifyEffect`
 * that is not a boolean.
 *
 * Defence in depth. The executor is where a request is validated, but this
 * package resolves `@qontinui/ui-bridge` by range, and no released executor
 * validates `requestId`: it echoes back whatever it was given. A `verifyEffect`
 * that is not a boolean is never an instruction.
 */
export function withCheckedFields(request: ComponentActionRequest): ComponentActionRequest {
  const { requestId, verifyEffect, ...rest } = request;
  return {
    ...rest,
    ...(typeof requestId === 'string' ? { requestId } : {}),
    ...(typeof verifyEffect === 'boolean' ? { verifyEffect } : {}),
  };
}

/**
 * The HTTP body of `POST /control/component/:id/action/:actionId`, made into a
 * request, the way `@qontinui/ui-bridge`'s `componentActionInvocation` makes
 * it. The route's `:actionId` names the action. The listed request fields are
 * hoisted onto the request. Every other key is an action parameter, as the flat
 * shape an action's `paramSchema` advertises, and an explicit `params` wins on
 * collision.
 */
export function componentActionInvocation(
  actionId: string,
  body: Record<string, unknown> | undefined
): ComponentActionRequest {
  const entries = Object.entries(body ?? {});
  const hoisted = Object.fromEntries(
    entries.filter(([key]) => isHoistedField(key))
  ) as Partial<ComponentActionRequest>;
  const flat = Object.fromEntries(
    entries.filter(([key]) => key !== 'params' && !isHoistedField(key))
  );
  const explicit = body?.params;
  return withCheckedFields({
    ...hoisted,
    action: actionId,
    params: {
      ...flat,
      ...(explicit !== null && typeof explicit === 'object' && !Array.isArray(explicit)
        ? explicit
        : {}),
    },
  });
}
