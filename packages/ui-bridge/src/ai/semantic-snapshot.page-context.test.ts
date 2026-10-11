/**
 * The semantic snapshot's PageContext carries no route pattern. The one route
 * channel is the control snapshot's `page.route` (RouteInfo), whose
 * `patternSource` lets a consumer drop a pattern the app did not assert came
 * from its router. A second, unasserted pattern field would let a concrete
 * path (user input) be stored as a template.
 */
import { describe, expect, it } from 'vitest';
import { SemanticSnapshotManager } from './semantic-snapshot';
import type { PageContext } from './types';
import type { ControlSnapshot } from '../core/types';

function emptyControlSnapshot(): ControlSnapshot {
  return { timestamp: Date.now(), elements: [], components: [], workflows: [] } as ControlSnapshot;
}

describe('SemanticSnapshotManager page context', () => {
  it('has no route-pattern field, and drops one smuggled in at runtime', () => {
    const smuggled = {
      url: 'https://app.test/search/SECRETterm',
      title: 'Search',
      pageName: 'Search',
      section: 'search',
      breadcrumb: ['Search'],
      routePattern: '/search/SECRETterm',
      routeParams: { term: 'SECRETterm' },
    };
    const page = new SemanticSnapshotManager().createSnapshot(
      emptyControlSnapshot(),
      smuggled as Partial<PageContext>
    ).page;

    expect(page).not.toHaveProperty('routePattern');
    expect(page).not.toHaveProperty('routeParams');
    expect(JSON.stringify(page)).not.toContain('"/search/SECRETterm"');
    // The caller-supplied semantic fields still pass through.
    expect(page.pageName).toBe('Search');
    expect(page.section).toBe('search');
    expect(page.breadcrumb).toEqual(['Search']);
  });
});
