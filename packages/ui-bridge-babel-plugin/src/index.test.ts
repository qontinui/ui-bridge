/**
 * UI Bridge Babel Plugin Tests
 */

import { describe, it, expect } from 'vitest';
import { transformSync } from '@babel/core';
import uiBridgeBabelPlugin from './index';
import type { PluginConfig } from './config';

function transform(code: string, options: PluginConfig = {}): string {
  const result = transformSync(code, {
    plugins: [[uiBridgeBabelPlugin, options]],
    parserOpts: {
      plugins: ['jsx'],
    },
    filename: 'test.tsx',
  });

  return result?.code || '';
}

describe('ui-bridge-babel-plugin', () => {
  describe('basic transformation', () => {
    it('should add data-ui-id to button elements', () => {
      const input = `<button>Click me</button>`;
      const output = transform(input);

      expect(output).toContain('data-ui-id=');
      expect(output).toContain('data-ui-type="button"');
    });

    it('should add data-ui-id to input elements', () => {
      const input = `<input placeholder="Email" />`;
      const output = transform(input);

      expect(output).toContain('data-ui-id=');
      expect(output).toContain('data-ui-type="input"');
    });

    it('should add data-ui-id to select elements', () => {
      const input = `<select><option>Option 1</option></select>`;
      const output = transform(input);

      expect(output).toContain('data-ui-id=');
      expect(output).toContain('data-ui-type="dropdown"');
    });

    it('should add data-ui-id to link elements', () => {
      const input = `<a href="#">Home</a>`;
      const output = transform(input);

      expect(output).toContain('data-ui-id=');
      expect(output).toContain('data-ui-type="link"');
    });

    it('should add data-ui-id to form elements', () => {
      const input = `<form><input /></form>`;
      const output = transform(input);

      expect(output).toContain('data-ui-type="form"');
    });
  });

  describe('ID generation', () => {
    it('should include text content in ID', () => {
      const input = `<button>Submit Form</button>`;
      const output = transform(input);

      expect(output).toContain('submit-form');
    });

    it('should use aria-label for ID when no text', () => {
      const input = `<button aria-label="Close dialog" />`;
      const output = transform(input);

      expect(output).toContain('close-dialog');
    });

    it('should use placeholder for input ID', () => {
      const input = `<input placeholder="Enter email" />`;
      const output = transform(input);

      expect(output).toContain('enter-email');
    });

    it('should use custom prefix', () => {
      const input = `<button>Click</button>`;
      const output = transform(input, { idPrefix: 'my-app' });

      expect(output).toContain('my-app-');
    });
  });

  describe('alias generation', () => {
    it('should generate aliases from text content', () => {
      const input = `<button>Submit</button>`;
      const output = transform(input);

      expect(output).toContain('data-ui-aliases=');
      expect(output).toContain('submit');
    });

    it('should include synonyms in aliases', () => {
      const input = `<button>Submit</button>`;
      const output = transform(input);

      // Should include synonyms like "send", "go", "confirm"
      expect(output).toMatch(/send|go|confirm/);
    });

    it('should generate aliases from aria-label', () => {
      const input = `<button aria-label="Close modal">X</button>`;
      const output = transform(input);

      expect(output).toContain('close');
    });

    it('should respect maxAliases option', () => {
      const input = `<button>Submit the form now please</button>`;
      const output = transform(input, { maxAliases: 2 });

      // Count commas in aliases attribute
      const aliasMatch = output.match(/data-ui-aliases="([^"]+)"/);
      if (aliasMatch) {
        const aliases = aliasMatch[1].split(',');
        expect(aliases.length).toBeLessThanOrEqual(2);
      }
    });
  });

  describe('configuration', () => {
    it('should skip elements not in elements list', () => {
      const input = `<div>Not instrumented</div>`;
      const output = transform(input);

      expect(output).not.toContain('data-ui-id');
    });

    it('should instrument custom elements when configured', () => {
      const input = `<nav>Navigation</nav>`;
      const output = transform(input, {
        elements: ['nav'] as any,
      });

      expect(output).toContain('data-ui-id=');
    });

    it('should skip elements with existing data-ui-id', () => {
      const input = `<button data-ui-id="custom-id">Click</button>`;
      const output = transform(input);

      // Should only have one data-ui-id
      expect(output.match(/data-ui-id=/g)?.length).toBe(1);
      expect(output).toContain('data-ui-id="custom-id"');
    });

    it('should use custom attribute names', () => {
      const input = `<button>Click</button>`;
      const output = transform(input, {
        idAttribute: 'data-test-id',
        aliasesAttribute: 'data-test-aliases',
        typeAttribute: 'data-test-type',
      });

      expect(output).toContain('data-test-id=');
      expect(output).toContain('data-test-aliases=');
      expect(output).toContain('data-test-type=');
    });

    it('should not generate aliases when disabled', () => {
      const input = `<button>Submit</button>`;
      const output = transform(input, { generateAliases: false });

      expect(output).not.toContain('data-ui-aliases');
    });
  });

  describe('component context', () => {
    it('should include component name in ID when in function component', () => {
      const input = `
        function LoginForm() {
          return <button>Submit</button>;
        }
      `;
      const output = transform(input);

      expect(output.toLowerCase()).toContain('loginform');
    });

    it('should include component name in ID when in arrow function', () => {
      const input = `
        const SignupForm = () => {
          return <button>Register</button>;
        };
      `;
      const output = transform(input);

      expect(output.toLowerCase()).toContain('signupform');
    });
  });

  describe('semantic types', () => {
    it('should detect submit button type', () => {
      const input = `<button>Submit</button>`;
      const output = transform(input);

      expect(output).toContain('data-ui-type="submit-button"');
    });

    it('should detect cancel button type', () => {
      const input = `<button>Cancel</button>`;
      const output = transform(input);

      expect(output).toContain('data-ui-type="cancel-button"');
    });

    it('should detect delete button type', () => {
      const input = `<button>Delete</button>`;
      const output = transform(input);

      expect(output).toContain('data-ui-type="delete-button"');
    });
  });

  describe('edge cases', () => {
    it('should handle self-closing elements', () => {
      const input = `<input />`;
      const output = transform(input);

      expect(output).toContain('data-ui-id=');
    });

    it('should handle elements with JSX expressions', () => {
      const input = `<button onClick={() => {}}>{label}</button>`;
      const output = transform(input);

      expect(output).toContain('data-ui-id=');
    });

    it('should handle nested elements', () => {
      const input = `
        <form>
          <input placeholder="Name" />
          <button>Submit</button>
        </form>
      `;
      const output = transform(input);

      // Should have 3 data-ui-id attributes (form, input, button)
      const matches = output.match(/data-ui-id=/g);
      expect(matches?.length).toBe(3);
    });

    it('should skip React components (uppercase)', () => {
      const input = `<CustomButton>Click</CustomButton>`;
      const output = transform(input);

      expect(output).not.toContain('data-ui-id');
    });

    it('should handle empty elements', () => {
      const input = `<button></button>`;
      const output = transform(input);

      expect(output).toContain('data-ui-id=');
    });
  });
});
