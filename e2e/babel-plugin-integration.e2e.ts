/**
 * Babel Plugin Integration E2E Tests
 *
 * Tests that the Babel plugin correctly instruments React components
 * with data-ui-id, data-ui-type, and data-ui-aliases attributes.
 */

import { describe, it, expect } from 'vitest';
import { transformSync } from '@babel/core';
// Import the babel plugin using relative path since workspaces may not resolve correctly
import uiBridgeBabelPlugin from '../packages/ui-bridge-babel-plugin/src/index';
import type { PluginConfig } from '../packages/ui-bridge-babel-plugin/src/config';

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Transform JSX code using the Babel plugin
 */
function transform(code: string, options: PluginConfig = {}): string {
  const result = transformSync(code, {
    plugins: [[uiBridgeBabelPlugin, options]],
    parserOpts: {
      plugins: ['jsx'],
    },
    filename: 'TestComponent.tsx',
  });

  return result?.code || '';
}

/**
 * Extract attribute value from transformed code
 */
function extractAttribute(code: string, attributeName: string): string | null {
  const regex = new RegExp(`${attributeName}="([^"]+)"`);
  const match = code.match(regex);
  return match ? match[1] : null;
}

/**
 * Check if code contains attribute
 */
function hasAttribute(code: string, attributeName: string): boolean {
  return code.includes(`${attributeName}=`);
}

// ============================================================================
// Test Suite: data-ui-id Generation
// ============================================================================

describe('Babel Plugin: data-ui-id generation', () => {
  it('should add data-ui-id to button elements', () => {
    const input = `<button>Click me</button>`;
    const output = transform(input);

    expect(hasAttribute(output, 'data-ui-id')).toBe(true);
    const id = extractAttribute(output, 'data-ui-id');
    expect(id).toBeDefined();
    expect(id!.length).toBeGreaterThan(0);
  });

  it('should add data-ui-id to input elements', () => {
    const input = `<input type="text" placeholder="Enter name" />`;
    const output = transform(input);

    expect(hasAttribute(output, 'data-ui-id')).toBe(true);
    const id = extractAttribute(output, 'data-ui-id');
    expect(id).toContain('enter-name');
  });

  it('should add data-ui-id to select elements', () => {
    const input = `<select><option>Option 1</option></select>`;
    const output = transform(input);

    expect(hasAttribute(output, 'data-ui-id')).toBe(true);
  });

  it('should add data-ui-id to anchor elements', () => {
    const input = `<a href="/home">Go Home</a>`;
    const output = transform(input);

    expect(hasAttribute(output, 'data-ui-id')).toBe(true);
    const id = extractAttribute(output, 'data-ui-id');
    expect(id!.toLowerCase()).toContain('go-home');
  });

  it('should add data-ui-id to form elements', () => {
    const input = `<form><input /></form>`;
    const output = transform(input);

    // Both form and input should have IDs
    const matches = output.match(/data-ui-id=/g);
    expect(matches?.length).toBe(2);
  });

  it('should generate unique IDs for multiple same-type elements', () => {
    const input = `
      <div>
        <button>First</button>
        <button>Second</button>
        <button>Third</button>
      </div>
    `;
    const output = transform(input);

    // Extract all IDs
    const idMatches = output.match(/data-ui-id="([^"]+)"/g) || [];
    const ids = idMatches.map((m) => m.match(/data-ui-id="([^"]+)"/)![1]);

    // All IDs should be unique
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should include text content in ID', () => {
    const input = `<button>Start Extraction</button>`;
    const output = transform(input);

    const id = extractAttribute(output, 'data-ui-id');
    expect(id!.toLowerCase()).toContain('start');
    expect(id!.toLowerCase()).toContain('extraction');
  });

  it('should use aria-label for ID when no text', () => {
    const input = `<button aria-label="Close dialog"><span>X</span></button>`;
    const output = transform(input);

    const id = extractAttribute(output, 'data-ui-id');
    expect(id!.toLowerCase()).toContain('close');
    expect(id!.toLowerCase()).toContain('dialog');
  });

  it('should use placeholder for input ID', () => {
    const input = `<input placeholder="Enter your email" />`;
    const output = transform(input);

    const id = extractAttribute(output, 'data-ui-id');
    expect(id!.toLowerCase()).toContain('enter');
    expect(id!.toLowerCase()).toContain('email');
  });
});

// ============================================================================
// Test Suite: data-ui-type Generation
// ============================================================================

