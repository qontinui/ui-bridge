/**
 * The named Next.js route helpers keep per-user tab scoping: they pass every
 * handler the verified caller context from `X-Caller-User-Id`, exactly as
 * the catch-all does, and drop a request-supplied `__callerUserId`.
 *
 * The independent review's named-helper probe, kept as an asserting test:
 * tab-a belongs to user-a and is the primary tab, tab-b belongs to user-b,
 * and every call is made as user-b.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';
import { createControlHandlers, createDebugHandlers, createRenderLogHandlers } from './nextjs';

describe('named Next.js helpers over a two-user relay', () => {
  let seen: Array<{ tab: string; action: string; payload: unknown }>;
  let relay: CommandRelay;

  beforeEach(() => {
    seen = [];
    relay = new CommandRelay({
      globalPrefix: `__uiBridgeNamed_${Math.random().toString(36).slice(2, 10)}`,
      proactiveSnapshot: false,
    });
    for (const [tab, userId] of [
      ['tab-b', 'user-b'],
      ['tab-a', 'user-a'],
    ] as const) {
      relay.subscribeToCommands((command) => {
        seen.push({ tab, action: command.action, payload: command.payload });
        setTimeout(
          () =>
            relay.resolveCommand(
              command.commandId,
              { tab, elements: [], components: [], workflows: [], timestamp: Date.now() },
              tab
            ),
          0
        );
      }, tab);
      relay.receiveHeartbeat(tab, { url: 'http://app.test/', title: tab, visibility: 'visible' });
      relay.recordRegistration(tab, { userId, sessionId: `s-${tab}` });
    }
  });

  afterEach(() => relay.destroy());

  const req = (url: string, body?: unknown) =>
    Object.assign(
      new Request(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Caller-User-Id': 'user-b' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      { nextUrl: new URL(url) }
    ) as never;

  /** [label, the call] — the review's seven, plus the rest of the helpers' routes. */
  function calls(): Array<[string, () => Promise<Response>]> {
    const handlers = createRelayHandlers(relay);
    const control = createControlHandlers(handlers);
    const debug = createDebugHandlers(handlers);
    const renderLog = createRenderLogHandlers(handlers);
    const id = { params: { id: 'save' } };
    const action = { params: { id: 'c', actionId: 'go' } };
    return [
      ['element.GET', () => control.element.GET(req('http://app.test/x'), id)],
      [
        'element.POST with a body naming another caller',
        () =>
          control.element.POST(
            req('http://app.test/x', { action: 'click', __callerUserId: 'user-a' }),
            id
          ),
      ],
      ['elements.GET', () => control.elements.GET(req('http://app.test/x'))],
      ['find.POST', () => control.find.POST(req('http://app.test/x', { text: 'a' }))],
      ['discover.POST', () => control.discover.POST(req('http://app.test/x', { text: 'a' }))],
      [
        'snapshot.GET pinned to tab-a',
        () => control.snapshot.GET(req('http://app.test/x?targetTabId=tab-a')),
      ],
      ['snapshot.GET', () => control.snapshot.GET(req('http://app.test/x'))],
      ['components.GET', () => control.components.GET(req('http://app.test/x'))],
      ['component.GET', () => control.component.GET(req('http://app.test/x'), id)],
      [
        'component.POST',
        () => control.component.POST(req('http://app.test/x', { params: {} }), action),
      ],
      [
        'componentActionPredict.POST',
        () => control.componentActionPredict.POST(req('http://app.test/x', {}), action),
      ],
      ['workflows.GET', () => control.workflows.GET(req('http://app.test/x'))],
      ['workflow.POST', () => control.workflow.POST(req('http://app.test/x', {}), id)],
      ['debug.highlight.POST', () => debug.highlight.POST(req('http://app.test/x', {}), id)],
      ['debug.actionHistory.GET', () => debug.actionHistory.GET(req('http://app.test/x?limit=2'))],
      ['renderLog.GET', () => renderLog.GET(req('http://app.test/x'))],
      ['renderLog.DELETE', () => renderLog.DELETE(req('http://app.test/x'))],
    ];
  }

  it('no helper sends a scoped caller command to another user tab, or carries the reserved key', async () => {
    const problems: string[] = [];
    for (const [label, run] of calls()) {
      const before = seen.length;
      const response = await run();
      await response.text();
      const fresh = seen.slice(before);
      if (fresh.some((s) => s.tab === 'tab-a')) problems.push(`${label}: reached tab-a`);
      if (JSON.stringify(fresh.map((s) => s.payload)).includes('user-a')) {
        problems.push(`${label}: carried another caller`);
      }
    }
    expect(problems).toEqual([]);
  });
});
