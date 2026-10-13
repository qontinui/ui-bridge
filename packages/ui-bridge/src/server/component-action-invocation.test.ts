/**
 * The component-action HTTP body becomes one request: flat keys and `params`
 * merge, request fields are hoisted, and routing fields never become params.
 */

import { describe, expect, it } from 'vitest';
import { componentActionInvocation } from './component-action-invocation';

describe('componentActionInvocation', () => {
  it('merges flat keys into params, an explicit params winning', () => {
    const { request } = componentActionInvocation('select', {
      layoutId: 'single',
      size: 1,
      params: { size: 2 },
    });
    expect(request).toEqual({ action: 'select', params: { layoutId: 'single', size: 2 } });
  });

  it('hoists timeoutMs and requestId onto the request', () => {
    const { request } = componentActionInvocation('select', { timeoutMs: 500, requestId: 'r-1' });
    expect(request).toEqual({ action: 'select', params: {}, timeoutMs: 500, requestId: 'r-1' });
  });

  it('keeps routing fields out of params and returns them separately', () => {
    const { request, routing } = componentActionInvocation('select', {
      tabId: 'tab-1',
      targetTabId: 'tab-2',
      __callerUserId: 'user-b',
      choice: 'a',
    });
    expect(request.params).toEqual({ choice: 'a' });
    expect(routing).toEqual({ tabId: 'tab-1', targetTabId: 'tab-2', __callerUserId: 'user-b' });
  });

  it('drops routing fields from an explicit params, and the reserved key at any depth', () => {
    const { request } = componentActionInvocation('select', {
      params: {
        tabId: 'tab-a',
        targetTabId: 'tab-a',
        __callerUserId: 'user-a',
        choice: 'a',
        nested: { __callerUserId: 'user-a', keep: 1 },
      },
    });
    expect(request.params).toEqual({ choice: 'a', nested: { keep: 1 } });
  });

  it('takes no body as an empty request', () => {
    expect(componentActionInvocation('open', undefined)).toEqual({
      request: { action: 'open', params: {} },
      routing: {},
    });
  });
});
