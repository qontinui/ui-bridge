/**
 * Relay ↔ browser command-handler drift guard.
 *
 * Root-cause regression coverage for the SDK interaction-API parity gap:
 * `relay-handlers.ts` relays the app-agnostic interaction commands
 * (clickByText / clickBySelector / typeInto / readValue / findByText) over the
 * SDK command channel, but the browser-side executor (`react/commandHandlers.ts`)
 * had NO matching `case`, so every relayed call hit
 * `default: throw new Error('Unknown command action')`. The runner then
 * silently fell back to its own Tauri webview, masking the failure.
 *
 * The same defect recurred for `getElement`: relayed since 2026-03, never
 * served by the dispatcher, so every live read threw and the relay answered
 * from its cache (plan 2026-11-08-ui-bridge-inject-exec-mode-is-a-second-class-driver).
 * So the guard no longer stops at a hand-kept list. It pins the contract on
 * three fronts:
 *
 *   1. EVERY relayed action — every action literal the SDK queues for a
 *      browser, read from the TypeScript AST (never a regex: one missed the
 *      nested generic of `relayCommand<{… Record<string, unknown> …}>('expectElement'`)
 *      — has a browser case in `executeCommand`, or is on the ratcheted
 *      `KNOWN_UNSERVED_RELAY_ACTIONS` list. The count is ratcheted exactly, so
 *      an extraction that silently loses call sites fails too.
 *
 *   2. STATIC parity for the canonical interactions — every action in
 *      `INTERACTION_RELAY_COMMAND_ACTIONS` (server/types.ts) is both relayed
 *      and served.
 *
 *   3. FUNCTIONAL — `executeCommand` actually runs each interaction against a
 *      live (jsdom) DOM and produces the expected effect, never throwing
 *      `Unknown command action`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { INTERACTION_RELAY_COMMAND_ACTIONS } from './types';
import { executeCommand, type BridgeAccess } from '../react/commandHandlers';
import { resetGlobalRegistry } from '../core/registry';

const here = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = resolve(here, '..');
const commandHandlersSrc = readFileSync(resolve(here, '../react/commandHandlers.ts'), 'utf8');

/**
 * Relayed actions the in-page dispatcher does not serve. Each reaches a browser
 * that answers `Unknown command action`: a typed error through `relayCommand`,
 * or, through `relayWithFallback`, a `success` carrying the fallback default
 * with `fallback: true`, which reads as an empty answer.
 *
 * Owned by plan `2026-11-08-eight-relayed-ui-bridge-actions-have-no-browser-case`:
 * each one is served in the dispatcher or its relay route is deleted (delete
 * over deprecate). That plan was scoped from the eight `relayCommand` sites;
 * `getElementHistory` and `getRecentEffects` reach the browser through
 * `relayWithFallback`, which only this AST extraction reads, and belong to the
 * same work.
 *
 * Ratcheted both ways: an action that gains a browser case, or stops being
 * relayed, fails the guard until it leaves this list.
 */
const KNOWN_UNSERVED_RELAY_ACTIONS: readonly string[] = [
  'controlBatch',
  'executeBatchAction',
  'getDiagnostics',
  'getElementHistory',
  'getElementReactState',
  'getRecentEffects',
  'getRoutes',
  'navigateByAdapter',
  'query',
  'waitForElement',
];

/**
 * How many distinct action literals the SDK relays to a browser. Change it
 * only together with the relay call sites it counts: a drop with no relay
 * route removed means the extraction lost sight of a call shape.
 */
const RELAYED_ACTION_COUNT = 152;

/** The relay wrappers in the SDK — functions that forward their first parameter to `queueCommand`. */
const RELAY_WRAPPERS = [
  'server/relay-handlers.ts:relayCommand',
  'server/relay-handlers.ts:relayWithFallback',
];

/** Directories that hold test helpers, never SDK source. */
const TEST_ONLY_DIRS: ReadonlySet<string> = new Set(['__tests__', '__mocks__', '__fixtures__']);

