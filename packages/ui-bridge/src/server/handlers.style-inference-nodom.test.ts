// @vitest-environment node
/**
 * The direct server transport (`createHandlers`) in a host with NO DOM — a
 * bare Node server with an empty registry. Before the fix `collectSamples`
 * read `document` even with zero candidates, so both routes threw
 * `document is not defined` instead of answering UNKNOWN. Plan:
 * 2026-11-13-ui-bridge-infers-a-draft-style-guide-and-token-drift-from-computed-styles.
 */

import { describe, expect, it } from 'vitest';
import { createHandlers, type RegistryLike } from './handlers';

function emptyRegistry(): RegistryLike {
  return { getAllElements: () => [] } as unknown as RegistryLike;
}

/** A DOM-less host turns off the browser-only monitors (fetch/XHR interception, idle detection). */
function nodomHandlers(): ReturnType<typeof createHandlers> {
  return createHandlers(emptyRegistry(), {} as never, {
    networkMonitoring: false,
    idleDetection: false,
  });
}

describe('style inference routes without a DOM', () => {
  it('there is no DOM in this environment', () => {
    expect(typeof document).toBe('undefined');
  });

  it('inferStyleGuide answers status empty with a reason', async () => {
    const handlers = nodomHandlers();
    const result = await handlers.inferStyleGuide!({});
    expect(result.success).toBe(true);
    const data = result.data as { status: string; reason?: string; capture: { notes: string[] } };
    expect(data.status).toBe('empty');
    expect(data.reason).toBeTruthy();
    expect(data.capture.notes.join(' ')).toMatch(/no DOM/);
  });

  it('diffDesignTokens answers verdict unknown with a reason', async () => {
    const handlers = nodomHandlers();
    const result = await handlers.diffDesignTokens!({ tokens: { colors: { a: '#000000' } } });
    expect(result.success).toBe(true);
    const data = result.data as { verdict: string; reason?: string };
    expect(data.verdict).toBe('unknown');
    expect(data.reason).toBeTruthy();
  });

  it('a page-custom-property source answers unknown too', async () => {
    const handlers = nodomHandlers();
    const result = await handlers.diffDesignTokens!({ pageCustomPropertyPrefix: '--' });
    expect(result.success).toBe(true);
    expect((result.data as { verdict: string }).verdict).toBe('unknown');
  });
});
