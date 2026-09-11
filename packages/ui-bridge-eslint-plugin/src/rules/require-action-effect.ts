import * as fs from 'node:fs';
import * as path from 'node:path';

import { AST_NODE_TYPES, ESLintUtils, TSESTree } from '@typescript-eslint/utils';

/**
 * `require-action-effect` — every component action registered through
 * `useUIComponent({ actions: [...] })` must declare an `effect`.
 *
 * WHY THIS RULE IS SHIPPED AT `"error"`, NOT `"warn"` OR `"off"`.
 * Its sibling `require-state-annotation` was wired into the runner at `"off"`
 * "until the codebase is progressively annotated", and has stayed off ever
 * since across 1355 sites. A capability nobody switched on is a capability the
 * product does not have [policy: `capability-ships-enabled`]. This rule is only
 * shippable ON because the annotation pass landed FIRST: every registered
 * runner component action already carries an `effect`, so the rule starts green
 * and acts as a ratchet rather than as a backlog.
 *
 * WHY AN ABSENT `effect` IS NOT A BENIGN DEFAULT. The serializer forwards the
 * field undefaulted on purpose: absent means UNCLASSIFIED, never `read`. No
 * verb in the SDK's consumer-side `STANDARD_ACTION_EFFECTS` map can ever yield
 * `destructive`, so an unannotated action is indistinguishable — to an
 * autonomous caller deciding whether it is safe to invoke — from a harmless
 * one [policy: `unknown-must-not-render-as-a-default`].
 *
 * WHY IT NEVER KEYS ON THE ACTION ID. Action ids collide across components by
 * design in the runner (`refresh` on three components; `open` and `work-on-it`
 * on two; `create-plain` vs `create-plain-terminal`). There is therefore no
 * id-keyed table of any kind in this rule — no defaults, no allow-list, no
 * exemptions. Checking is purely positional: one AST element of one
 * registration's `actions` array at a time. Ids appear only inside the report
 * message, always qualified by the component id and the source position, so
 * two same-named actions are never conflated. The SDK's verb map stays what it
 * always was: a consumer-side default, never a projection.
 *
 * WHY IT RESOLVES FACTORIES INSTEAD OF SKIPPING THEM. Not every action is
 * written as an inline object literal: the runner's `create-plain-terminal` is
 * built by `buildCreatePlainTerminalAction(...)`, imported from a sibling
 * module, and its `effect` lives on the returned object. A rule that saw only
 * inline literals would pass over that element in silence, and a skipped
 * element is an UNMEASURED action, not an annotated one [policy:
 * `silent-empty-is-unknown`]. So the rule follows identifiers, factory calls,
 * spreads and (relative or alias-configured) imports through to the object
 * literal they produce. When that resolution genuinely fails it reports a
 * distinct message naming the reason, rather than assuming the annotation is
 * there.
 */

/** The three values of `IREffect` / `IrEffect`. */
const VALID_EFFECTS = new Set(['read', 'write', 'destructive']);

/** Hooks whose first argument is a component registration. */
const DEFAULT_HOOK_NAMES = ['useUIComponent'];

/**
 * Guard against an import cycle or a pathologically chained factory. Six hops
 * reaches `element -> factory call -> imported function -> returned literal`
 * with room to spare; anything deeper is reported as unresolved rather than
 * followed forever.
 */
const MAX_RESOLUTION_DEPTH = 6;

const RESOLVABLE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

export interface Options {
  /**
   * Hook names whose first argument is a component registration.
   * Defaults to `["useUIComponent"]`.
   */
  hookNames?: string[];
  /**
   * Path-alias prefixes the rule should follow when an action factory is
   * imported through one (e.g. `{ "@/": "src" }` for a tsconfig `@/*` path).
   * Targets resolve against the ESLint working directory. Relative imports
   * need no configuration and are always followed.
   *
   * This is resolution configuration, not a suppression list: an alias that is
   * NOT configured makes the import unresolved and therefore reported — never
   * silently accepted.
   */
  importAliases?: Record<string, string>;
}

export type RuleOptions = [Options?];
export type MessageIds =
  | 'missingActionEffect'
  | 'invalidActionEffect'
  | 'unresolvedActionEffect'
  | 'unenumerableActions'
  | 'unresolvedRegistration';