describe('Babel Plugin: data-ui-type generation', () => {
  it('should add data-ui-type="button" for button elements', () => {
    const input = `<button>Click</button>`;
    const output = transform(input);

    expect(hasAttribute(output, 'data-ui-type')).toBe(true);
    const type = extractAttribute(output, 'data-ui-type');
    expect(type).toContain('button');
  });

  it('should add data-ui-type="input" for input elements', () => {
    const input = `<input type="text" />`;
    const output = transform(input);

    expect(hasAttribute(output, 'data-ui-type')).toBe(true);
    const type = extractAttribute(output, 'data-ui-type');
    expect(type).toBe('input');
  });

  it('should add data-ui-type="dropdown" for select elements', () => {
    const input = `<select><option>A</option></select>`;
    const output = transform(input);

    const type = extractAttribute(output, 'data-ui-type');
    expect(type).toBe('dropdown');
  });

  it('should add data-ui-type="link" for anchor elements', () => {
    const input = `<a href="#">Link</a>`;
    const output = transform(input);

    const type = extractAttribute(output, 'data-ui-type');
    expect(type).toBe('link');
  });

  it('should detect submit button semantic type', () => {
    const input = `<button>Submit</button>`;
    const output = transform(input);

    const type = extractAttribute(output, 'data-ui-type');
    expect(type).toBe('submit-button');
  });

  it('should detect cancel button semantic type', () => {
    const input = `<button>Cancel</button>`;
    const output = transform(input);

    const type = extractAttribute(output, 'data-ui-type');
    expect(type).toBe('cancel-button');
  });

  it('should detect delete button semantic type', () => {
    const input = `<button>Delete</button>`;
    const output = transform(input);

    const type = extractAttribute(output, 'data-ui-type');
    expect(type).toBe('delete-button');
  });
});

// ============================================================================
// Test Suite: data-ui-aliases Generation
// ============================================================================

describe('Babel Plugin: data-ui-aliases generation', () => {
  it('should generate aliases from text content', () => {
    const input = `<button>Submit</button>`;
    const output = transform(input);

    expect(hasAttribute(output, 'data-ui-aliases')).toBe(true);
    const aliases = extractAttribute(output, 'data-ui-aliases');
    expect(aliases).toBeDefined();
    expect(aliases!.toLowerCase()).toContain('submit');
  });

  it('should include synonyms in aliases', () => {
    const input = `<button>Submit</button>`;
    const output = transform(input);

    const aliases = extractAttribute(output, 'data-ui-aliases');
    // Should include synonyms like "send", "go", "confirm"
    expect(aliases).toMatch(/send|go|confirm/);
  });

  it('should generate aliases from aria-label', () => {
    const input = `<button aria-label="Close modal">X</button>`;
    const output = transform(input);

    const aliases = extractAttribute(output, 'data-ui-aliases');
    expect(aliases!.toLowerCase()).toContain('close');
  });

  it('should generate aliases from placeholder', () => {
    const input = `<input placeholder="Enter email address" />`;
    const output = transform(input);

    const aliases = extractAttribute(output, 'data-ui-aliases');
    expect(aliases!.toLowerCase()).toContain('email');
  });

  it('should respect maxAliases option', () => {
    const input = `<button>Submit the form now please</button>`;
    const output = transform(input, { maxAliases: 3 });

    const aliases = extractAttribute(output, 'data-ui-aliases');
    const aliasList = aliases!.split(',');
    expect(aliasList.length).toBeLessThanOrEqual(3);
  });

  it('should not generate aliases when disabled', () => {
    const input = `<button>Submit</button>`;
    const output = transform(input, { generateAliases: false });

    expect(hasAttribute(output, 'data-ui-aliases')).toBe(false);
  });
});

// ============================================================================
// Test Suite: Component Context
// ============================================================================

describe('Babel Plugin: component context', () => {
  it('should include component name in ID for function components', () => {
    const input = `
      function LoginForm() {
        return <button>Submit</button>;
      }
    `;
    const output = transform(input);

    const id = extractAttribute(output, 'data-ui-id');
    expect(id!.toLowerCase()).toContain('loginform');
  });

  it('should include component name in ID for arrow functions', () => {
    const input = `
      const SignupForm = () => {
        return <button>Register</button>;
      };
    `;
    const output = transform(input);

    const id = extractAttribute(output, 'data-ui-id');
    expect(id!.toLowerCase()).toContain('signupform');
  });

  it('should handle nested components', () => {
    const input = `
      function FormContainer() {
        function InnerForm() {
          return <input placeholder="Name" />;
        }
        return <InnerForm />;
      }
    `;
    const output = transform(input);

    // Should find the input and have component context
    expect(hasAttribute(output, 'data-ui-id')).toBe(true);
  });
});

// ============================================================================
// Test Suite: Configuration Options
// ============================================================================