/** Every non-test TypeScript source under `src/` that names `queueCommand`. */
function relaySourceFiles(dir: string = SRC_ROOT): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!TEST_ONLY_DIRS.has(entry.name)) out.push(...relaySourceFiles(abs));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|spec)\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith('.d.ts') &&
      readFileSync(abs, 'utf8').includes('queueCommand')
    ) {
      out.push(abs);
    }
  }
  return out;
}

function functionName(fn: ts.SignatureDeclaration): string | undefined {
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name) {
    return fn.name.getText();
  }
  if (
    (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
    ts.isVariableDeclaration(fn.parent)
  ) {
    return fn.parent.name.getText();
  }
  return undefined;
}

const isQueueCommand = (callee: ts.Expression): boolean =>
  ts.isPropertyAccessExpression(callee) && callee.name.text === 'queueCommand';

/**
 * Every action literal relayed to a browser: the first argument of each
 * `<x>.queueCommand(…)` call, and of each call to a relay wrapper — a function
 * whose first parameter it passes as the action of a `queueCommand` call
 * (`relayCommand`, `relayWithFallback`). Read from the AST, so generics of any
 * depth, comments and strings cannot hide or fake a call site.
 *
 * What it cannot read it reports as `unreadable` (an action that is not a
 * string literal outside a wrapper's own forwarding call), never skips.
 */
