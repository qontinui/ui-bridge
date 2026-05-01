import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { DefaultNativeActionExecutor } from '../../control/action-executor';
import type { NativeElementRef } from '../../core/types';
import { NativeUIBridgeServer } from '../http-server';
import type { NativeFindResponse } from '../../core/types';

/**
 * Routing + filter coverage for `POST /ui-bridge/control/find`.
 *
 * The bug this regresses against: prior to 0.2.1 the handler ignored the
 * `query` body field entirely and returned every registered element. The
 * test seeds a small fixture registry and asserts that each priority tier
 * (label > identifier fields > registered handlers) actually narrows the
 * response.
 */

function makeRef(): React.RefObject<NativeElementRef> {
  return { current: {} as NativeElementRef };
}

interface ParsedFindResponse {
  success: boolean;
  data: NativeFindResponse;
  timestamp: number;
}

async function callFind(
  server: NativeUIBridgeServer,
  body: Record<string, unknown>
): Promise<ParsedFindResponse> {
  const response = await server.handleRequest({
    method: 'POST',
    path: '/ui-bridge/control/find',
    headers: { 'Content-Type': 'application/json' },
    query: {},
    body,
  });
  expect(response.status).toBe(200);
  return JSON.parse(response.body) as ParsedFindResponse;
}

function ids(parsed: ParsedFindResponse): string[] {
  return parsed.data.elements.map((e) => e.id);
}

describe('POST /ui-bridge/control/find — query filtering', () => {
  function buildFixture() {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);

    // Element with a discoverable label.
    registry.registerElement('row-api-url', makeRef(), {
      type: 'text',
      label: 'API URL',
    });

    // Element matched only by accessibilityLabel.
    registry.registerElement('btn-save', makeRef(), {
      type: 'button',
      label: 'Save',
      accessibilityLabel: 'Save settings',
      props: {
        onPress: () => {
          /* noop */
        },
      },
    });

    // Element matched only by testId.
    registry.registerElement('input-token', makeRef(), {
      type: 'input',
      testId: 'auth-token',
      props: {
        onChangeText: () => {
          /* noop */
        },
      },
    });

    // Element matched only by registered handler name.
    registry.registerElement('uniq-handler-host', makeRef(), {
      type: 'custom',
      props: {
        onSubmitEditing: () => {
          /* noop */
        },
      },
    });

    // Background noise — should never match.
    registry.registerElement('row-other', makeRef(), {
      type: 'text',
      label: 'Other',
    });

    return new NativeUIBridgeServer(registry, executor);
  }

  it('returns all elements when query is missing (preserves opt-out)', async () => {
    const server = buildFixture();
    const parsed = await callFind(server, {});
    expect(parsed.success).toBe(true);
    expect(ids(parsed).sort()).toEqual(
      ['btn-save', 'input-token', 'row-api-url', 'row-other', 'uniq-handler-host'].sort()
    );
  });

  it('returns all elements when query is the empty string', async () => {
    const server = buildFixture();
    const parsed = await callFind(server, { query: '' });
    expect(parsed.data.elements.length).toBe(5);
  });

  it('matches by label (priority tier 1)', async () => {
    const server = buildFixture();
    const parsed = await callFind(server, { query: 'API URL' });
    expect(ids(parsed)).toEqual(['row-api-url']);
  });

  it('matches by accessibilityLabel (priority tier 2)', async () => {
    const server = buildFixture();
    const parsed = await callFind(server, { query: 'settings' });
    expect(ids(parsed)).toEqual(['btn-save']);
  });

  it('matches by testId (priority tier 2)', async () => {
    const server = buildFixture();
    const parsed = await callFind(server, { query: 'auth-token' });
    expect(ids(parsed)).toEqual(['input-token']);
  });

  it('matches by registered handler name (priority tier 3)', async () => {
    const server = buildFixture();
    const parsed = await callFind(server, { query: 'onSubmitEditing' });
    expect(ids(parsed)).toEqual(['uniq-handler-host']);
  });

  it('is case-insensitive', async () => {
    const server = buildFixture();
    const parsed = await callFind(server, { query: 'api url' });
    expect(ids(parsed)).toEqual(['row-api-url']);
  });

  it('returns an empty list when nothing matches', async () => {
    const server = buildFixture();
    const parsed = await callFind(server, { query: 'definitely-not-present' });
    expect(parsed.data.elements).toEqual([]);
    expect(parsed.data.total).toBe(0);
  });

  it('respects the limit parameter when query matches multiple elements', async () => {
    // Two elements share the substring "row" via their ids/treePaths.
    const server = buildFixture();
    const parsed = await callFind(server, { query: 'row', limit: 1 });
    expect(parsed.data.elements.length).toBe(1);
  });
});
