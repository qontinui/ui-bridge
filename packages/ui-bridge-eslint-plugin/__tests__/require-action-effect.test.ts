import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RuleTester } from '@typescript-eslint/rule-tester';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { clearModuleCache, requireActionEffectRule } from '../src/rules/require-action-effect';

// Wire RuleTester to vitest globals — required since v6.
RuleTester.afterAll = afterAll;
RuleTester.it = it;
RuleTester.itOnly = it.only;
RuleTester.describe = describe;

/**
 * A real directory on disk, because the interesting half of this rule is
 * cross-file: the runner's `create-plain-terminal` action is built by a factory
 * imported from a sibling module, and a rule that only sees inline literals
 * would pass over it in silence. Fixtures written to a temp dir let the test
 * exercise the same filesystem resolution the rule does in anger, rather than
 * a mock of it.
 */
const fixtureRoot = mkdtempSync(join(tmpdir(), 'require-action-effect-'));

function fixture(name: string, code: string): string {
  const file = join(fixtureRoot, name);
  writeFileSync(file, code, 'utf8');
  return file;
}

beforeAll(() => {
  // Mirrors qontinui-runner/src/components/terminal/createPlainTerminalAction.ts:
  // a pure factory whose returned object carries the annotation.
  fixture(
    'annotated-factory.ts',
    `export interface ActionDef {
  id: string;
  effect: "read" | "write" | "destructive";
  handler: () => Promise<void>;
}

export function buildCreatePlainTerminalAction(create: () => Promise<void>): ActionDef {
  return {
    id: "create-plain-terminal",
    label: "Create Plain Terminal",
    effect: "write",
    handler: create,
  };
}
`
  );

  fixture(
    'unannotated-factory.ts',
    `export function buildUnannotatedAction(handler) {
  return {
    id: "wipe-everything",
    label: "Wipe Everything",
    handler,
  };
}
`
  );

  // A re-export barrel, so the import-following also covers `export … from`.
  fixture(
    'factory-barrel.ts',
    `export { buildCreatePlainTerminalAction } from "./annotated-factory";\n`
  );

  // A factory whose return this rule genuinely cannot reduce: the object comes
  // from a parameter. Must be reported as UNRESOLVED, never as annotated.
  fixture(
    'opaque-factory.ts',
    `export function buildFromParam(base) {
  return base;
}
`
  );

  // The runner's factory names its action with an exported const rather than a
  // bare literal, and the report has to resolve through it or send the author
  // hunting for `<action #1>`.
  fixture(
    'const-id-factory.ts',
    `export const CREATE_PLAIN_TERMINAL_ACTION_ID = "create-plain-terminal";

export function buildConstIdAction(handler) {
  return {
    id: CREATE_PLAIN_TERMINAL_ACTION_ID,
    label: "Create Plain Terminal",
    handler,
  };
}
`
  );

  // A module the borrowed parser cannot read. Unparseable must report, not pass.
  fixture('broken-factory.ts', `export function buildBroken( {{{ !!! \n`);
});

afterAll(() => {
  clearModuleCache();
  rmSync(fixtureRoot, { recursive: true, force: true });
});

const ruleTester = new RuleTester({
  languageOptions: {
    parser: require('@typescript-eslint/parser'),
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      ecmaFeatures: { jsx: true },
    },
  },
});

const inFixtures = (name: string): string => join(fixtureRoot, name);

