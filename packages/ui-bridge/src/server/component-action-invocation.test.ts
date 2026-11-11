/**
 * The component-action HTTP body becomes one request: flat keys and `params`
 * merge, request fields are hoisted, and routing fields never become params.
 */

import { describe, expect, it } from 'vitest';
import {
  COMPONENT_ACTION_REQUEST_FIELDS,
  componentActionInvocation,
  componentActionRequestFields,
  componentActionRequestFromWire,
} from './component-action-invocation';
import { asIfARequestField } from '../react/__tests__/relay-into-listener';

describe('COMPONENT_ACTION_REQUEST_FIELDS', () => {
  // The compiler holds the list to `keyof ComponentActionRequest`; this pins
  // what that is today, so an edit that gets past the type shows up here.
  it('lists every ComponentActionRequest field', () => {
    expect(Object.keys(COMPONENT_ACTION_REQUEST_FIELDS).sort()).toEqual([
      'action',
      'params',
      'requestId',
      'timeoutMs',
      'verifyEffect',
    ]);
  });
});

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

  it('hoists a boolean verifyEffect onto the request, never into params', () => {
    expect(componentActionInvocation('open', { verifyEffect: true, x: 1 }).request).toEqual({
      action: 'open',
      params: { x: 1 },
      verifyEffect: true,
    });
    expect(componentActionInvocation('open', { verifyEffect: false }).request).toEqual({
      action: 'open',
      params: {},
      verifyEffect: false,
    });
  });

  // Hoisted as it is, never into params. The executor is the one place that
  // decides what a request field means, and it treats only a boolean
  // `verifyEffect` as an instruction.
  it('hoists a non-boolean verifyEffect as it is, never into params', () => {
    const { request } = componentActionInvocation('open', { verifyEffect: 'true' });
    expect(request).toEqual({ action: 'open', params: {}, verifyEffect: 'true' });
  });

  it('hoists a field added to the list instead of merging it into params', async () => {
    const { request } = await asIfARequestField('futureOptIn', async () =>
      componentActionInvocation('open', { futureOptIn: 'x', size: 1 })
    );
    expect(request).toEqual({ action: 'open', params: { size: 1 }, futureOptIn: 'x' });
  });

  // `action` is a request field, but the route's `:actionId` names the action.
  // So a body key called `action` stays the action argument it has always been.
  it('keeps a body key named action as a param, the route naming the action', () => {
    const { request } = componentActionInvocation('dispatch', { action: 'increment' });
    expect(request).toEqual({ action: 'dispatch', params: { action: 'increment' } });
  });

  it('reads the list by own key, so a prototype name is a param', () => {
    const { request } = componentActionInvocation('open', { toString: 'x', constructor: 'y' });
    expect(request).toEqual({ action: 'open', params: { toString: 'x', constructor: 'y' } });
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

describe('componentActionRequestFromWire', () => {
  it('keeps the request whole, a field nobody has heard of included', () => {
    expect(
      componentActionRequestFromWire({
        action: 'open',
        params: { size: 2 },
        timeoutMs: 'soon',
        verifyEffect: 'yes',
        requestId: 7,
        futureOptIn: 'x',
      })
    ).toEqual({
      action: 'open',
      params: { size: 2 },
      timeoutMs: 'soon',
      verifyEffect: 'yes',
      requestId: 7,
      futureOptIn: 'x',
    });
  });

  it('leaves the routing keys behind, and reads the action from actionId first', () => {
    expect(
      componentActionRequestFromWire({
        id: 'drawer',
        componentId: 'drawer',
        actionId: 'open',
        action: 'close',
        params: {},
      })
    ).toEqual({ action: 'open', params: {} });
  });

  it('falls back to action when there is no actionId', () => {
    expect(componentActionRequestFromWire({ componentId: 'drawer', action: 'close' })).toEqual({
      action: 'close',
    });
  });
});

describe('componentActionRequestFields', () => {
  it('takes each listed field as it is and leaves every other key behind', () => {
    expect(
      componentActionRequestFields({
        componentId: 'drawer',
        action: 'open',
        params: { size: 2 },
        timeoutMs: 'soon',
        verifyEffect: 'yes',
        requestId: 7,
        unlisted: 'x',
      })
    ).toEqual({
      action: 'open',
      params: { size: 2 },
      timeoutMs: 'soon',
      verifyEffect: 'yes',
      requestId: 7,
    });
  });

  it('takes a field added to the list', async () => {
    const request = await asIfARequestField('futureOptIn', async () =>
      componentActionRequestFields({ componentId: 'drawer', action: 'open', futureOptIn: 'x' })
    );
    expect(request).toEqual({ action: 'open', futureOptIn: 'x' });
  });
});
