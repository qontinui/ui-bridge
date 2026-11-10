/**
 * The HTTP body of `POST /control/component/:id/action/:actionId`, made into a
 * `ComponentActionRequest`, and the one field list every component-action hop
 * reads the request by.
 *
 * Shared by the server and relay handlers' `invokeComponentAction`, the
 * route's handler. Its parameter list matches the route, so the adapters pass
 * `(id, actionId, body, context)` and nothing has to guess which argument is
 * which.
 *
 * The body may be the wrapped `{ params: {...} }` shape or the flat shape an
 * action's `paramSchema` advertises (`{ layoutId: 'single' }`). Flat keys are
 * merged into `params`, and an explicit `params` wins on collision: parity
 * with the runner's `UIBridgeComponentActionRequest` merge and the element
 * action route's flat format. Two kinds of key never become params:
 *   - request fields, the keys of {@link COMPONENT_ACTION_REQUEST_FIELDS}
 *     other than `action` and `params`. Each is hoisted onto the request as it
 *     is, and the executor validates it: the executor is the one place every
 *     transport passes through. `verifyEffect` was once missing from a
 *     hand-written copy of this list, so it was merged into `params` as if it
 *     were an action argument and the executor never saw it;
 *   - routing fields (`tabId`, `targetTabId`, `__callerUserId`), which the
 *     adapters splice into a body and the relay lifts off a request before
 *     dispatch. They are dropped from the flat keys and from the top level of
 *     an explicit `params`, and the reserved `__callerUserId` from any depth,
 *     so none reaches the action handler as a parameter.
 *
 * The other transports carry the request as an object of its own, so they
 * need no split. The relay listener passes it on whole
 * (`componentActionRequestFromWire`), and the whole-request server handler
 * takes it as typed. The WebSocket handler, whose payload also carries
 * `componentId`, takes the listed fields out of it
 * (`componentActionRequestFields`).
 */

import type { ComponentActionRequest } from '../control/types';
import { withoutReservedCaller } from './reserved-caller';

/**
 * Every field of `ComponentActionRequest`.
 *
 * The type makes the list exhaustive. A field added to the interface and not
 * here, or listed here and not on the interface, fails to compile. Every hop
 * that reads the request by field name reads it through this list, so once a
 * new field is listed, it reaches the executor from every transport, and the
 * compiler makes sure it is listed.
 */
export const COMPONENT_ACTION_REQUEST_FIELDS: Readonly<Record<keyof ComponentActionRequest, true>> =
  {
    action: true,
    params: true,
    requestId: true,
    timeoutMs: true,
    verifyEffect: true,
  };

const ROUTING_FIELDS = ['tabId', 'targetTabId', '__callerUserId'] as const;

type RoutingField = (typeof ROUTING_FIELDS)[number];

/**
 * Whether `key` is a request field. Read by own key, at call time, so a
 * prototype name such as `toString` is never one.
 */
function isRequestField(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(COMPONENT_ACTION_REQUEST_FIELDS, key);
}

/**
 * Whether a body key is hoisted onto the request. `params` is merged instead.
 * `action` is a request field, but the route's `:actionId` names the action,
 * so a body key called `action` stays the action argument it has always been.
 */
function isHoistedField(key: string): boolean {
  return key !== 'action' && key !== 'params' && isRequestField(key);
}

export interface ComponentActionInvocation {
  /** The action request: `action`, merged `params`, and the request fields. */
  request: ComponentActionRequest;
  /** The routing fields the body carried, for a transport that routes on them. */
  routing: Partial<Record<RoutingField, string>>;
}

export function componentActionInvocation(
  actionId: string,
  body: Record<string, unknown> | undefined
): ComponentActionInvocation {
  const routingNames: ReadonlySet<string> = new Set(ROUTING_FIELDS);
  const flat = body
    ? Object.fromEntries(
        Object.entries(body).filter(
          ([k]) => k !== 'params' && !isHoistedField(k) && !routingNames.has(k)
        )
      )
    : {};
  const explicit =
    body?.params !== null && typeof body?.params === 'object' && !Array.isArray(body.params)
      ? Object.fromEntries(
          Object.entries(body.params as Record<string, unknown>).filter(
            ([k]) => !routingNames.has(k)
          )
        )
      : {};
  const routing: Partial<Record<RoutingField, string>> = {};
  for (const field of ROUTING_FIELDS) {
    const value = body?.[field];
    if (typeof value === 'string') routing[field] = value;
  }
  return {
    request: {
      action: actionId,
      params: withoutReservedCaller({ ...flat, ...explicit }),
      ...(body ? Object.fromEntries(Object.entries(body).filter(([k]) => isHoistedField(k))) : {}),
    },
    routing,
  };
}

/**
 * The request fields `source` carries, each as it is, and no other key: the
 * request out of a payload that mixes it with keys of its own transport.
 *
 * Partial, because nothing here proves `action` is present. A caller supplies
 * the action it has already read, as the WebSocket handler does.
 */
export function componentActionRequestFields(source: object): Partial<ComponentActionRequest> {
  return Object.fromEntries(Object.entries(source).filter(([key]) => isRequestField(key)));
}

/**
 * A request as a transport delivered it, made into the executor's request.
 *
 * It is `source` whole, minus the routing keys that name the component (`id`,
 * `componentId`) and the action (`actionId`), with `action` read from
 * `actionId` first and then from `action`. It is whole on purpose. The
 * executor reads the request by field name and validates what it reads, so a
 * field that no hop has heard of still reaches it instead of being dropped on
 * the way.
 *
 * Partial, because the wire may name no action at all. The caller narrows
 * `action` before the request reaches the executor: the relay listener looks
 * the action up on the component and hands on the id it found.
 */
export function componentActionRequestFromWire(source: object): Partial<ComponentActionRequest> {
  const {
    id: _id,
    componentId: _componentId,
    actionId,
    ...request
  } = source as Record<string, unknown>;
  return { ...request, action: actionId ?? request.action } as Partial<ComponentActionRequest>;
}
