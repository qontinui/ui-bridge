---
sidebar_position: 3
---

# React Components

Most of UI Bridge is hooks. The components below exist where a hook is awkward:
declarative authoring, provider-shaped context, and a couple of ready-made
patterns.

Every component on this page is exported from both `@qontinui/ui-bridge` and
`@qontinui/ui-bridge/react`.

| Component               | Renders                | Purpose                                                     |
| ----------------------- | ---------------------- | ----------------------------------------------------------- |
| `UIBridgeProvider`       | context + children     | Root provider — everything else needs it                    |
| `State`                  | `Fragment`             | Declarative wrapper around `useUIState`                     |
| `TransitionTo`           | `Fragment`             | Declarative wrapper around `useUITransition`                |
| `AutoRegisterProvider`   | children (or a `div`)  | Auto-register interactive elements in a subtree             |
| `UIBridgeComponentScope` | `display: contents` div| Attribute every element in a subtree to an owning component |
| `UIBridgeWindowProvider` | context + children     | Scope registrations to a named window (multi-window hosts)  |
| `CommandRelayListener`   | `null`                 | Connect the browser back to a UI Bridge server              |
| `CaptureHostFrame`       | an iframe host UI      | Drive an iframe through an automation-controlled URL list   |

## UIBridgeProvider

The root provider. See [Provider](./provider) for the full reference.

### Basic Usage

```tsx
import { UIBridgeProvider } from '@qontinui/ui-bridge';

function App() {
  return (
    <UIBridgeProvider features={{ control: true, renderLog: true, debug: true }}>
      <YourApp />
    </UIBridgeProvider>
  );
}
```

### Props

| Prop                   | Type                    | Description                                          |
| ---------------------- | ----------------------- | ---------------------------------------------------- |
| `children`             | `ReactNode`             | Your app                                             |
| `features`             | `UIBridgeFeatures`      | `renderLog`, `control`, `debug` toggles              |
| `config`               | `UIBridgeConfig`        | `serverPort`, `apiPath`, `websocket`, `appInfo`, …   |
| `onEvent`              | `BridgeEventListener`   | Called for every bridge event                        |
| `onBrowserEvent`       | `OnBrowserEventCallback`| Called for every captured browser event              |
| `browserCaptureConfig` | `BrowserCaptureConfig`  | Configures the browser-event capture sub-modules     |

## State

Authoring-time sugar around `useUIState`. It renders a `Fragment`, so it has no
DOM impact — the wrapper simply calls the hook with its props and passes
`children` straight through. Build plugins extract `<State>` invocations into
IR, which is why the JSX form exists at all.

### Basic Usage

```tsx
import { State } from '@qontinui/ui-bridge';

function LoginPage() {
  return (
    <State
      id="login-form"
      name="Login Form"
      elements={['email-input', 'password-input', 'submit-btn']}
      metadata={{
        description: 'Form for authenticating existing users',
        tags: ['auth', 'form'],
      }}
    >
      <form>
        <input id="email-input" />
        <input id="password-input" type="password" />
        <button id="submit-btn">Log in</button>
      </form>
    </State>
  );
}
```

### Props

`StateProps` extends every option of `UseUIStateOptions`:

| Prop               | Type                                     | Description                                            |
| ------------------ | ---------------------------------------- | ------------------------------------------------------ |
| `id`               | `string` _(required)_                    | Unique identifier for the state                        |
| `name`             | `string` _(required)_                    | Human-readable name                                    |
| `children`         | `ReactNode`                              | Rendered as-is                                         |
| `elements`         | `string[]`                               | Element IDs belonging to this state                    |
| `requiredElements` | `IRElementCriteria[]`                    | IR-canonical form of `elements`; wins if both are given |
| `activeWhen`       | `() => boolean`                          | Predicate deciding whether the state is active         |
| `blocking`         | `boolean`                                | Blocks other state activations (modal behaviour)       |
| `blocks`           | `string[]`                               | Specific state IDs this state blocks                   |
| `group`            | `string`                                 | State group membership                                 |
| `pathCost`         | `number`                                 | Pathfinding cost (default `1.0`)                       |
| `metadata`         | `IRMetadata \| Record<string, unknown>`  | `description` / `purpose` / `tags` / `relatedElements` / `notes` |
| `provenance`       | `IRProvenance`                           | Set by build plugins                                   |
| `autoRegister`     | `boolean`                                | Register on mount                                      |
| `initialActive`    | `boolean`                                | Initial active state                                   |

:::note
`metadata` only routes into the global annotation store when it matches the
`IRMetadata` shape. An arbitrary `Record<string, unknown>` is still accepted for
backwards compatibility, but writes no annotation.
:::

