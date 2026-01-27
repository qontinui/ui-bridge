/**
 * UI Bridge Babel Plugin
 *
 * Automatically instruments React components with UI Bridge IDs and aliases.
 *
 * @example
 * ```js
 * // babel.config.js
 * module.exports = {
 *   plugins: [
 *     ['@qontinui/ui-bridge-babel-plugin', {
 *       elements: ['button', 'input', 'a'],
 *       idPrefix: 'ui',
 *     }]
 *   ]
 * };
 * ```
 *
 * @example
 * ```jsx
 * // Input
 * <button onClick={handleSubmit}>Submit</button>
 *
 * // Output
 * <button
 *   onClick={handleSubmit}
 *   data-ui-id="ui-component-submit-button"
 *   data-ui-aliases="submit,send,go,confirm"
 *   data-ui-type="button"
 * >
 *   Submit
 * </button>
 * ```
 */

import { declare } from '@babel/helper-plugin-utils';
import type { PluginObj, NodePath, BabelFile } from '@babel/core';
import type * as t from '@babel/types';
import {
  type PluginConfig,
  mergeConfig,
  shouldProcessFile,
} from './config';
import {
  generateId,
  getNextElementIndex,
  resetFileCounters,
  getSemanticType,
  type IdGeneratorContext,
} from './id-generator';
import {
  generateAliases,
  formatAliasesAttribute,
  shouldGenerateAliases,
  type AliasGeneratorContext,
} from './alias-generator';

export type { PluginConfig } from './config';

/**
 * State tracked during file transformation
 */
interface PluginState {
  filename: string;
  config: Required<PluginConfig>;
  componentStack: string[];
  processed: Set<string>;
}

/**
 * Extract text content from JSX children
 */
function extractTextContent(
  children: (t.JSXElement | t.JSXText | t.JSXExpressionContainer | t.JSXSpreadChild | t.JSXFragment)[],
  types: typeof t
): string | null {
  const textParts: string[] = [];

  for (const child of children) {
    if (types.isJSXText(child)) {
      const text = child.value.trim();
      if (text) {
        textParts.push(text);
      }
    }
  }

  return textParts.length > 0 ? textParts.join(' ') : null;
}

/**
 * Get attribute value from JSX element
 */
function getAttributeValue(
  element: t.JSXOpeningElement,
  attrName: string,
  types: typeof t
): string | null {
  for (const attr of element.attributes) {
    if (types.isJSXAttribute(attr) && types.isJSXIdentifier(attr.name)) {
      if (attr.name.name === attrName) {
        if (types.isStringLiteral(attr.value)) {
          return attr.value.value;
        }
        if (types.isJSXExpressionContainer(attr.value)) {
          if (types.isStringLiteral(attr.value.expression)) {
            return attr.value.expression.value;
          }
        }
      }
    }
  }
  return null;
}

/**
 * Check if element has a specific attribute
 */
function hasAttribute(
  element: t.JSXOpeningElement,
  attrName: string,
  types: typeof t
): boolean {
  return element.attributes.some(
    (attr) =>
      types.isJSXAttribute(attr) &&
      types.isJSXIdentifier(attr.name) &&
      attr.name.name === attrName
  );
}

/**
 * Add attribute to JSX element
 */
function addAttribute(
  element: t.JSXOpeningElement,
  name: string,
  value: string,
  types: typeof t
): void {
  element.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier(name),
      types.stringLiteral(value)
    )
  );
}

/**
 * Get tag name from JSX element
 */
function getTagName(element: t.JSXOpeningElement, types: typeof t): string | null {
  if (types.isJSXIdentifier(element.name)) {
    return element.name.name;
  }
  if (types.isJSXMemberExpression(element.name)) {
    // Handle Component.SubComponent
    return null; // Skip member expressions
  }
  return null;
}

/**
 * Check if tag is a lowercase HTML element (not a React component)
 */
function isHtmlElement(tagName: string): boolean {
  return tagName[0] === tagName[0].toLowerCase();
}

/**
 * Find parent component name
 */
function findComponentName(path: NodePath<t.JSXElement>): string | null {
  let current: NodePath<t.Node> | null = path as NodePath<t.Node>;

  while (current) {
    const parent: NodePath<t.Node> | null = current.parentPath;

    if (!parent) break;

    // Check for function declaration
    if (parent.isFunctionDeclaration()) {
      const name = (parent.node as t.FunctionDeclaration).id?.name;
      if (name && name[0] === name[0].toUpperCase()) {
        return name;
      }
    }

    // Check for variable declarator with arrow function
    if (parent.isArrowFunctionExpression() || parent.isFunctionExpression()) {
      const varDeclarator = parent.parentPath;
      if (varDeclarator?.isVariableDeclarator()) {
        const id = (varDeclarator.node as t.VariableDeclarator).id;
        if (id && id.type === 'Identifier') {
          const name = id.name;
          if (name[0] === name[0].toUpperCase()) {
            return name;
          }
        }
      }
    }

    // Check for class method (render)
    if (parent.isClassMethod()) {
      const classDecl = parent.parentPath?.parentPath;
      if (classDecl?.isClassDeclaration()) {
        const name = (classDecl.node as t.ClassDeclaration).id?.name;
        if (name) {
          return name;
        }
      }
    }

    current = parent;
  }

  return null;
}

