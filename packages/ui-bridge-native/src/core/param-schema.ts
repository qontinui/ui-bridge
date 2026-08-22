/**
 * Parameter-schema validation for component actions.
 *
 * Plan `2026-08-20-ui-bridge-action-declaration-shape`, Phase 2.
 *
 * `ComponentAction.paramSchema` is **published to agents** — it is spread onto
 * `/control/components` and `/control/component/:id` by
 * `server/handlers.ts` `annotateComponentWithInvocationPaths`, and four live
 * runner consumers read it off the wire. Until Phase 2 nothing enforced it, so
 * an agent that read the schema and sent conforming params had no guarantee
 * the handler agreed. That is worse than publishing nothing: it invites trust
 * it cannot honour. This module is what makes the declaration enforceable.
 *
 * ---------------------------------------------------------------------------
 * THE SUPPORTED SUBSET — this is a CROSS-REPO CONTRACT
 * ---------------------------------------------------------------------------
 *
 * `qontinui-runner` reads these same schemas
 * (`workflow_generation/wrapper_manifest.rs`, `commands/command_interpreter.rs`,
 * `bin/wrappers_mcp.rs`), and `command_interpreter.rs` feeds one to an LLM and
 * asks it to produce conforming args. So the grammar below is not a private
 * implementation detail — changing it changes what those consumers may emit.
 *
 * **No dependency.** `@qontinui/ui-bridge` ships to browsers and has exactly
 * one runtime dependency (`dom-accessibility-api`). A full JSON Schema
 * validator (`ajv` and friends) would be the SDK's first heavyweight runtime
 * dep, which the plan rejected on bundle size. Hence a hand-implemented subset,
 * documented here rather than inferred from the code.
 *
 * **Two accepted top-level shapes**, because `useUIComponent`'s own author-
 * facing doc has always sanctioned both:
 *
 * 1. **Object-schema form** — the shape `paramSchemaOf()`
 *    (`@qontinui/ui-bridge-wrapper`) emits:
 *
 *    ```jsonc
 *    { "type": "object",
 *      "properties": { "username": { "type": "string" },
 *                      "remember": { "type": "boolean" } },
 *      "required": ["username"],
 *      "additionalProperties": false }
 *    ```
 *
 * 2. **Map form** — the lightweight shorthand the doc describes as
 *    "a map of `{ paramName: "string" | "number" | ... }`":
 *
 *    ```jsonc
 *    { "username": "string", "count": { "type": "integer", "minimum": 1 } }
 *    ```
 *
 * **Disambiguation rule** (deterministic, no heuristics): the schema is read as
 * form 1 **iff** its top level has `type === "object"` or carries a
 * `properties` object. Everything else is form 2. This is why `{ "type":
 * "string" }` is read as a map declaring one param named `type` of type
 * `string`, not as a top-level string schema — a params bag is always an
 * object, so a non-object top-level `type` cannot be describing the bag.
 *
 * ### Map form is a TYPE hint, never a REQUIREDNESS hint
 *
 * A bare string value in map form is read as a type name **only when it is one
 * of the seven JSON Schema primitive names** — `string`, `number`, `integer`,
 * `boolean`, `object`, `array`, `null` — which is exactly `paramSchemaOf`'s
 * own `PRIMITIVE_TYPES` set. **Any other string is prose and constrains
 * nothing.**
 *
 * That is not defensive coding, it is the corpus: a census of every literal
 * `paramSchema` in the fleet (2026-08-22) found ~50 map-form declarations in
 * `qontinui-runner` alone whose values are human-readable hints, not types —
 * `{ count: "number (>= 1, defaults to 1)", account: "string — either a Claude
 * account label … or the literal \"best\"" }`. Reading `"number (>= 1,
 * defaults to 1)"` as a type name would make every one of them unvalidatable
 * noise. The file that declares them says so itself: *"loose `Record<string,
 * unknown>` with hint strings, no runtime validation"*.
 *
 * For the same reason, **map form never marks anything required.** It has no
 * `required` array and no other way to express optionality, and most of those
 * ~50 real declarations describe params that are explicitly optional in their
 * own prose ("defaults to 1", "optional initial prompt"). Requiring by default
 * would report a violation on nearly every real call. An author who needs
 * required params writes form 1, which has a keyword for it.
 *
 * **Optionality in form 1** is exactly `required`: a property is required iff
 * listed there. Note `paramSchemaOf` **omits `required` entirely** when every
 * field is optional, so its absence means "nothing required", never "malformed".
 *
 * `optional: true` is not a JSON Schema keyword — it is this monorepo's
 * convention on `paramSchemaOf`'s *input* descriptors, and `paramSchemaOf`
 * strips it before the schema reaches the wire. It is honoured here (form 2
 * only) purely so an unstripped input-shaped object is read the same way.
 *
 * **Recognised property keywords** — everything else is IGNORED:
 *
 * | Keyword | Applies to | Meaning |
 * |---|---|---|
 * | `type` | any | `"string" \| "number" \| "integer" \| "boolean" \| "object" \| "array" \| "null"`, or an array of those (union — a value matching any member passes). Any OTHER type name constrains nothing (`paramSchemaOf` passes unknown names through verbatim, so they do occur) |
 * | `enum` | any | value must equal one of the listed JSON values |
 * | `const` | any | value must equal this JSON value |
 * | `properties` | objects | per-key sub-schemas, applied recursively |
 * | `required` | objects | array of key names that must be present |
 * | `additionalProperties` | objects | when exactly `false`, keys absent from `properties` are rejected. Any other value is ignored |
 * | `items` | arrays | one sub-schema applied to every element, recursively |
 * | `minimum` / `maximum` | numbers | inclusive bounds |
 * | `minLength` / `maxLength` | strings | inclusive bounds on `.length` |
 * | `pattern` | strings | ECMAScript regex, unanchored. An uncompilable pattern is ignored, never a failure |
 *
 * **⚠ Anything outside this table is IGNORED, never rejected.** `description`,
 * `default`, `title`, `format`, `examples`, `$schema`, `$ref`, `oneOf`,
 * `anyOf`, `allOf`, `not`, `patternProperties`, `minItems`, `exclusiveMinimum`
 * … all pass silently. This is deliberate and load-bearing: a schema outside
 * this subset is still *valid JSON Schema*, and rejecting an unrecognised
 * keyword would convert a documentation nicety into a hard invocation failure
 * for every author who wrote a richer schema than this validator reads. An
 * unreadable schema means "no constraint expressed here", not "invalid".
 * The same rule applies one level up: a `paramSchema` that is not a plain
 * object at all (`null`, an array, a string) expresses no constraint and
 * validates everything.
 *
 * **No coercion.** `"5"` does not satisfy `{"type":"number"}`. The runner's
 * LLM router is already instructed to "coerce numeric tokens to numbers"
 * (`command_interpreter.rs`), so coercing here would hide that contract rather
 * than enforce it.
 *
 * ---------------------------------------------------------------------------
 * DUPLICATE — deliberately not an import
 * ---------------------------------------------------------------------------
 *
 * DUPLICATE OF `@qontinui/ui-bridge` `src/core/param-schema.ts` — DELIBERATELY
 * NOT AN IMPORT, for the same reason as `core/abortable.ts` beside it:
 * `@qontinui/ui-bridge` is an OPTIONAL peerDependency of this package and is
 * absent from `dependencies`, so a consumer may install
 * `@qontinui/ui-bridge-native` alone; importing from it would resolve inside
 * this monorepo and then fail for that consumer.
 *
 * KEEP IN SYNC with `@qontinui/ui-bridge` `src/core/param-schema.ts`. The
 * module has no imports and touches no DOM or Node API — only `RegExp`,
 * `JSON`, `Set` and `Number`, all present in React Native. The documented
 * subset above is a cross-repo contract, so the two copies drifting is a
 * contract break, not a style nit.
 */

