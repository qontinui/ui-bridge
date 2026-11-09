/**
 * `RELAY_ELEMENT_ACTIONS` must name exactly the verbs the relay's
 * `executeElementAction` switch has a case for.
 *
 * Since ui-bridge#331 the list is load-bearing in both directions:
 * `relayAcceptedVerbs` FILTERS an element's advertised verbs through it, and
 * falls back to it when nothing survives. A case added to the switch but not
 * to the list is a runnable verb the unknown-verb refusal silently drops from
 * its suggestion; a list entry with no case is a suggestion the relay then
 * refuses — the exact defect #331 fixed. The list's own comment said "keep in
 * step"; this test is what keeps it there.
 *
 * The source is read through the TypeScript AST, not as text, so a
 * commented-out entry or case is absent here exactly as it is absent at
 * runtime. (ui-bridge#332 first shipped this test as a text parse, which read
 * `// case 'drag':` as a live case.)
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const path = join(dirname(fileURLToPath(import.meta.url)), 'commandHandlers.ts');
const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);

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
      source,
      (n): n is ts.VariableDeclaration =>
        ts.isVariableDeclaration(n) && n.name.getText() === 'RELAY_ELEMENT_ACTIONS'
    ),
    'RELAY_ELEMENT_ACTIONS declaration'
  );
  const array = decl.initializer;
  if (!array || !ts.isArrayLiteralExpression(array)) {
    throw new Error('RELAY_ELEMENT_ACTIONS is not an array literal');
  }
  return array.elements.map((e) => literal(e, 'RELAY_ELEMENT_ACTIONS entry'));
}

/**
 * The case labels of the relay switch that reach a body. A label with no
 * statements falls through, so it is judged by the first clause below it that
 * has statements; one that falls into `default` is refused there, so it does
 * not count. (`break` is this switch's normal clause ending, so unlike the
 * executors' return-style switches a body is not required to return. A body
 * that runs and then falls into `default` because its `break` is missing is
 * the compiler's to refuse: `noFallthroughCasesInSwitch`, TS7029.)
 */
function switchCases(): string[] {
  const sw = only(
    findAll(
      source,
      (n): n is ts.SwitchStatement =>
        ts.isSwitchStatement(n) && n.expression.getText() === 'request.action'
    ),
    '`switch (request.action)` in commandHandlers.ts'
  );
  const clauses = sw.caseBlock.clauses;
  return clauses.flatMap((clause, i) => {
    if (!ts.isCaseClause(clause)) return [];
    const body = clauses.slice(i).find((c) => c.statements.length > 0);
    if (!body || ts.isDefaultClause(body)) return [];
    return [literal(clause.expression, 'case label')];
  });
}

describe('relay verb list parity', () => {
  it('finds a non-trivial set on both sides (the parse is not vacuous)', () => {
    expect(listEntries().length).toBeGreaterThan(10);
    expect(switchCases().length).toBeGreaterThan(10);
  });

  it('RELAY_ELEMENT_ACTIONS equals the switch cases, with no duplicates', () => {
    const list = listEntries();
    expect(new Set(list).size).toBe(list.length);
    expect([...list].sort()).toEqual([...new Set(switchCases())].sort());
  });
});
