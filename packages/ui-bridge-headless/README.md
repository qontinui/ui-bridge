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

## Flags

| Flag                  | Type              | Default            | Purpose                                   |
| --------------------- | ----------------- | ------------------ | ----------------------------------------- |
| `--url <url>`         | string (required) | —                  | URL to open                               |
| `--headless`          | boolean           | `false`            | Hide the window                           |
| `--ui-bridge <base>`  | string            | —                  | Poll relay base until first tab registers |
| `--wait-ms <ms>`      | number            | `30000`            | Max wait for UI Bridge registration       |
| `--keep-alive <secs>` | number            | —                  | Auto-close after this many seconds        |
| `--viewport <WxH>`    | string            | `1280x720`         | Viewport size                             |
| `--user-agent <ua>`   | string            | (Chromium default) | UA override                               |
| `--quiet`             | boolean           | `false`            | Suppress browser console forwarding       |

## License

MIT.
