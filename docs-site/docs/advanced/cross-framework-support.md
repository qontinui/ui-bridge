# Framework Support

UI Bridge ships **one** framework binding — React — plus an **injected mode**
that drives any page at all, including one built with a framework UI Bridge has
never heard of and one that ships zero UI Bridge code.

There are no Vue, Angular or Svelte adapter packages. Framework coverage beyond
React comes from injected mode, not from a per-framework plugin.

| Situation | Use |
| --- | --- |
| Your app is React (web) | [`@qontinui/ui-bridge/react`](../react/provider.md) |
| Your app is React Native | `@qontinui/ui-bridge/native/react` |
| Any other framework, or no framework, or an app you cannot modify | **Injected mode** — below |
| You are driving from outside the browser | The HTTP + WebSocket API, which is language-agnostic |

## Injected Mode

Injected mode gets its element registry from the **DOM itself** rather than
from annotations the app author added. A driver injects the runtime bundle
before the page's first paint; the bundle scans the DOM for interactive
elements, registers each one, and keeps the registry live through a
`MutationObserver`. From there the same semantic engine embedded apps use —
find by label / text / role / type, click / type / clear / focus, snapshot,
state read — works against a page that knows nothing about UI Bridge.

### The Prebuilt Bundle

The runnable artifact is a single IIFE:

```
@qontinui/ui-bridge/injected/bundle.global.js
```

Inject it as an init-script so it runs at `document_start`. With Playwright:

```typescript
await context.addInitScript({
  path: require.resolve('@qontinui/ui-bridge/injected/bundle.global.js'),
});
```

The bundle installs its API on `window.__uiBridgeInjected`:

```typescript
import type { InjectedRuntimeApi } from '@qontinui/ui-bridge/injected';

declare const runtime: InjectedRuntimeApi;

runtime.ready; // registry populated, execute() will resolve elements
runtime.settled; // DOM went quiet after content appeared — gate here
runtime.settledByTimeout; // settle was forced by the hard cap, not by quiet
runtime.expectSatisfied; // the settle gating condition was actually met
runtime.expectSelector; // the CSS gate in effect, or null
runtime.elementCount; // interactive elements as of the last seed pass
runtime.version; // SDK version the bundle was built from
```

Gate your first read on `settled`, not `ready`. On a client-rendered SPA the
registry is empty at `ready` and fills in as the app paints:

```typescript
const state = await runtime.whenSettled(15_000);
// { settled, elementCount, settledByTimeout, expectSatisfied }
```

A result with `settled: true`, `settledByTimeout: true` and
`expectSatisfied: false` means the expected content never appeared inside the
cap. Treat that as blocked or unverified — not as a clean settle.

### Driving It

`execute(action, payload)` runs a relay command against the seeded registry —
the identical dispatcher embedded apps use, so the action vocabulary is the
same:

```typescript
await runtime.execute('clickByText', { text: 'Sign in', exact: true });
await runtime.execute('typeInto', { label: 'Email', text: 'user@example.com' });
await runtime.execute('clickBySelector', { selector: 'button[type=submit]' });
await runtime.execute('getControlSnapshot');
await runtime.execute('find', { role: 'button', text: 'Sign in' });
```

From a Playwright driver that is a `page.evaluate` away:

```typescript
await page.waitForFunction('window.__uiBridgeInjected?.settled === true');

const result = await page.evaluate(() =>
  window.__uiBridgeInjected!.execute('clickByText', { text: 'Sign in' })
);
```

### Configuring It

Inject `window.__uiBridgeInjectedConfig` as a sibling init-script *ahead* of the
bundle:

```typescript
import type { InjectedRuntimeConfig } from '@qontinui/ui-bridge/injected';

const config: InjectedRuntimeConfig = {
  // Quiet window (ms) with no re-seed before the runtime declares itself
  // settled. Default 500.
  settleQuietMs: 500,
  // Hard cap (ms) after which it settles regardless of ongoing mutations.
  // Default 10000.
  settleTimeoutMs: 10_000,
  // Don't settle until this selector matches — use it when the control you
  // care about mounts lazily after unrelated chrome. A malformed selector is
  // ignored rather than throwing.
  expectSelector: '#login-form',
};

await context.addInitScript((cfg) => {
  window.__uiBridgeInjectedConfig = cfg;
}, config);
```

