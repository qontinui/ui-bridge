import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { DefaultNativeActionExecutor } from '../../control/action-executor';
import type { NativeElementRef } from '../../core/types';
import { NativeUIBridgeServer } from '../http-server';

/**
 * An unknown verb over HTTP (plan
 * 2026-10-22-runner-ui-bridge-makes-an-agent-guess-its-own-vocabulary,
 * Phase 8): `POST /ui-bridge/control/element/:id/action` answers HTTP 400 with
 * `code: UNKNOWN_ACTION` (a client-input problem, not `NOT_SUPPORTED`'s 501),
 * and the envelope's message names the element's verbs and the suggestion.
 */

interface ParsedResponse {
  success: boolean;
  error?: string;
  code?: string;
}

async function postAction(action: string): Promise<{ status: number; parsed: ParsedResponse }> {
  const registry = new NativeUIBridgeRegistry();
  registry.registerElement(
    'save',
    { current: {} as unknown as NativeElementRef },
    {
      type: 'pressable',
      label: 'Save',
      props: { onPress: () => undefined },
      actions: ['focus', 'press', 'longPress'],
    }
  );
  const server = new NativeUIBridgeServer(registry, new DefaultNativeActionExecutor(registry));
  const res = await server.handleRequest({
    method: 'POST',
    path: '/ui-bridge/control/element/save/action',
    headers: {},
    query: {},
    body: { action },
  });
  return { status: res.status, parsed: JSON.parse(res.body) as ParsedResponse };
}

describe('native HTTP — unknown action envelope', () => {
  it('`tap` answers 400 UNKNOWN_ACTION naming the verbs and the suggestion', async () => {
    const { status, parsed } = await postAction('tap');
    expect(status).toBe(400);
    expect(parsed.success).toBe(false);
    expect(parsed.code).toBe('UNKNOWN_ACTION');
    expect(parsed.error).toBe(
      "Unknown action 'tap' for element 'save'. " +
        "This element accepts: focus, press, longPress. Did you mean 'press'?"
    );
  });

  it('a verb with no match answers 400 UNKNOWN_ACTION without a suggestion', async () => {
    const { status, parsed } = await postAction('frobnicate');
    expect(status).toBe(400);
    expect(parsed.code).toBe('UNKNOWN_ACTION');
    expect(parsed.error).not.toContain('Did you mean');
  });
});