ruleTester.run('require-action-effect', requireActionEffectRule, {
  valid: [
    {
      name: 'every inline action declares an effect',
      filename: inFixtures('ok-inline.ts'),
      code: `useUIComponent({
        id: "terminal-page",
        actions: [
          { id: "list-terminals", effect: "read", handler: () => [] },
          { id: "create-terminal", effect: "write", handler: () => {} },
          { id: "close-terminal", effect: "destructive", handler: () => {} },
        ],
      });`,
    },
    {
      name: 'a registration with no actions key registers no actions',
      filename: inFixtures('ok-no-actions.ts'),
      code: `useUIComponent({ id: "page-help", name: "Help" });`,
    },
    {
      name: 'an empty actions array is vacuously fine',
      filename: inFixtures('ok-empty.ts'),
      code: `useUIComponent({ id: "page-x", actions: [] });`,
    },
    {
      name: 'a non-useUIComponent call is not this rule’s business',
      filename: inFixtures('ok-other-hook.ts'),
      code: `useSomethingElse({ id: "x", actions: [{ id: "a" }] });`,
    },
    {
      name: 'element-level customActions are Phase 4, deliberately out of scope',
      filename: inFixtures('ok-custom-actions.ts'),
      code: `useUIElement({ id: "term", customActions: { sendKeys: { handler: () => {} } } });`,
    },
    {
      name: 'a factory imported from a sibling module is FOLLOWED to its annotated return',
      filename: inFixtures('ok-factory.ts'),
      code: `import { buildCreatePlainTerminalAction } from "./annotated-factory";
      useUIComponent({
        id: "terminal-page",
        actions: [
          { id: "create-terminal", effect: "write", handler: () => {} },
          buildCreatePlainTerminalAction(async () => {}),
        ],
      });`,
    },
    {
      name: 'the factory is followed through an `export … from` barrel too',
      filename: inFixtures('ok-barrel.ts'),
      code: `import { buildCreatePlainTerminalAction } from "./factory-barrel";
      useUIComponent({ id: "terminal-page", actions: [buildCreatePlainTerminalAction(async () => {})] });`,
    },
    {
      name: 'a locally declared factory is followed',
      filename: inFixtures('ok-local-factory.ts'),
      code: `function buildAction() {
        return { id: "refresh", effect: "read", handler: () => {} };
      }
      useUIComponent({ id: "projects-page", actions: [buildAction()] });`,
    },
    {
      name: 'a local const action object is followed',
      filename: inFixtures('ok-local-const.ts'),
      code: `const refreshAction = { id: "refresh", effect: "read", handler: () => {} };
      useUIComponent({ id: "scheduler-tab", actions: [refreshAction] });`,
    },
    {
      name: 'a spread that demonstrably supplies the effect is accepted',
      filename: inFixtures('ok-spread-object.ts'),
      code: `const base = { effect: "read" };
      useUIComponent({ id: "c", actions: [{ ...base, id: "refresh", handler: () => {} }] });`,
    },
    {
      name: 'an actions array held in a local const is still enumerated',
      filename: inFixtures('ok-const-array.ts'),
      code: `const actions = [{ id: "refresh", effect: "read", handler: () => {} }];
      useUIComponent({ id: "c", actions });`,
    },
    {
      name: 'spreading a local array literal of annotated actions is enumerated',
      filename: inFixtures('ok-spread-array.ts'),
      code: `const extra = [{ id: "open", effect: "write", handler: () => {} }];
      useUIComponent({ id: "c", actions: [{ id: "refresh", effect: "read", handler: () => {} }, ...extra] });`,
    },
    {
      name: 'colliding ids on DIFFERENT components are each satisfied on their own merits',
      filename: inFixtures('ok-collision.ts'),
      code: `useUIComponent({ id: "projects-page", actions: [{ id: "refresh", effect: "read", handler: () => {} }] });
      useUIComponent({ id: "scheduler-tab", actions: [{ id: "refresh", effect: "write", handler: () => {} }] });
      useUIComponent({ id: "projects-detail", actions: [{ id: "refresh", effect: "destructive", handler: () => {} }] });`,
    },
    {
      name: 'a `satisfies`-wrapped registration is still inspected',
      filename: inFixtures('ok-satisfies.ts'),
      code: `useUIComponent({ id: "c", actions: [{ id: "a", effect: "read", handler: () => {} }] } satisfies object);`,
    },
    {
      name: 'a template-literal component id is reported verbatim, never keyed on',
      filename: inFixtures('ok-template-id.ts'),
      code: 'useUIComponent({ id: `page-${id}`, actions: [{ id: "a", effect: "read", handler: () => {} }] });',
    },
    {
      name: 'a configured import alias is followed',
      filename: inFixtures('ok-alias.ts'),
      options: [{ importAliases: { '@/': fixtureRoot } }],
      code: `import { buildCreatePlainTerminalAction } from "@/annotated-factory";
      useUIComponent({ id: "terminal-page", actions: [buildCreatePlainTerminalAction(async () => {})] });`,
    },
    {
      name: 'a registration held in a local const is resolved and checked',
      filename: inFixtures('ok-const-registration.ts'),
      code: `const registration = {
        id: "c",
        actions: [{ id: "a", effect: "read", handler: () => {} }],
      };
      useUIComponent(registration);`,
    },
    {
      name: 'a custom hook name can be registered',
      filename: inFixtures('ok-hook-names.ts'),
      options: [{ hookNames: ['useUIComponent', 'registerComponent'] }],
      code: `registerComponent({ id: "c", actions: [{ id: "a", effect: "write", handler: () => {} }] });`,
    },
  ],

  invalid: [
    {
      name: 'an inline action with no effect is flagged, named by component AND action',
      filename: inFixtures('bad-inline.ts'),
      code: `useUIComponent({
        id: "terminal-page",
        actions: [{ id: "close-terminal", label: "Close", handler: () => {} }],
      });`,
      errors: [
        {
          messageId: 'missingActionEffect',
          data: { component: 'terminal-page', action: 'close-terminal' },
        },
      ],
    },
    {
      name: 'each unannotated action in one registration is flagged separately',
      filename: inFixtures('bad-two.ts'),
      code: `useUIComponent({
        id: "projects-page",
        actions: [
          { id: "refresh", handler: () => {} },
          { id: "open", effect: "write", handler: () => {} },
          { id: "delete", handler: () => {} },
        ],
      });`,
      errors: [
        {
          messageId: 'missingActionEffect',
          data: { component: 'projects-page', action: 'refresh' },
        },
        {
          messageId: 'missingActionEffect',
          data: { component: 'projects-page', action: 'delete' },
        },
      ],
    },
    {
      name: 'colliding ids are distinguished by component in the message',
      filename: inFixtures('bad-collision.ts'),
      code: `useUIComponent({ id: "projects-page", actions: [{ id: "refresh", handler: () => {} }] });
      useUIComponent({ id: "scheduler-tab", actions: [{ id: "refresh", handler: () => {} }] });`,
      errors: [
        {
          messageId: 'missingActionEffect',
          data: { component: 'projects-page', action: 'refresh' },
        },
        {
          messageId: 'missingActionEffect',
          data: { component: 'scheduler-tab', action: 'refresh' },
        },
      ],
    },
    {
      name: 'a factory whose returned object lacks an effect is flagged AT THE CALL SITE',
      filename: inFixtures('bad-factory.ts'),
      code: `import { buildUnannotatedAction } from "./unannotated-factory";
      useUIComponent({ id: "terminal-page", actions: [buildUnannotatedAction(() => {})] });`,
      errors: [
        {
          messageId: 'missingActionEffect',
          data: { component: 'terminal-page', action: 'wipe-everything' },
        },
      ],
    },
    {
      name: 'a factory this rule cannot reduce is UNRESOLVED, not silently annotated',
      filename: inFixtures('bad-opaque-factory.ts'),
      code: `import { buildFromParam } from "./opaque-factory";
      useUIComponent({ id: "terminal-page", actions: [buildFromParam({ id: "x" })] });`,
      errors: [
        {
          messageId: 'unresolvedActionEffect',
          data: {
            index: '0',
            component: 'terminal-page',
            reason:
              '"base" is not declared in a block this rule can see (a function parameter, a namespace import, or a binding outside this file)',
          },
        },
      ],
    },
    {
      name: 'a factory imported from an unresolvable module is UNRESOLVED',
      filename: inFixtures('bad-missing-module.ts'),
      code: `import { buildThing } from "./does-not-exist";
      useUIComponent({ id: "c", actions: [buildThing()] });`,
      errors: [
        {
          messageId: 'unresolvedActionEffect',
          data: {
            index: '0',
            component: 'c',
            reason:
              'the import "./does-not-exist" could not be resolved to a source file in this repository (bare package specifiers are not followed; configure `importAliases` for a path alias)',
          },
        },
      ],
    },
    {
      name: 'a bare package import is NOT followed into node_modules',
      filename: inFixtures('bad-bare-import.ts'),
      code: `import { buildThing } from "some-package";
      useUIComponent({ id: "c", actions: [buildThing()] });`,
      errors: [
        {
          messageId: 'unresolvedActionEffect',
          data: {
            index: '0',
            component: 'c',
            reason:
              'the import "some-package" could not be resolved to a source file in this repository (bare package specifiers are not followed; configure `importAliases` for a path alias)',
          },
        },
      ],
    },
    {
      name: 'a namespace-import factory is UNRESOLVED rather than assumed fine',
      filename: inFixtures('bad-namespace.ts'),
      code: `import * as factories from "./annotated-factory";
      useUIComponent({ id: "c", actions: [factories.buildCreatePlainTerminalAction()] });`,
      errors: [
        {
          messageId: 'unresolvedActionEffect',
          data: {
            index: '0',
            component: 'c',
            reason: 'the factory is not called through a plain identifier',
          },
        },
      ],
    },
    {
      name: 'an actions array forwarded from a parameter cannot be enumerated and is reported',
      filename: inFixtures('bad-forwarded.ts'),
      code: `export function usePageRegistration(id, name, description, actions) {
        useUIComponent({ id: \`page-\${id}\`, name, description, actions: actions || [] });
      }`,
      errors: [{ messageId: 'unenumerableActions' }],
    },
    {
      name: 'a spread of a non-enumerable array is reported, not skipped',
      filename: inFixtures('bad-spread.ts'),
      code: `export function f(extra) {
        useUIComponent({ id: "c", actions: [{ id: "a", effect: "read", handler: () => {} }, ...extra] });
      }`,
      errors: [
        {
          messageId: 'unresolvedActionEffect',
          data: {
            index: '1',
            component: 'c',
            reason: '"extra" does not resolve to an array literal in a block this rule can see',
          },
        },
      ],
    },
    {
      name: 'an object spread that supplies no effect is reported',
      filename: inFixtures('bad-spread-object.ts'),
      code: `const base = { label: "Refresh" };
      useUIComponent({ id: "c", actions: [{ ...base, id: "refresh", handler: () => {} }] });`,
      errors: [
        {
          messageId: 'unresolvedActionEffect',
          data: {
            index: '0',
            component: 'c',
            reason: 'the spread source declares no `effect` either',
          },
        },
      ],
    },
    {
      name: 'a cross-file action named by a const is reported under its RESOLVED id',
      filename: inFixtures('bad-const-id.ts'),
      code: `import { buildConstIdAction } from "./const-id-factory";
      useUIComponent({ id: "terminal-page", actions: [buildConstIdAction(() => {})] });`,
      errors: [
        {
          messageId: 'missingActionEffect',
          data: { component: 'terminal-page', action: 'create-plain-terminal' },
        },
      ],
    },
    {
      name: 'a factory module the borrowed parser cannot read is UNRESOLVED, not skipped',
      filename: inFixtures('bad-unparseable.ts'),
      code: `import { buildBroken } from "./broken-factory";
      useUIComponent({ id: "c", actions: [buildBroken()] });`,
      errors: [
        {
          messageId: 'unresolvedActionEffect',
          data: {
            index: '0',
            component: 'c',
            reason: '"./broken-factory" could not be read or parsed',
          },
        },
      ],
    },
    {
      name: 'an effect outside the three IREffect values is flagged',
      filename: inFixtures('bad-effect-value.ts'),
      code: `useUIComponent({ id: "c", actions: [{ id: "a", effect: "readonly", handler: () => {} }] });`,
      errors: [
        {
          messageId: 'invalidActionEffect',
          data: { component: 'c', action: 'a', value: 'readonly' },
        },
      ],
    },
    {
      name: 'an action with no id is still flagged, positionally',
      filename: inFixtures('bad-no-id.ts'),
      code: `useUIComponent({ id: "c", actions: [{ label: "Nameless", handler: () => {} }] });`,
      errors: [
        {
          messageId: 'missingActionEffect',
          data: { component: 'c', action: '<action #0 with no static id>' },
        },
      ],
    },
    {
      name: 'both branches of a conditional action are checked',
      filename: inFixtures('bad-conditional.ts'),
      code: `useUIComponent({
        id: "c",
        actions: [cond ? { id: "a", effect: "read", handler: () => {} } : { id: "b", handler: () => {} }],
      });`,
      errors: [{ messageId: 'missingActionEffect', data: { component: 'c', action: 'b' } }],
    },
    {
      name: 'a registration built elsewhere is UNRESOLVED, not skipped silently',
      filename: inFixtures('bad-opaque-registration.ts'),
      code: `export function register(config) {
        useUIComponent(config);
      }`,
      errors: [
        {
          messageId: 'unresolvedRegistration',
          data: {
            hook: 'useUIComponent',
            reason:
              '"config" is not declared in a block this rule can see (a function parameter, a namespace import, or a binding outside this file)',
          },
        },
      ],
    },
    {
      name: 'a registration held in a const WITHOUT an effect is still flagged by action id',
      filename: inFixtures('bad-const-registration.ts'),
      code: `const registration = { id: "c", actions: [{ id: "a", handler: () => {} }] };
      useUIComponent(registration);`,
      errors: [{ messageId: 'missingActionEffect', data: { component: 'c', action: 'a' } }],
    },
    {
      name: 'a MemberExpression-called hook is still inspected',
      filename: inFixtures('bad-member-hook.ts'),
      code: `bridge.useUIComponent({ id: "c", actions: [{ id: "a", handler: () => {} }] });`,
      errors: [{ messageId: 'missingActionEffect', data: { component: 'c', action: 'a' } }],
    },
  ],
});

