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
 *
 * It also covers the shapes that hide an activation from a plain reading:
 *   - a `click` MouseEvent / PointerEvent constructed outside the scope (only
 *     those two classes run activation behaviour when dispatched);
 *   - an indirect call such as `HTMLElement.prototype.click.call(el)`;
 *   - `dispatchEvent(ev)` with the event built elsewhere. Its type cannot be
 *     read at the call, so it fails the scan unless it runs inside the scope
 *     or was reviewed onto VARIABLE_DISPATCH_ALLOWLIST.
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

/** Event classes whose `click` instance runs activation behaviour when dispatched. */
const CLICK_EVENT_CLASSES = new Set(['MouseEvent', 'PointerEvent']);

/**
 * `dispatchEvent(<variable>)` calls reviewed as dispatching no click, keyed
 * `<file under src>::<enclosing function>::<argument>`. Each sends a pointer or
 * keyboard event built a line above it. An untrusted pointer or keyboard
 * event runs no activation behaviour: it neither submits a form nor clicks.
 * A new variable dispatch anywhere fails the scan until it runs inside
 * `sdkDispatch` or is reviewed onto this list.
 */
const VARIABLE_DISPATCH_ALLOWLIST = new Set([
  'control/drag-sequence.ts::dispatchDragPair::pointer',
  'core/key-events.ts::dispatchKeySequence::keydown',
  'react/commandHandlers.ts::executeCommand::event',
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

function calleeName(call: ts.CallExpression): string | null {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
}

function isClickLiteral(node: ts.Node | undefined): boolean {
  return (
    node !== undefined &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
    node.text === 'click'
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

/** What kind of activation this node is, or null when it is none. */
function activationKind(node: ts.Node, sf: ts.SourceFile): string | null {
  if (ts.isNewExpression(node)) {
    const cls = node.expression;
    return ts.isIdentifier(cls) &&
      CLICK_EVENT_CLASSES.has(cls.text) &&
      isClickLiteral(node.arguments?.[0])
      ? 'click-event'
      : null;
  }
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return null;
  const callee = node.expression;
  const name = callee.name.text;
  if (
    (name === 'call' || name === 'apply') &&
    ts.isPropertyAccessExpression(callee.expression) &&
    ACTIVATION_METHODS.has(callee.expression.name.text)
  ) {
    return 'indirect-call';
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
function variableDispatchArg(node: ts.Node, sf: ts.SourceFile): string | null {
  if (!ts.isCallExpression(node) || calleeName(node) !== 'dispatchEvent') return null;
  if (!ts.isPropertyAccessExpression(node.expression)) return null;
  const arg = node.arguments[0];
  if (arg === undefined) return null;
  const inner = unwrap(arg);
  return ts.isIdentifier(inner) ||
    ts.isPropertyAccessExpression(inner) ||
    ts.isElementAccessExpression(inner)
    ? inner.getText(sf)
    : null;
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
  kind: string;
  text: string;
}

interface ScanResult {
  unscoped: Finding[];
  scopedOnlyCallsOutside: Finding[];
  unreviewedVariableDispatches: Finding[];
  variableDispatchKeys: string[];
  total: number;
}

/** Scan one source text; `rel` is its path under src, `/`-separated. */
function scanSource(rel: string, text: string, out: ScanResult): void {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node) => {
    const where = `${rel}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
    const fn = enclosingFunctionName(node);
    const scoped = insideSdkDispatch(node) || (fn !== null && SCOPED_ONLY_FUNCTIONS.has(fn));
    const kind = activationKind(node, sf);
    if (kind !== null) {
      out.total++;
      if (!scoped) out.unscoped.push({ where, kind, text: node.getText(sf) });
    }
    const varArg = variableDispatchArg(node, sf);
    if (varArg !== null) {
      const key = `${rel}::${fn ?? '<top level>'}::${varArg}`;
      out.variableDispatchKeys.push(key);
      if (!scoped && !VARIABLE_DISPATCH_ALLOWLIST.has(key)) {
        out.unreviewedVariableDispatches.push({ where, kind: 'variable-dispatch', text: key });
      }
    }
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name && SCOPED_ONLY_FUNCTIONS.has(name) && !insideSdkDispatch(node)) {
        out.scopedOnlyCallsOutside.push({
          where,
          kind: 'scoped-only-call',
          text: node.getText(sf),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function emptyResult(): ScanResult {
  return {
    unscoped: [],
    scopedOnlyCallsOutside: [],
    unreviewedVariableDispatches: [],
    variableDispatchKeys: [],
    total: 0,
  };
}

function scan(): ScanResult {
  const out = emptyResult();
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    scanSource(rel, fs.readFileSync(file, 'utf8'), out);
  }
  return out;
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

  it('a dispatchEvent of an event built elsewhere runs inside sdkDispatch or was reviewed', () => {
    expect(result.unreviewedVariableDispatches).toEqual([]);
  });

  it('every reviewed variable dispatch still exists (no stale allowlist entry)', () => {
    const stale = [...VARIABLE_DISPATCH_ALLOWLIST].filter(
      (key) => !result.variableDispatchKeys.includes(key)
    );
    expect(stale).toEqual([]);
  });

  it('flags every guarded shape in planted source, and none of them inside sdkDispatch', () => {
    const planted = emptyResult();
    scanSource(
      'planted/violations.ts',
      [
        'function plant(el: HTMLElement, form: HTMLFormElement, ev: Event) {',
        '  el.click();',
        '  form.requestSubmit();',
        "  document.execCommand('copy');",
        "  el.dispatchEvent(new MouseEvent('click'));",
        "  const built = new PointerEvent('click');",
        '  HTMLElement.prototype.click.call(el);',
        '  el.dispatchEvent(ev);',
        '  return built;',
        '}',
        'function scoped(el: HTMLElement, ev: Event) {',
        '  sdkDispatch(() => {',
        '    el.click();',
        '    el.dispatchEvent(ev);',
        "    el.dispatchEvent(new MouseEvent('click'));",
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
      'indirect-call',
    ]);
    expect(planted.unreviewedVariableDispatches.map((f) => f.text)).toEqual([
      'planted/violations.ts::plant::ev',
    ]);
  });
});
