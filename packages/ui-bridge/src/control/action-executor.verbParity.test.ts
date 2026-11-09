/**
 * The HTTP executor's three verb declarations must name the same verbs:
 * `SUPPORTED_ACTIONS` (the early gate, and the accepted list an unknown-verb
 * refusal names when the element advertises none), the `StandardAction` union
 * (`../core/types`, the type an element's advertised `actions` and
 * `inferActions` are held to), and the verbs `performAction`'s FALLBACK
 * dispatch runs: its top-level `if (action === '…') { … return … }` arms plus
 * the `switch (action as StandardAction)` cases.
 *
 * Post-merge follow-up to ui-bridge#332, which pinned the relay's copy of this
 * pairing (`RELAY_ELEMENT_ACTIONS` against its switch). The HTTP executor had
 * the same unguarded pair. The gate is a `Set<string>`, so the compiler holds
 * it neither to the union nor to the dispatch. The switch's `as StandardAction`
 * cast rejects an off-union `case`, but not a missing one: nothing checks the
 * switch for exhaustiveness. A union member missing from the gate is a verb an
 * element can advertise and the executor refuses. A gate entry with no dispatch
 * arm passes the gate and then throws "unknown action". Either way the
 * refusal's suggestion and the executor disagree, which is the #331 defect
 * class on this door.
 *
 * NOT covered: when ui-bridge-auto is installed, every verb but the inline
 * `hoverClick` / `hover` / `unhover` arms is delegated to ui-bridge-auto's own
 * `performAction`, whose dispatcher lives in that repo and is not pinned here.
 *
 * The sources are read through the TypeScript AST, so a commented-out entry,
 * case or arm is absent here exactly as it is absent at runtime.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
}

const executor = parse(join(here, 'action-executor.ts'));
const types = parse(join(here, '..', 'core', 'types.ts'));

function findAll<T extends ts.Node>(root: ts.Node, match: (n: ts.Node) => n is T): T[] {
  const found: T[] = [];
  const visit = (n: ts.Node): void => {
    if (match(n)) found.push(n);
    ts.forEachChild(n, visit);
  };
  visit(root);
  return found;
}

function only<T>(items: T[], what: string): T {
  if (items.length !== 1) throw new Error(`expected exactly one ${what}, found ${items.length}`);
  return items[0];
}

function literal(node: ts.Node, what: string): string {
  if (!ts.isStringLiteral(node)) throw new Error(`${what}: non-literal \`${node.getText()}\``);
  return node.text;
}

function supportedActions(): string[] {
  const decl = only(
    findAll(
      executor,
      (n): n is ts.VariableDeclaration =>
        ts.isVariableDeclaration(n) && n.name.getText() === 'SUPPORTED_ACTIONS'
    ),
    'SUPPORTED_ACTIONS declaration'
  );
  const init = decl.initializer;
  const array = init && ts.isNewExpression(init) ? init.arguments?.[0] : undefined;
  if (!array || !ts.isArrayLiteralExpression(array)) {
    throw new Error('SUPPORTED_ACTIONS is not `new Set([...])` over an array literal');
  }
  return array.elements.map((e) => literal(e, 'SUPPORTED_ACTIONS entry'));
}

function standardActionUnion(): string[] {
  const alias = only(
    findAll(
      types,
      (n): n is ts.TypeAliasDeclaration =>
        ts.isTypeAliasDeclaration(n) && n.name.text === 'StandardAction'
    ),
    'StandardAction type'
  );
  if (!ts.isUnionTypeNode(alias.type)) throw new Error('StandardAction is not a union');
  return alias.type.types.map((t) => {
    if (!ts.isLiteralTypeNode(t)) throw new Error(`StandardAction member \`${t.getText()}\``);
    return literal(t.literal, 'StandardAction member');
  });
}

/** True when `node` holds a `return` of its own, not one inside a nested function. */
function returns(node: ts.Node): boolean {
  if (ts.isReturnStatement(node)) return true;
  if (ts.isFunctionLike(node)) return false;
  return ts.forEachChild(node, returns) ?? false;
}

/**
 * The case labels of `sw` that reach a body which returns. A label with no
 * statements falls through, so it is judged by the first clause below it that
 * has statements. A label that falls into `default` (where the verb is refused),
 * or whose body does not return (`case 'x': break;`, after which
 * `performAction` returns nothing and the action reports success), dispatches
 * nothing.
 */
function returningCases(sw: ts.SwitchStatement): string[] {
  const clauses = sw.caseBlock.clauses;
  return clauses.flatMap((clause, i) => {
    if (!ts.isCaseClause(clause)) return [];
    const body = clauses.slice(i).find((c) => c.statements.length > 0);
    if (!body || ts.isDefaultClause(body) || !body.statements.some(returns)) return [];
    return [literal(clause.expression, 'case label')];
  });
}

/** `action === '<verb>'`, the condition of an inline dispatch arm. */
function armVerb(condition: ts.Expression): string | undefined {
  return ts.isBinaryExpression(condition) &&
    condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
    ts.isIdentifier(condition.left) &&
    condition.left.text === 'action' &&
    ts.isStringLiteral(condition.right)
    ? condition.right.text
    : undefined;
}

function dispatchedVerbs(): string[] {
  const method = only(
    findAll(
      executor,
      (n): n is ts.MethodDeclaration =>
        ts.isMethodDeclaration(n) && n.name.getText() === 'performAction' && n.body !== undefined
    ),
    'performAction method'
  );
  const body = method.body as ts.Block;
  // An arm counts only when it RETURNS: an `if (action === 'x')` that merely
  // adjusts params and falls through dispatches nothing.
  const arms = body.statements.filter(ts.isIfStatement).flatMap((stmt) => {
    const verb = armVerb(stmt.expression);
    return verb !== undefined && returns(stmt.thenStatement) ? [verb] : [];
  });
  const sw = only(
    findAll(
      body,
      (n): n is ts.SwitchStatement =>
        ts.isSwitchStatement(n) && n.expression.getText() === 'action as StandardAction'
    ),
    '`switch (action as StandardAction)` in performAction'
  );
  return [...arms, ...returningCases(sw)];
}

describe('HTTP executor verb parity', () => {
  it('finds a non-trivial set on every side (the parse is not vacuous)', () => {
    expect(supportedActions().length).toBeGreaterThan(10);
    expect(standardActionUnion().length).toBeGreaterThan(10);
    expect(dispatchedVerbs().length).toBeGreaterThan(10);
  });

  it('SUPPORTED_ACTIONS has no duplicates and equals the StandardAction union', () => {
    const gate = supportedActions();
    expect(new Set(gate).size).toBe(gate.length);
    expect([...gate].sort()).toEqual([...new Set(standardActionUnion())].sort());
  });

  it("SUPPORTED_ACTIONS equals the verbs performAction's fallback dispatch runs", () => {
    expect([...supportedActions()].sort()).toEqual([...new Set(dispatchedVerbs())].sort());
  });
});