## TransitionTo

The counterpart to `<State>`: sugar around `useUITransition`, named for its
destination so the call site reads as "transition to these states". Also renders
a `Fragment`.

### Basic Usage

```tsx
import { TransitionTo } from '@qontinui/ui-bridge';

function LoginButton() {
  return (
    <TransitionTo
      id="open-login"
      name="Open Login"
      fromStates={['landing']}
      activateStates={['login-form']}
      exitStates={['landing']}
      effect="read"
      metadata={{ description: 'Navigate from landing to the login form' }}
    >
      <button>Log in</button>
    </TransitionTo>
  );
}
```

### Props

`TransitionToProps` extends every option of `UseUITransitionOptions`:

| Prop              | Type                                     | Description                                          |
| ----------------- | ---------------------------------------- | ---------------------------------------------------- |
| `id`              | `string` _(required)_                    | Unique identifier for the transition                 |
| `name`            | `string` _(required)_                    | Human-readable name                                  |
| `fromStates`      | `string[]` _(required)_                  | Precondition — at least one must be active           |
| `activateStates`  | `string[]` _(required)_                  | States to activate                                   |
| `exitStates`      | `string[]` _(required)_                  | States to deactivate                                 |
| `children`        | `ReactNode`                              | Rendered as-is                                       |
| `activateGroups`  | `string[]`                               | Groups to activate                                   |
| `exitGroups`      | `string[]`                               | Groups to deactivate                                 |
| `actions`         | `WorkflowStep[]`                         | Actions executed during the transition               |
| `pathCost`        | `number`                                 | Pathfinding cost                                     |
| `staysVisible`    | `boolean`                                | Source states remain visible during the transition   |
| `effect`          | `'read' \| 'write' \| 'destructive'`     | Side-effect annotation                               |
| `metadata`        | `IRMetadata`                             | Semantic metadata                                    |
| `provenance`      | `IRProvenance`                           | Set by build plugins                                 |
| `autoRegister`    | `boolean`                                | Register on mount                                    |

:::warning
`effect="destructive"` is not cosmetic — destructive transitions are excluded
from automatic regression walks and drive counterfactual analysis. Annotate
irreversible actions (delete, send, charge, deploy) accordingly.
:::

## AutoRegisterProvider

Turns on automatic registration of interactive elements for its subtree, using a
`MutationObserver` and a configurable ID strategy. See
[Auto-Registration](./auto-registration) for the full story.

### Basic Usage

```tsx
import { UIBridgeProvider, AutoRegisterProvider } from '@qontinui/ui-bridge';

function App() {
  return (
    <UIBridgeProvider features={{ control: true }}>
      <AutoRegisterProvider enabled={process.env.NODE_ENV === 'development'}>
        <YourApp />
      </AutoRegisterProvider>
    </UIBridgeProvider>
  );
}
```

### Props

`AutoRegisterProviderProps` extends `AutoRegisterOptions` minus `root`, which
`scopeToChildren` replaces:

| Prop                  | Type                                                     | Default              | Description                                             |
| --------------------- | -------------------------------------------------------- | -------------------- | ------------------------------------------------------- |
| `children`            | `ReactNode` _(required)_                                 | —                    | Subtree to observe                                      |
| `scopeToChildren`     | `boolean`                                                | `false`              | Observe a wrapper `div` instead of `document.body`      |
| `enabled`             | `boolean`                                                | dev mode             | Enable auto-registration                                |
| `idStrategy`          | `'data-testid' \| 'semantic' \| 'auto' \| 'prefer-existing'` | `'prefer-existing'` | How IDs are generated                                   |
| `debounceMs`          | `number`                                                 | `100`                | Mutation-handling debounce                              |
| `includeHidden`       | `boolean`                                                | `false`              | Register hidden elements too                            |
| `includeSelectors`    | `string[]`                                               | `[]`                 | Only register elements matching these                   |
| `excludeSelectors`    | `string[]`                                               | `[]`                 | Skip elements matching these                            |
| `generateId`          | `(element: HTMLElement) => string`                       | —                    | Custom ID generator                                     |
| `onRegister`          | `(id: string, element: HTMLElement) => void`             | —                    | Registration callback                                   |
| `onUnregister`        | `(id: string) => void`                                   | —                    | Unregistration callback                                 |
| `contentDiscovery`    | `ContentDiscoveryOptions`                                | enabled              | Content-discovery options                               |
| `persistWhileMounted` | `boolean`                                                | `false`              | Keep elements registered while mounted even when the visibility gate would reject them |

### Scoped to a section

```tsx
<AutoRegisterProvider
  scopeToChildren
  idStrategy="data-testid"
  excludeSelectors={['[data-no-register]']}
>
  <DashboardContent />
</AutoRegisterProvider>
```

