/**
 * Vitest Test Setup
 *
 * This file is run before each test file.
 * It sets up global polyfills and mocks needed for jsdom testing, and guards
 * every file against leaving a CommandRelay subscription open (see the end).
 */

import { afterAll } from 'vitest';
import { CommandRelay, type WebSocketClient } from './server/command-relay';

// Polyfill CSS.escape for jsdom
// https://github.com/mathiasbynens/CSS.escape
if (typeof CSS === 'undefined') {
  (globalThis as unknown as { CSS: typeof CSS }).CSS = {} as typeof CSS;
}

if (typeof CSS.escape !== 'function') {
  CSS.escape = function (value: string): string {
    if (arguments.length === 0) {
      throw new TypeError('`CSS.escape` requires an argument.');
    }
    const string = String(value);
    const length = string.length;
    let index = -1;
    let codeUnit: number;
    let result = '';
    const firstCodeUnit = string.charCodeAt(0);

    if (
      // If the character is the first character and is a `-` (U+002D), and
      // there is no second character, […]
      length === 1 &&
      firstCodeUnit === 0x002d
    ) {
      return '\\' + string;
    }

    while (++index < length) {
      codeUnit = string.charCodeAt(index);
      // Note: there's no need to special-case astral symbols, surrogate
      // pairs, or lone surrogates.

      // If the character is NULL (U+0000), then the REPLACEMENT CHARACTER
      // (U+FFFD).
      if (codeUnit === 0x0000) {
        result += '\uFFFD';
        continue;
      }

      if (
        // If the character is in the range [\1-\1F] (U+0001 to U+001F) or is
        // U+007F, […]
        (codeUnit >= 0x0001 && codeUnit <= 0x001f) ||
        codeUnit === 0x007f ||
        // If the character is the first character and is in the range [0-9]
        // (U+0030 to U+0039), […]
        (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
        // If the character is the second character and is in the range [0-9]
        // (U+0030 to U+0039) and the first character is a `-` (U+002D), […]
        (index === 1 && codeUnit >= 0x0030 && codeUnit <= 0x0039 && firstCodeUnit === 0x002d)
      ) {
        // https://drafts.csswg.org/cssom/#escape-a-character-as-code-point
        result += '\\' + codeUnit.toString(16) + ' ';
        continue;
      }

      // If the character is not handled by one of the above rules and is
      // greater than or equal to U+0080, is `-` (U+002D) or `_` (U+005F), or
      // is in one of the ranges [0-9] (U+0030 to U+0039), [A-Z] (U+0041 to
      // U+005A), or [a-z] (U+0061 to U+007A), […]
      if (
        codeUnit >= 0x0080 ||
        codeUnit === 0x002d ||
        codeUnit === 0x005f ||
        (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
        (codeUnit >= 0x0041 && codeUnit <= 0x005a) ||
        (codeUnit >= 0x0061 && codeUnit <= 0x007a)
      ) {
        // the character itself
        result += string.charAt(index);
        continue;
      }

      // Otherwise, the escaped character.
      // https://drafts.csswg.org/cssom/#escape-a-character
      result += '\\' + string.charAt(index);
    }

    return result;
  };
}

// ============================================================================
// Guard: no test file may leave a CommandRelay subscription open
// ============================================================================
//
// A relay subscription arms proactive-snapshot timers (500 ms, then 1500 ms)
// that send a command, and sending logs. Left open, they fire after the
// file's last test, and a console call still being forwarded when the worker
// closes its RPC channel fails the whole run with every test green
// (EnvironmentTeardownError, "Closing rpc while onUserConsoleLog was
// pending"). So every subscription a file opens is recorded here, and the
// file fails after its last test while one is still open.
//
// Two doors open one, and a later `destroy()` of the relay closes both: it
// clears every warm-up timer either door armed and forgets every listener and
// client. Only the records open at `destroy()` time are closed — a
// subscription opened on the relay after `destroy()` is live.
// - SSE: `subscribeToCommands` and `openCommandStream` both reach the private
//   `addCommandListener`. Closed by the unsubscribe it returns, or by a later
//   `destroy()`. Recorded whatever `proactiveSnapshot` says, on purpose: an
//   open SSE subscription means its relay was not destroyed since it opened,
//   so the relay's cleanup interval may still run, and the same leak logs
//   again the moment the warm-up snapshot is turned back on. With it off, the
//   warm-up timer itself is inert.
// - WebSocket: `registerWebSocketClient` on a relay with proactive snapshots
//   on. Closed by `unregisterWebSocketClient`, or by a later `destroy()`. With
//   proactive snapshots off the registration arms only an inert timer, so it
//   is not recorded.
//
// The private method is reached through an `unknown` cast, and every wrapped
// method is checked at setup: a renamed one throws here rather than leaving
// the guard silently disarmed. One boundary remains: a test that calls
// `vi.resetModules()` and then imports `command-relay` dynamically gets a
// fresh, unwrapped class. No test does that today. This file's `afterAll` is
// registered before the test file's own hooks, so it runs after them.

type RelayTransport =
  | { door: 'sse'; relay: CommandRelay; opened: Error; closed: boolean }
  | { door: 'ws'; relay: CommandRelay; clientId: string; opened: Error; closed: boolean };

const relayTransports: RelayTransport[] = [];

const relayPrototype = CommandRelay.prototype as unknown as Record<string, unknown>;

/** The prototype method `name`, or a setup-time throw that names it. */
function relayMethod<F extends (...args: never[]) => unknown>(name: string): F {
  const method = relayPrototype[name];
  if (typeof method !== 'function') {
    throw new Error(
      `test-setup: CommandRelay.prototype.${name} is not a function, so the ` +
        'open-subscription guard cannot wrap it. Point the guard at the method that now does its job.'
    );
  }
  return method as F;
}

const addCommandListener =
  relayMethod<
    (this: CommandRelay, ...args: unknown[]) => { streamId: string; unsubscribe: () => void }
  >('addCommandListener');
const destroy = relayMethod<(this: CommandRelay) => void>('destroy');
const registerWebSocketClient =
  relayMethod<(this: CommandRelay, client: WebSocketClient) => void>('registerWebSocketClient');
const unregisterWebSocketClient = relayMethod<(this: CommandRelay, clientId: string) => void>(
  'unregisterWebSocketClient'
);

/** Where a transport is being opened. Deep enough to reach the test frames below a helper. */
function openedHere(): Error {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 50;
  try {
    return new Error('opened here');
  } finally {
    Error.stackTraceLimit = limit;
  }
}

/** Whether `relay` sends a WebSocket client its warm-up snapshot. */
function sendsProactiveSnapshot(relay: CommandRelay): boolean {
  const value = (relay as unknown as { proactiveSnapshot?: unknown }).proactiveSnapshot;
  if (typeof value !== 'boolean') {
    throw new Error(
      'test-setup: CommandRelay#proactiveSnapshot is not a boolean, so the open-subscription ' +
        'guard cannot tell whether a WebSocket client arms a snapshot timer.'
    );
  }
  return value;
}

relayPrototype.addCommandListener = function (this: CommandRelay, ...args: unknown[]) {
  const stream = addCommandListener.apply(this, args);
  const transport: RelayTransport = {
    door: 'sse',
    relay: this,
    opened: openedHere(),
    closed: false,
  };
  relayTransports.push(transport);
  return {
    ...stream,
    unsubscribe: () => {
      transport.closed = true;
      stream.unsubscribe();
    },
  };
};

relayPrototype.destroy = function (this: CommandRelay) {
  // Every subscription open now, through either door: `destroy()` clears the
  // timers of both. One opened after `destroy()` is live.
  for (const transport of relayTransports) {
    if (transport.relay === this) transport.closed = true;
  }
  destroy.call(this);
};

relayPrototype.registerWebSocketClient = function (this: CommandRelay, client: WebSocketClient) {
  registerWebSocketClient.call(this, client);
  if (sendsProactiveSnapshot(this)) {
    relayTransports.push({
      door: 'ws',
      relay: this,
      clientId: client.clientId,
      opened: openedHere(),
      closed: false,
    });
  }
};

relayPrototype.unregisterWebSocketClient = function (this: CommandRelay, clientId: string) {
  for (const transport of relayTransports) {
    if (transport.door === 'ws' && transport.relay === this && transport.clientId === clientId) {
      transport.closed = true;
    }
  }
  unregisterWebSocketClient.call(this, clientId);
};

/**
 * The subscriptions recorded on `relay` that the guard would flag now. Read by
 * the guard's own tests (`server/command-relay.destroy.test.ts`); this setup
 * file is the module those tests import, so they see the same records.
 */
export function openRelaySubscriptions(
  relay: CommandRelay
): ReadonlyArray<{ door: 'sse' | 'ws'; clientId?: string }> {
  return relayTransports
    .filter((transport) => transport.relay === relay && !transport.closed)
    .map((transport) =>
      transport.door === 'ws'
        ? { door: transport.door, clientId: transport.clientId }
        : { door: transport.door }
    );
}

/** The first two test-file frames of where `transport` was opened. */
function testFileFrames(transport: RelayTransport): string[] {
  const callers = (transport.opened.stack ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('at ') && !line.includes('test-setup.ts'));
  const inTestFiles = callers.filter((frame) => /\.test\.tsx?:\d+/.test(frame)).slice(0, 2);
  return inTestFiles.length > 0
    ? inTestFiles
    : ['(no test-file frame on the stack)', ...callers.slice(0, 2)];
}

afterAll(() => {
  const open = relayTransports.filter((transport) => !transport.closed);
  relayTransports.length = 0;
  if (open.length === 0) return;
  const entries = open.map((transport, index) => {
    const [what, remedy] =
      transport.door === 'sse'
        ? [
            'SSE subscription (its relay was not destroyed since it opened, so its cleanup interval may still run)',
            'call the unsubscribe, or relay.destroy(), in afterEach (afterAll for a relay built in beforeAll)',
          ]
        : [
            `WebSocket client "${transport.clientId}"`,
            'unregister the WebSocket client (relay.unregisterWebSocketClient), or call relay.destroy(), in afterEach (afterAll for a relay built in beforeAll)',
          ];
    return [
      `  ${index + 1}. ${what}, opened at:`,
      ...testFileFrames(transport).map((frame) => `       ${frame}`),
      `     Remedy: ${remedy}.`,
    ].join('\n');
  });
  throw new Error(
    `${open.length} CommandRelay subscription(s) left open after the file's last test. ` +
      'With the warm-up snapshot on (the default), their timers send and log while the ' +
      'worker tears down, which fails the run with every test green.\n' +
      entries.join('\n')
  );
});
