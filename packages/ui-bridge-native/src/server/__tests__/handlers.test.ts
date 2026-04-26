import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry } from '../../core/registry';
import type { NativeElementRef } from '../../core/types';
import type { NativeActionExecutor } from '../../control/types';
import { createServerHandlers } from '../handlers';

/**
 * Minimal `NativeActionExecutor` stub. The handlers covered by these tests
 * (`getSnapshot`, `health`) never invoke the executor, so we just supply
 * unimplemented methods that throw if accidentally called — that way a future
 * regression that starts touching the executor in those handlers will fail
 * loudly instead of silently passing.
 */
function makeStubExecutor(): NativeActionExecutor {
  const unused = (): never => {
    throw new Error('executor method should not be called by snapshot/health handlers');
  };
  return {
    executeAction: unused,
    executeComponentAction: unused,
    find: unused,
    waitForElement: unused,
    onActionExecuted: () => () => {},
  } as unknown as NativeActionExecutor;
}

function makeRef(): React.RefObject<NativeElementRef> {
  return { current: {} as NativeElementRef };
}

describe('snapshot.registration coverage', () => {
  it('reports zero registrations and never-had-registrations on an empty registry', async () => {
    const registry = new NativeUIBridgeRegistry();
    const handlers = createServerHandlers(registry, makeStubExecutor());

    const response = await handlers.getSnapshot({ params: {}, query: {}, body: undefined });

    expect(response.success).toBe(true);
    expect(response.data?.registration).toEqual({
      totalRegistered: 0,
      everHadRegistrations: false,
      byRoute: {},
    });
  });

  it('groups elements by registrationRoute and buckets unrouted elements under "?"', async () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('with-route', makeRef(), { registrationRoute: '/foo' });
    registry.registerElement('no-route', makeRef(), {});

    const handlers = createServerHandlers(registry, makeStubExecutor());
    const response = await handlers.getSnapshot({ params: {}, query: {}, body: undefined });

    expect(response.success).toBe(true);
    expect(response.data?.registration).toEqual({
      totalRegistered: 2,
      everHadRegistrations: true,
      byRoute: { '/foo': 1, '?': 1 },
    });
  });

  it('keeps everHadRegistrations sticky after all elements unregister', async () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('a', makeRef(), { registrationRoute: '/foo' });
    registry.registerElement('b', makeRef(), { registrationRoute: '/foo' });
    registry.unregisterElement('a');
    registry.unregisterElement('b');

    const handlers = createServerHandlers(registry, makeStubExecutor());
    const response = await handlers.getSnapshot({ params: {}, query: {}, body: undefined });

    expect(response.success).toBe(true);
    expect(response.data?.registration).toEqual({
      totalRegistered: 0,
      everHadRegistrations: true,
      byRoute: {},
    });
  });

  it('counts multiple elements on the same route correctly', async () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('a', makeRef(), { registrationRoute: '/dashboard' });
    registry.registerElement('b', makeRef(), { registrationRoute: '/dashboard' });
    registry.registerElement('c', makeRef(), { registrationRoute: '/settings' });

    const handlers = createServerHandlers(registry, makeStubExecutor());
    const response = await handlers.getSnapshot({ params: {}, query: {}, body: undefined });

    expect(response.data?.registration).toEqual({
      totalRegistered: 3,
      everHadRegistrations: true,
      byRoute: { '/dashboard': 2, '/settings': 1 },
    });
  });
});

describe('health.registration coverage', () => {
  it('includes the same registration block as the snapshot handler', async () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('a', makeRef(), { registrationRoute: '/foo' });
    registry.registerElement('b', makeRef(), {});

    const handlers = createServerHandlers(registry, makeStubExecutor());
    const response = await handlers.health({ params: {}, query: {}, body: undefined });

    expect(response.success).toBe(true);
    const data = response.data as Record<string, unknown>;
    expect(data.registration).toEqual({
      totalRegistered: 2,
      everHadRegistrations: true,
      byRoute: { '/foo': 1, '?': 1 },
    });
    expect(data.status).toBe('healthy');
    expect(typeof data.timestamp).toBe('number');
  });

  it('reports an empty-registry coverage block when nothing has been registered', async () => {
    const registry = new NativeUIBridgeRegistry();
    const handlers = createServerHandlers(registry, makeStubExecutor());

    const response = await handlers.health({ params: {}, query: {}, body: undefined });

    const data = response.data as Record<string, unknown>;
    expect(data.registration).toEqual({
      totalRegistered: 0,
      everHadRegistrations: false,
      byRoute: {},
    });
  });

  it('still emits registration when appInfo is configured (alongside the uiBridge block)', async () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('a', makeRef(), { registrationRoute: '/foo' });

    const handlers = createServerHandlers(registry, makeStubExecutor(), {
      appInfo: {
        appId: 'test-app',
        appName: 'Test App',
        appType: 'mobile',
        framework: 'react-native',
      },
    });

    const response = await handlers.health({ params: {}, query: {}, body: undefined });
    const data = response.data as Record<string, unknown>;

    expect(data.registration).toEqual({
      totalRegistered: 1,
      everHadRegistrations: true,
      byRoute: { '/foo': 1 },
    });
    expect(data.uiBridge).toBeDefined();
  });
});
