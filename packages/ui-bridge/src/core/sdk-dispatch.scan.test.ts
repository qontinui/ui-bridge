/**
 * Ratchet: every activation the SDK performs on the page runs inside the
 * synchronous `sdkDispatch` scope (core/sdk-dispatch.ts).
 *
 * The browser fires TRUSTED `submit` / `input` / `change` events as a
 * consequence of `.click()`, a dispatched `click`, `requestSubmit()` and
 * `execCommand()`. Passive capture tells an agent's action from a human's by
 * that scope, so an activation outside it would record the agent's action as
 * a human's. This scan makes such an activation a test failure.
 *
 * WHAT IT SEES, in package source (src/, test files excluded):
 *   - a call to `click()`, `requestSubmit()` or `execCommand()`, written
 *     `x.click()` or `x['click']()`;
 *   - the same methods reached indirectly: through `.call`, `.apply` or
 *     `.bind`, or passed to `Reflect.apply`;
 *   - a dispatched click: `dispatchEvent(…)` with a 'click' literal in its
 *     argument;
 *   - a click event built with a literal type: `new MouseEvent('click')`, or
 *     any subclass of MouseEvent (PointerEvent, DragEvent, WheelEvent), also
 *     written `new view.MouseEvent(…)` or `new view['MouseEvent'](…)`. A
 *     dispatched click-typed instance of
 *     MouseEvent or a subclass is what runs activation behaviour;
 *   - an event of that family built from a non-literal type. It may be built
 *     only inside a reviewed builder, from the builder's own type parameter,
 *     and every call to a builder, or to a forwarder that hands one its type,
 *     must pass a literal type other than 'click' (REVIEWED_BUILDERS,
 *     TYPE_FORWARDERS);
 *   - `dispatchEvent(<variable>)`. The site must be reviewed, at its exact
 *     count, and the variable must be a `const` built in the same function
 *     from a literal non-click type, or by a reviewed builder
 *     (VARIABLE_DISPATCH_ALLOWLIST);
 *   - any use of a reviewed builder's, forwarder's or scoped-only function's
 *     name, in its own file, other than a direct call: an export list,
 *     `export default`, an alias, a callback argument, a property value. Every
 *     call to one of them is therefore a call this scan reads.
 *
 * "Inside the scope" means the nearest enclosing function is a scoped-only
 * function, or the inline, non-async callback passed to `sdkDispatch(…)`.
 * Work deferred from inside the scope therefore reads as outside it: a
 * `setTimeout` or `.then` callback, or code after an `await`. So does a nested
 * callback such as `forEach`'s, which runs synchronously but cannot be told
 * apart here; write the loop inline instead.
 *
 * KNOWN BLIND SPOTS, which nothing here catches:
 *   - an alias: `const c = el.click; c.call(el)`, or a class or builder held
 *     in a variable (`const C = MouseEvent; new C(type)`);
 *   - a computed key: `el[name]()`;
 *   - `Reflect.construct(…)`, and `document.createEvent` with
 *     `initMouseEvent`;
 *   - an event built inside the scope, returned, and dispatched outside it
 *     (`el.dispatchEvent(buildInScope())`, where `buildInScope` returns
 *     `sdkDispatch(() => new MouseEvent('click'))`): the scope is checked where
 *     the event is built, while activation happens where it is dispatched;
 *   - a reviewed builder that overwrites its type parameter before building
 *     (`type = 'click'`): the rule checks only that it builds from that
 *     parameter;
 *   - code outside this package's source, including the app's own handlers
 *     that react later to an agent's action (the gap sdk-dispatch.ts states).
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';

const SRC = path.resolve(__dirname, '..');

/**
 * Functions whose BODY is the dispatch, and which are only ever invoked
 * inside `sdkDispatch(...)` — checked below, not trusted.
 */
const SCOPED_ONLY_FUNCTIONS = new Set(['dispatchRealClickSequence']);

/** Methods whose call can make the browser fire trusted events. */
const ACTIVATION_METHODS = new Set(['click', 'requestSubmit', 'execCommand']);

