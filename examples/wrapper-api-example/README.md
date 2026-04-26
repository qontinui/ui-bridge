# wrapper-api-example

A minimal reference api-transport wrapper for the qontinui UI Bridge.

This example shows how to wrap a remote HTTP API behind UI Bridge action
vocabulary using `ApiTransport` from `@qontinui/ui-bridge-wrapper`. The api
transport is the thinnest of the four — no browser, no WebSocket, no runner.
It is a pure in-process dispatcher: caller code invokes
`transport.dispatch(actionId, params)`, the registered handler runs in Node,
and the return value flows back.

The use case is making a non-browser surface (Stripe, GitHub, an internal
microservice — here a stand-in todo list) addressable through the same
automation tooling that drives browsers via the `headless` / `headed` /
`live` transports.

## What it demonstrates

Five caller-driven actions wired to a tiny "todo list" upstream API:

| Action id    | HTTP call                  | Description                                        |
| ------------ | -------------------------- | -------------------------------------------------- |
| `listTodos`  | `GET /todos`               | Returns `{ todos: [...] }`.                        |
| `getTodo`    | `GET /todos/:id`           | Returns the todo, or `{ error: 'not_found', id }`. |
| `createTodo` | `POST /todos`              | Returns the created todo with assigned id.         |
| `toggleTodo` | `GET` + `PATCH /todos/:id` | Reads, flips `completed`, PATCHes; returns it.     |
| `deleteTodo` | `DELETE /todos/:id`        | Returns `{ deleted: id }`.                         |

The action ids are **wrapper-internal** — the caller invokes
`transport.dispatch(actionId, params)` directly. Unlike the live transport,
nothing goes over the wire to a runner. Adopters should swap these names and
implementations for whatever fits their service.

For api transport handlers, `ctx` is `undefined`. Everything the handler needs
comes from `params` and module-level state — in this example, a closed-over
`apiClient` constructed from `TARGET_API_URL`. `registerHandlers` takes
`(transport, apiClient)` so the smoke test can inject a stub-backed client.

## Run it manually

```bash
cd examples/wrapper-api-example
npm install --legacy-peer-deps
npm run build

# Point at a real upstream and list its todos:
TARGET_API_URL="http://127.0.0.1:4000" npm start

# Dispatch a specific action with params:
TARGET_API_URL="http://127.0.0.1:4000" \
  ACTION=createTodo PARAMS='{"title":"buy milk","completed":false}' \
  npm start

# Toggle one:
TARGET_API_URL="http://127.0.0.1:4000" \
  ACTION=toggleTodo PARAMS='{"id":1}' \
  npm start
```

`npm start` prints the chosen action's result as JSON, then closes the
transport and exits. Exit code is non-zero if the action throws.

## Env vars

| Var              | Default      | Notes                                          |
| ---------------- | ------------ | ---------------------------------------------- |
| `TARGET_API_URL` | _(required)_ | Base URL of the upstream HTTP API.             |
| `ACTION`         | `listTodos`  | Action id from the table above.                |
| `PARAMS`         | _(none)_     | JSON string passed as the action's params arg. |

## Smoke test

`tests/smoke.test.ts` boots a tiny in-memory todo server (`node:http` on a
random port), constructs an `ApiTransport`, registers the example's handlers
against a `fetch`-backed client pointed at the stub, dispatches every action
in sequence, and asserts the upstream calls flowed through and the data
round-tripped.

```bash
cd examples/wrapper-api-example
npm install --legacy-peer-deps
npm test
```

Receiving the expected todo back from `getTodo` after `createTodo` proves
the dispatcher invoked the handler, the handler hit the upstream, and the
upstream's response returned through the transport — i.e. the full api-
transport path fired.

## Adopting this for a real upstream

1. Swap the `Todo` types in `src/handlers.ts` for the upstream's resource
   shapes (or import them from a generated client).
2. Replace the action implementations with your domain calls. Keep the
   `(transport, apiClient)` signature so tests can inject a stub.
3. If the upstream needs auth (bearer token, OAuth refresh), wrap calls in
   `withAuthRefresh` from `@qontinui/ui-bridge-wrapper`.
4. Point `TARGET_API_URL` at the real service.

## Files

- `src/index.ts` — runnable entry point. Parses env, builds the api client,
  creates the transport, registers handlers, dispatches one action, prints
  the result, exits.
- `src/handlers.ts` — handler implementations + `registerHandlers(transport, apiClient)`,
  shared between `index.ts` and the smoke test. Also exports
  `createApiClient(baseUrl)`.
- `tests/smoke.test.ts` — end-to-end vitest run against an in-memory `node:http`
  todo stub.
- `vitest.config.ts`, `tsconfig.json`, `package.json` — standard tooling.
  Test/hook timeouts are 30s (no browser cold-start to wait on).
