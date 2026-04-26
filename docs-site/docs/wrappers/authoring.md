---
sidebar_position: 1
---

# Authoring a Wrapper

A **wrapper** is a small program that exposes a target application to UI Bridge tooling. The qontinui runner sends action commands; your wrapper's handlers translate them into operations the target app understands. Wrappers are the user-facing product when the target isn't a React app you can instrument directly — third-party SaaS, headless tests, browser extensions, scripted Playwright sessions.

Two decisions drive the shape of every wrapper:

1. **Who initiates dispatch?** The runner (event-driven) or your own code (caller-driven)?
2. **Where does the handler run?** In the target app's browser, in a headless Chromium you control, or in pure Node?

The transport answers both at once.

## The four transports

| Transport      | Initiator | Handler runs in                                 | Use when                                                                                                                                                                                                   |
| -------------- | --------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`api`**      | caller    | Node (in-process)                               | The wrapper is a thin client wrapping a remote HTTP API. No browser, no relay.                                                                                                                             |
| **`live`**     | runner    | Node, talking to a real browser tab             | A user has a browser tab open and the runner needs to drive it. The browser tab embeds UI Bridge and registers via `/ui-bridge/ws`. Best for inspecting and driving any web app the user is already using. |
| **`headless`** | caller    | Node, controlling a Playwright Chromium         | CI / smoke tests / headless agents. Your code launches Chromium, registers handlers, dispatches actions. The runner is not in the loop.                                                                    |
| **`headed`**   | caller    | Node, controlling a visible Playwright Chromium | Same as headless, but the browser window is visible. Use during development and for debugging headless failures.                                                                                           |

The runner only initiates dispatch for `live`. `api`, `headless`, and `headed` are caller-driven — your wrapper's own code calls `transport.dispatch(action, params)` and gets the result.

## Choosing a transport

```
Are you driving a third-party HTTP API with no browser?              -> api
Is a real human-opened browser tab the target?                       -> live
Do you want CI/headless to drive a browser, no UI?                   -> headless
Do you want a visible browser for debugging?                         -> headed
```

If you're not sure, scaffold with `create-ui-bridge-wrapper` — the prompt asks which transports to support and renders templates for each.

## The 30-second wrapper

```bash
npm create ui-bridge-wrapper@latest my-wrapper
```

Pick a transport at the prompt; the scaffolder produces a working package with one `hello` action and a sanity test. Replace `hello` with the actions you actually need.

If you want to see end-to-end working examples instead, copy a sibling example:

