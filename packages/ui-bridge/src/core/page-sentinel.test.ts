/**
 * The one page-sentinel resolver (`core/page-sentinel.ts`).
 *
 * That every site resolves through it is pinned by what the sites DO, where
 * the behaviour lives: the relay scroll in
 * `react/commandHandlers.pageScrollTarget.test.ts`; the scroll, the reads and
 * the assertion operands on both transports in
 * `server/element-projection.transports.test.ts`, whose scroll of `Document`,
 * `body` and `WINDOW` fails when the relay's dispatcher or the action executor
 * matches the ids itself, case-sensitively. This file pins the resolver.
 */

import { describe, expect, it } from 'vitest';
import { PAGE_SENTINEL_IDS, isPageSentinelId, resolvePageSentinel } from './page-sentinel';

describe('resolvePageSentinel', () => {
  it('a scroll resolves document, body and window to <html>, in any case', () => {
    expect(PAGE_SENTINEL_IDS).toEqual(['document', 'body', 'window']);
    for (const id of ['document', 'body', 'window', 'Document', 'WINDOW']) {
      expect(resolvePageSentinel(id, 'scroll')).toBe(document.documentElement);
    }
  });

  it('a read resolves only document — window is no element, and body is not <html>', () => {
    expect(resolvePageSentinel('document', 'read')).toBe(document.documentElement);
    expect(resolvePageSentinel('DOCUMENT', 'read')).toBe(document.documentElement);
    expect(resolvePageSentinel('body', 'read')).toBeNull();
    expect(resolvePageSentinel('window', 'read')).toBeNull();
  });

  it('anything else is not a sentinel', () => {
    for (const id of ['html', 'documentElement', 'doc', '', undefined, null, 42]) {
      expect(isPageSentinelId(id, 'scroll')).toBe(false);
      expect(resolvePageSentinel(id, 'read')).toBeNull();
    }
  });
});
