/**
 * `executeComponentAction` answers a `useUIComponent` refusal
 * (`ComponentActionUnavailableError`) the way it answers an unknown action,
 * whichever bundled copy of the error class threw it.
 *
 * tsup bundles every entry point on its own (`splitting: false`), so the hook
 * that throws the refusal and the executor that catches it can each hold a
 * different copy of the class, and an `instanceof` check would miss the one it
 * did not construct. The class carries a `Symbol.for` brand for that reason.
 * This file makes the two copies real: `vi.resetModules()` and a dynamic import
 * give a SECOND instance of `core/component-action-unavailable`, whose class is
 * a different object from the one the executor imported.
 *
 * Every expectation is a hand-written literal.
 */

import { describe, it, expect, vi } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { ComponentActionUnavailableError } from '../core/component-action-unavailable';
import { DefaultActionExecutor } from './action-executor';

describe('DefaultActionExecutor — a component action refusal', () => {
  it('answers UB-UNSUPPORTED-ACTION for a refusal thrown from another copy of the class', async () => {
    vi.resetModules();
    const secondCopy = await import('../core/component-action-unavailable');
    // Two module instances: a different class object, so `instanceof` against
    // the executor's copy is false and only the brand can recognise the throw.
    expect(secondCopy.ComponentActionUnavailableError).not.toBe(ComponentActionUnavailableError);
    const refusal = new secondCopy.ComponentActionUnavailableError('panel', 'delete');
    expect(refusal instanceof ComponentActionUnavailableError).toBe(false);

    const registry = new UIBridgeRegistry();
    registry.registerComponent('panel', {
      name: 'Panel',
      actions: [
        {
          id: 'delete',
          handler: () => {
            throw refusal;
          },
        },
      ],
    });
    const response = await new DefaultActionExecutor(registry).executeComponentAction('panel', {
      action: 'delete',
    });

    expect(response.success).toBe(false);
    expect(response.error).toBe(
      'Action "delete" is no longer declared by component "panel": its latest committed render withdrew it. Read the component again before calling one of its actions.'
    );
    expect(response.failureDetails?.errorCode).toBe('UB-UNSUPPORTED-ACTION');
    // Nothing crashed, so there is no stack to report.
    expect(response.stack).toBeUndefined();
  });

  // The control: the brand, not the catch, decides the code. A handler that
  // simply fails is still a handler failure.
  it('still answers an ordinary handler throw as UB-ACTION-FAILED, with its stack', async () => {
    const registry = new UIBridgeRegistry();
    registry.registerComponent('panel', {
      name: 'Panel',
      actions: [
        {
          id: 'save',
          handler: () => {
            throw new Error('disk full');
          },
        },
      ],
    });
    const response = await new DefaultActionExecutor(registry).executeComponentAction('panel', {
      action: 'save',
    });

    expect(response.success).toBe(false);
    expect(response.error).toBe('disk full');
    expect(response.failureDetails?.errorCode).toBe('UB-ACTION-FAILED');
    expect(typeof response.stack).toBe('string');
  });
});
