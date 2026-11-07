/**
 * Ratchet: every activation-capable call (`.click()`, `requestSubmit()`, a
 * dispatched click, `document.execCommand(…)`) in the package source runs inside
 * `sdkDispatch` (core/sdk-dispatch.ts).
 *
 * The browser fires TRUSTED `submit` / `input` / `change` events as a
 * consequence of `.click()`, a dispatched `click`, `requestSubmit()` and
 * `execCommand()`.
 * Passive capture tells an agent's action from a human's by the dispatch
 * scope, so a call outside it would record the agent's action as a human's.
 * This scan makes adding such a call without the scope a test failure.
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

function calleeName(call: ts.CallExpression): string | null {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
}

function isActivationCall(call: ts.CallExpression, sf: ts.SourceFile): boolean {
  if (!ts.isPropertyAccessExpression(call.expression)) return false;
  const name = call.expression.name.text;
  if (name === 'click') return call.arguments.length === 0;
  if (name === 'requestSubmit') return true;
  // execCommand('insertText' / 'paste' / …) fires a TRUSTED `input`.
  if (name === 'execCommand') return true;
  if (name === 'dispatchEvent') {
    return call.arguments.some((a) => /['"`]click['"`]/.test(a.getText(sf)));
  }
  return false;
}

function enclosingFunctionName(node: ts.Node): string | null {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) && p.name) return p.name.text;
  }
  return null;
}

function insideSdkDispatch(node: ts.Node): boolean {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p) && calleeName(p) === 'sdkDispatch') return true;
  }
  return false;
}

interface Finding {
  where: string;
  text: string;
}

function scan(): { unscoped: Finding[]; scopedOnlyCallsOutside: Finding[]; total: number } {
  const unscoped: Finding[] = [];
  const scopedOnlyCallsOutside: Finding[] = [];
  let total = 0;
  for (const file of sourceFiles(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const where = `${path.relative(SRC, file)}:${
          sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
        }`;
        if (isActivationCall(node, sf)) {
          total++;
          const fn = enclosingFunctionName(node);
          if (!insideSdkDispatch(node) && !(fn && SCOPED_ONLY_FUNCTIONS.has(fn))) {
            unscoped.push({ where, text: node.getText(sf) });
          }
        }
        const name = calleeName(node);
        if (name && SCOPED_ONLY_FUNCTIONS.has(name) && !insideSdkDispatch(node)) {
          scopedOnlyCallsOutside.push({ where, text: node.getText(sf) });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { unscoped, scopedOnlyCallsOutside, total };
}

describe('sdkDispatch ratchet', () => {
  const result = scan();

  it('finds the activation calls it guards (the scan is not vacuous)', () => {
    expect(result.total).toBeGreaterThanOrEqual(10);
  });

  it('every .click() / requestSubmit() / dispatched click / execCommand runs inside sdkDispatch', () => {
    expect(result.unscoped).toEqual([]);
  });

  it('a scoped-only dispatch function is only called inside sdkDispatch', () => {
    expect(result.scopedOnlyCallsOutside).toEqual([]);
  });
});