/** Which rule rejected a value. Machine-readable; pairs with `message`. */
export type ParamSchemaKeyword =
  | 'required'
  | 'type'
  | 'enum'
  | 'const'
  | 'additionalProperties'
  | 'minimum'
  | 'maximum'
  | 'minLength'
  | 'maxLength'
  | 'pattern';

/**
 * One rejected parameter. `path` is the whole point — an agent told only
 * "invalid params" cannot fix anything, so every issue names the param it is
 * about.
 */
export interface ParamSchemaIssue {
  /**
   * Location of the offending value, in dotted/bracketed form relative to the
   * params object: `"username"`, `"filter.status"`, `"ids[2]"`. Empty string
   * means the params object itself.
   */
  path: string;
  /** Which rule rejected it. */
  keyword: ParamSchemaKeyword;
  /** What the schema demanded, rendered for a human/agent reader. */
  expected: string;
  /** What was actually supplied, rendered compactly. Absent for `required`. */
  received?: string;
  /** One-line explanation naming both the param and the reason. */
  message: string;
}

/** Outcome of {@link validateActionParams}. */
export interface ParamValidationResult {
  valid: boolean;
  /** Empty iff `valid`. */
  issues: ParamSchemaIssue[];
}

/**
 * What the executor does with a schema violation.
 *
 * - `'enforce'` — reject the invocation before the handler runs, with
 *   `errorCode: 'UB-ACTION-REJECTED'` and the issue list attached.
 * - `'warn'` — log the violation and invoke the handler anyway.
 * - `'off'` — skip validation entirely (no schema walk, no allocation).
 */