With `scopeToChildren`, the provider renders a `display: contents` wrapper and
observes that node instead of `document.body`. Without it, children render
directly with no extra DOM node.

## UIBridgeComponentScope

Wraps a subtree so every `useUIElement` inside auto-registers with
`ownedByComponent: <componentId>`. Snapshot consumers can then see that a button
belongs to a higher-level component — and that a named component action may be a
cleaner call path than driving the DOM.

### Basic Usage

```tsx
import { UIBridgeComponentScope, useUIComponent, useUIElement } from '@qontinui/ui-bridge';

function ProfilePicker() {
  useUIComponent({
    id: 'zone-profile-picker',
    name: 'Profile Picker',
    actions: [{ id: 'open', label: 'Open picker', handler: async () => openPicker() }],
  });

  const button = useUIElement({ id: 'profile-open', type: 'button' });

  return (
    <UIBridgeComponentScope componentId="zone-profile-picker">
      <button ref={button.ref}>Choose profile</button>
      <div>…</div>
    </UIBridgeComponentScope>
  );
}
```

### Props

| Prop          | Type                  | Description                                              |
| ------------- | --------------------- | -------------------------------------------------------- |
| `componentId` | `string` _(required)_ | ID of the `useUIComponent` that owns elements in the subtree |
| `children`    | `ReactNode`           | The owned subtree                                        |

The wrapper is a real DOM node carrying `data-ui-bridge-component`, styled
`display: contents` so it is invisible to layout. That attribute is what lets
auto-registered (DOM-scanned) elements discover their owner by walking up.

## UIBridgeWindowProvider

Declares, once at a window's React root, which window the subtree's
registrations belong to. Every `useUIElement` inside reads the context and
registers under that `windowLabel`, so a multi-window host keeps each window's
elements in its own bucket without threading a prop through every call site.

### Basic Usage

```tsx
import { getCurrentWindow } from '@tauri-apps/api/window';
import { UIBridgeWindowProvider } from '@qontinui/ui-bridge';

function WindowRoot({ children }: { children: React.ReactNode }) {
  const label = getCurrentWindow().label; // "main" | "term-1" | ...
  return <UIBridgeWindowProvider windowLabel={label}>{children}</UIBridgeWindowProvider>;
}
```

### Props

| Prop          | Type                  | Description                                                              |
| ------------- | --------------------- | ------------------------------------------------------------------------ |
| `windowLabel` | `string \| undefined` _(required)_ | The real webview label. `undefined` means the default `"main"` window |
| `children`    | `ReactNode`           | The window's subtree                                                     |

:::note
This provider is additive and opt-in. Single-window hosts never wrap their tree
in it: the context stays `undefined`, no `windowLabel` is passed, and the
registry uses the default `"main"` window — byte-identical to the
pre-window-aware behaviour.
:::

## CommandRelayListener

Connects the browser back to a UI Bridge server that runs out of process, so
relay-backed handlers can answer queries with live browser state. Renders
`null`; drop it anywhere inside your provider.

### Basic Usage

```tsx
import { UIBridgeProvider, AutoRegisterProvider, CommandRelayListener } from '@qontinui/ui-bridge';

<UIBridgeProvider features={{ renderLog: true, control: true, debug: true }}>
  <AutoRegisterProvider>
    <CommandRelayListener />
    {children}
  </AutoRegisterProvider>
</UIBridgeProvider>;
```

