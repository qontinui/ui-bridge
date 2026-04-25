/**
 * Template engine for `create-ui-bridge-wrapper`.
 *
 * Intentionally tiny. Two directives, no escaping, no nesting of the same
 * conditional key (which we don't need):
 *
 *   {{VAR}}                         — substitutes `vars[VAR]` (string)
 *   {{#IF_FLAG}}...{{/IF_FLAG}}     — keeps the body iff `flags[FLAG]` is truthy
 *   {{#IFNOT_FLAG}}...{{/IFNOT_FLAG}} — keeps the body iff `flags[FLAG]` is falsy
 *
 * Variables missing from `vars` throw — catches typos early. Conditionals
 * are stripped entirely when false; the surrounding whitespace is left as
 * authored. Order of transforms: conditionals first (outer-in, non-greedy),
 * then variable substitution, so conditional branches can themselves
 * contain `{{VAR}}`.
 */

export interface RenderContext {
  /** Raw variables substituted via `{{KEY}}`. */
  vars: Record<string, string>;
  /** Booleans controlling `{{#IF_KEY}}...{{/IF_KEY}}` blocks. */
  flags: Record<string, boolean>;
}

const CONDITIONAL_RE = /\{\{#(IF|IFNOT)_([A-Z0-9_]+)\}\}([\s\S]*?)\{\{\/\1_\2\}\}/g;
const VAR_RE = /\{\{([A-Z0-9_]+)\}\}/g;

export function renderTemplate(source: string, ctx: RenderContext): string {
  const afterConditionals = applyConditionals(source, ctx.flags);
  return applyVariables(afterConditionals, ctx.vars);
}

function applyConditionals(input: string, flags: Record<string, boolean>): string {
  // Run until fixed-point in case conditional bodies contain other
  // conditionals (one level of nesting is enough for our templates).
  let prev: string;
  let current = input;
  do {
    prev = current;
    current = current.replace(
      CONDITIONAL_RE,
      (_match, kind: string, name: string, body: string) => {
        const value = flags[name];
        if (value === undefined) {
          throw new Error(`renderTemplate: conditional {{#${kind}_${name}}} has no flag entry`);
        }
        const keep = kind === 'IF' ? value : !value;
        return keep ? body : '';
      }
    );
  } while (current !== prev);
  return current;
}

function applyVariables(input: string, vars: Record<string, string>): string {
  return input.replace(VAR_RE, (_match, name: string) => {
    if (!(name in vars)) {
      throw new Error(`renderTemplate: no value for variable {{${name}}}`);
    }
    return vars[name]!;
  });
}

/** kebab-case → PascalCase (safe for JS identifiers). */
export function toPascalCase(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter((s) => s.length > 0)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

/** kebab-case → "Display Case" (Title Case with spaces). */
export function toDisplayName(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter((s) => s.length > 0)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}