describe('Babel Plugin: configuration options', () => {
  it('should use custom id attribute name', () => {
    const input = `<button>Click</button>`;
    const output = transform(input, { idAttribute: 'data-test-id' });

    expect(hasAttribute(output, 'data-test-id')).toBe(true);
    expect(hasAttribute(output, 'data-ui-id')).toBe(false);
  });

  it('should use custom aliases attribute name', () => {
    const input = `<button>Submit</button>`;
    const output = transform(input, { aliasesAttribute: 'data-test-aliases' });

    expect(hasAttribute(output, 'data-test-aliases')).toBe(true);
    expect(hasAttribute(output, 'data-ui-aliases')).toBe(false);
  });

  it('should use custom type attribute name', () => {
    const input = `<button>Click</button>`;
    const output = transform(input, { typeAttribute: 'data-test-type' });

    expect(hasAttribute(output, 'data-test-type')).toBe(true);
    expect(hasAttribute(output, 'data-ui-type')).toBe(false);
  });

  it('should use custom ID prefix', () => {
    const input = `<button>Click</button>`;
    const output = transform(input, { idPrefix: 'myapp' });

    const id = extractAttribute(output, 'data-ui-id');
    expect(id!.startsWith('myapp-')).toBe(true);
  });

  it('should skip elements not in elements list', () => {
    const input = `<div>Not instrumented</div>`;
    const output = transform(input);

    expect(hasAttribute(output, 'data-ui-id')).toBe(false);
  });

  it('should instrument custom elements when configured', () => {
    const input = `<nav>Navigation</nav>`;
    const output = transform(input, { elements: ['nav'] as any });

    expect(hasAttribute(output, 'data-ui-id')).toBe(true);
  });

  it('should skip elements with existing data-ui-id', () => {
    const input = `<button data-ui-id="custom-id">Click</button>`;
    const output = transform(input);

    // Should only have one data-ui-id
    const matches = output.match(/data-ui-id=/g);
    expect(matches?.length).toBe(1);
    expect(output).toContain('data-ui-id="custom-id"');
  });

  it('should skip React components (uppercase)', () => {
    const input = `<CustomButton>Click</CustomButton>`;
    const output = transform(input);

    expect(hasAttribute(output, 'data-ui-id')).toBe(false);
  });
});

// ============================================================================
// Test Suite: Edge Cases
// ============================================================================

describe('Babel Plugin: edge cases', () => {
  it('should handle self-closing elements', () => {
    const input = `<input />`;
    const output = transform(input);

    expect(hasAttribute(output, 'data-ui-id')).toBe(true);
  });

  it('should handle elements with JSX expressions', () => {
    const input = `<button onClick={() => {}}>{label}</button>`;
    const output = transform(input);

    expect(hasAttribute(output, 'data-ui-id')).toBe(true);
  });

  it('should handle deeply nested elements', () => {
    const input = `
      <form>
        <div>
          <div>
            <input placeholder="Deep input" />
          </div>
        </div>
        <button>Submit</button>
      </form>
    `;
    const output = transform(input);

    // Should have 3 data-ui-id attributes (form, input, button)
    const matches = output.match(/data-ui-id=/g);
    expect(matches?.length).toBe(3);
  });

  it('should handle empty elements', () => {
    const input = `<button></button>`;
    const output = transform(input);

    expect(hasAttribute(output, 'data-ui-id')).toBe(true);
  });

  it('should handle elements with dynamic props', () => {
    const input = `<button disabled={isDisabled} onClick={handleClick}>Click</button>`;
    const output = transform(input);

    expect(hasAttribute(output, 'data-ui-id')).toBe(true);
    // Should preserve existing props
    expect(output).toContain('disabled={isDisabled}');
    expect(output).toContain('onClick={handleClick}');
  });

  it('should handle multiple element types in same component', () => {
    const input = `
      <form>
        <input type="text" placeholder="Name" />
        <input type="email" placeholder="Email" />
        <select><option>A</option></select>
        <textarea placeholder="Message"></textarea>
        <button>Submit</button>
        <a href="#">Cancel</a>
      </form>
    `;
    const output = transform(input);

    // Count all instrumented elements
    const matches = output.match(/data-ui-id=/g);
    expect(matches?.length).toBeGreaterThanOrEqual(6);
  });
});

// ============================================================================
// Integration Test: Complete Component
// ============================================================================

describe('Babel Plugin: complete component integration', () => {
  it('should correctly instrument a complete form component', () => {
    const input = `
      function ExtractionForm() {
        const [url, setUrl] = useState('');
        const [format, setFormat] = useState('json');

        return (
          <form onSubmit={handleSubmit}>
            <label htmlFor="url">Target URL</label>
            <input
              id="url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Enter the URL to extract"
            />

            <label htmlFor="format">Output Format</label>
            <select
              id="format"
              value={format}
              onChange={(e) => setFormat(e.target.value)}
            >
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
            </select>

            <button type="submit">Start Extraction</button>
            <button type="button" onClick={handleCancel}>Cancel</button>
          </form>
        );
      }
    `;
    const output = transform(input);

    // Should have instrumented: form, input, select, 2 buttons = 5 elements
    const idMatches = output.match(/data-ui-id=/g);
    expect(idMatches?.length).toBe(5);

    // Should have type attributes
    const typeMatches = output.match(/data-ui-type=/g);
    expect(typeMatches?.length).toBe(5);

    // Check specific elements were instrumented correctly
    expect(output).toContain('data-ui-type="form"');
    expect(output).toContain('data-ui-type="input"');
    expect(output).toContain('data-ui-type="dropdown"');
    // The Babel plugin detects "cancel" as cancel-button, and "Start Extraction" as generic button
    expect(output).toContain('data-ui-type="button"');
    expect(output).toContain('data-ui-type="cancel-button"');

    // Component name should be in IDs
    expect(output.toLowerCase()).toContain('extractionform');
  });
});