/** MouseEvent and its subclasses: a dispatched click-typed instance runs activation behaviour. */
const CLICK_EVENT_CLASSES = new Set(['MouseEvent', 'PointerEvent', 'DragEvent', 'WheelEvent']);

/**
 * Reviewed event builders, keyed `<file under src>::<function>`, each with the
 * index of the parameter that carries the event type. A builder may build a
 * MouseEvent-family event from that parameter. Every call to it must pass a
 * literal type other than 'click', or run inside the scope. Each builder must
 * be private to its file and used there only by direct calls (both checked
 * below), so that every call to it is visible here.
 */
const REVIEWED_BUILDERS = new Map<string, number>([
  ['control/action-executor.ts::createMouseEvent', 0],
  ['control/action-executor.ts::createPointerEvent', 0],
  ['control/combobox-select.ts::make', 0],
  ['control/drag-sequence.ts::createMouseEventAt', 0],
  ['control/drag-sequence.ts::createPointerEventAt', 0],
  ['control/forced-hover.ts::make', 0],
  ['react/commandHandlers.ts::makeMouse', 0],
  ['react/commandHandlers.ts::makePointer', 0],
]);

/**
 * Functions that hand their own type parameters to a reviewed builder, keyed
 * like REVIEWED_BUILDERS, each with the indexes of those parameters. A call to
 * a forwarder is held to the builder rule for each of them.
 */
const TYPE_FORWARDERS = new Map<string, readonly number[]>([
  ['control/drag-sequence.ts::dispatchDragPair', [1, 2]],
]);

/**
 * `dispatchEvent(<variable>)` calls outside the scope, reviewed as
 * dispatching no click, keyed
 * `<file under src>::<nearest named function>::<argument>`, each with the
 * exact number of such calls. Each sends a pointer or keyboard event, and an
 * untrusted pointer or keyboard event runs no activation behaviour. The scan
 * also checks that each variable is still built that way.
 */
const VARIABLE_DISPATCH_ALLOWLIST = new Map<string, number>([
  ['control/drag-sequence.ts::dispatchDragPair::pointer', 1],
  ['core/key-events.ts::dispatchKeySequence::keydown', 1],
  ['react/commandHandlers.ts::executeCommand::event', 1],
]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

type FunctionNode =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration;

function isFunctionNode(node: ts.Node): node is FunctionNode {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function nearestFunction(node: ts.Node): FunctionNode | null {
  for (let p = node.parent; p; p = p.parent) {
    if (isFunctionNode(p)) return p;
  }
  return null;
}

/** A function's own name, or the name of the variable or property it is assigned to. */
function functionName(fn: FunctionNode): string | null {
  if ((ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) && fn.name) return fn.name.text;
  if (
    (ts.isMethodDeclaration(fn) ||
      ts.isGetAccessorDeclaration(fn) ||
      ts.isSetAccessorDeclaration(fn)) &&
    ts.isIdentifier(fn.name)
  ) {
    return fn.name.text;
  }
  const parent = fn.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  return null;
}

/** The name of the nearest enclosing function that has one. */
function nearestNamedFunction(node: ts.Node): string | null {
  for (let p = node.parent; p; p = p.parent) {
    if (isFunctionNode(p)) {
      const name = functionName(p);
      if (name !== null) return name;
    }
  }
  return null;
}

function parameterName(fn: FunctionNode, index: number): string | null {
  const p = fn.parameters[index];
  return p !== undefined && ts.isIdentifier(p.name) ? p.name.text : null;
}

function isExported(fn: FunctionNode): boolean {
  const declaration: ts.Declaration =
    !ts.isFunctionDeclaration(fn) && ts.isVariableDeclaration(fn.parent) ? fn.parent : fn;
  return (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Export) !== 0;
}

function isStringLiteralLike(
  node: ts.Node | undefined
): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return (
    node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
  );
}

/** The expression with parentheses, `as`, `!` and `<T>` assertions peeled off. */
function unwrap(e: ts.Expression): ts.Expression {
  let cur = e;
  while (
    ts.isParenthesizedExpression(cur) ||
    ts.isAsExpression(cur) ||
    ts.isNonNullExpression(cur) ||
    ts.isTypeAssertionExpression(cur)
  ) {
    cur = cur.expression;
  }
  return cur;
}

/** `x.name` / `x['name']`: the member name, else null. */
function memberName(e: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  if (ts.isElementAccessExpression(e) && isStringLiteralLike(e.argumentExpression)) {
    return e.argumentExpression.text;
  }
  return null;
}

/** `x.name` / `x['name']`: the `x`, else null. */
function memberObject(e: ts.Expression): ts.Expression | null {
  return ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e) ? e.expression : null;
}