const createRule = ESLintUtils.RuleCreator(
  (name) =>
    `https://github.com/qontinui/ui-bridge/tree/main/packages/ui-bridge-eslint-plugin#${name}`
);

/* -------------------------------------------------------------------------- */
/* Foreign-file parsing                                                        */
/* -------------------------------------------------------------------------- */

interface CachedProgram {
  mtimeMs: number;
  program: TSESTree.Program | null;
}

/**
 * A parser borrowed from the config being linted. Foreign modules are parsed
 * with the SAME parser the project already configured rather than one this
 * plugin bundles: it keeps the plugin dependency-light, and it means a file the
 * project can parse is a file this rule can follow. Where no usable parser is
 * exposed, resolution fails honestly instead of silently passing.
 */
export interface BorrowedParser {
  parseForESLint?: (code: string, options?: unknown) => { ast: TSESTree.Program };
  parse?: (code: string, options?: unknown) => TSESTree.Program;
}

/**
 * Parsed foreign modules, keyed by absolute path and invalidated on mtime. A
 * lint run over a large app re-visits the same factory module once per
 * importing file; re-parsing it each time is pure waste.
 */
const programCache = new Map<string, CachedProgram>();

/** Exposed for tests: a cached parse must not survive a file rewrite. */
export function clearModuleCache(): void {
  programCache.clear();
}

function statMtime(file: string): number | null {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * `parent` pointers are what the scope-chain walk below follows. ESLint sets
 * them on the file being linted; a foreign module gets them from this pass, so
 * resolution behaves identically in both files.
 */
function setParents(root: TSESTree.Node): void {
  const visit = (node: TSESTree.Node): void => {
    for (const key of Object.keys(node)) {
      if (key === 'parent') continue;
      const value = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child === 'object' && 'type' in child) {
            (child as TSESTree.Node).parent = node as never;
            visit(child as TSESTree.Node);
          }
        }
      } else if (value && typeof value === 'object' && 'type' in (value as object)) {
        (value as TSESTree.Node).parent = node as never;
        visit(value as TSESTree.Node);
      }
    }
  };
  visit(root);
}

function loadProgram(file: string, parser: BorrowedParser | null): TSESTree.Program | null {
  if (!parser) return null;

  const mtimeMs = statMtime(file);
  if (mtimeMs === null) return null;

  const cached = programCache.get(file);
  if (cached && cached.mtimeMs === mtimeMs) return cached.program;

  let program: TSESTree.Program | null;
  try {
    const code = fs.readFileSync(file, 'utf8');
    // A deliberately SYNTACTIC parse: no `project`, no project service, no type
    // information. This rule only needs the shape of a returned object literal,
    // and a type-aware parse of an arbitrary out-of-project file is both slow
    // and prone to throwing on files the tsconfig does not include.
    const options = {
      ecmaVersion: 2022,
      sourceType: 'module',
      ecmaFeatures: { jsx: file.endsWith('.tsx') || file.endsWith('.jsx') },
      jsx: file.endsWith('.tsx') || file.endsWith('.jsx'),
      range: true,
      loc: true,
      filePath: file,
    };
    if (typeof parser.parseForESLint === 'function') {
      program = parser.parseForESLint(code, options).ast;
    } else if (typeof parser.parse === 'function') {
      program = parser.parse(code, options);
    } else {
      program = null;
    }
    if (program) setParents(program);
  } catch {
    program = null;
  }
  programCache.set(file, { mtimeMs, program });
  return program;
}

