/**
 * Element Identifier Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createElementIdentifier,
  getBestIdentifier,
  generateXPath,
  generateCSSSelector,
  findElementByIdentifier,
  elementMatchesIdentifier,
} from './element-identifier';

describe('element-identifier', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'test-container';
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('createElementIdentifier', () => {
    it('should create identifier with data-ui-id', () => {
      const element = document.createElement('button');
      element.setAttribute('data-ui-id', 'submit-btn');
      container.appendChild(element);

      const identifier = createElementIdentifier(element);

      expect(identifier.uiId).toBe('submit-btn');
    });

    it('should create identifier with data-testid', () => {
      const element = document.createElement('input');
      element.setAttribute('data-testid', 'email-input');
      container.appendChild(element);

      const identifier = createElementIdentifier(element);

      expect(identifier.testId).toBe('email-input');
    });

    it('should create identifier with id attribute', () => {
      const element = document.createElement('div');
      element.id = 'main-content';
      container.appendChild(element);

      const identifier = createElementIdentifier(element);

      expect(identifier.htmlId).toBe('main-content');
    });

    it('should generate xpath and css selector', () => {
      const element = document.createElement('button');
      element.className = 'btn primary';
      container.appendChild(element);

      const identifier = createElementIdentifier(element);

      expect(identifier.xpath).toBeDefined();
      expect(identifier.selector).toBeDefined();
    });

    it('should handle element without any identifying attributes', () => {
      const element = document.createElement('span');
      container.appendChild(element);

      const identifier = createElementIdentifier(element);

      expect(identifier.uiId).toBeUndefined();
      expect(identifier.testId).toBeUndefined();
      expect(identifier.htmlId).toBeUndefined();
      expect(identifier.xpath).toBeDefined();
      expect(identifier.selector).toBeDefined();
    });
  });

  describe('getBestIdentifier', () => {
    it('should return data-ui-id when present', () => {
      const element = document.createElement('button');
      element.setAttribute('data-ui-id', 'my-button');
      element.setAttribute('data-testid', 'test-button');
      element.id = 'button-id';
      container.appendChild(element);

      const best = getBestIdentifier(element);

      expect(best).toBe('my-button');
    });

    it('should return data-testid when no data-ui-id', () => {
      const element = document.createElement('button');
      element.setAttribute('data-testid', 'test-button');
      element.id = 'button-id';
      container.appendChild(element);

      const best = getBestIdentifier(element);

      expect(best).toBe('test-button');
    });

    it('should return id when no data attributes', () => {
      const element = document.createElement('button');
      element.id = 'button-id';
      container.appendChild(element);

      const best = getBestIdentifier(element);

      expect(best).toBe('button-id');
    });

    it('should return CSS selector as fallback', () => {
      const element = document.createElement('button');
      element.className = 'btn-primary';
      container.appendChild(element);

      const best = getBestIdentifier(element);

      expect(best).toBeDefined();
      expect(best.length).toBeGreaterThan(0);
    });
  });

  describe('generateXPath', () => {
    it('should generate xpath for element with id', () => {
      const element = document.createElement('div');
      element.id = 'unique-id';
      container.appendChild(element);

      const xpath = generateXPath(element);

      expect(xpath).toContain('unique-id');
    });

    it('should generate positional xpath for nested elements', () => {
      const parent = document.createElement('div');
      const child1 = document.createElement('span');
      const child2 = document.createElement('span');
      parent.appendChild(child1);
      parent.appendChild(child2);
      container.appendChild(parent);

      const xpath = generateXPath(child2);

      expect(xpath).toBeDefined();
      expect(xpath.length).toBeGreaterThan(0);
    });

    it('should generate xpath for document.body', () => {
      const xpath = generateXPath(document.body);
      expect(xpath).toBe('/html/body');
    });
  });

  describe('generateCSSSelector', () => {
    it('should generate selector with id', () => {
      const element = document.createElement('button');
      element.id = 'my-btn';
      container.appendChild(element);

      const selector = generateCSSSelector(element);

      expect(selector).toBe('#my-btn');
    });

    it('should generate selector based on ancestor id when no direct identifier', () => {
      const element = document.createElement('button');
      element.className = 'btn primary large';
      container.appendChild(element);

      const selector = generateCSSSelector(element);

      // Implementation uses id-based selectors rather than classes
      // Container has id="test-container", so selector uses that as anchor
      expect(selector).toContain('#test-container');
      expect(selector).toContain('button');
    });

    it('should generate selector with data-ui-id', () => {
      const element = document.createElement('button');
      element.setAttribute('data-ui-id', 'submit');
      container.appendChild(element);

      const selector = generateCSSSelector(element);

      expect(selector).toContain('[data-ui-id="submit"]');
    });

    it('should generate selector with data-testid', () => {
      const element = document.createElement('input');
      element.setAttribute('data-testid', 'email');
      container.appendChild(element);

      const selector = generateCSSSelector(element);

      expect(selector).toContain('[data-testid="email"]');
    });
  });

  describe('findElementByIdentifier', () => {
    it('should find element by data-ui-id string', () => {
      const element = document.createElement('button');
      element.setAttribute('data-ui-id', 'find-me');
      container.appendChild(element);

      const found = findElementByIdentifier('find-me', container);

      expect(found).toBe(element);
    });

    it('should find element by data-testid string', () => {
      const element = document.createElement('input');
      element.setAttribute('data-testid', 'email-field');
      container.appendChild(element);

      const found = findElementByIdentifier('email-field', container);

      expect(found).toBe(element);
    });

    it('should find element by id string', () => {
      const element = document.createElement('div');
      element.id = 'my-element';
      container.appendChild(element);

      const found = findElementByIdentifier('my-element', container);

      expect(found).toBe(element);
    });

    it('should find element by CSS selector', () => {
      const element = document.createElement('button');
      element.className = 'submit-btn';
      container.appendChild(element);

      const found = findElementByIdentifier('.submit-btn', container);

      expect(found).toBe(element);
    });

    it('should return null for non-existent element', () => {
      const found = findElementByIdentifier('nonexistent', container);

      expect(found).toBeNull();
    });

    it('should find element by ElementIdentifier object', () => {
      const element = document.createElement('button');
      element.setAttribute('data-ui-id', 'target-btn');
      container.appendChild(element);

      const identifier = createElementIdentifier(element);
      const found = findElementByIdentifier(identifier, container);

      expect(found).toBe(element);
    });
  });

  describe('elementMatchesIdentifier', () => {
    it('should match element with same data-ui-id', () => {
      const element = document.createElement('button');
      element.setAttribute('data-ui-id', 'test-btn');
      container.appendChild(element);

      expect(elementMatchesIdentifier(element, 'test-btn')).toBe(true);
    });

    it('should match element with same data-testid', () => {
      const element = document.createElement('input');
      element.setAttribute('data-testid', 'email');
      container.appendChild(element);

      expect(elementMatchesIdentifier(element, 'email')).toBe(true);
    });

    it('should not match element with different identifier', () => {
      const element = document.createElement('button');
      element.setAttribute('data-ui-id', 'btn-1');
      container.appendChild(element);

      expect(elementMatchesIdentifier(element, 'btn-2')).toBe(false);
    });

    it('should match element by ElementIdentifier object', () => {
      const element = document.createElement('button');
      element.setAttribute('data-ui-id', 'target');
      container.appendChild(element);

      const identifier = createElementIdentifier(element);
      expect(elementMatchesIdentifier(element, identifier)).toBe(true);
    });
  });
});
