/**
 * Relationship Tracker Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RelationshipTracker } from '../relationship-tracker';

describe('RelationshipTracker', () => {
  let tracker: RelationshipTracker;

  beforeEach(() => {
    tracker = new RelationshipTracker();
  });

  // -------------------------------------------------------------------------
  // Declared relationships
  // -------------------------------------------------------------------------

  describe('declared relationships', () => {
    it('should store a relationship via declare()', () => {
      tracker.declare('btn-toggle', 'panel-settings', 'controls');

      const declared = tracker.getDeclared();
      expect(declared).toHaveLength(1);
      expect(declared[0]).toEqual({
        source: 'btn-toggle',
        target: 'panel-settings',
        type: 'controls',
        origin: 'declared',
      });
    });

    it('should store a relationship with bidirectional option', () => {
      tracker.declare('input-search', 'list-results', 'filters', {
        bidirectional: true,
      });

      const declared = tracker.getDeclared();
      expect(declared).toHaveLength(1);
      expect(declared[0].bidirectional).toBe(true);
    });

    it('should store a relationship with metadata', () => {
      tracker.declare('btn-save', 'form-profile', 'submits', {
        metadata: { priority: 'high' },
      });

      const declared = tracker.getDeclared();
      expect(declared[0].metadata).toEqual({ priority: 'high' });
    });

    it('should overwrite duplicate declare() with same source+target+type', () => {
      tracker.declare('a', 'b', 'controls', { metadata: { v: 1 } });
      tracker.declare('a', 'b', 'controls', { metadata: { v: 2 } });

      const declared = tracker.getDeclared();
      expect(declared).toHaveLength(1);
      expect(declared[0].metadata).toEqual({ v: 2 });
    });

    it('should allow multiple relationship types between the same pair', () => {
      tracker.declare('a', 'b', 'controls');
      tracker.declare('a', 'b', 'toggles');

      const declared = tracker.getDeclared();
      expect(declared).toHaveLength(2);
      const types = declared.map((r) => r.type);
      expect(types).toContain('controls');
      expect(types).toContain('toggles');
    });

    it('should undeclare a specific relationship by type', () => {
      tracker.declare('a', 'b', 'controls');
      tracker.declare('a', 'b', 'toggles');

      tracker.undeclare('a', 'b', 'controls');

      const declared = tracker.getDeclared();
      expect(declared).toHaveLength(1);
      expect(declared[0].type).toBe('toggles');
    });

    it('should undeclare all relationships between source and target when type is omitted', () => {
      tracker.declare('a', 'b', 'controls');
      tracker.declare('a', 'b', 'toggles');
      tracker.declare('a', 'c', 'labels');

      tracker.undeclare('a', 'b');

      const declared = tracker.getDeclared();
      expect(declared).toHaveLength(1);
      expect(declared[0].target).toBe('c');
    });

    it('should undeclareAll() removing all relationships for an element as source or target', () => {
      tracker.declare('a', 'b', 'controls');
      tracker.declare('c', 'a', 'labels');
      tracker.declare('d', 'e', 'toggles');

      tracker.undeclareAll('a');

      const declared = tracker.getDeclared();
      expect(declared).toHaveLength(1);
      expect(declared[0].source).toBe('d');
      expect(declared[0].target).toBe('e');
    });

    it('should return all declared relationships via getDeclared()', () => {
      tracker.declare('a', 'b', 'controls');
      tracker.declare('c', 'd', 'labels');
      tracker.declare('e', 'f', 'submits');

      const declared = tracker.getDeclared();
      expect(declared).toHaveLength(3);
    });
  });

  // -------------------------------------------------------------------------
  // ARIA scanning
  // -------------------------------------------------------------------------

  describe('ARIA scanning', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
    });

    afterEach(() => {
      document.body.removeChild(container);
    });

    it('should detect aria-controls relationship', () => {
      const btn = document.createElement('button');
      btn.id = 'toggle-btn';
      btn.setAttribute('aria-controls', 'settings-panel');
      container.appendChild(btn);

      const panel = document.createElement('div');
      panel.id = 'settings-panel';
      container.appendChild(panel);

      const elements = [
        { id: 'btn-toggle', element: btn },
        { id: 'panel-settings', element: panel },
      ];

      const rels = tracker.scanARIARelationships(elements);
      expect(rels).toHaveLength(1);
      expect(rels[0]).toEqual({
        source: 'btn-toggle',
        target: 'panel-settings',
        type: 'controls',
        origin: 'aria',
      });
    });

    it('should detect aria-labelledby relationship (reversed: target labels source)', () => {
      const heading = document.createElement('h2');
      heading.id = 'section-heading';
      container.appendChild(heading);

      const section = document.createElement('section');
      section.id = 'content-section';
      section.setAttribute('aria-labelledby', 'section-heading');
      container.appendChild(section);

      const elements = [
        { id: 'heading-section', element: heading },
        { id: 'section-content', element: section },
      ];

      const rels = tracker.scanARIARelationships(elements);
      expect(rels).toHaveLength(1);
      // Reversed: the heading (target of aria-labelledby) labels the section (source of attr)
      expect(rels[0].source).toBe('heading-section');
      expect(rels[0].target).toBe('section-content');
      expect(rels[0].type).toBe('labels');
    });

    it('should detect aria-describedby relationship (reversed: target describes source)', () => {
      const helpText = document.createElement('span');
      helpText.id = 'email-help';
      container.appendChild(helpText);

      const input = document.createElement('input');
      input.id = 'email-input';
      input.setAttribute('aria-describedby', 'email-help');
      container.appendChild(input);

      const elements = [
        { id: 'help-email', element: helpText },
        { id: 'input-email', element: input },
      ];

      const rels = tracker.scanARIARelationships(elements);
      expect(rels).toHaveLength(1);
      expect(rels[0].source).toBe('help-email');
      expect(rels[0].target).toBe('input-email');
      expect(rels[0].type).toBe('describes');
    });

    it('should detect aria-owns relationship', () => {
      const combobox = document.createElement('div');
      combobox.id = 'combo';
      combobox.setAttribute('aria-owns', 'listbox-popup');
      container.appendChild(combobox);

      const listbox = document.createElement('ul');
      listbox.id = 'listbox-popup';
      container.appendChild(listbox);

      const elements = [
        { id: 'combobox-main', element: combobox },
        { id: 'listbox-options', element: listbox },
      ];

      const rels = tracker.scanARIARelationships(elements);
      expect(rels).toHaveLength(1);
      expect(rels[0].source).toBe('combobox-main');
      expect(rels[0].target).toBe('listbox-options');
      expect(rels[0].type).toBe('owns');
    });

    it('should detect aria-errormessage relationship (reversed: target validates source)', () => {
      const errorMsg = document.createElement('span');
      errorMsg.id = 'name-error';
      container.appendChild(errorMsg);

      const input = document.createElement('input');
      input.id = 'name-input';
      input.setAttribute('aria-errormessage', 'name-error');
      container.appendChild(input);

      const elements = [
        { id: 'error-name', element: errorMsg },
        { id: 'input-name', element: input },
      ];

      const rels = tracker.scanARIARelationships(elements);
      expect(rels).toHaveLength(1);
      expect(rels[0].source).toBe('error-name');
      expect(rels[0].target).toBe('input-name');
      expect(rels[0].type).toBe('validates');
    });

    it('should handle space-separated ARIA ID lists (multiple targets)', () => {
      const desc1 = document.createElement('span');
      desc1.id = 'desc-1';
      container.appendChild(desc1);

      const desc2 = document.createElement('span');
      desc2.id = 'desc-2';
      container.appendChild(desc2);

      const input = document.createElement('input');
      input.id = 'main-input';
      input.setAttribute('aria-describedby', 'desc-1 desc-2');
      container.appendChild(input);

      const elements = [
        { id: 'description-1', element: desc1 },
        { id: 'description-2', element: desc2 },
        { id: 'input-main', element: input },
      ];

      const rels = tracker.scanARIARelationships(elements);
      expect(rels).toHaveLength(2);
      expect(rels[0].source).toBe('description-1');
      expect(rels[0].target).toBe('input-main');
      expect(rels[1].source).toBe('description-2');
      expect(rels[1].target).toBe('input-main');
    });

    it('should ignore ARIA references to unregistered elements', () => {
      const btn = document.createElement('button');
      btn.id = 'btn-1';
      btn.setAttribute('aria-controls', 'unregistered-panel');
      container.appendChild(btn);

      // The target panel exists in DOM but is not registered
      const panel = document.createElement('div');
      panel.id = 'unregistered-panel';
      container.appendChild(panel);

      const elements = [{ id: 'button-1', element: btn }];

      const rels = tracker.scanARIARelationships(elements);
      expect(rels).toHaveLength(0);
    });

    it('should return empty array when no ARIA relationships found', () => {
      const btn = document.createElement('button');
      container.appendChild(btn);

      const elements = [{ id: 'button-plain', element: btn }];

      const rels = tracker.scanARIARelationships(elements);
      expect(rels).toHaveLength(0);
    });

    it('should detect aria-activedescendant relationship', () => {
      const listbox = document.createElement('ul');
      listbox.id = 'listbox';
      listbox.setAttribute('aria-activedescendant', 'option-2');
      container.appendChild(listbox);

      const option = document.createElement('li');
      option.id = 'option-2';
      container.appendChild(option);

      const elements = [
        { id: 'listbox-main', element: listbox },
        { id: 'option-second', element: option },
      ];

      const rels = tracker.scanARIARelationships(elements);
      expect(rels).toHaveLength(1);
      expect(rels[0].source).toBe('listbox-main');
      expect(rels[0].target).toBe('option-second');
      expect(rels[0].type).toBe('activates');
    });

    it('should detect aria-flowto relationship', () => {
      const step1 = document.createElement('div');
      step1.id = 'step-1';
      step1.setAttribute('aria-flowto', 'step-2');
      container.appendChild(step1);

      const step2 = document.createElement('div');
      step2.id = 'step-2';
      container.appendChild(step2);

      const elements = [
        { id: 'wizard-step-1', element: step1 },
        { id: 'wizard-step-2', element: step2 },
      ];

      const rels = tracker.scanARIARelationships(elements);
      expect(rels).toHaveLength(1);
      expect(rels[0].type).toBe('navigatesTo');
    });

    it('should detect aria-details relationship (reversed: target describes source)', () => {
      const details = document.createElement('div');
      details.id = 'details-panel';
      container.appendChild(details);

      const summary = document.createElement('div');
      summary.id = 'summary-item';
      summary.setAttribute('aria-details', 'details-panel');
      container.appendChild(summary);

      const elements = [
        { id: 'details-info', element: details },
        { id: 'summary-main', element: summary },
      ];

      const rels = tracker.scanARIARelationships(elements);
      expect(rels).toHaveLength(1);
      expect(rels[0].source).toBe('details-info');
      expect(rels[0].target).toBe('summary-main');
      expect(rels[0].type).toBe('describes');
    });
  });

  // -------------------------------------------------------------------------
  // HTML scanning
  // -------------------------------------------------------------------------

  describe('HTML scanning', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
    });

    afterEach(() => {
      document.body.removeChild(container);
    });

    it('should detect label[for] -> input relationship', () => {
      const label = document.createElement('label');
      label.setAttribute('for', 'email-field');
      label.textContent = 'Email';
      container.appendChild(label);

      const input = document.createElement('input');
      input.id = 'email-field';
      container.appendChild(input);

      const elements = [
        { id: 'label-email', element: label },
        { id: 'input-email', element: input },
      ];

      const rels = tracker.scanHTMLRelationships(elements);
      expect(rels).toHaveLength(1);
      expect(rels[0]).toEqual({
        source: 'label-email',
        target: 'input-email',
        type: 'labels',
        origin: 'html',
      });
    });

    it('should detect implicit label wrapping an input', () => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      label.appendChild(document.createTextNode('Username'));
      label.appendChild(input);
      container.appendChild(label);

      const elements = [
        { id: 'label-username', element: label },
        { id: 'input-username', element: input },
      ];

      const rels = tracker.scanHTMLRelationships(elements);
      expect(rels).toHaveLength(1);
      expect(rels[0].source).toBe('label-username');
      expect(rels[0].target).toBe('input-username');
      expect(rels[0].type).toBe('labels');
      expect(rels[0].origin).toBe('html');
    });

    it('should return empty array when no HTML relationships found', () => {
      const div = document.createElement('div');
      container.appendChild(div);

      const elements = [{ id: 'div-plain', element: div }];

      const rels = tracker.scanHTMLRelationships(elements);
      expect(rels).toHaveLength(0);
    });

    it('should ignore labels with for attribute pointing to unregistered elements', () => {
      const label = document.createElement('label');
      label.setAttribute('for', 'unregistered-input');
      container.appendChild(label);

      const input = document.createElement('input');
      input.id = 'unregistered-input';
      container.appendChild(input);

      // Only the label is registered, not the input
      const elements = [{ id: 'label-orphan', element: label }];

      const rels = tracker.scanHTMLRelationships(elements);
      expect(rels).toHaveLength(0);
    });

    it('should detect implicit label wrapping a select element', () => {
      const label = document.createElement('label');
      const select = document.createElement('select');
      label.appendChild(document.createTextNode('Country'));
      label.appendChild(select);
      container.appendChild(label);

      const elements = [
        { id: 'label-country', element: label },
        { id: 'select-country', element: select },
      ];

      const rels = tracker.scanHTMLRelationships(elements);
      expect(rels).toHaveLength(1);
      expect(rels[0].target).toBe('select-country');
    });
  });

  // -------------------------------------------------------------------------
  // Merged output
  // -------------------------------------------------------------------------

  describe('merged output', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
    });

    afterEach(() => {
      document.body.removeChild(container);
    });

    it('should merge declared + ARIA + HTML relationships', () => {
      // Declared
      tracker.declare('btn-save', 'form-main', 'submits');

      // ARIA: button controls panel
      const btn = document.createElement('button');
      btn.id = 'toggle';
      btn.setAttribute('aria-controls', 'panel');
      container.appendChild(btn);

      const panel = document.createElement('div');
      panel.id = 'panel';
      container.appendChild(panel);

      // HTML: label for input
      const label = document.createElement('label');
      label.setAttribute('for', 'name-field');
      container.appendChild(label);

      const input = document.createElement('input');
      input.id = 'name-field';
      container.appendChild(input);

      const elements = [
        { id: 'btn-toggle', element: btn },
        { id: 'panel-content', element: panel },
        { id: 'label-name', element: label },
        { id: 'input-name', element: input },
      ];

      const rels = tracker.getRelationships(elements);
      expect(rels).toHaveLength(3);

      const types = rels.map((r) => r.type);
      expect(types).toContain('submits');
      expect(types).toContain('controls');
      expect(types).toContain('labels');
    });

    it('should deduplicate: declared takes priority over aria', () => {
      // Both declared and ARIA produce the same source/target/type
      const btn = document.createElement('button');
      btn.id = 'toggle-btn';
      btn.setAttribute('aria-controls', 'my-panel');
      container.appendChild(btn);

      const panel = document.createElement('div');
      panel.id = 'my-panel';
      container.appendChild(panel);

      // Declare the same relationship with metadata
      tracker.declare('btn-toggle', 'panel-main', 'controls', {
        metadata: { custom: true },
      });

      const elements = [
        { id: 'btn-toggle', element: btn },
        { id: 'panel-main', element: panel },
      ];

      const rels = tracker.getRelationships(elements);
      // Should have only 1 (deduplicated), and it should be the declared one
      const controlsRels = rels.filter((r) => r.type === 'controls');
      expect(controlsRels).toHaveLength(1);
      expect(controlsRels[0].origin).toBe('declared');
      expect(controlsRels[0].metadata).toEqual({ custom: true });
    });

    it('should return only declared relationships when no elements provided', () => {
      tracker.declare('a', 'b', 'controls');

      const rels = tracker.getRelationships();
      expect(rels).toHaveLength(1);
      expect(rels[0].origin).toBe('declared');
    });
  });

  // -------------------------------------------------------------------------
  // Snapshot context
  // -------------------------------------------------------------------------

  describe('getSnapshotRelationshipContext', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
    });

    afterEach(() => {
      document.body.removeChild(container);
    });

    it('should return correct shape with counts', () => {
      // 1 declared
      tracker.declare('a', 'b', 'controls');

      // 1 ARIA
      const btn = document.createElement('button');
      btn.id = 'btn-x';
      btn.setAttribute('aria-controls', 'panel-x');
      container.appendChild(btn);

      const panel = document.createElement('div');
      panel.id = 'panel-x';
      container.appendChild(panel);

      // 1 HTML
      const label = document.createElement('label');
      label.setAttribute('for', 'input-x');
      container.appendChild(label);

      const input = document.createElement('input');
      input.id = 'input-x';
      container.appendChild(input);

      const elements = [
        { id: 'btn-aria', element: btn },
        { id: 'panel-aria', element: panel },
        { id: 'label-html', element: label },
        { id: 'input-html', element: input },
      ];

      const ctx = tracker.getSnapshotRelationshipContext(elements);
      expect(ctx.count).toBe(3);
      expect(ctx.relationships).toHaveLength(3);
      expect(ctx.byOrigin.declared).toBe(1);
      expect(ctx.byOrigin.aria).toBe(1);
      expect(ctx.byOrigin.html).toBe(1);
    });

    it('should return zero counts when empty', () => {
      const ctx = tracker.getSnapshotRelationshipContext();
      expect(ctx.count).toBe(0);
      expect(ctx.byOrigin).toEqual({ declared: 0, aria: 0, html: 0 });
    });
  });

  // -------------------------------------------------------------------------
  // Query helpers
  // -------------------------------------------------------------------------

  describe('query helpers', () => {
    it('should return relationships for a specific element via getRelationshipsFor', () => {
      tracker.declare('a', 'b', 'controls');
      tracker.declare('c', 'a', 'labels');
      tracker.declare('d', 'e', 'toggles');

      const rels = tracker.getRelationshipsFor('a');
      expect(rels).toHaveLength(2);

      const ids = rels.map((r) => [r.source, r.target]);
      expect(ids).toContainEqual(['a', 'b']);
      expect(ids).toContainEqual(['c', 'a']);
    });

    it('should return empty array for element with no relationships', () => {
      tracker.declare('a', 'b', 'controls');

      const rels = tracker.getRelationshipsFor('z');
      expect(rels).toHaveLength(0);
    });

    it('should return target IDs via getRelatedElements', () => {
      tracker.declare('a', 'b', 'controls');
      tracker.declare('a', 'c', 'toggles');

      const related = tracker.getRelatedElements('a');
      expect(related).toHaveLength(2);
      expect(related).toContain('b');
      expect(related).toContain('c');
    });

    it('should return source IDs when element is a target', () => {
      tracker.declare('x', 'a', 'labels');
      tracker.declare('y', 'a', 'describes');

      const related = tracker.getRelatedElements('a');
      expect(related).toHaveLength(2);
      expect(related).toContain('x');
      expect(related).toContain('y');
    });

    it('should filter related elements by type', () => {
      tracker.declare('a', 'b', 'controls');
      tracker.declare('a', 'c', 'toggles');
      tracker.declare('a', 'd', 'controls');

      const related = tracker.getRelatedElements('a', 'controls');
      expect(related).toHaveLength(2);
      expect(related).toContain('b');
      expect(related).toContain('d');
    });

    it('should return unique IDs (no duplicates)', () => {
      // Same target via different types
      tracker.declare('a', 'b', 'controls');
      tracker.declare('a', 'b', 'toggles');

      const related = tracker.getRelatedElements('a');
      expect(related).toHaveLength(1);
      expect(related).toContain('b');
    });
  });

  // -------------------------------------------------------------------------
  // Auto-detection cache (refreshAutoDetected)
  // -------------------------------------------------------------------------

  describe('refreshAutoDetected', () => {
    it('should cache ARIA relationships for use without elements arg', () => {
      const input = document.createElement('input');
      input.id = 'email-input';
      const label = document.createElement('label');
      label.setAttribute('aria-controls', 'email-input');
      document.body.appendChild(input);
      document.body.appendChild(label);

      const elements = [
        { id: 'input-email', element: input },
        { id: 'label-email', element: label },
      ];

      // Before refresh, getRelationships() without elements returns only declared
      tracker.declare('a', 'b', 'controls');
      const before = tracker.getRelationships();
      expect(before).toHaveLength(1);

      // After refresh, cached auto-detected are included
      tracker.refreshAutoDetected(elements);
      const after = tracker.getRelationships();
      expect(after.length).toBeGreaterThan(1);
      expect(after.some((r) => r.origin === 'aria')).toBe(true);

      document.body.removeChild(input);
      document.body.removeChild(label);
    });

    it('should replace cached results on subsequent refresh calls', () => {
      const input = document.createElement('input');
      input.id = 'field1';
      const label = document.createElement('label');
      label.setAttribute('for', 'field1');
      document.body.appendChild(input);
      document.body.appendChild(label);

      tracker.refreshAutoDetected([
        { id: 'input-field1', element: input },
        { id: 'label-field1', element: label },
      ]);

      const first = tracker.getRelationships();
      const htmlCount = first.filter((r) => r.origin === 'html').length;
      expect(htmlCount).toBeGreaterThan(0);

      // Refresh with empty elements clears cache
      tracker.refreshAutoDetected([]);
      const second = tracker.getRelationships();
      expect(second.filter((r) => r.origin === 'html').length).toBe(0);
      expect(second.filter((r) => r.origin === 'aria').length).toBe(0);

      document.body.removeChild(input);
      document.body.removeChild(label);
    });

    it('should clear cache via clearAutoDetected()', () => {
      const el = document.createElement('div');
      el.setAttribute('aria-controls', 'target');
      const target = document.createElement('div');
      target.id = 'target';
      document.body.appendChild(el);
      document.body.appendChild(target);

      tracker.refreshAutoDetected([
        { id: 'source', element: el },
        { id: 'target-el', element: target },
      ]);
      expect(tracker.getRelationships().length).toBeGreaterThan(0);

      tracker.clearAutoDetected();
      expect(tracker.getRelationships()).toHaveLength(0);

      document.body.removeChild(el);
      document.body.removeChild(target);
    });

    it('on-demand elements arg should override cached results', () => {
      const el1 = document.createElement('div');
      el1.setAttribute('aria-controls', 'panel');
      const panel = document.createElement('div');
      panel.id = 'panel';
      document.body.appendChild(el1);
      document.body.appendChild(panel);

      // Cache some relationships
      tracker.refreshAutoDetected([
        { id: 'toggle', element: el1 },
        { id: 'panel-el', element: panel },
      ]);
      const cached = tracker.getRelationships();
      expect(cached.length).toBeGreaterThan(0);

      // Passing explicit elements should use on-demand scan, not cache
      const onDemand = tracker.getRelationships([]);
      expect(onDemand).toHaveLength(0);

      document.body.removeChild(el1);
      document.body.removeChild(panel);
    });
  });
});