function fileExists(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve a module specifier to a file on disk. Relative specifiers resolve
 * against the importing file; configured alias prefixes resolve against the
 * ESLint working directory. Bare package specifiers are deliberately NOT
 * resolved — following an action factory into `node_modules` would lint a
 * published artifact rather than this repository's source, so such an import
 * is reported as unresolved instead.
 */
export function resolveModulePath(
  fromFile: string,
  source: string,
  aliases: Record<string, string>,
  cwd: string
): string | null {
  let base: string | null = null;

  if (source.startsWith('./') || source.startsWith('../') || source === '.' || source === '..') {
    base = path.resolve(path.dirname(fromFile), source);
  } else {
    for (const [prefix, target] of Object.entries(aliases)) {
      if (prefix.length > 0 && source.startsWith(prefix)) {
        base = path.resolve(cwd, target, source.slice(prefix.length));
        break;
      }
    }
  }
  if (base === null) return null;

  const candidates: string[] = [];
  // A TS source importing `./foo.js` (NodeNext style) is really `./foo.ts`.
  const jsLike = /\.(js|jsx|mjs|cjs)$/.exec(base);
  if (jsLike) {
    const stem = base.slice(0, base.length - jsLike[0].length);
    candidates.push(`${stem}.ts`, `${stem}.tsx`);
  }
  candidates.push(base);
  for (const ext of RESOLVABLE_EXTENSIONS) candidates.push(`${base}${ext}`);
  for (const ext of RESOLVABLE_EXTENSIONS) candidates.push(path.join(base, `index${ext}`));

  for (const candidate of candidates) {
    if (fileExists(candidate)) return candidate;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Declaration lookup                                                          */
/* -------------------------------------------------------------------------- */

type FunctionNode =
  | TSESTree.FunctionDeclaration
  | TSESTree.FunctionExpression
  | TSESTree.ArrowFunctionExpression;

type Declaration =
  | { kind: 'function'; node: FunctionNode; file: string }
  | { kind: 'value'; node: TSESTree.Expression; file: string }
  | { kind: 'import'; source: string; imported: string; file: string };

function statementListOf(node: TSESTree.Node): readonly TSESTree.Statement[] | null {
  if (node.type === AST_NODE_TYPES.Program) return node.body as TSESTree.Statement[];
  if (node.type === AST_NODE_TYPES.BlockStatement) return node.body;
  return null;
}

function declarationFromStatement(
  statement: TSESTree.Node,
  name: string,
  file: string
): Declaration | null {
  switch (statement.type) {
    case AST_NODE_TYPES.FunctionDeclaration:
      if (statement.id?.name === name) return { kind: 'function', node: statement, file };
      return null;

    case AST_NODE_TYPES.VariableDeclaration:
      for (const declarator of statement.declarations) {
        if (
          declarator.id.type === AST_NODE_TYPES.Identifier &&
          declarator.id.name === name &&
          declarator.init
        ) {
          return { kind: 'value', node: declarator.init, file };
        }
      }
      return null;

    case AST_NODE_TYPES.ImportDeclaration: {
      if (typeof statement.source.value !== 'string') return null;
      for (const specifier of statement.specifiers) {
        if (specifier.local.name !== name) continue;
        if (specifier.type === AST_NODE_TYPES.ImportSpecifier) {
          const imported =
            specifier.imported.type === AST_NODE_TYPES.Identifier
              ? specifier.imported.name
              : String(specifier.imported.value);
          return { kind: 'import', source: statement.source.value, imported, file };
        }
        if (specifier.type === AST_NODE_TYPES.ImportDefaultSpecifier) {
          return { kind: 'import', source: statement.source.value, imported: 'default', file };
        }
        // A namespace import (`import * as ns`) is not followed — the rule
        // would have to model member access on it. Left unresolved on purpose.
        return null;
      }
      return null;
    }

    case AST_NODE_TYPES.ExportNamedDeclaration: {
      if (statement.declaration) {
        return declarationFromStatement(statement.declaration, name, file);
      }
      // `export { a } from './m'` and `export { a as b } from './m'`
      if (statement.source && typeof statement.source.value === 'string') {
        for (const specifier of statement.specifiers) {
          const exportedName =
            specifier.exported.type === AST_NODE_TYPES.Identifier
              ? specifier.exported.name
              : String(specifier.exported.value);
          if (exportedName !== name) continue;
          const localName =
            specifier.local.type === AST_NODE_TYPES.Identifier
              ? specifier.local.name
              : String(specifier.local.value);
          return { kind: 'import', source: statement.source.value, imported: localName, file };
        }
      }
      return null;
    }

    case AST_NODE_TYPES.ExportDefaultDeclaration: {
      if (name !== 'default') return null;
      const declaration = statement.declaration;
      if (
        declaration.type === AST_NODE_TYPES.FunctionDeclaration ||
        declaration.type === AST_NODE_TYPES.FunctionExpression ||
        declaration.type === AST_NODE_TYPES.ArrowFunctionExpression
      ) {
        return { kind: 'function', node: declaration, file };
      }
      return { kind: 'value', node: declaration as TSESTree.Expression, file };
    }

    default:
      return null;
  }
}

function scanStatements(
  statements: readonly TSESTree.Statement[],
  name: string,
  file: string
): Declaration | null {
  for (const statement of statements) {
    const found = declarationFromStatement(statement, name, file);
    if (found) return found;
  }
  return null;
}

/**
 * Look a name up from `fromNode` outwards: every enclosing block, then the
 * module body. Works in the linted file and in a foreign module alike, because
 * `loadProgram` gives foreign modules the same `parent` pointers ESLint gives
 * this one.
 */
function lookupInScopeChain(
  fromNode: TSESTree.Node,
  name: string,
  file: string
): Declaration | null {
  let current: TSESTree.Node | undefined = fromNode;
  while (current) {
    const statements = statementListOf(current);
    if (statements) {
      const found = scanStatements(statements, name, file);
      if (found) return found;
    }
    current = current.parent;
  }
  return null;
}

/** Look a name up at the top level of a foreign module. */
function lookupInProgram(
  program: TSESTree.Program,
  name: string,
  file: string
): Declaration | null {
  return scanStatements(program.body as TSESTree.Statement[], name, file);
}

/* -------------------------------------------------------------------------- */
/* Resolution                                                                  */
/* -------------------------------------------------------------------------- */

/** An object literal, plus the file its AST belongs to. */
interface ResolvedObject {
  node: TSESTree.ObjectExpression;
  file: string;
}

interface ResolvedArray {
  node: TSESTree.ArrayExpression;
  file: string;
}

type Resolution<T> = { kind: 'ok'; values: T[] } | { kind: 'unresolved'; reason: string };

interface ResolveContext {
  cwd: string;
  aliases: Record<string, string>;
  /** The linted config's own parser, used to read foreign factory modules. */
  parser: BorrowedParser | null;
}

function unwrap(node: TSESTree.Node): TSESTree.Node {
  let current = node;
  for (;;) {
    switch (current.type) {
      case AST_NODE_TYPES.TSAsExpression:
      case AST_NODE_TYPES.TSSatisfiesExpression:
      case AST_NODE_TYPES.TSNonNullExpression:
      case AST_NODE_TYPES.TSTypeAssertion:
        current = current.expression;
        continue;
      default:
        return current;
    }
  }
}

/**
 * Every expression a function can return. Nested functions are not descended
 * into — their returns belong to them, not to this one. A function that can
 * fall off the end (or return bare) is reported as unresolvable rather than
 * treated as producing an annotated action.
 */
function returnExpressions(fn: FunctionNode): TSESTree.Expression[] | null {
  if (fn.body.type !== AST_NODE_TYPES.BlockStatement) {
    return [fn.body];
  }
  const out: TSESTree.Expression[] = [];
  let sawBareReturn = false;

  const walk = (node: TSESTree.Node): void => {
    switch (node.type) {
      case AST_NODE_TYPES.FunctionDeclaration:
      case AST_NODE_TYPES.FunctionExpression:
      case AST_NODE_TYPES.ArrowFunctionExpression:
        return;
      case AST_NODE_TYPES.ReturnStatement:
        if (node.argument) out.push(node.argument);
        else sawBareReturn = true;
        return;
      default:
        break;
    }
    for (const key of Object.keys(node)) {
      if (key === 'parent') continue;
      const value = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child === 'object' && 'type' in child) walk(child as TSESTree.Node);
        }
      } else if (value && typeof value === 'object' && 'type' in (value as object)) {
        walk(value as TSESTree.Node);
      }
    }
  };

  walk(fn.body);
  if (sawBareReturn || out.length === 0) return null;
  return out;
}