function calleeName(call: ts.CallExpression): string | null {
  return ts.isIdentifier(call.expression) ? call.expression.text : memberName(call.expression);
}

/**
 * Inside the synchronous `sdkDispatch` scope: the nearest enclosing function
 * is a scoped-only function, or the inline, non-async callback passed to
 * `sdkDispatch(...)`.
 */
function inScope(node: ts.Node): boolean {
  const fn = nearestFunction(node);
  if (fn === null) return false;
  if (ts.isFunctionDeclaration(fn) && fn.name && SCOPED_ONLY_FUNCTIONS.has(fn.name.text))
    return true;
  const call = fn.parent;
  return (
    ts.isCallExpression(call) &&
    calleeName(call) === 'sdkDispatch' &&
    call.arguments.some((a) => a === fn) &&
    (ts.getCombinedModifierFlags(fn) & ts.ModifierFlags.Async) === 0
  );
}

/** The class a `new` builds when it is MouseEvent or a subclass: `new MouseEvent(…)`, `new view.MouseEvent(…)`. */
function clickEventClass(node: ts.NewExpression): string | null {
  const e = node.expression;
  const name = ts.isIdentifier(e) ? e.text : memberName(e);
  return name !== null && CLICK_EVENT_CLASSES.has(name) ? name : null;
}

/** Whether `arg` is one of the type parameters of the reviewed forwarder that encloses `node`. */
function forwardsOwnTypeParameter(
  node: ts.Node,
  arg: ts.Expression | undefined,
  rel: string
): boolean {
  if (arg === undefined || !ts.isIdentifier(arg)) return false;
  const fn = nearestFunction(node);
  if (fn === null) return false;
  const indexes = TYPE_FORWARDERS.get(`${rel}::${functionName(fn)}`);
  return indexes !== undefined && indexes.some((i) => parameterName(fn, i) === arg.text);
}

/** What kind of activation this node is, or null when it is none. */
function activationKind(node: ts.Node, sf: ts.SourceFile): string | null {
  if (ts.isNewExpression(node)) {
    const first = node.arguments?.[0];
    return clickEventClass(node) !== null && isStringLiteralLike(first) && first.text === 'click'
      ? 'click-event'
      : null;
  }
  if (!ts.isCallExpression(node)) return null;
  const callee = node.expression;
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'Reflect' &&
    callee.name.text === 'apply'
  ) {
    const target = node.arguments[0];
    const name = target !== undefined ? memberName(unwrap(target)) : null;
    return name !== null && ACTIVATION_METHODS.has(name) ? 'indirect-call' : null;
  }
  const name = memberName(callee);
  if (name === null) return null;
  if (name === 'call' || name === 'apply' || name === 'bind') {
    const inner = memberObject(callee);
    const innerName = inner !== null ? memberName(inner) : null;
    return innerName !== null && ACTIVATION_METHODS.has(innerName) ? 'indirect-call' : null;
  }
  if (name === 'click') return node.arguments.length === 0 ? 'click' : null;
  if (name === 'requestSubmit' || name === 'execCommand') return name;
  if (name === 'dispatchEvent') {
    return node.arguments.some((a) => /['"`]click['"`]/.test(a.getText(sf)))
      ? 'dispatched-click'
      : null;
  }
  return null;
}

/** `dispatchEvent(ev)` / `dispatchEvent(this.ev)`: the argument's text, else null. */
function variableDispatchArg(node: ts.CallExpression, sf: ts.SourceFile): string | null {
  if (memberName(node.expression) !== 'dispatchEvent') return null;
  const arg = node.arguments[0];
  if (arg === undefined) return null;
  const inner = unwrap(arg);
  return ts.isIdentifier(inner) ||
    ts.isPropertyAccessExpression(inner) ||
    ts.isElementAccessExpression(inner)
    ? inner.getText(sf)
    : null;
}

/**
 * An event initialiser that cannot make a click: a `new` with a literal type
 * other than 'click', or a reviewed builder called with one, or with the
 * enclosing forwarder's own type parameter.
 */
function eventInitIsSafe(init: ts.Expression, rel: string): boolean {
  const e = unwrap(init);
  if (ts.isNewExpression(e)) {
    const first = e.arguments?.[0];
    return isStringLiteralLike(first) && first.text !== 'click';
  }
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) {
    const index = REVIEWED_BUILDERS.get(`${rel}::${e.expression.text}`);
    if (index === undefined) return false;
    const typeArg = e.arguments[index];
    if (isStringLiteralLike(typeArg)) return typeArg.text !== 'click';
    return forwardsOwnTypeParameter(e, typeArg, rel);
  }
  return false;
}