The server side of this pairing is
[relay-backed handlers](../server/standalone#relay-backed-handlers).

### Props

| Prop                   | Type                                                     | Default                    | Description                                        |
| ---------------------- | -------------------------------------------------------- | -------------------------- | -------------------------------------------------- |
| `basePath`             | `string`                                                 | `'/api/ui-bridge'`         | Base path for UI Bridge API routes                 |
| `enabled`              | `boolean`                                                | `true`                     | Whether the relay is active                        |
| `heartbeatInterval`    | `number`                                                 | `10000`                    | Heartbeat interval in ms                           |
| `runnerUrl`            | `string`                                                 | `'http://127.0.0.1:9876'`  | Explicit runner URL for phone-home registration    |
| `disablePhoneHome`     | `boolean`                                                | `false`                    | Opt out of phone-home registration entirely        |
| `appId`                | `string`                                                 | hostname                   | Stable identity in the runner's registry           |
| `appName`              | `string`                                                 | `document.title` or hostname | Display name                                     |
| `appType`              | `'web' \| 'desktop' \| 'mobile' \| 'dashboard' \| 'other'` | `'web'`                  | App classification                                 |
| `framework`            | `string`                                                 | `'react'`                  | Framework hint                                     |
| `capabilities`         | `string[]`                                               | `['control']`              | Capability tags                                    |
| `version`              | `string`                                                 | —                          | SDK/app version forwarded on each heartbeat        |
| `authHeader`           | `() => string \| null \| undefined`                      | —                          | Returns the raw session token (no `Bearer ` prefix) |
| `registrationMetadata` | `() => { userId: string; sessionId: string } \| null \| undefined` | —                | Tab-ownership envelope sent with every heartbeat    |

:::warning
Strict mode is the only mode in `@qontinui/ui-bridge` ≥ 0.12: without
`registrationMetadata`, a strict server answers every heartbeat with HTTP 400 /
`MISSING_REGISTRATION_METADATA`.
:::

Without `runnerUrl`, phone-home is gated to localhost-family hosts. Setting it
makes phone-home fire regardless of hostname.

## CaptureHostFrame

A ready-made capture-host pattern: an outer component that keeps a stable UI
Bridge connection while cycling an inner `<iframe>` through an
automation-driven URL sequence. It exists to solve the "the SDK unmounts when we
navigate to page X" problem that breaks naïve navigation loops.

### Basic Usage

```tsx
import { CaptureHostFrame } from '@qontinui/ui-bridge/react';

function MyCaptureHost() {
  return (
    <CaptureHostFrame
      initialSrc="/api/my-isolated?sample=0"
      messageKind="grounding-bbox"
      title="Grounding Capture"
    />
  );
}
```

External automation drives it in three calls:

1. `POST /control/element/{urlInputId}/action` with `{ action: 'setValue', params: { value: '/next/sample/url' } }`
2. `POST /control/element/{advanceId}/action` with `{ action: 'click' }`
3. `GET /control/snapshot`, then read `element.state.value` where `element.id === echoId`

The inner iframe reports measurements back via `window.postMessage`; any message
whose `data.kind` matches `messageKind` is echoed into the hidden echo input so
automation can read it straight out of the snapshot.

### Props

| Prop          | Type                                        | Default                    | Description                                        |
| ------------- | ------------------------------------------- | -------------------------- | -------------------------------------------------- |
| `initialSrc`  | `string`                                    | `'about:blank'`            | Starting iframe URL                                |
| `messageKind` | `string`                                    | `'capture-host-echo'`      | `postMessage` `kind` to listen for                 |
| `ids`         | `Partial<typeof DEFAULT_CAPTURE_HOST_IDS>`  | see below                  | Override the registered element IDs                |
| `title`       | `string`                                    | `'UI Bridge Capture Host'` | Title shown above the iframe                       |
| `header`      | `ReactNode`                                 | —                          | Header content replacing `title`                   |
| `iframeStyle` | `React.CSSProperties`                       | —                          | Iframe style overrides                             |
| `iframeTitle` | `string`                                    | `'capture-sample'`         | Iframe `title` attribute (a11y)                    |
| `onEcho`      | `(payload: unknown) => void`                | —                          | Fired when a matching message arrives              |
| `onMessage`   | `(data: unknown, ev: MessageEvent) => void` | —                          | Fired for every message, before `onEcho` filtering |

The default element IDs are exported as `DEFAULT_CAPTURE_HOST_IDS`:

```typescript
import { DEFAULT_CAPTURE_HOST_IDS } from '@qontinui/ui-bridge/react';

// { urlInput: 'capture-next-url', advance: 'capture-advance', echo: 'capture-last-echo' }
```

Override them via `ids` when a page hosts more than one capture host.

## Creating Custom Components

Combine hooks to create reusable controlled components:

```tsx
import { useRef } from 'react';
import { useUIComponent } from '@qontinui/ui-bridge';

interface ControlledFormProps {
  id: string;
  onSubmit: (data: FormData) => Promise<any>;
  children: React.ReactNode;
}

function ControlledForm({ id, onSubmit, children }: ControlledFormProps) {
  const formRef = useRef<HTMLFormElement>(null);

  useUIComponent({
    id,
    name: `Form: ${id}`,
    actions: [
      {
        id: 'submit',
        handler: async () => {
          const formData = new FormData(formRef.current!);
          return await onSubmit(formData);
        },
      },
      {
        id: 'reset',
        handler: async () => {
          formRef.current?.reset();
        },
      },
    ],
  });

  return (
    <form ref={formRef} data-ui-id={id}>
      {children}
    </form>
  );
}
```

Usage:

```tsx
<ControlledForm id="login-form" onSubmit={handleLogin}>
  <input name="email" />
  <input name="password" type="password" />
  <button type="submit">Login</button>
</ControlledForm>
```

Then from Python:

```python
client.component('login-form').action('submit')
```