/**
 * Reduce an expression to the object literal(s) it can evaluate to, following
 * identifiers, factory calls and (relative or alias-configured) imports on the
 * way. Anything it cannot follow comes back as `unresolved` WITH a reason —
 * never as an implicit pass.
 */
function resolveObjects(
  rawNode: TSESTree.Node,
  file: string,
  ctx: ResolveContext,
  depth: number
): Resolution<ResolvedObject> {
  if (depth > MAX_RESOLUTION_DEPTH) {
    return { kind: 'unresolved', reason: 'the resolution chain is too deep to follow' };
  }
  const node = unwrap(rawNode);

  switch (node.type) {
    case AST_NODE_TYPES.ObjectExpression:
      return { kind: 'ok', values: [{ node, file }] };

    case AST_NODE_TYPES.Identifier: {
      const declaration = lookupInScopeChain(node, node.name, file);
      if (!declaration) {
        return {
          kind: 'unresolved',
          reason: `"${node.name}" is not declared in a block this rule can see (a function parameter, a namespace import, or a binding outside this file)`,
        };
      }
      return resolveDeclarationToObjects(declaration, ctx, depth + 1);
    }

    case AST_NODE_TYPES.CallExpression: {
      const callee = unwrap(node.callee);
      if (callee.type !== AST_NODE_TYPES.Identifier) {
        return {
          kind: 'unresolved',
          reason: 'the factory is not called through a plain identifier',
        };
      }
      const declaration = lookupInScopeChain(node, callee.name, file);
      if (!declaration) {
        return {
          kind: 'unresolved',
          reason: `the factory "${callee.name}" is not declared in a block this rule can see`,
        };
      }
      return resolveDeclarationToObjects(declaration, ctx, depth + 1);
    }

    case AST_NODE_TYPES.ConditionalExpression:
      return mergeBranches(
        resolveObjects(node.consequent, file, ctx, depth + 1),
        resolveObjects(node.alternate, file, ctx, depth + 1)
      );

    case AST_NODE_TYPES.LogicalExpression:
      return mergeBranches(
        resolveObjects(node.left, file, ctx, depth + 1),
        resolveObjects(node.right, file, ctx, depth + 1)
      );

    default:
      return {
        kind: 'unresolved',
        reason: `a ${node.type} is not something this rule can reduce to an action object`,
      };
  }
}