export type ParamValidationMode = 'enforce' | 'warn' | 'off';

/**
 * **`'warn'`.** Decided on the plan's priority order — *powerful features →
 * scalability → robustness → clean code* — not on backward compatibility,
 * which is explicitly not a factor on this project.
 *
 * The feature Phase 2 delivers is *an enforceable declaration*, and warn mode
 * delivers all of it except the refusal: the schema is walked, the violating
 * param is named, and the violation is reported. Enforcement is one call to
 * {@link setDefaultParamValidationMode} away, per deployment.
 *
 * What arming `'enforce'` by default would buy is the refusal — and the
 * population it would refuse first is not attackers, it is the fleet's own
 * schemas. Nothing has ever validated these declarations, so on the balance of
 * evidence some existing `paramSchema` values are wrong about their own
 * handlers rather than the callers being wrong about the schema; a validator
 * armed on day one reports that as the caller's failure. Worse, the largest
 * live producer of action params is a *model*:
 * `qontinui-runner/src-tauri/src/commands/command_interpreter.rs` asks an LLM
 * for "args whose keys match the chosen action's `paramSchema`", and that
 * failure surfaces to a user running a slash command. Defaulting to enforce
 * would convert a documentation defect into a user-visible outage on a
 * population that was never measured.
 *
 * Robustness — third in the order, and the tiebreaker here — argues the same
 * way: the robust move is to collect violations from a validator that has
 * never seen production traffic before letting it refuse anything. A default
 * that fails open and is *observable* beats a default that fails closed and is
 * *unmeasured*.
 */
export const DEFAULT_PARAM_VALIDATION_MODE: ParamValidationMode = 'warn';

let currentDefaultMode: ParamValidationMode = DEFAULT_PARAM_VALIDATION_MODE;

/**
 * Arm or disarm validation process-wide. Call once at app boot; each
 * invocation may still override it via `executeComponentAction`'s
 * `{ paramValidation }` option.
 */
export function setDefaultParamValidationMode(mode: ParamValidationMode): void {
  currentDefaultMode = mode;
}

