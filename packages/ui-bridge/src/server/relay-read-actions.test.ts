/**
 * Every declared read (`RELAY_READ_ACTIONS`) is a real dispatcher case, and
 * none of them runs the pre-read DOM settle (plan
 * 2026-11-08-ui-bridge-relay-and-exec-mode-follow-ups-from-pr-329, Phase 3).
 *
 * An entry with no `case` in `executeCommand` was classified from nothing, and
 * an entry the dispatcher settles before reading is not a pure read; either
 * would let the failover re-send something nobody read. The check parses
 * `../react/commandHandlers.ts`: a `case '<x>':` of the top-level
 * `switch (action)` inside `executeCommand`, and the string literals of the
 * `SETTLE_BEFORE_READ_ACTIONS` set.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { RELAY_READ_ACTIONS } from './relay-read-actions';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../react/commandHandlers.ts'), 'utf8');
const sf = ts.createSourceFile('commandHandlers.ts', source, ts.ScriptTarget.Latest, true);

/** The `case` labels of `executeCommand`'s top-level `switch (action)`. */
function dispatcherCases(): Set<string> {
  let body: ts.Block | undefined;
  const find = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'executeCommand') body = node.body;
    if (!body) ts.forEachChild(node, find);
  };
  find(sf);
  if (!body) throw new Error('executeCommand not found in commandHandlers.ts');
  const cases = new Set<string>();
  for (const stmt of body.statements) {
    if (
      ts.isSwitchStatement(stmt) &&
      ts.isIdentifier(stmt.expression) &&
      stmt.expression.text === 'action'
    ) {
      for (const clause of stmt.caseBlock.clauses) {
        if (ts.isCaseClause(clause) && ts.isStringLiteral(clause.expression)) {
          cases.add(clause.expression.text);
        }
      }
    }
  }
  return cases;
}

/** The string literals `SETTLE_BEFORE_READ_ACTIONS` is built from. */
function settleBeforeRead(): Set<string> {
  const found = new Set<string>();
  let seen = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'SETTLE_BEFORE_READ_ACTIONS'
    ) {
      seen = true;
      const collect = (n: ts.Node): void => {
        if (ts.isStringLiteral(n)) found.add(n.text);
        ts.forEachChild(n, collect);
      };
      if (node.initializer) collect(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!seen) throw new Error('SETTLE_BEFORE_READ_ACTIONS not found in commandHandlers.ts');
  return found;
}

describe('RELAY_READ_ACTIONS', () => {
  const cases = dispatcherCases();
  const settles = settleBeforeRead();

  it('the parse found the dispatcher (controls)', () => {
    expect(cases.has('getElement')).toBe(true);
    expect(cases.has('executeElementAction')).toBe(true);
    // A nested `case 'click':` (inside executeElementAction) is not the dispatch.
    expect(cases.has('click')).toBe(false);
    expect(settles.has('aiExecute')).toBe(true);
  });

  it('names only actions that have a case in executeCommand', () => {
    expect([...RELAY_READ_ACTIONS].filter((a) => !cases.has(a))).toEqual([]);
  });

  it('names no action the dispatcher settles before reading', () => {
    expect([...RELAY_READ_ACTIONS].filter((a) => settles.has(a))).toEqual([]);
  });
});
