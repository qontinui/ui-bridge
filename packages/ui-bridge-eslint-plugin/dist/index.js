import { ESLintUtils, AST_NODE_TYPES } from '@typescript-eslint/utils';

// src/rules/require-state-annotation.ts
var IR_PRIMITIVES = /* @__PURE__ */ new Set(["State", "TransitionTo"]);
var DEFAULT_TEST_GLOBS = ["**/*.test.{ts,tsx}", "**/__tests__/**", "**/*.stories.{ts,tsx}"];
var createRule = ESLintUtils.RuleCreator(
  (name) => `https://github.com/qontinui/ui-bridge/tree/main/packages/ui-bridge-eslint-plugin#${name}`
);
function globToRegex(glob) {
  let out = "";
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (glob.startsWith("**/", i)) {
      out += "(?:.*/)?";
      i += 3;
      continue;
    }
    if (ch === "*") {
      out += "[^/]*";
      i += 1;
      continue;
    }
    if (ch === "{") {
      const close = glob.indexOf("}", i);
      if (close === -1) {
        out += "\\{";
        i += 1;
        continue;
      }
      const alts = glob.slice(i + 1, close).split(",");
      out += "(?:" + alts.map((a) => a.replace(/[.+^$()|[\]\\]/g, "\\$&")).join("|") + ")";
      i = close + 1;
      continue;
    }
    if (/[.+^$()|[\]\\]/.test(ch)) {
      out += "\\" + ch;
    } else {
      out += ch;
    }
    i += 1;
  }
  return new RegExp("^" + out + "$");
}
function matchesAnyGlob(filename, globs) {
  const normalized = filename.replace(/\\/g, "/");
  return globs.some((g) => globToRegex(g).test(normalized));
}
function getJSXTagName(opening) {
  if (opening.name.type === AST_NODE_TYPES.JSXIdentifier) {
    return opening.name.name;
  }
  return null;
}
function isComponentName(name) {
  return /^[A-Z]/.test(name);
}
function isFlaggableComponentElement(node) {
  if (!node || node.type !== AST_NODE_TYPES.JSXElement) {
    return false;
  }
  const tag = getJSXTagName(node.openingElement);
  if (tag === null) return false;
  if (IR_PRIMITIVES.has(tag)) return false;
  return isComponentName(tag);
}
function hasIRSiblingAnnotation(parent) {
  for (const child of parent.children) {
    if (child.type !== AST_NODE_TYPES.JSXElement) continue;
    const tag = getJSXTagName(child.openingElement);
    if (tag !== null && IR_PRIMITIVES.has(tag)) {
      return true;
    }
  }
  return false;
}
function findEnclosingJSXElement(node) {
  let current = node.parent;
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
var requireStateAnnotationRule = createRule({
  name: "require-state-annotation",
  meta: {
    type: "suggestion",
    docs: {
      description: "Warn on conditional JSX rendering at configuration boundaries that the UI Bridge IR builder cannot statically pick up."
    },
    schema: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          testGlobs: {
            type: "array",
            items: { type: "string" },
            description: "Globs whose files are exempt from this rule (default covers tests + stories)."
          }
        }
      }
    ],
    messages: {
      requireStateAnnotation: "Conditional rendering of <{{name}}> may hide a UI configuration from the IR builder. Wrap one of the branches in <State> or <TransitionTo>, or annotate the parent component with a <State> declaration."
    }
  },
  defaultOptions: [{}],
  create(context, [optionsRaw]) {
    const options = optionsRaw ?? {};
    const testGlobs = options.testGlobs ?? DEFAULT_TEST_GLOBS;
    const filename = context.filename ?? context.getFilename?.() ?? "";
    if (filename && matchesAnyGlob(filename, testGlobs)) {
      return {};
    }
    function reportIfNeeded(branch) {
      if (!isFlaggableComponentElement(branch)) return;
      const enclosing = findEnclosingJSXElement(branch);
      if (!enclosing) return;
      if (hasIRSiblingAnnotation(enclosing)) return;
      const tag = getJSXTagName(branch.openingElement);
      if (tag === null) return;
      context.report({
        node: branch,
        messageId: "requireStateAnnotation",
        data: { name: tag }
      });
    }
    return {
      'LogicalExpression[operator="&&"]'(node) {
        reportIfNeeded(node.right);
      },
      ConditionalExpression(node) {
        reportIfNeeded(node.consequent);
        reportIfNeeded(node.alternate);
      }
    };
  }
});

// src/index.ts
var rules = {
  "require-state-annotation": requireStateAnnotationRule
};
var plugin = {
  meta: {
    name: "@qontinui/ui-bridge-eslint-plugin",
    version: "0.1.0"
  },
  rules,
  configs: {
    recommended: {
      plugins: ["ui-bridge"],
      rules: {
        "ui-bridge/require-state-annotation": "warn"
      }
    }
  }
};
var src_default = plugin;

export { src_default as default, requireStateAnnotationRule };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map