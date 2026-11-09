/**
 * The native executor's three verb declarations must name the same verbs:
 * `NATIVE_STANDARD_ACTIONS` (the accepted list an unknown-verb refusal names
 * when the element advertises none), the `NativeStandardAction` union
 * (`../core/types`, the type an element's advertised `actions` are held to),
 * and the cases of `performAction`'s `switch (action)`.
 *
 * Post-merge follow-up to ui-bridge#332, which pinned the relay's copy of this
 * pairing. The list's own comment said "keep in step with
 * `NativeStandardAction` and the switch below". Its type only rejects an entry
 * that is NOT a union member, and the switch reads `action` as a plain
 * `string`. So two drifts both compiled. A member missing from the list is a
 * runnable verb the refusal silently drops. A member with no case is a verb an
 * element may advertise, and the refusal suggest, that the switch then refuses:
 * the #331 defect. This test is what keeps the three in step.
 *
 * `@qontinui/ui-bridge-native` has its own executor, with a larger verb set,
 * and its own version of this test. Each test pins only its own package.
 *
 * The sources are read through the TypeScript AST, so a commented-out entry or
 * case is absent here exactly as it is absent at runtime.
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

function listEntries(): string[] {
  const decl = only(
    findAll(
      executor,
      (n): n is ts.VariableDeclaration =>
        ts.isVariableDeclaration(n) && n.name.getText() === 'NATIVE_STANDARD_ACTIONS'
    ),
    'NATIVE_STANDARD_ACTIONS declaration'
  );
  const array = decl.initializer;
  if (!array || !ts.isArrayLiteralExpression(array)) {
    throw new Error('NATIVE_STANDARD_ACTIONS is not an array literal');
  }
  return array.elements.map((e) => literal(e, 'NATIVE_STANDARD_ACTIONS entry'));
}

function unionMembers(): string[] {
  const alias = only(
    findAll(
      types,
      (n): n is ts.TypeAliasDeclaration =>
        ts.isTypeAliasDeclaration(n) && n.name.text === 'NativeStandardAction'
    ),
    'NativeStandardAction type'
  );
  if (!ts.isUnionTypeNode(alias.type)) throw new Error('NativeStandardAction is not a union');
  return alias.type.types.map((t) => {
    if (!ts.isLiteralTypeNode(t)) throw new Error(`NativeStandardAction member \`${t.getText()}\``);
    return literal(t.literal, 'NativeStandardAction member');
  });
}

/** True when `node` holds a `return` of its own, not one inside a nested function. */
function returns(node: ts.Node): boolean {
  if (ts.isReturnStatement(node)) return true;
  if (ts.isFunctionLike(node)) return false;
  return ts.forEachChild(node, returns) ?? false;
}

/**
 * The case labels of `performAction`'s switch that reach a body which returns.
 * A label with no statements falls through (`click` into `press` is the
 * pattern), so it is judged by the first clause below it that has statements. A
 * label that falls into `default` (where the verb is refused), or whose body
 * does not return (`case 'x': break;`, after which `performAction` returns
 * nothing and the action reports success), dispatches nothing.
 */
function switchCases(): string[] {
  const sw = only(
    findAll(
      executor,
      (n): n is ts.SwitchStatement => ts.isSwitchStatement(n) && n.expression.getText() === 'action'
    ),
    '`switch (action)` in action-executor.ts'
  );
  const clauses = sw.caseBlock.clauses;
  return clauses.flatMap((clause, i) => {
    if (!ts.isCaseClause(clause)) return [];
    const body = clauses.slice(i).find((c) => c.statements.length > 0);
    if (!body || ts.isDefaultClause(body) || !body.statements.some(returns)) return [];
    return [literal(clause.expression, 'case label')];
  });
}

describe('native executor verb parity', () => {
  it('finds a non-trivial set on every side (the parse is not vacuous)', () => {
    expect(listEntries().length).toBeGreaterThan(5);
    expect(unionMembers().length).toBeGreaterThan(5);
    expect(switchCases().length).toBeGreaterThan(5);
  });

  it('NATIVE_STANDARD_ACTIONS has no duplicates and equals the NativeStandardAction union', () => {
    const list = listEntries();
    expect(new Set(list).size).toBe(list.length);
    expect([...list].sort()).toEqual([...new Set(unionMembers())].sort());
  });

  it('NATIVE_STANDARD_ACTIONS equals the switch cases', () => {
    expect([...listEntries()].sort()).toEqual([...new Set(switchCases())].sort());
  });
});
