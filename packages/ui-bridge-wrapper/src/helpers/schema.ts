/**
 * `paramSchemaOf`
 *
 * Tiny helper that produces a JSON-Schema-subset object from a plain
 * descriptor, matching the shape `useUIComponent` already exposes on its
 * `actions[].paramSchema` field. The existing SDK contract says "no
 * runtime validation is performed" — this helper's only job is to surface
 * parameter names and types on the runner's `/control/component/:id`
 * endpoint so callers can discover the action signature.
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