/** The mode an invocation gets when it does not pass one. */
export function getDefaultParamValidationMode(): ParamValidationMode {
  return currentDefaultMode;
}

/** Test/teardown helper: restore {@link DEFAULT_PARAM_VALIDATION_MODE}. */
export function resetDefaultParamValidationMode(): void {
  currentDefaultMode = DEFAULT_PARAM_VALIDATION_MODE;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

type PlainObject = Record<string, unknown>;

/**
 * The only strings read as type names. Byte-identical to `paramSchemaOf`'s
 * `PRIMITIVE_TYPES` (`@qontinui/ui-bridge-wrapper` `helpers/schema.ts`) —
 * KEEP IN SYNC. Anything else is prose.
 */
const PRIMITIVE_TYPE_NAMES = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'object',
  'array',
  'null',
]);

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Compact rendering of a supplied value, for the `received` field. */
function render(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `array(${value.length})`;
  const t = typeof value;
  if (t === 'string') return JSON.stringify(value);
  if (t === 'number' || t === 'boolean') return String(value);
  if (t === 'object') return 'object';
  return t;
}

/** The JSON Schema type name a runtime value would be reported as. */
function jsonTypeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (t === 'string' || t === 'boolean' || t === 'object') return t;
  return t;
}

function matchesType(value: unknown, typeName: string): boolean {
  switch (typeName) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isPlainObject(value);
    default:
      // Unrecognised type name — outside the subset, so it constrains nothing.
      return true;
  }
}

/** Structural equality good enough for JSON `enum`/`const` members. */
function jsonEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function joinPath(base: string, key: string): string {
  return base === '' ? key : `${base}.${key}`;
}

/**
 * Read a `type` keyword into the list of accepted type names, or `null` when
 * the keyword is absent or shaped outside the subset (in which case it
 * constrains nothing).
 */
function readTypes(schema: PlainObject): string[] | null {
  const raw = schema['type'];
  if (typeof raw === 'string') return [raw];
  if (Array.isArray(raw)) {
    const names = raw.filter((t): t is string => typeof t === 'string');
    return names.length > 0 ? names : null;
  }
  return null;
}

