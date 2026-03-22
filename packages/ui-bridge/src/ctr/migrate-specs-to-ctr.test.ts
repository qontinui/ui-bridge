import { describe, it, expect } from 'vitest';
import type { SpecConfig } from '../specs/types';
import type { CtrConfig } from './types';
import { DEFAULT_SELECTOR_CONFIDENCE } from './types';
import { migrateSpecToCtr, rewriteSpecWithCtr } from './migrate-specs-to-ctr';

// =============================================================================
// Fixtures
// =============================================================================

function makeSpecConfig(overrides?: Partial<SpecConfig>): SpecConfig {
  return {
    version: '1.0.0',
    groups: [],
    metadata: { component: 'TestComponent' },
    ...overrides,
  };
}

const baseAssertion = {
  id: 'a1',
  description: 'Button is visible',
  category: 'element-presence' as const,
  severity: 'critical' as const,
  assertionType: 'visible' as const,
  source: 'manual' as const,
  reviewed: true,
  enabled: true,
};

// =============================================================================
// migrateSpecToCtr
// =============================================================================

describe('migrateSpecToCtr', () => {
  it('extracts elementId targets from group assertions', () => {
    const spec = makeSpecConfig({
      groups: [
        {
          id: 'g1',
          name: 'Group 1',
          description: 'Test group',
          category: 'element-presence',
          source: 'manual',
          assertions: [
            {
              ...baseAssertion,
              target: { type: 'elementId', elementId: 'submit-btn' },
            },
            {
              ...baseAssertion,
              id: 'a2',
              description: 'Input exists',
              target: { type: 'elementId', elementId: 'email-input' },
            },
          ],
        },
      ],
    });

    const result = migrateSpecToCtr(spec);

    expect(result.version).toBe('1.0.0');
    expect(result.entries).toHaveLength(2);

    const submitEntry = result.entries.find((e) => e.logicalName === 'submit-btn');
    expect(submitEntry).toBeDefined();
    expect(submitEntry!.selectors).toHaveLength(2);
    expect(submitEntry!.selectors[0]).toEqual({
      strategy: 'data-testid',
      value: 'submit-btn',
      priority: 0,
      confidence: DEFAULT_SELECTOR_CONFIDENCE,
    });
    expect(submitEntry!.selectors[1]).toEqual({
      strategy: 'id',
      value: 'submit-btn',
      priority: 1,
      confidence: DEFAULT_SELECTOR_CONFIDENCE,
    });
    expect(submitEntry!.metadata?.component).toBe('TestComponent');
    expect(submitEntry!.metadata?.description).toBe('Button is visible');

    const emailEntry = result.entries.find((e) => e.logicalName === 'email-input');
    expect(emailEntry).toBeDefined();
  });

  it('extracts elementId targets from ungrouped assertions', () => {
    const spec = makeSpecConfig({
      assertions: [
        {
          ...baseAssertion,
          target: { type: 'elementId', elementId: 'header-logo' },
        },
      ],
    });

    const result = migrateSpecToCtr(spec);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].logicalName).toBe('header-logo');
  });

  it('deduplicates same elementId across multiple assertions', () => {
    const spec = makeSpecConfig({
      groups: [
        {
          id: 'g1',
          name: 'Group 1',
          description: 'Test group',
          category: 'element-presence',
          source: 'manual',
          assertions: [
            {
              ...baseAssertion,
              target: { type: 'elementId', elementId: 'submit-btn' },
            },
            {
              ...baseAssertion,
              id: 'a2',
              description: 'Button is enabled',
              assertionType: 'enabled',
              target: { type: 'elementId', elementId: 'submit-btn' },
            },
          ],
        },
      ],
      assertions: [
        {
          ...baseAssertion,
          id: 'a3',
          target: { type: 'elementId', elementId: 'submit-btn' },
        },
      ],
    });

    const result = migrateSpecToCtr(spec);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].logicalName).toBe('submit-btn');
  });

  it('extracts elementId targets from relatedTarget', () => {
    const spec = makeSpecConfig({
      groups: [
        {
          id: 'g1',
          name: 'Layout group',
          description: 'Spatial checks',
          category: 'layout',
          source: 'manual',
          assertions: [
            {
              ...baseAssertion,
              id: 'a1',
              assertionType: 'noOverlap',
              category: 'layout',
              target: { type: 'elementId', elementId: 'panel-a' },
              relatedTarget: { type: 'elementId', elementId: 'panel-b' },
            },
          ],
        },
      ],
    });

    const result = migrateSpecToCtr(spec);
    expect(result.entries).toHaveLength(2);
    const names = result.entries.map((e) => e.logicalName).sort();
    expect(names).toEqual(['panel-a', 'panel-b']);
  });

  it('extracts elementId targets from condition targets', () => {
    const spec = makeSpecConfig({
      groups: [
        {
          id: 'g1',
          name: 'Conditional group',
          description: 'Conditional',
          category: 'state-consistency',
          source: 'manual',
          assertions: [
            {
              ...baseAssertion,
              target: { type: 'elementId', elementId: 'main-btn' },
              condition: {
                type: 'exists',
                target: { type: 'elementId', elementId: 'prereq-element' },
              },
            },
          ],
        },
      ],
    });

    const result = migrateSpecToCtr(spec);
    expect(result.entries).toHaveLength(2);
    const names = result.entries.map((e) => e.logicalName).sort();
    expect(names).toEqual(['main-btn', 'prereq-element']);
  });

  it('ignores search targets', () => {
    const spec = makeSpecConfig({
      groups: [
        {
          id: 'g1',
          name: 'Search group',
          description: 'Uses search targets',
          category: 'element-presence',
          source: 'manual',
          assertions: [
            {
              ...baseAssertion,
              target: {
                type: 'search',
                criteria: { role: 'button', name: 'Submit' },
              },
            },
            {
              ...baseAssertion,
              id: 'a2',
              target: { type: 'elementId', elementId: 'real-id' },
            },
          ],
        },
      ],
    });

    const result = migrateSpecToCtr(spec);
    // Only the elementId target should be extracted; the search target should be ignored
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].logicalName).toBe('real-id');
  });

  it('ignores ctr targets (already migrated)', () => {
    const spec = makeSpecConfig({
      groups: [
        {
          id: 'g1',
          name: 'CTR group',
          description: 'Already migrated',
          category: 'element-presence',
          source: 'manual',
          assertions: [
            {
              ...baseAssertion,
              target: { type: 'ctr', logicalName: 'already-done' },
            },
          ],
        },
      ],
    });

    const result = migrateSpecToCtr(spec);
    expect(result.entries).toHaveLength(0);
  });

  it('extracts targets from setup actions', () => {
    const spec = makeSpecConfig({
      groups: [
        {
          id: 'g1',
          name: 'Setup group',
          description: 'Has setup actions',
          category: 'element-presence',
          source: 'manual',
          assertions: [
            {
              ...baseAssertion,
              target: { type: 'elementId', elementId: 'result-label' },
            },
          ],
          setupActions: [
            { type: 'click', target: { type: 'elementId', elementId: 'trigger-btn' } },
            { type: 'wait', ms: 100 },
          ],
        },
      ],
    });

    const result = migrateSpecToCtr(spec);
    expect(result.entries).toHaveLength(2);
    const names = result.entries.map((e) => e.logicalName).sort();
    expect(names).toEqual(['result-label', 'trigger-btn']);
  });

  it('includes specId in metadata description when provided', () => {
    const spec = makeSpecConfig();
    const result = migrateSpecToCtr(spec, 'login-form');
    expect(result.metadata?.description).toContain('login-form');
  });
});

