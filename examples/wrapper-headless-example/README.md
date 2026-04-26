# wrapper-headless-example

A minimal reference Playwright-transport wrapper for the qontinui UI Bridge.

This example shows how to drive any web app with the same handler code under
two transports from `@qontinui/ui-bridge-wrapper`:

- `HeadlessTransport` — Playwright Chromium with no visible window. CI default.
- `HeadedTransport` — Playwright Chromium with a visible window. Debugging.

Both launch the browser through `@qontinui/ui-bridge-headless` internally; the
only difference is the `headless` flag the transport forwards.

## What it demonstrates

Five caller-driven actions, registered against a real `playwright.Page`:

| Action id        | Description                                                      |
| ---------------- | ---------------------------------------------------------------- |
| `getHeadingText` | Reads `document.querySelector('h1').textContent`.                |
| `clickButton`    | Clicks `button[data-test="primary"]`; returns before/after text. |
| `fillInput`      | Fills `input[name="email"]`; reads value back from the DOM.      |
| `screenshot`     | Captures a PNG via `page.screenshot()`; returns byte length.     |
| `getMetrics`     | `{ url, viewport, userAgent }` from the live page.               |

The action ids are **wrapper-internal** — the caller invokes
`transport.dispatch(actionId, params)` directly. Unlike the live transport,
nothing goes over the wire to a runner. Adopters should swap these names and
implementations for whatever fits their app.

## Run it manually

```bash
cd examples/wrapper-headless-example
npm install --legacy-peer-deps
npm run build

# Headless (default) — no visible window. Default action: getMetrics.
TARGET_URL="https://example.com" npm start

# Headed (visible Chrome window) — handy when an action misbehaves.
HEADED=1 TARGET_URL="https://example.com" npm start

# Drive a specific action with params:
HEADED=1 TARGET_URL="http://localhost:3000" \
  ACTION=fillInput PARAMS='{"value":"a@b.c"}' \
  npm start
```

`npm start` prints the chosen action's result as JSON, then closes the
browser and exits. Exit code is non-zero if the action throws.

## Env vars

| Var               | Default      | Notes                                                     |
| ----------------- | ------------ | --------------------------------------------------------- |
| `TARGET_URL`      | _(required)_ | URL the browser should open before dispatching.           |
| `HEADED`          | `0`          | Set to `1` (or `true`) to launch a visible Chrome window. |
| `ACTION`          | `getMetrics` | Action id from the table above.                           |
| `PARAMS`          | _(none)_     | JSON string passed as the action's params arg.            |
| `VIEWPORT_WIDTH`  | `1280`       | Browser viewport width in px.                             |
| `VIEWPORT_HEIGHT` | `720`        | Browser viewport height in px.                            |

## Smoke test

`tests/smoke.test.ts` boots a local HTTP server that serves a tiny fixture
page (heading + button + input), launches `HeadlessTransport` against it,
dispatches all five actions, and asserts page state changed in the expected
ways.

```bash
cd examples/wrapper-headless-example
npm install --legacy-peer-deps
npm test
```

The test only exercises the headless path. Headed mode requires a visible
display; on CI just set `HEADED=0` (the default) and the test stays green.

Playwright's Chromium binary needs to be installed once on the host:

```bash
npx playwright install chromium
```

(Already done on this machine — `D:\Users\<you>\AppData\Local\ms-playwright\chromium-1217`.)

## Files

- `src/index.ts` — runnable entry point. Parses env, creates the transport,
  dispatches one action, prints the result, exits.
- `src/handlers.ts` — handler implementations + `registerHandlers(transport)`,
  shared between `index.ts` and the smoke test.
- `tests/fixtures/page.html` — minimal static HTML the smoke test serves.
- `tests/smoke.test.ts` — end-to-end vitest run against `HeadlessTransport`.
- `vitest.config.ts`, `tsconfig.json`, `package.json` — standard tooling.
  Test/hook timeouts are 90s because Playwright cold-starts can take 10–30s
  on a fresh profile.
