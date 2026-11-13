# @qontinui/ui-bridge-headless

Playwright-backed browser launcher for UI Bridge testing. Spin up a real
Chromium tab that loads your app, registers with the UI Bridge relay like
any normal browser tab, and stays connected so tests and CI can drive the
web surface through UI Bridge — no human-opened browser required.

## Why

`@qontinui/ui-bridge-server`'s command relay needs a live browser tab
subscribed to its SSE / WebSocket stream. Without one, every control
command returns:

> No browser connected — no WebSocket clients and no SSE listeners.
> Ensure the web app is open in a browser tab.

This package is the automated answer: it launches a real browser, loads
your app, and lets UI Bridge treat it as an ordinary tab.

## Install

```bash
npm install --save-dev @qontinui/ui-bridge-headless
npx playwright install chromium     # one-time, fetches the browser binary
```

## CLI

```bash
# Visible window (default) — useful for watching a test flow
ui-bridge-tab --url http://localhost:3001/vga/builder \
  --ui-bridge http://localhost:3001/api/ui-bridge

# Truly headless — for CI
ui-bridge-tab --url http://localhost:3001/vga/builder \
  --ui-bridge http://localhost:3001/api/ui-bridge \
  --headless

# Auto-close after N seconds instead of holding the tab forever
ui-bridge-tab --url http://localhost:9876 \
  --ui-bridge http://localhost:9876/ui-bridge \
  --keep-alive 120
```

When `--ui-bridge <base>` is provided, the CLI polls `<base>/tabs` until
it reports a registered tab — so the moment the CLI prints
`UI Bridge tab registered` you know the relay can accept commands.

Exit: `Ctrl+C` cleanly closes the browser. `--keep-alive <secs>` auto-
exits after the given window.

## Output streams

Browser console forwarding (on by default; `forwardConsole: false`
programmatically, `--quiet` on the CLI) writes **only to stderr**:

- every page `console.*` call, whatever its type, as `[browser.<type>] <text>`
  (`[browser.log]`, `[browser.info]`, `[browser.debug]`, `[browser.warning]`,
  `[browser.error]`, …);
- every uncaught page error as `[browser.pageerror] <message>`.

The launcher never writes to stdout. stdout is reserved for the embedding
process's machine output — for example `ui-bridge-wrapper`'s inject-cli, which
emits one `{action,result}` / `{action,error}` JSON line per action there. A
consumer can therefore parse stdout without filtering browser noise.

The `ui-bridge-tab` CLI itself still prints its own `[ui-bridge-tab]` progress
lines (`launching`, `url:`, `navigated:`, `UI Bridge tab registered`) to
stdout, so on a terminal the forwarded browser lines appear beside them on
stderr.

Since 0.5.0. Up to 0.4.1, `log` / `info` / `debug` (every type except `error`
and `warning`) went to stdout.

## Programmatic

```ts
import { launchHeadlessTab } from '@qontinui/ui-bridge-headless';

const tab = await launchHeadlessTab({
  url: 'http://localhost:3001/vga/builder',
  uiBridgeBase: 'http://localhost:3001/api/ui-bridge',
  headless: true,
  waitForUiBridgeMs: 30_000,
});

if (!tab.uiBridgeRegistered) {
  throw new Error('UI Bridge SDK did not register — is the app loaded?');
}

// …drive UI Bridge via normal HTTP calls against uiBridgeBase…

await tab.close();
```

When the relay serves a `verifiedOrigin` per tab (the Qontinui runner does),
`tab.tabId` is this launch's own tab: only a tab bound to the navigated origin
counts, never another tab that happens to be registered on the same relay.
Against a relay that does not, or when the navigated URL has an opaque origin,
the first registered tab is returned, which may belong to someone else. Pass
`pinnedTabId` when the page pins its tab id (`ui-bridge-inject --tab-id` does).
The poll then returns that tab and no other.

### A launch that fails cleans up after itself

`launchHeadlessTab` either resolves with a tab that is yours to `close()`, or
rejects having already closed the browser it started. After a rejection there
is no handle to receive and nothing to clean up:

- Before Chromium is spawned, `deviceScaleFactor` and `colorScheme` are
  validated, and the `storageStatePath` file is read, parsed as JSON and
  checked to hold an object whose `cookies` and `origins` are arrays when
  present. A failure there rejects with no browser launched: a
  `deviceScaleFactor` or `colorScheme` failure with its validation error, and
  a `storageStatePath` failure with the read error, the JSON parse error, or
  an error naming the file and what is wrong with its shape. Nothing deeper in
  the file is checked at this point.
