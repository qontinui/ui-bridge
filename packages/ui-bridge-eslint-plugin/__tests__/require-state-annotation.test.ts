import { RuleTester } from '@typescript-eslint/rule-tester';
import { afterAll, describe, it } from 'vitest';

import { requireStateAnnotationRule } from '../src/rules/require-state-annotation';

// Wire RuleTester to vitest globals — required since v6.
RuleTester.afterAll = afterAll;
RuleTester.it = it;
RuleTester.itOnly = it.only;
RuleTester.describe = describe;

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

ruleTester.run('require-state-annotation', requireStateAnnotationRule, {
  valid: [
    {
      name: 'host element conditional render is fine',
      code: `const C = () => <div>{x && <span />}</div>;`,
    },
    {
      name: 'sibling <State> annotates the conditional',
      code: `const C = () => <div>{x && <Modal />}<State id="open" /></div>;`,
    },
    {
      name: '<State> itself in conditional is fine',
      code: `const C = () => <div>{x && <State id="open" />}</div>;`,
    },
    {
      name: '<TransitionTo> itself in conditional is fine',
      code: `const C = () => <div>{x && <TransitionTo to="next" />}</div>;`,
    },
    {
      name: 'top-level return value (not inside JSX expression) is not flagged',
      code: `function f() { return cond && <Modal />; }`,
    },
    {
      name: 'sibling <TransitionTo> also annotates',
      code: `const C = () => <div>{x && <Sheet />}<TransitionTo to="other" /></div>;`,
    },
    {
      name: 'ternary with both host elements is fine',
      code: `const C = () => <div>{x ? <span /> : <em />}</div>;`,
    },
    {
      name: 'test file glob exempts the rule',
      filename: 'foo.test.tsx',
      code: `const C = () => <div>{x && <Modal />}</div>;`,
    },
    {
      name: '__tests__ folder glob exempts the rule',
      filename: '/proj/src/__tests__/foo.tsx',
      code: `const C = () => <div>{x && <Modal />}</div>;`,
    },
    {
      name: 'storybook file glob exempts the rule',
      filename: 'foo.stories.tsx',
      code: `const C = () => <div>{x && <Modal />}</div>;`,
    },
  ],
  invalid: [
    {
      name: 'short-circuit && conditional with component is flagged',
      code: `const C = () => <div>{open && <LoginModal />}</div>;`,
      errors: [
        {
          messageId: 'requireStateAnnotation',
          data: { name: 'LoginModal' },
        },
      ],
    },
    {
      name: 'ternary with both branches as components is flagged on each branch',
      code: `const C = () => <div>{open ? <Yes /> : <No />}</div>;`,
      errors: [
        { messageId: 'requireStateAnnotation', data: { name: 'Yes' } },
        { messageId: 'requireStateAnnotation', data: { name: 'No' } },
      ],
    },
    {
      name: 'conditional component without sibling annotation is flagged',
      code: `const C = () => <section>{ready && <Banner />}</section>;`,
      errors: [{ messageId: 'requireStateAnnotation', data: { name: 'Banner' } }],
    },
    {
      name: 'unrelated sibling does not satisfy the annotation requirement',
      code: `const C = () => <div>{open && <Modal />}<Footer /></div>;`,
      errors: [{ messageId: 'requireStateAnnotation', data: { name: 'Modal' } }],
    },
    {
      name: 'test glob can be overridden via options',
      filename: 'foo.test.tsx',
      options: [{ testGlobs: ['**/*.spec.{ts,tsx}'] }],
      code: `const C = () => <div>{x && <Modal />}</div>;`,
      errors: [{ messageId: 'requireStateAnnotation', data: { name: 'Modal' } }],
    },
  ],
});
