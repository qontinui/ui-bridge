---
sidebar_position: 2.8
---

# Integration Hooks

Three hooks from `@qontinui/ui-bridge/react` connect the SDK to the world
outside the React tree: a command relay on your server, an automation driver
reading snapshots, and a deployment that ships new bundles under a running tab.

## useCommandRelay

```typescript
function useCommandRelay(options?: UseCommandRelayOptions): void
```

Connects the browser to the server's command relay. It opens an SSE stream,
executes each command it receives against the UI Bridge registry and browser
APIs, POSTs the results back, and heartbeats so the server knows the tab is
alive. Mount it once, near your app root, below the `UIBridgeProvider`.

```tsx
import { useCommandRelay } from '@qontinui/ui-bridge/react';

function BridgeRelay() {
  useCommandRelay({
    basePath: '/api/ui-bridge',
    authHeader: () => sessionStorage.getItem('sessionToken'),
    registrationMetadata: () => ({ userId: currentUser.id, sessionId: currentSession.id }),
  });
  return null;
}
```

The transport uses three routes under `basePath`: `GET {basePath}/commands/stream`
(SSE), `POST {basePath}/commands` (results) and `POST {basePath}/heartbeat`. It
reconnects on visibility change. See [Server Overview](../server/overview.md) for
the other end.

### Options

`UseCommandRelayOptions` — every field is optional, as is the argument itself.

| Option | Type | Default | Meaning |
|--------|------|---------|---------|
| `enabled` | `boolean` | `true` | Turn the relay off without unmounting |
| `basePath` | `string` | `'/api/ui-bridge'` | Base path for the three relay routes |
| `heartbeatInterval` | `number` | `10000` | Heartbeat period in ms |
| `runnerUrl` | `string` | `'http://127.0.0.1:9876'` | Explicit runner URL for phone-home registration |
| `disablePhoneHome` | `boolean` | `false` | Skip phone-home registration entirely |
| `appId` | `string` | hostname | Stable identity in the runner's registry |
| `appName` | `string` | `document.title \|\| location.hostname` | Display name |
| `appType` | `'web' \| 'desktop' \| 'mobile' \| 'dashboard' \| 'other'` | `'web'` | App classification |
| `framework` | `string` | `'react'` | Framework hint |
| `capabilities` | `string[]` | `['control']` | Capability tags |
| `version` | `string` | — | SDK/app version reported on heartbeats |
| `authHeader` | `() => string \| null \| undefined` | — | Per-request bearer token source |
| `registrationMetadata` | `() => { userId, sessionId } \| null \| undefined` | — | Per-user tab scoping; see below |

`runnerUrl` also changes *when* phone-home fires: with it set, registration is
attempted regardless of hostname; without it, phone-home is gated to
localhost-family hosts.

### `authHeader`

Return the **raw token**, without a `Bearer ` prefix — the SDK adds it. When the
function returns a non-empty string, `Authorization: Bearer <value>` is attached
to all three routes, including the SSE stream (consumed via `fetch` streaming, so
no token ever lands in a URL).

It is called fresh on every outbound request, so read from a live source such as
`sessionStorage` and a rotated token is picked up without remounting. Returning
`null`, `undefined` or `''` means "no auth this call" and the transport falls
back to unauthenticated / cookie-based behaviour.

Supply it for any relay that enforces a session-bound auth gate — for example
qontinui-web's `UI_BRIDGE_REQUIRE_AUTH=1` mode.

:::warning `registrationMetadata` is effectively required against a strict relay

As of `@qontinui/ui-bridge` 0.12 the server **rejects any `POST /heartbeat` whose
body omits this field**. A tab without registration metadata never enters the
ownership registry, so authenticated dispatch cannot reach it at all. Older
relays simply ignore the extra field, so supplying it is always safe.

When present, the server uses `{ userId, sessionId }` to record tab ownership,
filter `/tabs` and `/tabs/wait` to the caller's own tabs, reject cross-user
`targetTabId` dispatch with a 404, and scope unscoped fan-out to the caller's
tabs. Like `authHeader` it is a function, read fresh on every beat, so a
re-login can rotate `sessionId` without remounting. Returning `null`,
`undefined`, or a value missing either field means "no metadata this beat" —
and a strict server answers 400.

:::

## useUIBridgeEcho

```typescript
function useUIBridgeEcho<T>(id: string, value: T, options?: UseUIBridgeEchoOptions<T>): ReactElement
```

Surfaces arbitrary state in the snapshot by registering a hidden read-only
`<input>` whose value is the serialised state. Unlike the other hooks here it
**returns a React element**, which you must render.

```tsx
import { useUIBridgeEcho } from '@qontinui/ui-bridge/react';

function CaptureHost() {
  const [bbox, setBbox] = useState<Bbox | null>(null);
  const echo = useUIBridgeEcho('capture-last-bbox', bbox);

  return (
    <>
      <iframe title="target" src="/target" />
      {echo}
    </>
  );
}
```

A driver then reads it out of `/control/snapshot`:

