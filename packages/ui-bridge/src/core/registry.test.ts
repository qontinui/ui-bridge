/**
 * Registry Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  UIBridgeRegistry,
  setGlobalRegistry,
  getGlobalRegistry,
  resetGlobalRegistry,
} from './registry';

describe('UIBridgeRegistry', () => {
  let registry: UIBridgeRegistry;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    resetGlobalRegistry();
  });

  describe('element registration', () => {
    it('should register an element', () => {
      const element = document.createElement('button');
      element.setAttribute('data-ui-id', 'test-btn');
      container.appendChild(element);

      const registered = registry.registerElement('test-btn', element, {
        type: 'button',
        label: 'Test Button',
      });

      expect(registered).toBeDefined();
      expect(registered.id).toBe('test-btn');
      expect(registered.type).toBe('button');
      expect(registered.label).toBe('Test Button');
    });

    it('should infer element type when not specified', () => {
      const button = document.createElement('button');
      container.appendChild(button);

      const registered = registry.registerElement('btn-1', button);

      expect(registered.type).toBe('button');
    });

    it('should infer input type', () => {
      const input = document.createElement('input');
      input.type = 'text';
      container.appendChild(input);

      const registered = registry.registerElement('input-1', input);

      expect(registered.type).toBe('input');
    });

    it('should infer checkbox type', () => {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      container.appendChild(checkbox);

      const registered = registry.registerElement('checkbox-1', checkbox);

      expect(registered.type).toBe('checkbox');
    });

    it('should unregister an element', () => {
      const element = document.createElement('button');
      container.appendChild(element);

      registry.registerElement('btn-1', element);
      expect(registry.getElement('btn-1')).toBeDefined();

      registry.unregisterElement('btn-1');
      expect(registry.getElement('btn-1')).toBeUndefined();
    });

    it('should get all elements', () => {
      const btn1 = document.createElement('button');
      const btn2 = document.createElement('button');
      container.appendChild(btn1);
      container.appendChild(btn2);

      registry.registerElement('btn-1', btn1);
      registry.registerElement('btn-2', btn2);

      const elements = registry.getAllElements();

      expect(elements).toHaveLength(2);
      expect(elements.map((e) => e.id)).toContain('btn-1');
      expect(elements.map((e) => e.id)).toContain('btn-2');
    });

    it('should find element by DOM element', () => {
      const element = document.createElement('input');
      container.appendChild(element);

      registry.registerElement('email-input', element);

      const found = registry.findByDOMElement(element);

      expect(found).toBeDefined();
      expect(found?.id).toBe('email-input');
    });
  });

  describe('component registration', () => {
    it('should register a component', () => {
      const handler = vi.fn();

      const component = registry.registerComponent('login-form', {
        name: 'Login Form',
        description: 'User authentication form',
        actions: [
          {
            id: 'submit',
            label: 'Submit',
            handler,
          },
        ],
      });

      expect(component).toBeDefined();
      expect(component.id).toBe('login-form');
      expect(component.name).toBe('Login Form');
      expect(component.actions).toHaveLength(1);
    });

    it('should unregister a component', () => {
      registry.registerComponent('form-1', {
        name: 'Form',
        actions: [],
      });

      expect(registry.getComponent('form-1')).toBeDefined();

      registry.unregisterComponent('form-1');

      expect(registry.getComponent('form-1')).toBeUndefined();
    });

    it('should get all components', () => {
      registry.registerComponent('comp-1', { name: 'Component 1', actions: [] });
      registry.registerComponent('comp-2', { name: 'Component 2', actions: [] });

      const components = registry.getAllComponents();

      expect(components).toHaveLength(2);
    });

    it('should link elements to component', () => {
      const btn = document.createElement('button');
      const input = document.createElement('input');
      container.appendChild(btn);
      container.appendChild(input);

      registry.registerElement('btn-1', btn);
      registry.registerElement('input-1', input);

      const component = registry.registerComponent('form-1', {
        name: 'Form',
        actions: [],
        elementIds: ['btn-1', 'input-1'],
      });

      expect(component.elementIds).toContain('btn-1');
      expect(component.elementIds).toContain('input-1');
    });
  });

  describe('workflow registration', () => {
    it('should register a workflow', () => {
      const workflow = registry.registerWorkflow({
        id: 'login-flow',
        name: 'Login Flow',
        steps: [
          {
            id: 'step-1',
            type: 'action',
            target: 'email-input',
            action: 'type',
            params: { text: 'test@example.com' },
          },
        ],
      });

      expect(workflow).toBeDefined();
      expect(workflow.id).toBe('login-flow');
      expect(workflow.steps).toHaveLength(1);
    });

    it('should get a workflow by id', () => {
      registry.registerWorkflow({
        id: 'test-workflow',
        name: 'Test',
        steps: [],
      });

      const workflow = registry.getWorkflow('test-workflow');

      expect(workflow).toBeDefined();
      expect(workflow?.name).toBe('Test');
    });

    it('should unregister a workflow', () => {
      registry.registerWorkflow({
        id: 'temp-workflow',
        name: 'Temp',
        steps: [],
      });

      expect(registry.getWorkflow('temp-workflow')).toBeDefined();

      registry.unregisterWorkflow('temp-workflow');

      expect(registry.getWorkflow('temp-workflow')).toBeUndefined();
    });
  });

  describe('event system', () => {
    it('should emit and listen to events', () => {
      const listener = vi.fn();

      registry.on('element:registered', listener);

      const element = document.createElement('button');
      container.appendChild(element);

      registry.registerElement('btn-1', element);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'element:registered',
        })
      );
    });

    it('should remove event listener with off()', () => {
      const listener = vi.fn();

      registry.on('element:registered', listener);
      registry.off('element:registered', listener);

      const element = document.createElement('button');
      container.appendChild(element);

      registry.registerElement('btn-1', element);

      expect(listener).not.toHaveBeenCalled();
    });

    it('should return unsubscribe function from on()', () => {
      const listener = vi.fn();

      const unsubscribe = registry.on('element:registered', listener);

      // Unsubscribe before registering
      unsubscribe();

      const element = document.createElement('button');
      container.appendChild(element);

      registry.registerElement('btn-1', element);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('snapshot', () => {
    it('should create a snapshot', () => {
      const btn = document.createElement('button');
      container.appendChild(btn);

      registry.registerElement('btn-1', btn);
      registry.registerComponent('comp-1', { name: 'Component', actions: [] });

      const snapshot = registry.createSnapshot();

      expect(snapshot.elements).toHaveLength(1);
      expect(snapshot.components).toHaveLength(1);
      expect(snapshot.timestamp).toBeDefined();
    });
  });

  describe('global registry', () => {
    it('should set and get global registry', () => {
      const newRegistry = new UIBridgeRegistry();

      setGlobalRegistry(newRegistry);

      expect(getGlobalRegistry()).toBe(newRegistry);
    });

    it('should reset global registry', () => {
      const newRegistry = new UIBridgeRegistry();
      const btn = document.createElement('button');
      container.appendChild(btn);
      newRegistry.registerElement('test-btn', btn);

      setGlobalRegistry(newRegistry);
      expect(getGlobalRegistry().getAllElements()).toHaveLength(1);

      resetGlobalRegistry();

      // After reset, getGlobalRegistry creates a fresh registry
      const freshRegistry = getGlobalRegistry();
      expect(freshRegistry).toBeInstanceOf(UIBridgeRegistry);
      expect(freshRegistry.getAllElements()).toHaveLength(0);
      expect(freshRegistry).not.toBe(newRegistry);
    });
  });
});
