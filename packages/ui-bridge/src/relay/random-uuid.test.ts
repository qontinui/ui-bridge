/**
 * The relay client's UUIDs: the tab id it mints when nothing pins one, and
 * the per-instance `cid` its streams declare. `crypto.randomUUID` is defined
 * only in secure contexts, and the injected runtime also runs on plain-http
 * pages, so the same v4 shape is built from `crypto.getRandomValues` there.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUuid } from './random-uuid';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('randomUuid', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mints a fresh v4 UUID on every call', () => {
    const first = randomUuid();
    expect(first).toMatch(UUID_V4);
    expect(randomUuid()).not.toBe(first);
  });

  it('mints a fresh v4 UUID on a page with no crypto.randomUUID (a non-secure context)', () => {
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal('crypto', { getRandomValues });
    const first = randomUuid();
    expect(first).toMatch(UUID_V4);
    expect(randomUuid()).not.toBe(first);
  });
});