- Once Chromium is running, a step that throws closes the browser first and
  then rejects with the original error: the same error object, not a wrapper,
  and never the close's own failure. The steps are creating the context (which
  is also where Playwright refuses storageState content that passed the shape
  check, such as a malformed cookie), an init script, opening the page, the
  first navigation and the registration wait. If that close fails too, the
  launcher reports it on stderr.

A registration wait that runs out is not a failure: the launch resolves with
`uiBridgeRegistered: false`, and the tab is still yours to close.

`tab.close()` resolves even when closing the browser fails, and reports that
failure on stderr the same way. Calling it again returns the same promise.

Up to 0.7.0, a launch whose first navigation failed (or any earlier step after
the browser started) rejected with Chromium still running and no handle to
close it, so a long-lived caller leaked one browser per failed launch.

### Device pixel ratio and colour scheme

`deviceScaleFactor` and `colorScheme` are browser-CONTEXT options (in the
0.6.0 and later): the page reads them back as `window.devicePixelRatio` and
`matchMedia('(prefers-color-scheme: dark)')`, and a screenshot is
`viewport × deviceScaleFactor` pixels.

```ts
const tab = await launchHeadlessTab({
  url: 'http://localhost:3001/',
  headless: true,
  viewportWidth: 390,
  viewportHeight: 844,
  deviceScaleFactor: 3,
  colorScheme: 'dark',
});
```

Do not reach for Chromium's `--force-device-scale-factor` through
`launchArgs` instead: the launcher always sets a viewport, and Playwright's
metrics emulation overrides the flag, so the page keeps reading
`devicePixelRatio` 1.

### HAR recording, service workers and routes (context passthrough)

Three options reach the browser context for a caller that records what a page
loads or serves it from somewhere else:

| Option           | Type                                                      | Passed to                                  |
| ---------------- | --------------------------------------------------------- | ------------------------------------------ |
| `recordHar`      | `LaunchRecordHarOptions` (Playwright's `recordHar` shape) | `newContext({ recordHar })`, unchanged     |
| `serviceWorkers` | `'allow' \| 'block'`                                      | `newContext({ serviceWorkers })`           |
| `initRouter`     | `(context: BrowserContext) => void \| Promise<void>`      | called with the context before `newPage()` |

```ts
const tab = await launchHeadlessTab({
  url: 'https://example.com/',
  headless: true,
  recordHar: { path: './capture.zip', content: 'attach', mode: 'minimal' },
  serviceWorkers: 'block',
  initRouter: async (context) => {
    await context.route('**/*', (route) => route.continue());
    await context.routeWebSocket(/.*/, (ws) => ws.close());
  },
});
// …
await tab.close(); // the HAR is complete once this resolves
```

- **The HAR is written when the context closes.** `tab.close()` closes the
  context first and the browser second, so the archive exists once `close()`
  resolves. Closing only `tab.browser` yourself leaves no HAR. A context close
  that fails (a HAR that could not be written, say) is reported on stderr, and
  the browser is still closed. Calling `close()` again, even concurrently,
  returns the same promise, so every caller waits for the archive.
- **A failed launch writes no HAR.** If the first navigation or the UI Bridge
  wait fails, only the browser is closed and the error rethrown; do not expect
  an archive of a launch that threw.
- **Block service workers when every request must be seen.** A service worker
  answers requests itself, so they reach neither the HAR nor your routes.
- **`initRouter` runs before the first page exists**, after the context and
  any init scripts are set up, so a `context.route('**/*', …)` it installs
  intercepts the first navigation's own document request. If it throws, the
  launch fails like any other post-launch step: the browser is closed and the
  error rethrown.

With none of the three set, the context is created exactly as before. The
close sequence did change for every tab: `tab.close()` now closes the context
before the browser, whether or not `recordHar` is set.

## Flags

| Flag                  | Type              | Default            | Purpose                                             |
| --------------------- | ----------------- | ------------------ | --------------------------------------------------- |
| `--url <url>`         | string (required) | —                  | URL to open                                         |
| `--headless`          | boolean           | `false`            | Hide the window                                     |
| `--ui-bridge <base>`  | string            | —                  | Poll relay base until its tab registers (see above) |
| `--wait-ms <ms>`      | number            | `30000`            | Max wait for UI Bridge registration                 |
| `--keep-alive <secs>` | number            | —                  | Auto-close after this many seconds                  |
| `--viewport <WxH>`    | string            | `1280x720`         | Viewport size                                       |
| `--user-agent <ua>`   | string            | (Chromium default) | UA override                                         |
| `--quiet`             | boolean           | `false`            | Suppress browser console forwarding                 |

## License

MIT.
