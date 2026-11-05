/**
 * `POST /control/element/:id/action` keeps the executor's OWN failure details.
 *
 * Follow-up to qontinui/ui-bridge#279 (plan
 * `2026-10-22-runner-ui-bridge-makes-an-agent-guess-its-own-vocabulary`,
 * Phase 8). The executor answers an unknown verb with `failureDetails`
 * carrying `errorCode: 'UB-UNSUPPORTED-ACTION'` and a `context` bag holding
 * `supportedActions` / `didYouMean`. This handler used to regenerate
 * `failureDetails` by sniffing the message, so an HTTP caller got
 * `UB-UNKNOWN-ERROR` and the suggestion only in prose.
 *
 * Every expectation is a hand-written literal.
 */

import { describe, it, expect } from 'vitest';
import { createHandlers, type RegistryLike } from './handlers';

function registryWith(id: string): RegistryLike {
  return {
    getAllElements: () => [],
    getElement: (elementId: string) => (elementId === id ? { id } : undefined),
    getAllComponents: () => [],
    getComponent: () => undefined,
    createSnapshot: () =>
      ({
        timestamp: 0,
        elements: [],
        components: [],
        workflows: [],
        activeRuns: [],
      }) as unknown as ReturnType<RegistryLike['createSnapshot']>,
  } as unknown as RegistryLike;
}

function executorReturning(result: Record<string, unknown>) {
  return {
    executeAction: async () => result,
    executeComponentAction: async () => ({ success: true }),
  };
}

describe('executeElementAction failure arm (ui-bridge-server)', () => {
  it("carries the executor's errorCode and didYouMean context", async () => {
    const executorDetails = {
      errorCode: 'UB-UNSUPPORTED-ACTION',
      message:
        "Unknown action 'press' for element 'submit'. This element accepts: click. Did you mean 'click'?",
      elementId: 'submit',
      context: { action: 'press', supportedActions: ['click'], didYouMean: 'click' },
    };
    const handlers = createHandlers(
      registryWith('submit'),
      executorReturning({
        success: false,
        error: executorDetails.message,
        failureDetails: executorDetails,
      }) as never
    );

    const res = await handlers.executeElementAction!('submit', { action: 'press' } as never);

    expect(res.success).toBe(false);
    expect(res.code).toBe('UB-UNSUPPORTED-ACTION');
    const data = res.data as unknown as { failureDetails: typeof executorDetails };
    expect(data.failureDetails.errorCode).toBe('UB-UNSUPPORTED-ACTION');
    expect(data.failureDetails.context).toEqual({
      action: 'press',
      supportedActions: ['click'],
      didYouMean: 'click',
    });
  });

  it("keeps a handler's hoisted code verbatim", async () => {
    const handlers = createHandlers(
      registryWith('pane'),
      executorReturning({
        success: false,
        error: 'terminal has exited',
        code: 'TERMINAL_EXITED',
        failureDetails: { errorCode: 'UB-ACTION-FAILED', message: 'terminal has exited' },
      }) as never
    );

    const res = await handlers.executeElementAction!('pane', { action: 'sendKeys' } as never);

    expect(res.code).toBe('TERMINAL_EXITED');
    const data = res.data as unknown as { failureDetails: { errorCode: string } };
    expect(data.failureDetails.errorCode).toBe('UB-ACTION-FAILED');
  });

  it('still derives details from the message when the executor sent none', async () => {
    const handlers = createHandlers(
      registryWith('btn'),
      executorReturning({ success: false, error: 'Element is disabled' }) as never
    );

    const res = await handlers.executeElementAction!('btn', { action: 'click' } as never);

    expect(res.code).toBe('UB-ELEM-NOT-ENABLED');
    const data = res.data as unknown as { failureDetails: { errorCode: string } };
    expect(data.failureDetails.errorCode).toBe('UB-ELEM-NOT-ENABLED');
  });
});