/**
 * Babel API interface
 */
interface BabelAPI {
  assertVersion(version: number): void;
  types: typeof t;
}

/**
 * The Babel plugin
 */
const uiBridgeBabelPlugin = declare<PluginConfig, PluginObj<PluginState>>(
  (api: BabelAPI, options: PluginConfig) => {
    api.assertVersion(7);

    const types = api.types;
    const config = mergeConfig(options);

    return {
      name: 'ui-bridge-babel-plugin',

      pre(this: PluginState, file: BabelFile) {
        const filename = file.opts.filename || 'unknown';
        this.filename = filename;
        this.config = config;
        this.componentStack = [];
        this.processed = new Set();

        // Reset element counters for this file
        resetFileCounters(filename);

        if (config.verbose) {
          console.log(`[ui-bridge-babel-plugin] Processing: ${filename}`);
        }
      },

      visitor: {
        JSXElement(this: PluginState, path: NodePath<t.JSXElement>) {
          const state = this;

          // Check if file should be processed
          if (!shouldProcessFile(state.filename, state.config)) {
            return;
          }

          const openingElement = path.node.openingElement;
          const tagName = getTagName(openingElement, types);

          // Skip if no tag name or not an HTML element
          if (!tagName || !isHtmlElement(tagName)) {
            return;
          }

          // Check if this element type should be instrumented
          if (!state.config.elements.includes(tagName as any)) {
            return;
          }

          // Skip if already has ui-id (unless configured otherwise)
          if (
            state.config.skipExisting &&
            hasAttribute(openingElement, state.config.idAttribute, types)
          ) {
            return;
          }

          // Find component name
          const componentName = findComponentName(path);

          // Check component filters
          if (state.config.onlyInComponents.length > 0) {
            if (!componentName || !state.config.onlyInComponents.includes(componentName)) {
              return;
            }
          }

          if (state.config.skipInComponents.length > 0) {
            if (componentName && state.config.skipInComponents.includes(componentName)) {
              return;
            }
          }

          // Extract element info
          const textContent = extractTextContent(
            path.node.children as any[],
            types
          );
          const ariaLabel = getAttributeValue(openingElement, 'aria-label', types);
          const placeholder = getAttributeValue(openingElement, 'placeholder', types);
          const title = getAttributeValue(openingElement, 'title', types);
          const name = getAttributeValue(openingElement, 'name', types);
          const existingId = getAttributeValue(openingElement, 'id', types);

          // Get element index for uniqueness
          const elementIndex = getNextElementIndex(state.filename, tagName);

          // Build context for ID generation
          const idContext: IdGeneratorContext = {
            componentName,
            filePath: state.filename,
            tagName,
            textContent,
            ariaLabel,
            placeholder,
            title,
            elementIndex,
            existingId,
          };

          // Generate ID
          const generatedId = generateId(idContext, state.config);

          // Skip if this exact ID was already generated (collision)
          if (state.processed.has(generatedId)) {
            // Add index suffix for uniqueness
            const uniqueId = `${generatedId}-${elementIndex}`;
            addAttribute(openingElement, state.config.idAttribute, uniqueId, types);
          } else {
            state.processed.add(generatedId);
            addAttribute(openingElement, state.config.idAttribute, generatedId, types);
          }

          // Add element type
          const semanticType = getSemanticType(tagName, idContext);
          addAttribute(openingElement, state.config.typeAttribute, semanticType, types);

          // Generate and add aliases
          const aliasContext: AliasGeneratorContext = {
            tagName,
            textContent,
            ariaLabel,
            placeholder,
            title,
            name,
            id: existingId,
          };

          if (shouldGenerateAliases(aliasContext, state.config)) {
            const aliases = generateAliases(aliasContext, state.config);
            if (aliases.length > 0) {
              addAttribute(
                openingElement,
                state.config.aliasesAttribute,
                formatAliasesAttribute(aliases),
                types
              );
            }
          }

          if (state.config.verbose) {
            console.log(
              `[ui-bridge-babel-plugin] Instrumented <${tagName}> as "${generatedId}"`
            );
          }
        },
      },

      post(this: PluginState) {
        if (this.config.verbose) {
          console.log(
            `[ui-bridge-babel-plugin] Finished processing: ${this.filename}`
          );
        }
      },
    };
  }
);

export default uiBridgeBabelPlugin;

// Named export for ESM compatibility
export { uiBridgeBabelPlugin };

// Re-export utilities for advanced usage
export { mergeConfig, shouldProcessFile, DEFAULT_CONFIG } from './config';
export {
  generateId,
  getSemanticType,
  extractComponentFromPath,
  resetFileCounters,
  getNextElementIndex,
  type IdGeneratorContext,
} from './id-generator';
export {
  generateAliases,
  formatAliasesAttribute,
  shouldGenerateAliases,
  type AliasGeneratorContext,
} from './alias-generator';