/**
 * The mutation check, as a test rather than as a one-off console session.
 *
 * A lint rule nobody has watched fail has not been shown to lint anything
 * [policy: `a-test-must-be-able-to-fail`]. `RuleTester` above proves the rule
 * reports on hand-written fixtures; this proves the FAILURE IS LOAD-BEARING —
 * that deleting one `effect` from an otherwise-passing registration is what
 * turns a clean run red, and that restoring it turns it green again.
 */
describe('mutation check — the rule is what makes the difference', () => {
  const { Linter } = require('eslint') as typeof import('eslint');

  function lint(code: string): { count: number; messages: string[] } {
    const linter = new Linter({ configType: 'flat' });
    const results = linter.verify(
      code,
      [
        {
          files: ['**/*.ts'],
          languageOptions: {
            parser: require('@typescript-eslint/parser'),
            parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
          },
          plugins: {
            'ui-bridge': { rules: { 'require-action-effect': requireActionEffectRule } },
          },
          rules: { 'ui-bridge/require-action-effect': 'error' },
        },
      ] as never,
      'mutation.ts'
    );
    return {
      count: results.length,
      messages: results.map((m) => `${m.severity === 2 ? 'error' : 'warning'} ${m.message}`),
    };
  }

  const annotated = `useUIComponent({
    id: "terminal-page",
    actions: [
      { id: "create-terminal", effect: "write", handler: () => {} },
      { id: "list-terminals", effect: "read", handler: () => {} },
    ],
  });`;

  const mutated = annotated.replace(' effect: "read",', '');

  it('the mutation really removed something (the two sources differ)', () => {
    expect(mutated).not.toBe(annotated);
  });

  it('is green on the annotated source', () => {
    expect(lint(annotated)).toEqual({ count: 0, messages: [] });
  });

  it('goes red at severity 2 when one effect is deleted, naming that action', () => {
    const result = lint(mutated);
    expect(result.count).toBe(1);
    expect(result.messages[0]).toContain('error');
    expect(result.messages[0]).toContain('`terminal-page.list-terminals` declares no `effect`');
  });

  it('goes green again when the annotation is restored', () => {
    expect(
      lint(mutated.replace('{ id: "list-terminals",', '{ id: "list-terminals", effect: "read",'))
    ).toEqual({
      count: 0,
      messages: [],
    });
  });
});
