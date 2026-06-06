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
| `ui-bridge-inject` | Drive the injected transport against a UI-Bridge-free page (exec one-shot actions, or register as a relay tab). |
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

`ui-bridge-login-web` and `ui-bridge-capture-specs` launch Chromium via the
injected transport, which dynamically imports `@qontinui/ui-bridge-headless`
(it carries `playwright` as a real dependency). When installing the wrapper
standalone you must therefore also:

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
