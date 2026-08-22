# Interaction Recording

UI Bridge can record a session of real user interactions, together with a DOM
fingerprint snapshot taken before and after each one, and export the result as
**co-occurrence data** — the input a state machine is bootstrapped from.

Read the scope carefully, because it is narrower than the name suggests:

- Recording is a **server-side session**, driven over the bridge WebSocket with
  the `recording:*` message family. There is no client-side recorder class to
  construct.
- The output is a `CooccurrenceExportData` document — fingerprints, a presence
  matrix, transitions and state candidates — **not** a replayable action script.
- **There is no playback.** UI Bridge does not ship a player, a step/seek
  control, or a script exporter. To re-drive a flow, use the control API
  (`executeAction` / workflows) against the elements the recording identified.

## Enabling Recording

The recording session manager is constructed only when the WebSocket handler is
given a registry. On the standalone server that is the `recording` config field:

```typescript
import { createStandaloneServer, createHandlers } from '@qontinui/ui-bridge/server';
import { createActionExecutor, getGlobalRegistry } from '@qontinui/ui-bridge';

const registry = getGlobalRegistry();
const handlers = createHandlers(registry, createActionExecutor(registry));

const server = await createStandaloneServer(handlers, {
  port: 9876,
  websocket: true,
  recording: { registry },
});
```

`recording` also accepts an optional `changeObserver`, which the session manager
uses to correlate DOM changes with the interaction that caused them:

```typescript
import type { ChangeObserver } from '@qontinui/ui-bridge';

const server = await createStandaloneServer(handlers, {
  port: 9876,
  websocket: true,
  recording: { registry, changeObserver },
});
```

