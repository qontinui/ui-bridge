/**
 * Next.js HTTP-layer test for Phase 1 window targeting
 * (plan 2026-06-07-multi-window-sdk-automation).
 *
 * `GET /control/elements?windowLabel=term-2` must forward `windowLabel` into
 * the `getElements` options bag so the runner can scope element discovery to a
 * pop-out window. Empty / absent `windowLabel` must arrive as `undefined`
 * (same drop-empty rule as the other filter params), never the empty string.
 */

import { describe, expect, it, vi } from 'vitest';
import { createControlHandlers } from './nextjs';
import type { UIBridgeServerHandlers } from './types';

interface NextRequestLike extends Request {
  nextUrl: URL;
}

function makeGet(query?: string): NextRequestLike {
  const url = `https://test.local/control/elements${query ? `?${query}` : ''}`;
  const req = new Request(url, { method: 'GET' });
  Object.defineProperty(req, 'nextUrl', { value: new URL(url), writable: false });
  return req as NextRequestLike;
}

/** A handlers stub that records the options passed to `getElements`. */
function stubHandlers() {
  const getElements = vi.fn().mockResolvedValue({ success: true, data: [] });
  const handlers = { getElements } as unknown as UIBridgeServerHandlers;
  return { handlers, getElements };
}

describe('Next.js · GET /control/elements — windowLabel forwarding (Phase 1)', () => {
  it('forwards ?windowLabel= into the getElements options bag', async () => {
    const { handlers, getElements } = stubHandlers();
    const control = createControlHandlers(handlers);

    await control.elements.GET(makeGet('windowLabel=term-2'));

    expect(getElements).toHaveBeenCalledTimes(1);
    expect(getElements.mock.calls[0]![0]).toMatchObject({ windowLabel: 'term-2' });
  });

  it('omits windowLabel (undefined, not "") when absent', async () => {
    const { handlers, getElements } = stubHandlers();
    const control = createControlHandlers(handlers);

    await control.elements.GET(makeGet('text=Save'));

    expect(getElements).toHaveBeenCalledTimes(1);
    expect(getElements.mock.calls[0]![0]).toHaveProperty('windowLabel', undefined);
  });

  it('drops an empty ?windowLabel= to undefined', async () => {
    const { handlers, getElements } = stubHandlers();
    const control = createControlHandlers(handlers);

    await control.elements.GET(makeGet('windowLabel='));

    expect(getElements).toHaveBeenCalledTimes(1);
    expect(getElements.mock.calls[0]![0]).toHaveProperty('windowLabel', undefined);
  });
});