/**
 * The variable declaration an identifier refers to, resolved lexically: the
 * innermost enclosing block, case clause or `for` initializer that declares
 * the name. A parameter of that name, or no declaration, resolves to null.
 */
function resolveDeclaration(identifier: ts.Identifier): ts.VariableDeclaration | null {
  const name = identifier.text;
  const declares = (list: ts.VariableDeclarationList) =>
    list.declarations.find((d) => ts.isIdentifier(d.name) && d.name.text === name) ?? null;
  for (let p: ts.Node | undefined = identifier.parent; p; p = p.parent) {
    const statements =
      ts.isBlock(p) || ts.isSourceFile(p) || ts.isCaseClause(p) || ts.isDefaultClause(p)
        ? p.statements
        : undefined;
    for (const statement of statements ?? []) {
      const found = ts.isVariableStatement(statement) ? declares(statement.declarationList) : null;
      if (found !== null) return found;
    }
    if (
      (ts.isForOfStatement(p) || ts.isForInStatement(p) || ts.isForStatement(p)) &&
      p.initializer !== undefined &&
      ts.isVariableDeclarationList(p.initializer)
    ) {
      const found = declares(p.initializer);
      if (found !== null) return found;
    }
    if (
      isFunctionNode(p) &&
      p.parameters.some((q) => ts.isIdentifier(q.name) && q.name.text === name)
    ) {
      return null;
    }
  }
  return null;
}

/** Whether the dispatched variable resolves to a `const` in the dispatch's own function, built safely. */
function builtInSameFunction(call: ts.CallExpression, rel: string): boolean {
  const first = call.arguments[0];
  const arg = first !== undefined ? unwrap(first) : undefined;
  const fn = nearestFunction(call);
  if (arg === undefined || !ts.isIdentifier(arg) || fn === null) return false;
  const declaration = resolveDeclaration(arg);
  return (
    declaration !== null &&
    nearestFunction(declaration) === fn &&
    (ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) !== 0 &&
    declaration.initializer !== undefined &&
    eventInitIsSafe(declaration.initializer, rel)
  );
}

interface Finding {
  where: string;
  kind: string;
  text: string;
}

interface BuilderSeen {
  count: number;
  exported: boolean;
  fn: FunctionNode;
}

interface ScanResult {
  unscoped: Finding[];
  scopedOnlyCallsOutside: Finding[];
  unreviewedBuilders: Finding[];
  builderCalls: Finding[];
  references: Finding[];
  variableDispatches: Finding[];
  variableDispatchCounts: Map<string, number>;
  builders: Map<string, BuilderSeen>;
  total: number;
}

function emptyResult(): ScanResult {
  return {
    unscoped: [],
    scopedOnlyCallsOutside: [],
    unreviewedBuilders: [],
    builderCalls: [],
    references: [],
    variableDispatches: [],
    variableDispatchCounts: new Map(),
    builders: new Map(),
    total: 0,
  };
}

