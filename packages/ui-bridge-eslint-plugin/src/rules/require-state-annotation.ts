import { ESLintUtils, AST_NODE_TYPES, TSESTree } from '@typescript-eslint/utils';

/**
 * Names of the IR primitive components that self-annotate. JSX rendering of
 * these directly is always fine — the IR builder picks them up.
 */
const IR_PRIMITIVES = new Set(['State', 'TransitionTo']);

/**
 * Default globs whose conditional rendering should never trigger the rule.
 * Tests legitimately render different branches; storybook stories likewise.
 */
const DEFAULT_TEST_GLOBS = ['**/*.test.{ts,tsx}', '**/__tests__/**', '**/*.stories.{ts,tsx}'];

export interface Options {
  testGlobs?: string[];
}

export type RuleOptions = [Options?];
export type MessageIds = 'requireStateAnnotation';

const createRule = ESLintUtils.RuleCreator(
  (name) =>
    `https://github.com/qontinui/ui-bridge/tree/main/packages/ui-bridge-eslint-plugin#${name}`
);

/**
 * Convert one of our default-test glob patterns into a regex string. We support
 * a tiny subset that's enough for common cases:
 *   `**\/`  → match any path prefix (zero or more segments)
 *   `*`     → match anything except `/`
 *   `{a,b}` → alternation
 *   `.`     → literal dot
 *
 * We avoid pulling in a real glob library to keep the plugin dependency-light.
 */
function globToRegex(glob: string): RegExp {
  let out = '';
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (glob.startsWith('**/', i)) {
      out += '(?:.*/)?';
      i += 3;
      continue;
    }
    if (ch === '*') {
      out += '[^/]*';
      i += 1;
      continue;
    }
    if (ch === '{') {
      const close = glob.indexOf('}', i);
      if (close === -1) {
        out += '\\{';
        i += 1;
        continue;
      }
      const alts = glob.slice(i + 1, close).split(',');
      out += '(?:' + alts.map((a) => a.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|') + ')';
      i = close + 1;
      continue;
    }
    if (/[.+^$()|[\]\\]/.test(ch)) {
      out += '\\' + ch;
    } else {
      out += ch;
    }
    i += 1;
  }
  return new RegExp('^' + out + '$');
}

function matchesAnyGlob(filename: string, globs: readonly string[]): boolean {
  // Normalize separators for cross-platform consistency.
  const normalized = filename.replace(/\\/g, '/');
  return globs.some((g) => globToRegex(g).test(normalized));
}

/**
 * Returns the JSX tag name (the `Foo` in `<Foo />`), or `null` if the opening
 * element doesn't use a plain JSXIdentifier (e.g. `<a.b />` — namespaced or
 * member expressions are out of scope for this rule).
 */
function getJSXTagName(opening: TSESTree.JSXOpeningElement): string | null {
  if (opening.name.type === AST_NODE_TYPES.JSXIdentifier) {
    return opening.name.name;
  }
  return null;
}

function isComponentName(name: string): boolean {
  // React convention: components start with an uppercase letter.
  return /^[A-Z]/.test(name);
}

/**
 * A flagged JSX element is one that:
 *   - is a JSXElement
 *   - has a tag name starting with an uppercase letter
 *   - is NOT one of the IR primitives (State / TransitionTo)
 */
function isFlaggableComponentElement(
  node: TSESTree.Node | null | undefined
): node is TSESTree.JSXElement {
  if (!node || node.type !== AST_NODE_TYPES.JSXElement) {
    return false;
  }
  const tag = getJSXTagName(node.openingElement);
  if (tag === null) return false;
  if (IR_PRIMITIVES.has(tag)) return false;
  return isComponentName(tag);
}

/**
 * Walk children of a JSXElement and return true if any of them is an IR
 * primitive (`<State>` or `<TransitionTo>`). We only inspect direct children —
 * the whole point is that a sibling annotation right next to the conditional
 * gives the IR builder enough information.
 */
function hasIRSiblingAnnotation(parent: TSESTree.JSXElement): boolean {
  for (const child of parent.children) {
    if (child.type !== AST_NODE_TYPES.JSXElement) continue;
    const tag = getJSXTagName(child.openingElement);
    if (tag !== null && IR_PRIMITIVES.has(tag)) {
      return true;
    }
  }
  return false;
}

/**
 * Walks up `node`'s ancestor chain to the nearest JSXElement enclosing the
 * JSXExpressionContainer that holds it. Returns `null` if the node isn't
 * inside a JSX expression (e.g. a `return cond && <Modal />` at function top
 * level — that's the component's own render, not a configuration boundary).
 */
function findEnclosingJSXElement(node: TSESTree.Node): TSESTree.JSXElement | null {
  let current: TSESTree.Node | undefined = node.parent;
  let sawExpressionContainer = false;
  while (current) {
    if (current.type === AST_NODE_TYPES.JSXExpressionContainer) {
      sawExpressionContainer = true;
    }
    if (current.type === AST_NODE_TYPES.JSXElement) {
      return sawExpressionContainer ? current : null;
    }
    if (current.type === AST_NODE_TYPES.JSXFragment) {
      return sawExpressionContainer ? null : null;
    }
    current = current.parent;
  }
  return null;
}

export const requireStateAnnotationRule = createRule<RuleOptions, MessageIds>({
  name: 'require-state-annotation',
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Warn on conditional JSX rendering at configuration boundaries that the UI Bridge IR builder cannot statically pick up.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          testGlobs: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Globs whose files are exempt from this rule (default covers tests + stories).',
          },
        },
      },
    ],
    messages: {
      requireStateAnnotation:
        'Conditional rendering of <{{name}}> may hide a UI configuration from the IR builder. Wrap one of the branches in <State> or <TransitionTo>, or annotate the parent component with a <State> declaration.',
    },
  },
  defaultOptions: [{}],
  create(context, [optionsRaw]) {
    const options = optionsRaw ?? {};
    const testGlobs = options.testGlobs ?? DEFAULT_TEST_GLOBS;

    const filename = context.filename ?? context.getFilename?.() ?? '';
    if (filename && matchesAnyGlob(filename, testGlobs)) {
      // File is exempt — return an empty visitor.
      return {};
    }

    function reportIfNeeded(branch: TSESTree.Node | null | undefined): void {
      if (!isFlaggableComponentElement(branch)) return;
      const enclosing = findEnclosingJSXElement(branch);
      if (!enclosing) return;
      if (hasIRSiblingAnnotation(enclosing)) return;
      const tag = getJSXTagName(branch.openingElement);
      if (tag === null) return;
      context.report({
        node: branch,
        messageId: 'requireStateAnnotation',
        data: { name: tag },
      });
    }

    return {
      'LogicalExpression[operator="&&"]'(node: TSESTree.LogicalExpression) {
        reportIfNeeded(node.right);
      },
      ConditionalExpression(node: TSESTree.ConditionalExpression) {
        reportIfNeeded(node.consequent);
        reportIfNeeded(node.alternate);
      },
    };
  },
});

export default requireStateAnnotationRule;
