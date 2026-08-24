/**
 * `paramSchemaOf`
 *
 * Tiny helper that produces a JSON-Schema-subset object from a plain
 * descriptor, matching the shape `useUIComponent` already exposes on its
 * `actions[].paramSchema` field. It surfaces parameter names and types on the
 * runner's `/control/component/:id` endpoint so callers can discover the
 * action signature.
 *
 * ⚠️ **The output is ENFORCED, not merely advertised.** This doc used to say
 * the SDK performs "no runtime validation"; that stopped being true in Phase 2
 * of plan `2026-08-20-ui-bridge-action-declaration-shape`. The invocation seam
 * now checks `params` against the schema before the handler runs, and the
 * object form this helper emits is exactly form 1 of the supported subset
 * (`@qontinui/ui-bridge` `core/param-schema.ts`, which documents the grammar).
 * Enforcement defaults to `'warn'`, so a wrong schema logs rather than breaks —
 * until a deployment arms `setDefaultParamValidationMode('enforce')`, at which
 * point it rejects real calls with `UB-ACTION-REJECTED`.
 *
 * Two consequences worth knowing before you declare one:
 *
 *   - **`additionalProperties: false` is always emitted**, so any param not in
 *     the descriptor is a violation. That is the point of the helper, but it
 *     means a handler that quietly accepts extras must declare them.
 *   - **An unrecognised type name is passed through verbatim** (see `normalize`
 *     below). The validator treats a `type` outside the seven JSON Schema
 *     primitive names as expressing no constraint, so a typo like `"sting"`
 *     silently validates everything rather than rejecting everything. It fails
 *     open, not closed — but it fails.
 *
 * Accepted descriptor values:
 *   - a JSON-Schema type name string (`"string"`, `"number"`, ...)
 *   - an object already shaped like JSON Schema (`{ type: "string", enum: [...] }`)
 *   - `null` / `undefined` → field omitted
 *
 * Example:
 *
 * ```ts
 * paramSchemaOf({ email: 'string', password: 'string', remember: 'boolean' })
 * // => {
 * //   type: 'object',
 * //   properties: {
 * //     email:    { type: 'string' },
 * //     password: { type: 'string' },
 * //     remember: { type: 'boolean' },
 * //   },
 * //   required: ['email', 'password', 'remember'],
 * //   additionalProperties: false,
 * // }
 * ```
 */

const PRIMITIVE_TYPES = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'object',
  'array',
  'null',
]);

type SchemaValue = string | Record<string, unknown> | null | undefined;

function normalize(value: SchemaValue): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    if (!PRIMITIVE_TYPES.has(value)) {
      // Unknown string — surface it as a type anyway so introspection
      // surfaces *something* rather than silently dropping the field.
      return { type: value };
    }
    return { type: value };
  }
  if (typeof value === 'object') {
    return { ...value };
  }
  return null;
}

export function paramSchemaOf<T extends Record<string, SchemaValue>>(
  shape: T
): Record<string, unknown> {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];
  for (const [key, raw] of Object.entries(shape)) {
    const normalized = normalize(raw);
    if (!normalized) continue;
    const { optional, ...rest } = normalized as Record<string, unknown> & {
      optional?: unknown;
    };
    properties[key] = rest;
    if (optional !== true) {
      required.push(key);
    }
  }
  const schema: Record<string, unknown> = {
    type: 'object',
    properties,
    additionalProperties: false,
  };
  if (required.length > 0) {
    schema['required'] = required;
  }
  return schema;
}