/** Scan one source text; `rel` is its path under src, `/`-separated. */
function scanSource(rel: string, text: string, out: ScanResult): void {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
  const at = (node: ts.Node) =>
    `${rel}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;

  const recordBuilder = (fn: FunctionNode) => {
    const key = `${rel}::${functionName(fn)}`;
    if (!REVIEWED_BUILDERS.has(key) && !TYPE_FORWARDERS.has(key)) return;
    const seen = out.builders.get(key);
    out.builders.set(key, {
      count: (seen?.count ?? 0) + 1,
      exported: (seen?.exported ?? false) || isExported(fn),
      fn,
    });
  };

  const checkConstruction = (node: ts.NewExpression) => {
    const cls = clickEventClass(node);
    const first = node.arguments?.[0];
    if (cls === null || isStringLiteralLike(first) || inScope(node)) return;
    const fn = nearestFunction(node);
    const key = `${rel}::${fn !== null ? functionName(fn) : '<top level>'}`;
    const index = REVIEWED_BUILDERS.get(key);
    const text = `${key}: new ${cls}(${first !== undefined ? first.getText(sf) : ''})`;
    if (index === undefined || fn === null) {
      out.unreviewedBuilders.push({ where: at(node), kind: 'unreviewed-builder', text });
    } else if (
      first === undefined ||
      !ts.isIdentifier(first) ||
      first.text !== parameterName(fn, index)
    ) {
      out.unreviewedBuilders.push({
        where: at(node),
        kind: 'builder-type-not-its-parameter',
        text,
      });
    }
  };

  const checkBuilderCall = (node: ts.CallExpression) => {
    if (!ts.isIdentifier(node.expression)) return;
    const key = `${rel}::${node.expression.text}`;
    const builderIndex = REVIEWED_BUILDERS.get(key);
    const indexes = builderIndex !== undefined ? [builderIndex] : TYPE_FORWARDERS.get(key);
    if (indexes === undefined || inScope(node)) return;
    for (const i of indexes) {
      const arg = node.arguments[i];
      if (isStringLiteralLike(arg)) {
        if (arg.text === 'click') {
          out.builderCalls.push({
            where: at(node),
            kind: 'builder-call-click',
            text: node.getText(sf),
          });
        }
      } else if (!forwardsOwnTypeParameter(node, arg, rel)) {
        out.builderCalls.push({
          where: at(node),
          kind: 'builder-call-non-literal',
          text: node.getText(sf),
        });
      }
    }
  };

  /** Names whose every use in this file must be a direct call: its reviewed builders and forwarders, and the scoped-only functions. */
  const guardedNames = new Set<string>([
    ...SCOPED_ONLY_FUNCTIONS,
    ...[...REVIEWED_BUILDERS.keys(), ...TYPE_FORWARDERS.keys()]
      .filter((key) => key.startsWith(`${rel}::`))
      .map((key) => key.slice(rel.length + 2)),
  ]);

  const checkReference = (node: ts.Identifier) => {
    if (!guardedNames.has(node.text)) return;
    const parent = node.parent;
    const declarationName =
      (ts.isFunctionDeclaration(parent) || ts.isVariableDeclaration(parent)) &&
      parent.name === node;
    const directCall = ts.isCallExpression(parent) && parent.expression === node;
    const otherMemberName =
      (ts.isPropertyAccessExpression(parent) ||
        ts.isPropertyAssignment(parent) ||
        ts.isMethodDeclaration(parent) ||
        ts.isPropertyDeclaration(parent)) &&
      parent.name === node;
    if (declarationName || directCall || otherMemberName) return;
    out.references.push({
      where: at(node),
      kind: 'non-call-reference',
      text: `${rel}::${node.text}`,
    });
  };

  const checkVariableDispatch = (node: ts.CallExpression) => {
    const arg = variableDispatchArg(node, sf);
    if (arg === null || inScope(node)) return;
    const key = `${rel}::${nearestNamedFunction(node) ?? '<top level>'}::${arg}`;
    out.variableDispatchCounts.set(key, (out.variableDispatchCounts.get(key) ?? 0) + 1);
    if (!VARIABLE_DISPATCH_ALLOWLIST.has(key)) {
      out.variableDispatches.push({
        where: at(node),
        kind: 'unreviewed-variable-dispatch',
        text: key,
      });
    } else if (!builtInSameFunction(node, rel)) {
      out.variableDispatches.push({
        where: at(node),
        kind: 'unverified-variable-dispatch',
        text: key,
      });
    }
  };

  const visit = (node: ts.Node) => {
    if (isFunctionNode(node)) recordBuilder(node);
    if (ts.isIdentifier(node)) checkReference(node);
    const kind = activationKind(node, sf);
    if (kind !== null) {
      out.total++;
      if (!inScope(node)) out.unscoped.push({ where: at(node), kind, text: node.getText(sf) });
    }
    if (ts.isNewExpression(node)) checkConstruction(node);
    if (ts.isCallExpression(node)) {
      checkBuilderCall(node);
      checkVariableDispatch(node);
      const name = calleeName(node);
      if (name !== null && SCOPED_ONLY_FUNCTIONS.has(name) && !inScope(node)) {
        out.scopedOnlyCallsOutside.push({
          where: at(node),
          kind: 'scoped-only-call',
          text: node.getText(sf),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function scan(): ScanResult {
  const out = emptyResult();
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    scanSource(rel, fs.readFileSync(file, 'utf8'), out);
  }
  return out;
}

/** Each reviewed variable dispatch in `keys` whose count differs from the reviewed count. */
function countMismatches(result: ScanResult, keys: readonly string[]): string[] {
  return keys.flatMap((key) => {
    const reviewed = VARIABLE_DISPATCH_ALLOWLIST.get(key) ?? 0;
    const found = result.variableDispatchCounts.get(key) ?? 0;
    return found === reviewed ? [] : [`${key}: reviewed ${reviewed}, found ${found}`];
  });
}

/** Each reviewed builder or forwarder in `keys` that is missing, duplicated, exported or lacks its type parameter. */
function builderProblems(result: ScanResult, keys: readonly string[]): string[] {
  return keys.flatMap((key) => {
    const builderIndex = REVIEWED_BUILDERS.get(key);
    const indexes = builderIndex !== undefined ? [builderIndex] : (TYPE_FORWARDERS.get(key) ?? []);
    const seen = result.builders.get(key);
    if (seen === undefined) return [`${key}: not found`];
    const problems: string[] = [];
    if (seen.count !== 1) problems.push(`${key}: defined ${seen.count} times`);
    if (seen.exported)
      problems.push(`${key}: exported, so a call from another file goes unchecked`);
    for (const i of indexes) {
      if (parameterName(seen.fn, i) === null) problems.push(`${key}: no named parameter ${i}`);
    }
    return problems;
  });
}

describe('sdkDispatch ratchet', () => {
  const result = scan();

  it('finds the activation calls it guards (the scan is not vacuous)', () => {
    expect(result.total).toBeGreaterThanOrEqual(10);
  });

  it('every activation runs inside the synchronous sdkDispatch scope', () => {
    expect(result.unscoped).toEqual([]);
  });

  it('a scoped-only dispatch function is only called inside sdkDispatch', () => {
    expect(result.scopedOnlyCallsOutside).toEqual([]);
  });

  it('a MouseEvent-family event of non-literal type is built only by a reviewed builder, from its own type parameter', () => {
    expect(result.unreviewedBuilders).toEqual([]);
  });

  it('every call to a reviewed builder or forwarder passes a literal type other than click, or forwards its own', () => {
    expect(result.builderCalls).toEqual([]);
  });

  it('every reviewed builder and forwarder is defined once, private to its file, with its type parameter', () => {
    expect(
      builderProblems(result, [...REVIEWED_BUILDERS.keys(), ...TYPE_FORWARDERS.keys()])
    ).toEqual([]);
  });

  it('a reviewed builder, forwarder or scoped-only function is used only as a direct call in its own file', () => {
    expect(result.references).toEqual([]);
  });

  it('a dispatchEvent of an event built elsewhere is reviewed, and its variable is built safely in its own function', () => {
    expect(result.variableDispatches).toEqual([]);
  });

  it('each reviewed variable dispatch occurs exactly as often as reviewed (no stale entry, no new site)', () => {
    expect(countMismatches(result, [...VARIABLE_DISPATCH_ALLOWLIST.keys()])).toEqual([]);
  });

  describe('flags each guarded shape in planted source', () => {
    it('direct, indirect, deferred and constructed activations', () => {
      const planted = emptyResult();
      scanSource(
        'planted/shapes.ts',
        [
          'function plant(el: HTMLElement, form: HTMLFormElement, ev: Event, t: string) {',
          '  el.click();',
          '  form.requestSubmit();',
          "  document.execCommand('copy');",
          "  el.dispatchEvent(new MouseEvent('click'));",
          "  const built = new PointerEvent('click');",
          "  const dragged = new DragEvent('click');",
          "  const viewBuilt = new window.MouseEvent('click');",
          "  const viewIndexed = new window['MouseEvent']('click');",
          '  HTMLElement.prototype.click.call(el);',
          '  HTMLElement.prototype.click.bind(el)();',
          "  el['click']();",
          '  Reflect.apply(HTMLElement.prototype.click, el, []);',
          '  el.dispatchEvent(ev);',
          '  const loose = new MouseEvent(t);',
          '  return [built, dragged, viewBuilt, loose];',
          '}',
          'function deferred(el: HTMLElement) {',
          '  sdkDispatch(() => setTimeout(() => el.click(), 0));',
          '  sdkDispatch(async () => {',
          '    await Promise.resolve();',
          '    el.click();',
          '  });',
          '}',
          'function scoped(el: HTMLElement, ev: Event, t: string) {',
          '  sdkDispatch(() => {',
          '    el.click();',
          '    el.dispatchEvent(ev);',
          "    el.dispatchEvent(new MouseEvent('click'));",
          '    el.dispatchEvent(new MouseEvent(t));',
          '  });',
          '}',
        ].join('\n'),
        planted
      );
      expect(planted.unscoped.map((f) => f.kind)).toEqual([
        'click',
        'requestSubmit',
        'execCommand',
        'dispatched-click',
        'click-event',
        'click-event',
        'click-event',
        'click-event',
        'click-event',
        'indirect-call',
        'indirect-call',
        'click',
        'indirect-call',
        'click',
        'click',
      ]);
      expect(planted.unreviewedBuilders.map((f) => f.text)).toEqual([
        'planted/shapes.ts::plant: new MouseEvent(t)',
      ]);
      expect(planted.variableDispatches.map((f) => f.text)).toEqual([
        'planted/shapes.ts::plant::ev',
      ]);
    });

    it('a builder or forwarder called with click or a non-literal type, and a second reviewed dispatch site', () => {
      const planted = emptyResult();
      scanSource(
        'control/drag-sequence.ts',
        [
          'function createMouseEventAt(type: string, x: number, y: number, b = 0): MouseEvent {',
          '  return new MouseEvent(type, { clientX: x, clientY: y, buttons: b });',
          '}',
          'function createPointerEventAt(type: string, x: number, y: number, b: number): Event | null {',
          '  return new PointerEvent(type, { clientX: x, clientY: y, buttons: b });',
          '}',
          'function dispatchDragPair(',
          '  target: EventTarget,',
          '  pointerType: string,',
          '  mouseType: string,',
          '  x: number,',
          '  y: number,',
          '  b: number',
          '): void {',
          '  const pointer = createPointerEventAt(pointerType, x, y, b);',
          '  if (pointer) target.dispatchEvent(pointer);',
          '  if (pointer) target.dispatchEvent(pointer);',
          '  target.dispatchEvent(createMouseEventAt(mouseType, x, y, b));',
          '}',
          'function drive(el: HTMLElement, kind: string): void {',
          "  dispatchDragPair(el, 'pointerdown', 'mousedown', 0, 0, 1);",
          "  dispatchDragPair(el, 'pointerup', 'click', 0, 0, 0);",
          "  dispatchDragPair(el, 'pointerup', kind, 0, 0, 0);",
          "  createMouseEventAt('click', 0, 0);",
          '}',
        ].join('\n'),
        planted
      );
      expect(planted.builderCalls.map((f) => f.kind)).toEqual([
        'builder-call-click',
        'builder-call-non-literal',
        'builder-call-click',
      ]);
      expect(planted.unscoped).toEqual([]);
      expect(planted.unreviewedBuilders).toEqual([]);
      expect(planted.variableDispatches).toEqual([]);
      expect(
        countMismatches(planted, ['control/drag-sequence.ts::dispatchDragPair::pointer'])
      ).toEqual(['control/drag-sequence.ts::dispatchDragPair::pointer: reviewed 1, found 2']);
    });

    it('a second dispatch of a reviewed name in one function, resolved to a different binding', () => {
      const planted = emptyResult();
      scanSource(
        'react/commandHandlers.ts',
        [
          'export async function executeCommand(action: string, events: Event[]) {',
          '  const target: EventTarget = document;',
          '  switch (action) {',
          "    case 'replay': {",
          '      for (const event of events) target.dispatchEvent(event);',
          '      break;',
          '    }',
          "    case 'executeUndo': {",
          "      const event = new KeyboardEvent('keydown', { key: 'z' });",
          '      target.dispatchEvent(event);',
          '      break;',
          '    }',
          '  }',
          '}',
        ].join('\n'),
        planted
      );
      expect(planted.variableDispatches.map((f) => `${f.kind} ${f.where}`)).toEqual([
        'unverified-variable-dispatch react/commandHandlers.ts:5',
      ]);
      expect(countMismatches(planted, ['react/commandHandlers.ts::executeCommand::event'])).toEqual(
        ['react/commandHandlers.ts::executeCommand::event: reviewed 1, found 2']
      );
    });

    it('a reviewed name used other than as a direct call: an export list, an alias, a callback', () => {
      const planted = emptyResult();
      scanSource(
        'control/action-executor.ts',
        [
          'function createMouseEvent(type: string, element: HTMLElement): MouseEvent {',
          '  return new MouseEvent(type);',
          '}',
          'export { createMouseEvent };',
          'export const leak = createMouseEvent;',
          'const viaProperty = { build: createMouseEvent };',
          'export default createMouseEvent;',
          "createMouseEvent('mousedown', document.body);",
        ].join('\n'),
        planted
      );
      scanSource(
        'react/commandHandlers.ts',
        [
          'function dispatchRealClickSequence(el: HTMLElement): void {',
          '  el.click();',
          '}',
          'function plant(el: HTMLElement): void {',
          '  [el].forEach(dispatchRealClickSequence);',
          '}',
        ].join('\n'),
        planted
      );
      expect(planted.references.map((f) => f.where)).toEqual([
        'control/action-executor.ts:4',
        'control/action-executor.ts:5',
        'control/action-executor.ts:6',
        'control/action-executor.ts:7',
        'react/commandHandlers.ts:5',
      ]);
    });

    it('a reviewed builder that builds from another variable, or is exported', () => {
      const planted = emptyResult();
      scanSource(
        'control/action-executor.ts',
        [
          'function createMouseEvent(type: string, element: HTMLElement): MouseEvent {',
          "  const other = 'click';",
          '  return new MouseEvent(other, { bubbles: true });',
          '}',
          'export function createPointerEvent(type: string, element: HTMLElement): Event {',
          '  return new PointerEvent(type);',
          '}',
        ].join('\n'),
        planted
      );
      expect(planted.unreviewedBuilders.map((f) => f.kind)).toEqual([
        'builder-type-not-its-parameter',
      ]);
      expect(
        builderProblems(planted, [
          'control/action-executor.ts::createMouseEvent',
          'control/action-executor.ts::createPointerEvent',
        ])
      ).toEqual([
        'control/action-executor.ts::createPointerEvent: exported, so a call from another file goes unchecked',
      ]);
    });
  });
});