function mergeBranches<T>(a: Resolution<T>, b: Resolution<T>): Resolution<T> {
  if (a.kind === 'unresolved') return a;
  if (b.kind === 'unresolved') return b;
  return { kind: 'ok', values: [...a.values, ...b.values] };
}

function resolveDeclarationToObjects(
  declaration: Declaration,
  ctx: ResolveContext,
  depth: number
): Resolution<ResolvedObject> {
  if (depth > MAX_RESOLUTION_DEPTH) {
    return { kind: 'unresolved', reason: 'the resolution chain is too deep to follow' };
  }

  switch (declaration.kind) {
    case 'value':
      return resolveObjects(declaration.node, declaration.file, ctx, depth + 1);

    case 'function': {
      const returns = returnExpressions(declaration.node);
      if (!returns) {
        return {
          kind: 'unresolved',
          reason: 'the factory has no object-literal return this rule can follow',
        };
      }
      const values: ResolvedObject[] = [];
      for (const expression of returns) {
        const resolved = resolveObjects(expression, declaration.file, ctx, depth + 1);
        if (resolved.kind === 'unresolved') return resolved;
        values.push(...resolved.values);
      }
      return { kind: 'ok', values };
    }

    case 'import': {
      const target = resolveModulePath(declaration.file, declaration.source, ctx.aliases, ctx.cwd);
      if (!target) {
        return {
          kind: 'unresolved',
          reason: `the import "${declaration.source}" could not be resolved to a source file in this repository (bare package specifiers are not followed; configure \`importAliases\` for a path alias)`,
        };
      }
      const program = loadProgram(target, ctx.parser);
      if (!program) {
        return {
          kind: 'unresolved',
          reason: ctx.parser
            ? `"${declaration.source}" could not be read or parsed`
            : `"${declaration.source}" could not be read: this ESLint config exposes no parser for the rule to borrow`,
        };
      }
      const inner = lookupInProgram(program, declaration.imported, target);
      if (!inner) {
        return {
          kind: 'unresolved',
          reason: `"${declaration.imported}" was not found as a top-level declaration in "${declaration.source}"`,
        };
      }
      return resolveDeclarationToObjects(inner, ctx, depth + 1);
    }
  }
}

/**
 * The array-literal counterpart, used on the `actions` property itself: an
 * `actions` written as `const pageActions = [...]` is still enumerable, while
 * `actions: actions || []` — a value forwarded from a caller — is not, and is
 * reported rather than skipped.
 */