/** Validate one value against one property schema, appending to `issues`. */
function validateValue(
  value: unknown,
  schema: unknown,
  path: string,
  issues: ParamSchemaIssue[]
): void {
  // A property schema that is not an object expresses no constraint. A bare
  // PRIMITIVE type-name string IS a constraint though, and is how map form
  // spells one; any other string is prose (see the module header).
  if (typeof schema === 'string') {
    if (PRIMITIVE_TYPE_NAMES.has(schema) && !matchesType(value, schema)) {
      issues.push({
        path,
        keyword: 'type',
        expected: schema,
        received: render(value),
        message: `Parameter "${path}" must be of type ${schema}, received ${jsonTypeOf(value)} (${render(value)}).`,
      });
    }
    return;
  }
  if (!isPlainObject(schema)) return;

  const types = readTypes(schema);
  if (types !== null && !types.some((t) => matchesType(value, t))) {
    const expected = types.join(' | ');
    issues.push({
      path,
      keyword: 'type',
      expected,
      received: render(value),
      message: `Parameter "${path}" must be of type ${expected}, received ${jsonTypeOf(value)} (${render(value)}).`,
    });
    // A wrong-typed value cannot meaningfully fail the type-specific keywords
    // below; reporting those too would bury the one issue that matters.
    return;
  }

  if ('const' in schema && !jsonEquals(value, schema['const'])) {
    issues.push({
      path,
      keyword: 'const',
      expected: render(schema['const']),
      received: render(value),
      message: `Parameter "${path}" must equal ${render(schema['const'])}, received ${render(value)}.`,
    });
    return;
  }

  const enumValues = schema['enum'];
  if (Array.isArray(enumValues) && !enumValues.some((allowed) => jsonEquals(value, allowed))) {
    const expected = enumValues.map((v) => render(v)).join(', ');
    issues.push({
      path,
      keyword: 'enum',
      expected,
      received: render(value),
      message: `Parameter "${path}" must be one of [${expected}], received ${render(value)}.`,
    });
    return;
  }

  if (typeof value === 'number') {
    const min = schema['minimum'];
    if (typeof min === 'number' && value < min) {
      issues.push({
        path,
        keyword: 'minimum',
        expected: `>= ${min}`,
        received: render(value),
        message: `Parameter "${path}" must be >= ${min}, received ${value}.`,
      });
    }
    const max = schema['maximum'];
    if (typeof max === 'number' && value > max) {
      issues.push({
        path,
        keyword: 'maximum',
        expected: `<= ${max}`,
        received: render(value),
        message: `Parameter "${path}" must be <= ${max}, received ${value}.`,
      });
    }
  }

  if (typeof value === 'string') {
    const minLength = schema['minLength'];
    if (typeof minLength === 'number' && value.length < minLength) {
      issues.push({
        path,
        keyword: 'minLength',
        expected: `length >= ${minLength}`,
        received: `length ${value.length}`,
        message: `Parameter "${path}" must be at least ${minLength} characters, received ${value.length}.`,
      });
    }
    const maxLength = schema['maxLength'];
    if (typeof maxLength === 'number' && value.length > maxLength) {
      issues.push({
        path,
        keyword: 'maxLength',
        expected: `length <= ${maxLength}`,
        received: `length ${value.length}`,
        message: `Parameter "${path}" must be at most ${maxLength} characters, received ${value.length}.`,
      });
    }
    const pattern = schema['pattern'];
    if (typeof pattern === 'string') {
      // Declared WITHOUT an initializer on purpose: both arms below assign
      // before any read, so an initializer here would be dead (eslint
      // `no-useless-assignment`). The regex carries no `g` flag and is rebuilt
      // per call, so there is no `lastIndex` state to carry between values.
      let re: RegExp | null;
      try {
        re = new RegExp(pattern);
      } catch {
        // An uncompilable pattern expresses no constraint we can read. Ignored,
        // never a failure — same rule as an unrecognised keyword.
        re = null;
      }
      if (re !== null && !re.test(value)) {
        issues.push({
          path,
          keyword: 'pattern',
          expected: `match /${pattern}/`,
          received: render(value),
          message: `Parameter "${path}" must match /${pattern}/, received ${render(value)}.`,
        });
      }
    }
  }

  if (Array.isArray(value) && 'items' in schema) {
    const items = schema['items'];
    value.forEach((element, index) => {
      validateValue(element, items, `${path}[${index}]`, issues);
    });
  }

  if (isPlainObject(value) && (isPlainObject(schema['properties']) || 'required' in schema)) {
    validateObject(value, schema, path, issues);
  }
}

/**
 * Validate a plain object against the `properties` / `required` /
 * `additionalProperties` triple. Shared by the top level and by nested
 * `type: "object"` properties.
 */
function validateObject(
  value: PlainObject,
  schema: PlainObject,
  basePath: string,
  issues: ParamSchemaIssue[]
): void {
  const properties = isPlainObject(schema['properties']) ? schema['properties'] : {};
  const requiredRaw = schema['required'];
  const required = Array.isArray(requiredRaw)
    ? requiredRaw.filter((k): k is string => typeof k === 'string')
    : [];

  for (const key of required) {
    if (!(key in value) || value[key] === undefined) {
      const at = joinPath(basePath, key);
      issues.push({
        path: at,
        keyword: 'required',
        expected: 'present',
        message: `Required parameter "${at}" is missing.`,
      });
    }
  }

  if (schema['additionalProperties'] === false) {
    const declared = new Set(Object.keys(properties));
    for (const key of Object.keys(value)) {
      if (!declared.has(key)) {
        const at = joinPath(basePath, key);
        issues.push({
          path: at,
          keyword: 'additionalProperties',
          expected: `one of [${[...declared].join(', ')}]`,
          received: render(value[key]),
          message: `Parameter "${at}" is not declared by the schema, which sets additionalProperties: false.`,
        });
      }
    }
  }

  for (const [key, propSchema] of Object.entries(properties)) {
    if (!(key in value) || value[key] === undefined) continue;
    validateValue(value[key], propSchema, joinPath(basePath, key), issues);
  }
}