Adding a `uiBridgeBase` to that config switches the bundle from direct-drive to
**relay mode**: it registers as a tab against your bridge server and becomes
drivable through the standard `/control/*` plane, exactly like an embedded app.

```typescript
const config: InjectedRuntimeConfig = {
  uiBridgeBase: 'https://example.com/api/ui-bridge',
  authToken: process.env.UI_BRIDGE_TOKEN,
  appId: 'legacy-admin',
  appName: 'Legacy Admin',
};
```

## Building On The Pieces

If you are writing your own tooling rather than using the bundle, the same
building blocks are exported from `@qontinui/ui-bridge/injected`:

```typescript
import {
  seedRegistryFromDom,
  observeAndSeed,
  bridgeAccessOver,
  startRelayClient,
  resolveTabId,
} from '@qontinui/ui-bridge/injected';
import { UIBridgeRegistry } from '@qontinui/ui-bridge';

const registry = new UIBridgeRegistry();

// One-shot scan: register every interactive element under `root`.
const { registered, total } = seedRegistryFromDom(registry, document.body);

// Or keep it live — re-seeds on DOM mutation, unregisters removed nodes,
// and returns a disconnect function.
const disconnect = observeAndSeed(registry, document.body, {
  debounceMs: 100,
  onSeed: (elementCount) => console.log(`registry now holds ${elementCount}`),
});
```

`bridgeAccessOver(registry)` builds a registry-backed `BridgeAccess` — the
object the command dispatcher consults — with no React and no app cooperation:

```typescript
const bridge = bridgeAccessOver(registry);
```

`startRelayClient` opens the SSE command stream, executes inbound commands,
posts results back and beats a heartbeat. It is framework-agnostic — it needs
`fetch`, `TextDecoder` and `AbortController`, nothing else:

```typescript
import type { RelayClientConfig, RelayClientHandle } from '@qontinui/ui-bridge/injected';

const relayConfig: RelayClientConfig = {
  basePath: '/api/ui-bridge',
  execute: (action, payload) => runtime.execute(action, payload),
  tabId: resolveTabId(),
  heartbeatIntervalMs: 10_000,
  appId: 'legacy-admin',
  appName: 'Legacy Admin',
};

const handle: RelayClientHandle = startRelayClient(relayConfig);
// handle.tabId, handle.forceReconnect(), handle.stop()
```

`resolveTabId()` returns a stable per-tab id, reusing the one persisted in
`sessionStorage` when there is one so a reconnect keeps its identity.

## Known Limits

Injected mode is honest about what it cannot infer from a bare DOM:

- **Semantic find and the standard actions work.** Find by label / text / role /
  type, click / type / clear / focus, interactive-element snapshot, and
  visibility/state reads all ride the DOM-seeded registry.
- **The author-supplied layer is structurally absent.** An uninstrumented page
  has no declared components, no workflows and no state machine, because those
  come from annotations the app author writes. Commands that depend on them
  have nothing to resolve against.
- **The structural `ElementQuery` language and DOM-inferred state machine are
  not wired in.** Ranked semantic `find` does not depend on them, so it is
  unaffected.

## Framework-Agnostic By Another Route

None of the above is required to automate a UI Bridge app from a non-JavaScript
stack. The HTTP and WebSocket surfaces are plain protocol:

- [HTTP API](../api/overview.md) — find, act, snapshot, assert.
- [WebSocket Communication](./websocket-communication.md) — the same operations
  plus event subscriptions.
- The Python client (`ui_bridge`) wraps the HTTP surface directly.

A driver in any language that can speak HTTP gets the full control plane
without importing a single JavaScript package.
