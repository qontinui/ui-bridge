# wrapper-live-example

A minimal reference WebSocket-transport wrapper for the qontinui runner.

This example connects to a runner's `/ui-bridge/ws` endpoint via the public
`LiveSessionTransport` from `@qontinui/ui-bridge-wrapper`, registers a
representative subset of the relay action vocabulary, and prints every
command frame it dispatches.

It is intended as the canonical "what does a real wrapper look like?" answer
for adopters. It does **not** drive a real app — every handler returns a
realistic-shaped stub so the focus stays on the WS plumbing.

## What it demonstrates

The runner's retrofitted SDK control routes (`mcp/sdk_client.rs`) call
`try_ws_dispatch` before falling back to HTTP/IPC. When this wrapper is
registered, those routes return whatever the matching handler emits.

Wired actions (full list in `src/index.ts`):

| HTTP route                                       | Action id              |
| ------------------------------------------------ | ---------------------- |
| `GET  /ui-bridge/sdk/control/snapshot`           | `getControlSnapshot`   |
| `GET  /ui-bridge/sdk/control/element/:id`        | `getElement`           |
| `POST /ui-bridge/sdk/control/element/:id/action` | `executeElementAction` |
| `GET  /ui-bridge/sdk/control/forms`              | `getForms`             |
| `POST /ui-bridge/sdk/control/fill`               | `fillForm`             |
| `POST /ui-bridge/sdk/control/discover`           | `find`                 |
| `GET  /ui-bridge/sdk/control/console-errors`     | `getConsoleErrors`     |

## Run it manually

1. Start the supervisor (it must be reachable on `http://127.0.0.1:9875`).
2. Spawn a temp runner:

   ```bash
   curl -X POST http://127.0.0.1:9875/runners/spawn-test \
     -H 'Content-Type: application/json' \
     -d '{"rebuild":false,"wait":true}'
   ```

   Note the `runner_id` and `port` in the response.

3. Build (or just run with `tsx`) the wrapper from this package:

   ```bash
   cd examples/wrapper-live-example
   npm install
   RUNNER_URL=ws://127.0.0.1:<port>/ui-bridge/ws \
   APP_ID=demo-wrapper \
   APP_NAME="Demo Wrapper" \
   npm run start
   ```

   You should see `status: connecting` → `status: ready` →
   `handshake complete; awaiting commands.`

4. From another shell, hit a retrofitted route. The wrapper logs the inbound
   command frame, the route returns the wrapper's handler output:

   ```bash
   curl http://127.0.0.1:<port>/ui-bridge/sdk/control/snapshot
   # -> { "success": true, "data": { "elements": [...], "url": "ws-app://demo-wrapper", ... } }
   ```

   The wrapper console will show:

   ```
   [...] <- command  action=getControlSnapshot {}
   [...] -> response action=getControlSnapshot {"success":true,"data":{...}}
   ```

5. Stop the temp runner when done:

   ```bash
   curl -X POST http://127.0.0.1:9875/runners/<runner_id>/stop
   ```

## Smoke test

`tests/smoke.test.ts` automates the full pipeline (spawn runner, launch
wrapper, drive five routes via `fetch`, assert the wrapper's distinctive
output, tear down). It requires the supervisor on port 9875.

```bash
cd examples/wrapper-live-example
npm install
npm test
```

Each assertion checks for a marker that only the wrapper handler emits
(e.g. `data.url === "ws-app://wrapper-live-example"` for the snapshot,
`filledCount` for the fill response). Receiving them proves the WS path
fired — HTTP fallback would either 502 or return an IPC-shaped payload
without those keys.

## Required register-frame fields

The runner's `RegisterFrame` schema (`src-tauri/src/mcp/ws_relay.rs`)
requires `appId`, `appName`, and `appType`. The example forwards these
through `LiveSessionTransport`'s `options` (`appType` defaults to
`"wrapper"` if not set).

## Files

- `src/index.ts` — the runnable wrapper script (CLI flags / env vars,
  handler registration, signal handling).
- `tests/smoke.test.ts` — end-to-end smoke test driven through the
  supervisor on port 9875.
- `vitest.config.ts`, `tsconfig.json`, `package.json` — standard tooling.
