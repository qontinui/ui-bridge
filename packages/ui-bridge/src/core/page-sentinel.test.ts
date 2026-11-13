/**
 * The one page-sentinel resolver (`core/page-sentinel.ts`) and the three sites
 * that used to carry their own copy of it.
 *
 * What each site does with the element is pinned where the behaviour lives:
 * the relay scroll in `react/commandHandlers.pageScrollTarget.test.ts`; the
 * scroll, the reads and the assertion operands on both transports in
 * `server/element-projection.transports.test.ts`. This file pins the resolver
 * and that no site re-implements it.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PAGE_SENTINEL_IDS, isPageSentinelId, resolvePageSentinel } from './page-sentinel';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

describe('the three sentinel sites share it', () => {
  // Each site used to spell the ids out itself, and two of the three matched
  // them case-sensitively while the third lowercased first.
  it.each(['react/commandHandlers.ts', 'server/handlers.ts', 'control/action-executor.ts'])(
    '%s asks the shared resolver and spells no sentinel id itself',
    (file) => {
      const source = readFileSync(resolve(SRC, file), 'utf8');
      expect(source).toMatch(/from '\.\.\/core\/page-sentinel'/);
      expect(source).not.toMatch(/===\s*'window'/);
      expect(source).not.toMatch(/sentinel\s*===\s*'body'/);
    }
  );
});
