# `@qontinui/ui-bridge-wrapper`

Runtime library for building UI Bridge **wrapper apps** — tiny apps that
expose a set of semantic actions against a target system (a SaaS API, a
web UI, a running qontinui app) and let the same action code run against
any of four interchangeable transports:

| Kind       | What it does                                         | Typical use           |
| ---------- | ---------------------------------------------------- | --------------------- |
| `api`      | Delegates to user-defined handlers. No browser.      | Direct SDK/REST calls |
| `headless` | Launches Playwright Chromium with no visible window. | CI, background tests  |
| `headed`   | Launches Playwright Chromium with a visible window.  | Local debugging       |
| `live`     | Connects to a qontinui runner over WebSocket.        | Live orchestration    |

See `src/index.ts` for the full exported surface. React helpers ship
under the `./react` subpath so Node-only wrappers don't pay the React
import cost.

## Quick start

```ts
import { createTransport } from '@qontinui/ui-bridge-wrapper';

const transport = createTransport({
  kind: 'headless',
  options: { targetUrl: 'http://localhost:3001/vga/builder' },
});

transport.handlerRegistry.register('login', async (params, ctx) => {
  const { email, password } = params as { email: string; password: string };
  const { page } = ctx as { page: import('playwright').Page };
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
});

await transport.ready();
await transport.dispatch('login', { email: 'a@b.c', password: '...' });
await transport.close();
```

## Package layout

- `src/index.ts` — public surface (transports, helpers, types).
- `src/base-transport.ts` — `BaseTransport` with status/listeners/ready gating.
- `src/handler-registry.ts` — shared action registry used by every transport.
- `src/transports/{api,headless,headed,live}.ts` — the four concrete transports.
- `src/helpers/{retry,auth,schema}.ts` — `withRetry`, `withAuthRefresh`, `paramSchemaOf`.
- `src/react/*` — React hooks (`useWrapperStatus`, `useTransportSelector`) and the default `WrapperAppShell` layout.

Phase 3 of the wrapper plan adds a scaffold CLI on top of this package;
Phase 4 ships reference wrappers that exercise all four transports.

## CLI bins

The package ships three executables. Each resolves the engine bundle
(`@qontinui/ui-bridge/injected/bundle.global.js`) from the wrapper package's
own module tree via the injected transport's `createRequire(import.meta.url)`,
so **they run from any directory once installed** — there is no "must run from
the ui-bridge repo root" coupling. Run via `npx @qontinui/ui-bridge-wrapper`
or a global/dev install:

| Bin | What it does |
| --- | --- |
| `ui-bridge-inject` | Drive the injected transport against a UI-Bridge-free page (exec one-shot actions, register as a relay tab, or capture frame-and-snapshot pairs — one, or a viewport × DPR × colour-scheme matrix). |
| `ui-bridge-login-web` | Automated web login via the injected transport — drives the full Cognito OAuth redirect chain in one headless tab. Optionally asserts on-page text (`--expect-text`) and screenshots the authed landing (`--screenshot`/`--scroll-to`). Prints one JSON result line; exit 0 = login confirmed AND all expected text present. |
| `ui-bridge-capture-specs` | Log in (same flow) then `goto` + snapshot a set of authed pages, writing one `<slug>.snapshot.json` per page. |

Each bin supports `--help`.

> **Version floor:** the bins exist only at `@qontinui/ui-bridge-wrapper` **>= 0.4.0**
> (the `scripts/` predecessors were deleted in the same release). A pin or cached
> npx resolution below that yields `command not found: ui-bridge-login-web` —
> upgrade rather than hunting for the bin. Also note: since 0.4.1 an explicit but
> EMPTY `--pages` errors (exit 2) instead of silently capturing the default page
> set, and (0.4.2) an empty `--success`/`--url` value is rejected rather than
> matching every landing page.

### Prerequisites for the browser-driving bins

`ui-bridge-inject`, `ui-bridge-login-web`, and `ui-bridge-capture-specs` all
launch Chromium via the injected transport, which dynamically imports
`@qontinui/ui-bridge-headless` (it carries `playwright` as a real dependency).
When installing the wrapper standalone you must therefore also:

1. Install the optional `@qontinui/ui-bridge-headless` peer alongside it, and
2. Run `npx playwright install chromium` once (or point `PLAYWRIGHT_BROWSERS_PATH`
   at an existing Chromium download).

> **A bare `npx @qontinui/ui-bridge-wrapper …` does NOT install peers** — it
> fetches only the wrapper, so the dynamic `import('@qontinui/ui-bridge-headless')`
> dies with `ERR_MODULE_NOT_FOUND`. For a zero-install one-off, name every package
> with `-p` so npx stages them together:
>
> ```bash
> npx -y \
>   -p @qontinui/ui-bridge-wrapper \
>   -p @qontinui/ui-bridge \
>   -p @qontinui/ui-bridge-headless \
>   -p playwright \
>   ui-bridge-login-web \
>   --url "https://qontinui.io/login?next=%2Fbuild%2Fworkflows" \
>   --success /build/workflows
> ```
>
> (Still run `npx playwright install chromium` once for the browser binary.) The
> bare-bin examples below assume a local/global/dev install where the peer is
> already on the module path.