/**
 * Normalise map form into the object-schema form so one walker serves both.
 * Returns `null` when `schema` is already object form.
 */
function normalizeMapForm(schema: PlainObject): PlainObject | null {
  if (schema['type'] === 'object' || isPlainObject(schema['properties'])) return null;

  const properties: PlainObject = {};
  for (const [key, raw] of Object.entries(schema)) {
    if (raw === null || raw === undefined) continue;
    if (typeof raw === 'string') {
      // Type name, or prose? Only the seven primitive names are types. Every
      // other string is a human hint — ~50 live declarations in
      // `qontinui-runner` are exactly that — and expresses no constraint.
      properties[key] = PRIMITIVE_TYPE_NAMES.has(raw) ? { type: raw } : {};
      continue;
    }
    if (isPlainObject(raw)) {
      // `optional` is this monorepo's non-standard marker, not JSON Schema.
      // Nothing in map form is required, so it only needs stripping.
      const { optional: _optional, ...rest } = raw as PlainObject & { optional?: unknown };
      properties[key] = rest;
      continue;
    }
    // A value that is neither a type name nor a schema object expresses no
    // constraint — ignored, per the unrecognised-keyword rule.
  }
  // NO `required`: map form cannot express requiredness. See the module header.
  return { type: 'object', properties };
}

/**
 * Validate `params` against an action's `paramSchema`.
 *
 * Returns `{ valid: true, issues: [] }` for anything the documented subset
 * cannot read — that is the ignore-don't-reject rule, and it is why a schema
 * this validator does not understand can never fail an invocation.
 *
 * @param schema the action's declared `paramSchema` (any shape; unreadable
 *   shapes constrain nothing)
 * @param params the params the caller supplied. `undefined` is treated as an
 *   empty object, so a schema with required properties still reports them.
 */
export function validateActionParams(
  schema: unknown,
  params: unknown
): ParamValidationResult {
  if (!isPlainObject(schema)) return { valid: true, issues: [] };

  const normalized = normalizeMapForm(schema) ?? schema;

  const hasProperties = isPlainObject(normalized['properties']);
  const hasRequired = Array.isArray(normalized['required']);
  if (!hasProperties && !hasRequired) {
    // e.g. `{ type: "object" }` with nothing else, or a map form whose every
    // entry was unreadable. No constraint expressed.
    return { valid: true, issues: [] };
  }

  const issues: ParamSchemaIssue[] = [];

  if (params === undefined || params === null) {
    validateObject({}, normalized, '', issues);
    return { valid: issues.length === 0, issues };
  }

  if (!isPlainObject(params)) {
    issues.push({
      path: '',
      keyword: 'type',
      expected: 'object',
      received: render(params),
      message: `Action params must be an object, received ${jsonTypeOf(params)} (${render(params)}).`,
    });
    return { valid: false, issues };
  }

  validateObject(params, normalized, '', issues);
  return { valid: issues.length === 0, issues };
}

/**
 * One-line summary of a violation set, naming the action and every offending
 * param. Used as the `error` / `message` string at every invocation seam so
 * the three trees phrase the rejection identically.
 */
export function formatParamValidationFailure(
  componentId: string,
  actionId: string,
  issues: ParamSchemaIssue[]
): string {
  const detail = issues.map((i) => i.message).join(' ');
  return `Action "${actionId}" on component "${componentId}" was rejected: params do not match the action's declared paramSchema. ${detail}`;
}