function resolveArrays(
  rawNode: TSESTree.Node,
  file: string,
  ctx: ResolveContext,
  depth: number
): Resolution<ResolvedArray> {
  if (depth > MAX_RESOLUTION_DEPTH) {
    return { kind: 'unresolved', reason: 'the resolution chain is too deep to follow' };
  }
  const node = unwrap(rawNode);

  switch (node.type) {
    case AST_NODE_TYPES.ArrayExpression:
      return { kind: 'ok', values: [{ node, file }] };

    case AST_NODE_TYPES.Identifier: {
      const declaration = lookupInScopeChain(node, node.name, file);
      if (!declaration || declaration.kind !== 'value') {
        return {
          kind: 'unresolved',
          reason: `"${node.name}" does not resolve to an array literal in a block this rule can see`,
        };
      }
      return resolveArrays(declaration.node, declaration.file, ctx, depth + 1);
    }

    case AST_NODE_TYPES.ConditionalExpression:
      return mergeBranches(
        resolveArrays(node.consequent, file, ctx, depth + 1),
        resolveArrays(node.alternate, file, ctx, depth + 1)
      );

    case AST_NODE_TYPES.LogicalExpression:
      return mergeBranches(
        resolveArrays(node.left, file, ctx, depth + 1),
        resolveArrays(node.right, file, ctx, depth + 1)
      );

    default:
      return {
        kind: 'unresolved',
        reason: `it is a ${node.type}, which this rule cannot enumerate`,
      };
  }
}

/* -------------------------------------------------------------------------- */
/* Object inspection                                                           */
/* -------------------------------------------------------------------------- */

function propertyKeyName(property: TSESTree.Property): string | null {
  if (!property.computed) {
    if (property.key.type === AST_NODE_TYPES.Identifier) return property.key.name;
    if (property.key.type === AST_NODE_TYPES.Literal) return String(property.key.value);
  }
  return null;
}

function findProperty(object: TSESTree.ObjectExpression, name: string): TSESTree.Property | null {
  for (const property of object.properties) {
    if (property.type !== AST_NODE_TYPES.Property) continue;
    if (propertyKeyName(property) === name) return property;
  }
  return null;
}

function spreadArguments(object: TSESTree.ObjectExpression): TSESTree.Expression[] {
  const out: TSESTree.Expression[] = [];
  for (const property of object.properties) {
    if (property.type === AST_NODE_TYPES.SpreadElement) out.push(property.argument);
  }
  return out;
}

/** The literal value of a string-ish expression, for reporting and validation. */
function staticString(node: TSESTree.Node | undefined | null): string | null {
  if (!node) return null;
  const expression = unwrap(node);
  if (expression.type === AST_NODE_TYPES.Literal && typeof expression.value === 'string') {
    return expression.value;
  }
  if (
    expression.type === AST_NODE_TYPES.TemplateLiteral &&
    expression.expressions.length === 0 &&
    expression.quasis.length === 1
  ) {
    return expression.quasis[0].value.cooked;
  }
  return null;
}

/**
 * A string that may be reached through a `const` — the runner's factory names
 * its action with an exported `CREATE_PLAIN_TERMINAL_ACTION_ID` constant rather
 * than a bare literal, and a report reading `<action #1>` would send the author
 * hunting. Resolution only; the rule still keys on nothing.
 */
function staticStringDeep(
  node: TSESTree.Node | undefined | null,
  file: string,
  depth = 0
): string | null {
  if (!node || depth > MAX_RESOLUTION_DEPTH) return null;
  const direct = staticString(node);
  if (direct !== null) return direct;
  const expression = unwrap(node);
  if (expression.type !== AST_NODE_TYPES.Identifier) return null;
  const declaration = lookupInScopeChain(expression, expression.name, file);
  if (!declaration || declaration.kind !== 'value') return null;
  return staticStringDeep(declaration.node, declaration.file, depth + 1);
}

/* -------------------------------------------------------------------------- */
/* Rule                                                                        */
/* -------------------------------------------------------------------------- */