// =============================================================================
// rewriteSpecWithCtr
// =============================================================================

describe('rewriteSpecWithCtr', () => {
  it('converts elementId targets to ctr targets', () => {
    const spec = makeSpecConfig({
      groups: [
        {
          id: 'g1',
          name: 'Group 1',
          description: 'Test',
          category: 'element-presence',
          source: 'manual',
          assertions: [
            {
              ...baseAssertion,
              target: { type: 'elementId', elementId: 'submit-btn', label: 'Submit' },
            },
          ],
        },
      ],
    });

    const result = rewriteSpecWithCtr(spec);

    const target = result.groups[0].assertions[0].target;
    expect(target.type).toBe('ctr');
    expect(target).toEqual({ type: 'ctr', logicalName: 'submit-btn', label: 'Submit' });
  });

  it('converts relatedTarget and condition targets', () => {
    const spec = makeSpecConfig({
      groups: [
        {
          id: 'g1',
          name: 'Group 1',
          description: 'Test',
          category: 'layout',
          source: 'manual',
          assertions: [
            {
              ...baseAssertion,
              assertionType: 'noOverlap',
              category: 'layout',
              target: { type: 'elementId', elementId: 'panel-a' },
              relatedTarget: { type: 'elementId', elementId: 'panel-b' },
              condition: {
                type: 'exists',
                target: { type: 'elementId', elementId: 'prereq' },
              },
            },
          ],
        },
      ],
    });

    const result = rewriteSpecWithCtr(spec);
    const assertion = result.groups[0].assertions[0];

    expect(assertion.target).toEqual({ type: 'ctr', logicalName: 'panel-a' });
    expect(assertion.relatedTarget).toEqual({ type: 'ctr', logicalName: 'panel-b' });
    expect(assertion.condition?.target).toEqual({ type: 'ctr', logicalName: 'prereq' });
  });

  it('leaves search targets unchanged', () => {
    const searchTarget = {
      type: 'search' as const,
      criteria: { role: 'button', name: 'Submit' },
    };

    const spec = makeSpecConfig({
      groups: [
        {
          id: 'g1',
          name: 'Group 1',
          description: 'Test',
          category: 'element-presence',
          source: 'manual',
          assertions: [
            {
              ...baseAssertion,
              target: searchTarget,
            },
          ],
        },
      ],
    });

    const result = rewriteSpecWithCtr(spec);
    expect(result.groups[0].assertions[0].target).toEqual(searchTarget);
  });

  it('leaves ctr targets unchanged', () => {
    const ctrTarget = { type: 'ctr' as const, logicalName: 'already-migrated' };

    const spec = makeSpecConfig({
      groups: [
        {
          id: 'g1',
          name: 'Group 1',
          description: 'Test',
          category: 'element-presence',
          source: 'manual',
          assertions: [
            {
              ...baseAssertion,
              target: ctrTarget,
            },
          ],
        },
      ],
    });

    const result = rewriteSpecWithCtr(spec);
    expect(result.groups[0].assertions[0].target).toEqual(ctrTarget);
  });

  it('does not mutate the original spec', () => {
    const spec = makeSpecConfig({
      groups: [
        {
          id: 'g1',
          name: 'Group 1',
          description: 'Test',
          category: 'element-presence',
          source: 'manual',
          assertions: [
            {
              ...baseAssertion,
              target: { type: 'elementId', elementId: 'submit-btn' },
            },
          ],
        },
      ],
    });

    rewriteSpecWithCtr(spec);

    // Original should remain untouched
    expect(spec.groups[0].assertions[0].target.type).toBe('elementId');
  });

  it('converts setup action targets', () => {
    const spec = makeSpecConfig({
      groups: [
        {
          id: 'g1',
          name: 'Group 1',
          description: 'Test',
          category: 'element-presence',
          source: 'manual',
          assertions: [
            {
              ...baseAssertion,
              target: { type: 'elementId', elementId: 'result' },
            },
          ],
          setupActions: [
            { type: 'click', target: { type: 'elementId', elementId: 'trigger' } },
            { type: 'wait', ms: 50 },
          ],
        },
      ],
    });

    const result = rewriteSpecWithCtr(spec);
    const actions = result.groups[0].setupActions!;
    expect(actions[0]).toEqual({ type: 'click', target: { type: 'ctr', logicalName: 'trigger' } });
    // wait action has no target, should be unchanged
    expect(actions[1]).toEqual({ type: 'wait', ms: 50 });
  });
});