- [`examples/wrapper-live-example`](https://github.com/qontinui/ui-bridge/tree/main/examples/wrapper-live-example) — runner-driven, registers against a temp runner, full smoke test that proves WS dispatch fires.
- [`examples/wrapper-headless-example`](https://github.com/qontinui/ui-bridge/tree/main/examples/wrapper-headless-example) — caller-driven, launches real Chromium against a fixture, full smoke test that asserts page state changed.

## Registering handlers

Every transport exposes the same registration API:

```ts
import { createTransport } from '@qontinui/ui-bridge-wrapper';

const transport = createTransport({
  kind: 'live',
  options: {
    runnerUrl: 'ws://127.0.0.1:9876/ui-bridge/ws',
    appId: 'my-wrapper',
    appName: 'My Wrapper',
    appType: 'wrapper',
  },
});

transport.register('getControlSnapshot', async (_params, ctx) => {
  return {
    elements: [{ id: 'button.submit', type: 'button', label: 'Submit', actions: ['click'] }],
    components: [],
    workflows: [],
    states: [],
    timestamp: Date.now(),
  };
});

await transport.ready();
// for `live`: stays connected; runner dispatches arrive on their own
// for `headless`/`headed`/`api`: call `transport.dispatch('action', params)` from your code
```

The handler signature is `(params, ctx) => Promise<Result>`. The `ctx` shape depends on the transport — `live` provides a response helper, `headless`/`headed` provide `{ page, browserContext, browser }` from Playwright, `api` provides `undefined`.

## What handlers should return

The runner's HTTP routes wrap your handler's return value in `{ success: true, data: <result> }`. Return whatever shape the action's wrapper SDK type declares — see [Action vocabulary](./action-vocabulary.md) for the canonical list.

If your handler throws, the runner returns `{ success: false, error: <message> }`.

## The `live` register frame

For the `live` transport, the runner expects a register frame on socket open. The wrapper SDK sends it automatically when you call `transport.ready()`, but the contract is:

```json
{
  "type": "register",
  "appId": "my-wrapper",
  "appName": "My Wrapper",
  "appType": "wrapper",
  "transport": "websocket",
  "framework": "optional",
  "version": "optional",
  "capabilities": ["optional", "list"],
  "origin": "optional",
  "pageUrl": "optional"
}
```

`appType` is required by the runner's deserializer. The SDK defaults it to `"wrapper"` if you omit `LiveTransportOptions.appType`.

The runner replies with `{ "type": "registered", "appId, "connId", "acceptedAt" }`. Once you have that, the runner can dispatch any action your wrapper has a handler for.

## Headless / headed: the lifecycle

Both transports wrap [`launchHeadlessTab`](https://github.com/qontinui/ui-bridge/tree/main/packages/ui-bridge-headless) from `@qontinui/ui-bridge-headless`:

1. `transport.ready()` launches Playwright Chromium and navigates to `options.targetUrl`.
2. If `options.uiBridgeBase` is set, the launcher polls `<uiBridgeBase>/tabs` until the relay confirms the tab registered (so the page's own UI Bridge embed is reachable). Skip if your wrapper isn't relying on the page's UI Bridge.
3. The browser stays open until `transport.close()` is called.
4. Each `transport.dispatch(action, params)` invokes the handler with `ctx = { page, browserContext, browser }`.

The handler can do anything Playwright supports: `page.click`, `page.evaluate`, `page.screenshot`, multi-page navigation, network mocking. The transport just owns the lifecycle.

`headed` differs from `headless` in exactly one launch flag — it's a one-line subclass kept for clarity and future divergence (e.g. auto-opening devtools).

## Smoke test pattern

Every wrapper should have a smoke test that proves the dispatch actually fires. The pattern in both reference examples:

- **`live`**: spawn a temp runner via the supervisor (`POST /runners/spawn-test`), launch the wrapper as a child process, `fetch` retrofitted HTTP routes from the test, assert the response contains a marker only the wrapper could have produced. See [`wrapper-live-example/tests/smoke.test.ts`](https://github.com/qontinui/ui-bridge/blob/main/examples/wrapper-live-example/tests/smoke.test.ts).
- **`headless`/`headed`**: boot a tiny `node:http` server on port 0 serving a fixture, launch the transport pointed at it, dispatch each action, assert page state changed in expected ways. See [`wrapper-headless-example/tests/smoke.test.ts`](https://github.com/qontinui/ui-bridge/blob/main/examples/wrapper-headless-example/tests/smoke.test.ts).

Use ~90s timeouts on test/hook (Playwright cold-start is slow). Reuse the `registerHandlers(transport)` helper between `src/index.ts` and the smoke test so they exercise identical handler code.

## Common pitfalls

- **WS-only wrapper not reachable.** The runner's `try_ws_dispatch` reads the active `app_id` from `sdk_connection`. WS register handshakes populate it (since [`db36037d9`](https://github.com/qontinui/qontinui-runner/commit/db36037d9)), so a single wrapper "just works." If you're running multiple wrappers, the runner's last-tab-wins routing picks the most recent registration — there's no primary-tab election yet (Phase 2).
- **Action name mismatch.** A typo in `transport.register('getControlsnaphsot', ...)` registers a handler nobody will ever invoke. The runner will silently fall back to its HTTP path and time out. The cross-language [validator](./action-vocabulary.md#validating-action-names) catches drift on the runner side; on the wrapper side, copy action names from the canonical [Action vocabulary](./action-vocabulary.md) reference.
- **Forgetting `appType` for `live`.** Older wrapper SDK builds (pre-`53dce71`) didn't send `appType` in the register frame; the runner's deserializer rejects the handshake. Make sure your `@qontinui/ui-bridge-wrapper` is current.
- **Browser cold-start in CI.** `headless`/`headed` need Chromium installed; `npx playwright install chromium` once on each CI runner. The example's smoke test takes ~400-1500 ms on warm caches; the first cold run can take 30+ seconds.

## Next

- [Action vocabulary](./action-vocabulary.md) — every action the runner dispatches and what HTTP route triggers it.
- [`wrapper-live-example`](https://github.com/qontinui/ui-bridge/tree/main/examples/wrapper-live-example) — runnable runner-driven reference.
- [`wrapper-headless-example`](https://github.com/qontinui/ui-bridge/tree/main/examples/wrapper-headless-example) — runnable caller-driven reference.