export const requireActionEffectRule = createRule<RuleOptions, MessageIds>({
  name: 'require-action-effect',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require every component action registered through useUIComponent({ actions }) to declare an `effect` safety class.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          hookNames: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Hook names whose first argument is a component registration (default ["useUIComponent"]).',
          },
          importAliases: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description:
              'Path-alias prefixes to follow when an action factory is imported through one, e.g. {"@/": "src"}. Targets resolve against the ESLint working directory.',
          },
        },
      },
    ],
    messages: {
      missingActionEffect:
        'Component action `{{component}}.{{action}}` declares no `effect`. An absent effect is UNCLASSIFIED, not `read` — an autonomous caller cannot tell it from a harmless action. Add `effect: "read" | "write" | "destructive"` at this call site, classified against the rubric in src-tauri/src/mcp/ui_bridge/CONTRACT.md ("The `effect` classification rubric").',
      invalidActionEffect:
        'Component action `{{component}}.{{action}}` declares `effect: "{{value}}"`, which is not one of the three IREffect values (`read`, `write`, `destructive`).',
      unresolvedActionEffect:
        'Action element #{{index}} of component `{{component}}` could not be statically resolved to an object literal, so this rule cannot see whether it declares an `effect` — and unresolved is UNKNOWN, not annotated. Reason: {{reason}}. Write the action inline, or have the factory return an object literal this rule can follow.',
      unenumerableActions:
        'The `actions` of component `{{component}}` is not an enumerable array literal, so its component actions cannot be checked for an `effect` — and unchecked is UNKNOWN, not annotated. Reason: {{reason}}. Declare the actions as an array literal at the registration.',
      unresolvedRegistration:
        'This `{{hook}}` registration could not be statically resolved to an object literal, so the rule cannot see its `actions` at all — and unseen is UNKNOWN, not annotated. Reason: {{reason}}. Pass the registration as an object literal.',
    },
  },
  defaultOptions: [{}],
  create(context, [optionsRaw]) {
    const options = optionsRaw ?? {};
    const hookNames = new Set(options.hookNames ?? DEFAULT_HOOK_NAMES);
    const aliases = options.importAliases ?? {};
    const filename = context.filename ?? context.getFilename?.() ?? '';
    const cwd = context.cwd ?? process.cwd();
    const languageOptions = (
      context as unknown as { languageOptions?: { parser?: BorrowedParser } }
    ).languageOptions;
    const parser = languageOptions?.parser ?? null;
    const resolveCtx: ResolveContext = { cwd, aliases, parser };
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    function calleeName(node: TSESTree.CallExpression): string | null {
      const callee = unwrap(node.callee);
      if (callee.type === AST_NODE_TYPES.Identifier) return callee.name;
      if (
        callee.type === AST_NODE_TYPES.MemberExpression &&
        !callee.computed &&
        callee.property.type === AST_NODE_TYPES.Identifier
      ) {
        return callee.property.name;
      }
      return null;
    }

    /**
     * The component id as written. A template literal (`` `page-${id}` ``) is
     * reported verbatim rather than guessed at — the message only has to
     * identify the registration for a human; the rule keys on nothing.
     */
    function componentLabel(registration: TSESTree.ObjectExpression, file: string): string {
      const idProperty = findProperty(registration, 'id');
      if (!idProperty) return '<component with no id>';
      const resolved = staticStringDeep(idProperty.value, file);
      if (resolved !== null) return resolved;
      return file === filename
        ? sourceCode.getText(idProperty.value)
        : '<component with no static id>';
    }

    function actionLabel(object: ResolvedObject, index: number): string {
      const idProperty = findProperty(object.node, 'id');
      const literal = idProperty ? staticStringDeep(idProperty.value, object.file) : null;
      if (literal !== null) return literal;
      if (idProperty && object.file === filename) return sourceCode.getText(idProperty.value);
      return `<action #${index} with no static id>`;
    }

    /**
     * Where to put the squiggle. An object literal that lives in ANOTHER file
     * cannot be reported on — and should not be: the author needs to see which
     * registration is unclassified, not which factory. So a resolved-elsewhere
     * finding is reported on the element at this call site.
     */
    function reportNodeFor(object: ResolvedObject, element: TSESTree.Node): TSESTree.Node {
      return object.file === filename ? object.node : element;
    }

    function checkResolvedObject(
      object: ResolvedObject,
      element: TSESTree.Node,
      component: string,
      index: number
    ): void {
      const local = object.file === filename;
      const fallback = reportNodeFor(object, element);
      const effect = findProperty(object.node, 'effect');

      if (effect) {
        const value = staticString(effect.value);
        if (value !== null && !VALID_EFFECTS.has(value)) {
          context.report({
            node: local ? effect : fallback,
            messageId: 'invalidActionEffect',
            data: { component, action: actionLabel(object, index), value },
          });
        }
        return;
      }

      const spreads = spreadArguments(object.node);
      if (spreads.length === 0) {
        context.report({
          node: fallback,
          messageId: 'missingActionEffect',
          data: { component, action: actionLabel(object, index) },
        });
        return;
      }

      // A spread could carry the annotation. Follow every one of them; the
      // action counts as annotated only if one demonstrably provides `effect`.
      let lastReason = 'the spread source could not be followed';
      for (const spread of spreads) {
        const resolved = resolveObjects(spread, object.file, resolveCtx, 1);
        if (resolved.kind === 'unresolved') {
          lastReason = resolved.reason;
          continue;
        }
        if (
          resolved.values.length > 0 &&
          resolved.values.every((value) => findProperty(value.node, 'effect'))
        ) {
          return;
        }
        lastReason = 'the spread source declares no `effect` either';
      }
      context.report({
        node: fallback,
        messageId: 'unresolvedActionEffect',
        data: { index: String(index), component, reason: lastReason },
      });
    }

    function checkElement(element: TSESTree.Node, component: string, index: number): void {
      const resolved = resolveObjects(element, filename, resolveCtx, 0);
      if (resolved.kind === 'unresolved') {
        context.report({
          node: element,
          messageId: 'unresolvedActionEffect',
          data: { index: String(index), component, reason: resolved.reason },
        });
        return;
      }
      for (const object of resolved.values) {
        checkResolvedObject(object, element, component, index);
      }
    }

    function checkArray(
      array: ResolvedArray,
      component: string,
      reportOn: TSESTree.Node,
      depth: number
    ): void {
      array.node.elements.forEach((element, index) => {
        if (!element) return; // a hole in a sparse array registers nothing

        if (element.type === AST_NODE_TYPES.SpreadElement) {
          if (depth >= MAX_RESOLUTION_DEPTH) {
            context.report({
              node: array.file === filename ? element : reportOn,
              messageId: 'unresolvedActionEffect',
              data: {
                index: String(index),
                component,
                reason: 'the spread chain is too deep to follow',
              },
            });
            return;
          }
          const nested = resolveArrays(element.argument, array.file, resolveCtx, depth + 1);
          if (nested.kind === 'unresolved') {
            context.report({
              node: array.file === filename ? element : reportOn,
              messageId: 'unresolvedActionEffect',
              data: { index: String(index), component, reason: nested.reason },
            });
            return;
          }
          for (const inner of nested.values) {
            checkArray(inner, component, array.file === filename ? element : reportOn, depth + 1);
          }
          return;
        }

        if (array.file === filename) {
          checkElement(element, component, index);
        } else {
          // The array itself lives in another file; resolve there, report here.
          const resolved = resolveObjects(element, array.file, resolveCtx, 0);
          if (resolved.kind === 'unresolved') {
            context.report({
              node: reportOn,
              messageId: 'unresolvedActionEffect',
              data: { index: String(index), component, reason: resolved.reason },
            });
            return;
          }
          for (const object of resolved.values) {
            checkResolvedObject(object, reportOn, component, index);
          }
        }
      });
    }

    return {
      CallExpression(node: TSESTree.CallExpression) {
        const name = calleeName(node);
        if (name === null || !hookNames.has(name)) return;

        const argument = node.arguments[0];
        if (!argument) return;

        // The registration itself is resolved rather than pattern-matched: a
        // `useUIComponent(config)` whose object is built elsewhere hides its
        // whole action list, and a rule that returned quietly there would fail
        // open on exactly the shape it exists to catch.
        const registrations = resolveObjects(argument, filename, resolveCtx, 0);
        if (registrations.kind === 'unresolved') {
          context.report({
            node: argument,
            messageId: 'unresolvedRegistration',
            data: { hook: name, reason: registrations.reason },
          });
          return;
        }

        for (const registration of registrations.values) {
          const local = registration.file === filename;
          const component = componentLabel(registration.node, registration.file);
          const actionsProperty = findProperty(registration.node, 'actions');
          // No `actions` key at all registers no actions — nothing to classify.
          if (!actionsProperty) continue;
          const anchor = local ? actionsProperty : argument;

          const arrays = resolveArrays(actionsProperty.value, registration.file, resolveCtx, 0);
          if (arrays.kind === 'unresolved') {
            context.report({
              node: anchor,
              messageId: 'unenumerableActions',
              data: { component, reason: arrays.reason },
            });
            continue;
          }

          for (const array of arrays.values) {
            checkArray(array, component, anchor, 0);
          }
        }
      },
    };
  },
});

export default requireActionEffectRule;
