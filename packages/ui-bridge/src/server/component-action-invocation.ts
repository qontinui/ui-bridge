/**
 * The HTTP body of `POST /control/component/:id/action/:actionId`, made into a
 * `ComponentActionRequest`.
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
 *   - request fields (`timeoutMs`, `requestId`), hoisted onto the request;
 *   - routing fields (`tabId`, `targetTabId`, `__callerUserId`), which the
 *     adapters splice into a body and the relay lifts off a request before
 *     dispatch. A routing field left in `params` reaches the action handler as
 *     a parameter and escapes the relay's ownership routing.
 */

import type { ComponentActionRequest } from '../control/types';

const REQUEST_FIELDS = new Set(['params', 'timeoutMs', 'requestId']);
const ROUTING_FIELDS = ['tabId', 'targetTabId', '__callerUserId'] as const;

type RoutingField = (typeof ROUTING_FIELDS)[number];

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
        Object.entries(body).filter(([k]) => !REQUEST_FIELDS.has(k) && !routingNames.has(k))
      )
    : {};
  const explicit =
    body?.params !== null && typeof body?.params === 'object' && !Array.isArray(body.params)
      ? (body.params as Record<string, unknown>)
      : {};
  const routing: Partial<Record<RoutingField, string>> = {};
  for (const field of ROUTING_FIELDS) {
    const value = body?.[field];
    if (typeof value === 'string') routing[field] = value;
  }
  return {
    request: {
      action: actionId,
      params: { ...flat, ...explicit },
      timeoutMs: typeof body?.timeoutMs === 'number' ? body.timeoutMs : undefined,
      requestId: typeof body?.requestId === 'string' ? body.requestId : undefined,
    },
    routing,
  };
}