```python
snap = client.get_control_snapshot()
for el in snap['elements']:
    if el['id'] == 'capture-last-bbox':
        bbox = json.loads(el['state']['value'])
```

This exists because the snapshot does not expose `<body>` data-attributes, so
mirroring state there is invisible to automation. Registering an input via
[`useUIElement`](./hooks-registration.md#useuielement) puts the value on
`element.state.value`, where a driver can see it.

### Parameters

| Parameter | Type | Meaning |
|-----------|------|---------|
| `id` | `string` | UI Bridge element id; must be unique on the page |
| `value` | `T` | JSON-compatible state to echo |
| `options.label` | `string` | Label exposed via UI Bridge. Default: `` `UI Bridge echo: ${id}` `` |
| `options.serialize` | `(value: T) => string` | Custom serializer. Default `JSON.stringify` |
| `options.onNullish` | `'empty' \| 'serialize'` | `null`/`undefined` handling. Default `'empty'` |
| `options.style` | `React.CSSProperties` | Merged over the default hidden style |

With `onNullish: 'empty'` (the default) a nullish value echoes `''`; with
`'serialize'` it goes through the serializer, so `JSON.stringify` yields the
string `"null"`. A serializer that throws — a `BigInt`, a circular reference —
is caught and echoes `''` rather than breaking the render.

:::warning Do not make the input invisible

The default style is deliberate: `2×2` pixels at `opacity: 0.01`, absolutely
positioned, `pointer-events: none`. It is *nearly* invisible while keeping
non-zero geometry, because the auto-registrar's visibility filter skips
zero-area elements — a conventional `sr-only` style with `clip: rect(0 0 0 0)`
would drop the element from the snapshot and silently defeat the whole hook.

An `options.style` override is merged over these defaults, so overriding
`width`, `height`, `display` or `opacity` can re-introduce exactly that failure.

:::

## useBuildIdWatcher

```typescript
function useBuildIdWatcher(options?: UseBuildIdWatcherOptions): void
```

Detects when the server has shipped a new bundle while the tab is still running
the old code, so you can prompt for a refresh. Pairs with a server that injects
`<meta name="build-id" content="…">` into the served HTML and exposes the current
build-id on a live source.

```tsx
import { useState } from 'react';
import { useBuildIdWatcher } from '@qontinui/ui-bridge/react';

function BuildRefreshBanner() {
  const [stale, setStale] = useState(false);
  useBuildIdWatcher({ onBuildIdChange: () => setStale(true) });

  if (!stale) return null;
  return (
    <div role="status" aria-live="polite">
      A new build is available.
      <button onClick={() => window.location.reload()}>Refresh</button>
    </div>
  );
}
```

:::warning The watched source must be able to change while the page is open

Comparing two **compile-time constants of the same process** — for example a
meta tag baked into HTML embedded in a desktop binary against that same
binary's compiled-in build-id — is a permanent false positive, not a staleness
check. Replacing the executable on disk changes neither value, so the
comparison can only ever fire on a build-time inconsistency, and the reload it
prompts is a guaranteed no-op.

The qontinui runner shipped exactly that (a Tauri `invoke` custom getter
against its own embedded meta tag); its banner never cleared and was deleted
rather than repaired. Use this hook only where a real server — or another
source that genuinely moves at runtime — is on the other end.

:::

### Options

| Option | Type | Default | Meaning |
|--------|------|---------|---------|
| `healthStreamUrl` | `string` | `'/health/stream'` | SSE stream emitting a `buildId` field per event |
| `pollUrl` | `string` | — | URL GET-ed periodically; body must be JSON with a top-level `buildId` |
| `getCurrentBuildId` | `() => Promise<string> \| string` | — | Custom getter |
| `pollIntervalMs` | `number` | `30000` | Interval for `pollUrl` / `getCurrentBuildId`; `0` = one-shot on mount |
| `onBuildIdChange` | `(oldId: string, newId: string) => void` | — | Fires at most once per mount |

Exactly one source is used, in precedence order: `getCurrentBuildId`, then
`pollUrl`, then the default SSE stream. `pollIntervalMs` is ignored on the SSE
path.

### Sources

```tsx
// SSE (default) — supervisor dashboard pattern
useBuildIdWatcher({ onBuildIdChange: () => setStale(true) });

// Polling — Next.js / qontinui-web pattern
useBuildIdWatcher({
  pollUrl: '/api/health',
  pollIntervalMs: 30_000,
  onBuildIdChange: () => setStale(true),
});

// Custom getter — any source that changes at RUNTIME (see the warning above)
useBuildIdWatcher({
  getCurrentBuildId: () => fetchBuildIdFromSomewhereLive(),
  pollIntervalMs: 30_000,
  onBuildIdChange: () => setStale(true),
});
```

The baseline is read once at mount from `<meta name="build-id">`. The hook
no-ops cleanly when that tag is missing or empty, and when the chosen source is
unavailable (`EventSource` undefined in SSR, `fetch` undefined outside a
browser). `onBuildIdChange` fires at most once per mount; the source is torn
down on unmount.