If you omit `recording` entirely, the WebSocket still works — the recording
messages just answer `RECORDING_UNAVAILABLE` (see [Errors](#errors) below).

## The `recording:*` Protocol

Every message rides the standard bridge WebSocket envelope: an `id` you choose
for request/response correlation, a `type`, and a `timestamp`. The server
answers with a `response` message carrying your `id` in `requestId`.

The message interfaces are exported as types so you can build them without
hand-rolling the shapes:

```typescript
import type {
  WSRecordingStartMessage,
  WSRecordingStopMessage,
  WSRecordingStatusMessage,
  WSRecordingAutoSaveMessage,
  WSRecordingRecoverMessage,
  WSResponseMessage,
  WSErrorMessage,
} from '@qontinui/ui-bridge';
```

### `recording:start`

Begins a session. The optional `payload.config` tunes capture behaviour:

```typescript
const start: WSRecordingStartMessage = {
  id: 'req-1',
  type: 'recording:start',
  timestamp: Date.now(),
  payload: {
    config: {
      // Settle time in ms before the "after" snapshot is taken. Default 300.
      debounceMs: 300,
      // Max fingerprint snapshots stored for the session. Default 500.
      maxCaptures: 500,
      // Only capture interactions on registered elements. Default true.
      filterUnregistered: true,
      // Keystroke coalescing window in ms. Default 100.
      keystrokeCoalesceMs: 100,
      // Interval in ms for periodic auto-save exports. Default 30000.
      autoSaveIntervalMs: 30_000,
    },
  },
};

ws.send(JSON.stringify(start));
```

The response `data` is the recording status (the same shape
`recording:status` returns).

### `recording:stop`

Ends the session and returns the export:

```typescript
const stop: WSRecordingStopMessage = {
  id: 'req-2',
  type: 'recording:stop',
  timestamp: Date.now(),
};

ws.send(JSON.stringify(stop));
```

The response `data` is the session result:

```json
{
  "sessionId": "…",
  "duration": 48213,
  "interactionCount": 17,
  "captureCount": 34,
  "variables": [
    {
      "fingerprint": "…",
      "elementId": "email-input",
      "inputType": "text",
      "enteredValue": "…",
      "label": "Email",
      "suggestedParamName": "email"
    }
  ],
  "exportData": {
    "sessionId": "…",
    "exportedAt": 1730000000000,
    "allFingerprints": ["…"],
    "fingerprintDetails": {},
    "presenceMatrix": [],
    "cooccurrenceCounts": {},
    "fingerprintStats": {},
    "transitions": [],
    "stateCandidates": []
  }
}
```

`variables` is the recorder's guess at which inputs are parameters — each entry
names the element, the value that was typed, its label, and a camelCase
`suggestedParamName` to use when turning the flow into a parameterised workflow.
Values and labels are scrubbed before they leave the session.

### `recording:status`

Polls the session without disturbing it:

```typescript
const status: WSRecordingStatusMessage = {
  id: 'req-3',
  type: 'recording:status',
  timestamp: Date.now(),
};
```

The response `data` is:

```json
{ "active": true, "sessionId": "…", "duration": 12040, "interactionCount": 5, "captureCount": 9 }
```

Status is the one recording message that answers even when recording was never
configured — in that case it reports `{ active: false, duration: 0,
interactionCount: 0, captureCount: 0 }` rather than erroring, so a client can
feature-detect with it.

### `recording:autosave` and `recording:recover`

A long session is worth protecting against a dropped connection. The session
manager emits a partial export every `autoSaveIntervalMs`; the server keeps the
most recent one, and a client can also push one explicitly:

```typescript
const autosave: WSRecordingAutoSaveMessage = {
  id: 'req-4',
  type: 'recording:autosave',
  timestamp: Date.now(),
  payload: { exportData },
};
```

The response is `{ "stored": true }`. An autosave with no `exportData` in the
payload is rejected with `AUTOSAVE_INVALID`.

After reconnecting, ask for what survived:

```typescript
const recover: WSRecordingRecoverMessage = {
  id: 'req-5',
  type: 'recording:recover',
  timestamp: Date.now(),
};
```

The response is `{ "recovered": true, "exportData": { … } }`, or
`{ "recovered": false, "exportData": null }` when nothing was stored. Recovery
never errors — check `recovered`, not the message type.

Only the **last** auto-saved export is retained, and it is held in the server
process's memory. It does not survive a server restart.

## Errors

Failures arrive as an `error` message, not a `response`, carrying a `code` in
`payload`:

| Code | Meaning |
| --- | --- |
| `RECORDING_UNAVAILABLE` | The server was started without a `recording` registry. Returned by `recording:start` and `recording:stop`. |
| `RECORDING_START_ERROR` | The session manager threw while starting. Note that starting an already-active session is *not* an error — `start` is idempotent and returns the running session's status. |
| `RECORDING_STOP_ERROR` | The session manager threw while stopping — most commonly `No active recording session`, i.e. a `recording:stop` with nothing running. |
| `AUTOSAVE_INVALID` | `recording:autosave` arrived with no `exportData`. |
| `AUTOSAVE_ERROR` | The autosave payload could not be read. |

## A Complete Session

```typescript
import type { WSResponseMessage } from '@qontinui/ui-bridge';

const ws = new WebSocket('ws://localhost:9876');
const pending = new Map<string, (data: unknown) => void>();

ws.addEventListener('message', (evt) => {
  const msg = JSON.parse(evt.data as string) as WSResponseMessage;
  if (msg.type === 'response') {
    pending.get(msg.requestId)?.(msg.payload.data);
    pending.delete(msg.requestId);
  }
});

function send(type: string, payload?: unknown): Promise<unknown> {
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, type, timestamp: Date.now(), payload }));
  });
}

await send('recording:start', { config: { debounceMs: 300 } });
// … a person drives the UI …
const result = await send('recording:stop');
```

## What To Do With The Export

`exportData` is co-occurrence data, so it answers structural questions: which
elements are present together, which transitions were observed, and which
fingerprint clusters look like distinct application states (`stateCandidates`).
That is the raw material for building a state machine — see
[State Machine Integration](../state/state-machine-integration.md).

It is deliberately not an action log you can hand back to a player. If you want
a repeatable flow, model it as a workflow and run it through the control API;
the recording's `variables` list tells you which fields should become workflow
parameters.