Credentials for the login/capture bins come from `--email`/`--password` or the
env vars `UIB_LOGIN_EMAIL` / `UIB_LOGIN_PASSWORD`. Git Bash callers should
prefix `MSYS_NO_PATHCONV=1` so a leading-slash `--success` / path value is not
rewritten into a Windows path before the bin sees it.

```bash
# log in and confirm the authed landing is /build/workflows
ui-bridge-login-web \
  --url "https://qontinui.io/login?next=%2Fbuild%2Fworkflows" \
  --success /build/workflows

# log in, land on /operations, assert the gates panel rendered, screenshot it
ui-bridge-login-web \
  --url "https://qontinui.io/login?next=%2Foperations" \
  --success /operations \
  --expect-text "option2-actions-outage-drill,metric_threshold" \
  --screenshot out.png

# capture the default admin coord pages
ui-bridge-capture-specs --out ./spec-capture
```

### Frames, device pixel ratio and the capture matrix (`ui-bridge-inject`)

`--screenshot <path>` captures a PNG frame **in lockstep** with every
`getControlSnapshot` action: snapshot, frame, snapshot again, retried until the
two snapshots agree on every element's box. The action's output line gains a
`frame` object whose every field is read off the page or the PNG at capture time
— `width`/`height`, `devicePixelRatio`, `cssViewport`, `colorScheme`,
`capturedAt` and `lockstep: {verified, attempts, changedElements}` — never
copied from the flags. `{n}` in the path's file name becomes the action's
1-based position and is required when a run takes more than one snapshot (a
`{n}` in a directory name is refused). A frame that cannot be produced leaves
`"frame": null` plus `"frameError": {code, message}` (the snapshot still
stands) and the process exits 1.

A frame is **raw pixels** of the page: `data-bridge-redact` masks elements in
snapshots and over the relay, never in a screenshot, so a frame shows whatever
the page showed — including anything an authenticated session displays.
Directories created for frames (and the capture matrix's snapshots) are
`0700` and every file `0600`.

`--dpr <n>` and `--color-scheme <dark|light>` set the browser context's
`deviceScaleFactor` and `prefers-color-scheme`, and the page is checked after
launch: one that reports anything else fails with `EMULATION_NOT_APPLIED`
rather than being measured as if it had applied. (Chromium's
`--force-device-scale-factor` passed through `--launch-arg` does **not** reach
the page — Playwright's viewport emulation overrides it.) Needs
`@qontinui/ui-bridge-headless` with `deviceScaleFactor`/`colorScheme` support
(the release after 0.5.0).

```bash
# one frame at a Retina DPR in dark mode, paired with its snapshot
ui-bridge-inject --url http://127.0.0.1:3000/ --viewport 1280x720 --dpr 2 \
  --color-scheme dark --screenshot ./frame.png --exec 'getControlSnapshot {}'

# every combination: 2 breakpoints x 2 schemes x 2 DPRs = 8 cells
ui-bridge-inject --url http://127.0.0.1:3000/ --capture-matrix ./matrix \
  --viewport 390x844,1280x720 --color-scheme light,dark --dpr 1,2
```

`--capture-matrix <dir>` runs the plan (`--exec`/`--exec-stdin`, default one
`getControlSnapshot {}`) once per combination in a fresh browser context and
writes `<dir>/<cell>/frame-<n>.png`, `snapshot-<n>.json` and `results.ndjson`,
plus `<dir>/matrix.json`: the URL, the producer and its version, the axes, the
plan and every cell's requested values, status (`captured` / `incomplete` /
`failed`) and pairs with their frame provenance. An axis left out stays at the
browser default and says so in the cell id (`390x844_dpr-default_dark`). The
directory must be empty or not exist yet: a non-empty one is refused before any
browser launches, and is never cleared. `--viewport` sides are at most 8192 CSS
pixels.

#### Sourcing credentials from SSM (qontinui operators)

The bins read credentials from env / flags only — they intentionally do **not**
embed any SSM lookup, since `@qontinui/ui-bridge-wrapper` is a general-purpose
package. Operators with access to the operator parameters can populate the env
vars before invoking a bin. On this fleet `aws` resolves under PowerShell (the
git-bash profile diverges), so prefer the PowerShell form:

```powershell
$env:UIB_LOGIN_EMAIL    = (aws ssm get-parameter --name /qontinui/operator/email    --with-decryption --region eu-central-1 --query Parameter.Value --output text)
$env:UIB_LOGIN_PASSWORD = (aws ssm get-parameter --name /qontinui/operator/password --with-decryption --region eu-central-1 --query Parameter.Value --output text)
```

```bash
# bash equivalent (only where `aws` is on PATH for this shell)
export UIB_LOGIN_EMAIL="$(aws ssm get-parameter --name /qontinui/operator/email --with-decryption --region eu-central-1 --query Parameter.Value --output text)"
export UIB_LOGIN_PASSWORD="$(aws ssm get-parameter --name /qontinui/operator/password --with-decryption --region eu-central-1 --query Parameter.Value --output text)"
```