function extractRelayedActions(): {
  actions: Map<string, string[]>;
  wrappers: string[];
  unreadable: string[];
} {
  const actions = new Map<string, string[]>();
  const wrappers: string[] = [];
  const unreadable: string[] = [];
  for (const file of relaySourceFiles()) {
    const rel = relative(SRC_ROOT, file).split(sep).join('/');
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const at = (node: ts.Node) =>
      `${rel}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

    // Pass 1: the wrappers, by what they do.
    const local = new Set<string>();
    const forwarding = new Set<ts.Node>();
    const findWrappers = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && isQueueCommand(node.expression)) {
        const action = node.arguments[0];
        if (action && ts.isIdentifier(action)) {
          let fn: ts.Node | undefined = node.parent;
          while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
          const first = fn && ts.isFunctionLike(fn) ? fn.parameters[0] : undefined;
          const name = fn && ts.isFunctionLike(fn) ? functionName(fn) : undefined;
          if (first && ts.isIdentifier(first.name) && first.name.text === action.text && name) {
            local.add(name);
            forwarding.add(node);
            wrappers.push(`${rel}:${name}`);
          }
        }
      }
      ts.forEachChild(node, findWrappers);
    };
    findWrappers(sf);

    // Pass 2: every relay call site and its action literal.
    const collect = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        !forwarding.has(node) &&
        (isQueueCommand(node.expression) ||
          (ts.isIdentifier(node.expression) && local.has(node.expression.text)))
      ) {
        const action = node.arguments[0];
        if (action && (ts.isStringLiteral(action) || ts.isNoSubstitutionTemplateLiteral(action))) {
          actions.set(action.text, [...(actions.get(action.text) ?? []), at(node)]);
        } else {
          unreadable.push(at(node));
        }
      }
      ts.forEachChild(node, collect);
    };
    collect(sf);
  }
  return { actions, wrappers: wrappers.sort(), unreadable };
}

/**
 * The actions `executeCommand` serves: the `case` labels of its
 * `switch (action)` and its `action === '<x>'` arms, read from its own body
 * only — a `case 'click'` in the element-action switch serves no relayed
 * `click`.
 */
function servedActions(): Set<string> {
  const sf = ts.createSourceFile(
    'commandHandlers.ts',
    commandHandlersSrc,
    ts.ScriptTarget.Latest,
    true
  );
  let body: ts.Node | undefined;
  const find = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'executeCommand') body = node.body;
    if (!body) ts.forEachChild(node, find);
  };
  find(sf);
  if (!body) throw new Error('executeCommand not found in react/commandHandlers.ts');
  const served = new Set<string>();
  const isAction = (node: ts.Node) => ts.isIdentifier(node) && node.text === 'action';
  const visit = (node: ts.Node): void => {
    if (ts.isSwitchStatement(node) && isAction(node.expression)) {
      for (const clause of node.caseBlock.clauses) {
        if (ts.isCaseClause(clause) && ts.isStringLiteral(clause.expression)) {
          served.add(clause.expression.text);
        }
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      isAction(node.left) &&
      ts.isStringLiteral(node.right)
    ) {
      served.add(node.right.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return served;
}

const relayed = extractRelayedActions();
const served = servedActions();

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

/** `action (site, site)` for a failure message. */
const withSites = (actions: readonly string[]) =>
  actions.map((a) => `${a} (${(relayed.actions.get(a) ?? []).join(', ')})`).join('; ');

describe('relay ↔ commandHandlers drift guard · every relayed action has a browser case', () => {
  it('reads relay call sites from the AST: one per call shape (positive control)', () => {
    // relayCommand<{ … Record<string, unknown> … }>('expectElement', …): the
    // nested generic the old `(?:<[^>]*>)?` regex could not see.
    expect(relayed.actions.get('expectElement')).toEqual([
      expect.stringMatching(/^server\/relay-handlers\.ts:\d+$/),
    ]);
    // relayWithFallback('getRecentEffects', …): a wrapper call, not relayCommand.
    expect(relayed.actions.has('getRecentEffects')).toBe(true);
    // relay.queueCommand('tabActivate', …) in the Next.js adapter.
    expect(relayed.actions.get('tabActivate')).toEqual([
      expect.stringMatching(/^server\/nextjs\.ts:\d+$/),
    ]);
  });

  it('finds the relay wrappers by what they do: forward their first parameter to queueCommand', () => {
    expect(relayed.wrappers).toEqual(RELAY_WRAPPERS);
  });

  it('reads every relay call site: none passes an action it cannot read', () => {
    expect(relayed.unreadable, 'relay call sites whose action is not a string literal').toEqual([]);
  });

  it(`ratchets on the exact count: ${RELAYED_ACTION_COUNT} distinct relayed actions`, () => {
    expect(
      relayed.actions.size,
      'A relayed action was added or removed: update RELAYED_ACTION_COUNT with the relay ' +
        'route, and give a new action its browser case. A drop with no relay route removed ' +
        'means the extraction lost sight of a call shape.'
    ).toBe(RELAYED_ACTION_COUNT);
  });

  it('every relayed action is served by executeCommand, or is a known unserved one', () => {
    const missing = [...relayed.actions.keys()]
      .filter((a) => !served.has(a) && !KNOWN_UNSERVED_RELAY_ACTIONS.includes(a))
      .sort();
    expect(
      missing,
      `relayed with no browser case, so the browser answers 'Unknown command action': ` +
        `${withSites(missing)}. Serve each in executeCommand (react/commandHandlers.ts) or ` +
        `delete its relay route.`
    ).toEqual([]);
  });

  it('KNOWN_UNSERVED_RELAY_ACTIONS is ratcheted both ways', () => {
    const nowServed = KNOWN_UNSERVED_RELAY_ACTIONS.filter((a) => served.has(a));
    const noLongerRelayed = KNOWN_UNSERVED_RELAY_ACTIONS.filter((a) => !relayed.actions.has(a));
    expect(
      nowServed,
      'now have a browser case — remove them from KNOWN_UNSERVED_RELAY_ACTIONS'
    ).toEqual([]);
    expect(
      noLongerRelayed,
      'are no longer relayed — remove them from KNOWN_UNSERVED_RELAY_ACTIONS'
    ).toEqual([]);
  });
});

describe('relay ↔ commandHandlers drift guard · static parity', () => {
  it.each(INTERACTION_RELAY_COMMAND_ACTIONS)("relay-handlers.ts relays '%s'", (action) => {
    expect(
      (relayed.actions.get(action) ?? []).some((site) =>
        site.startsWith('server/relay-handlers.ts:')
      )
    ).toBe(true);
  });

  it.each(INTERACTION_RELAY_COMMAND_ACTIONS)(
    "commandHandlers.ts has a browser case for '%s'",
    (action) => {
      expect(served.has(action)).toBe(true);
    }
  );
});

describe('relay ↔ commandHandlers drift guard · functional', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    resetGlobalRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    resetGlobalRegistry();
  });

  it('none of the canonical interaction actions throw "Unknown command action"', async () => {
    for (const action of INTERACTION_RELAY_COMMAND_ACTIONS) {
      // Intentionally minimal payloads — we only assert the dispatcher
      // recognizes the action (no throw). Bad/empty payloads return a
      // structured `{success:false}` body, which is fine here.
      await expect(executeCommand(action, {}, emptyBridge)).resolves.toBeDefined();
    }
  });

  it('clickByText clicks a matching element in the live DOM', async () => {
    const btn = document.createElement('button');
    btn.textContent = 'Visual Editor';
    let clicked = false;
    btn.addEventListener('click', () => {
      clicked = true;
    });
    container.appendChild(btn);

    // Scope to the `button` tag — `findElementsByText` with the default `*`
    // selector returns ancestor containers (body/div) first in document order,
    // exactly like the standalone-server `clickByText`. The `tag` filter is
    // the documented way to target the interactive leaf.
    const result = (await executeCommand(
      'clickByText',
      { text: 'Visual', tag: 'button' },
      emptyBridge
    )) as { clicked?: boolean; element?: { tag?: string } };

    expect(clicked).toBe(true);
    expect(result.clicked).toBe(true);
    expect(result.element?.tag).toBe('button');
  });

  it('clickBySelector clicks the element matched by the selector', async () => {
    const btn = document.createElement('button');
    btn.id = 'go';
    let clicked = false;
    btn.addEventListener('click', () => {
      clicked = true;
    });
    container.appendChild(btn);

    const result = (await executeCommand('clickBySelector', { selector: '#go' }, emptyBridge)) as {
      clicked?: boolean;
    };

    expect(clicked).toBe(true);
    expect(result.clicked).toBe(true);
  });

  it('typeInto fills an input by selector and fires React-aware events', async () => {
    const input = document.createElement('input');
    input.id = 'name';
    let inputEvents = 0;
    let changeEvents = 0;
    input.addEventListener('input', () => {
      inputEvents++;
    });
    input.addEventListener('change', () => {
      changeEvents++;
    });
    container.appendChild(input);

    const result = (await executeCommand(
      'typeInto',
      { selector: '#name', text: 'hello' },
      emptyBridge
    )) as { typed?: boolean; element?: { value?: string } };

    expect(result.typed).toBe(true);
    expect(input.value).toBe('hello');
    expect(result.element?.value).toBe('hello');
    expect(inputEvents).toBeGreaterThan(0);
    expect(changeEvents).toBeGreaterThan(0);
  });

  it('typeInto resolves an input by associated label', async () => {
    const label = document.createElement('label');
    label.htmlFor = 'email';
    label.textContent = 'Email Address';
    const input = document.createElement('input');
    input.id = 'email';
    container.appendChild(label);
    container.appendChild(input);

    await executeCommand('typeInto', { label: 'Email', text: 'a@b.com' }, emptyBridge);

    expect(input.value).toBe('a@b.com');
  });

  it('readValue returns the value of the matched input', async () => {
    const input = document.createElement('input');
    input.id = 'token';
    input.value = 'abc123';
    container.appendChild(input);

    const result = (await executeCommand('readValue', { selector: '#token' }, emptyBridge)) as {
      value?: string | null;
      length?: number;
    };

    expect(result.value).toBe('abc123');
    expect(result.length).toBe(6);
  });

  it('findByText returns all matching elements as an array', async () => {
    const a = document.createElement('button');
    a.textContent = 'Save Draft';
    const b = document.createElement('button');
    b.textContent = 'Save Now';
    container.appendChild(a);
    container.appendChild(b);

    const result = (await executeCommand(
      'findByText',
      { text: 'Save', tag: 'button' },
      emptyBridge
    )) as Array<{ tag: string; text: string }>;

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    expect(result[0].tag).toBe('button');
  });

  it('returns a structured error (not a throw) for missing targets', async () => {
    const result = (await executeCommand(
      'clickByText',
      { text: 'does-not-exist-anywhere' },
      emptyBridge
    )) as { success?: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain('No element found');
  });
});
