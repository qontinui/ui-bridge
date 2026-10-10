---
sidebar_position: 3
---

# React Native / Expo Guide

Complete guide for integrating UI Bridge with React Native and Expo applications. Mobile integration differs significantly from web since there's no DOM to observe.

## Key Differences from Web

| Feature           | Web                     | React Native              |
| ----------------- | ----------------------- | ------------------------- |
| DOM Snapshots     | ✅ Full DOM capture     | ❌ No DOM                 |
| MutationObserver  | ✅ Auto-detects changes | ❌ Not available          |
| Auto-Registration | ✅ Automatic discovery  | ⚠️ Manual via hooks       |
| Render Logging    | ✅ DOM-based            | ✅ Screen/component-based |
| Element Control   | ✅ Direct DOM access    | ✅ Via component refs     |

## Installation

```bash
npm install @qontinui/ui-bridge-native
```

For Expo projects, no additional native modules are required.

## Basic Setup

### 1. Add the Provider

```tsx
// app/_layout.tsx (Expo Router)
import { UIBridgeNativeProvider } from '@qontinui/ui-bridge-native';
import { useAutoRegister } from '@qontinui/ui-bridge-native/react';

function AppContent() {
  // Enable auto-registration infrastructure
  useAutoRegister({ enabled: __DEV__ });

  return <Stack>{/* your screens */}</Stack>;
}

export default function RootLayout() {
  return (
    <UIBridgeNativeProvider
      features={{
        server: __DEV__, // Enable HTTP server in dev
        debug: __DEV__,
      }}
      config={{
        serverPort: 9876,
        verbose: __DEV__,
      }}
    >
      <AppContent />
    </UIBridgeNativeProvider>
  );
}
```

### 2. Add Render Logging

Since React Native has no DOM, render logging captures screen changes and component state:

```tsx
// lib/render-log/types.ts
export type RenderLogEntryType =
  | 'screen_change'
  | 'component_render'
  | 'interaction'
  | 'state_change'
  | 'error'
  | 'custom';

export interface RenderLogEntry {
  id: string;
  type: RenderLogEntryType;
  timestamp: number;
  source: string;
  trigger: string;
  data: Record<string, unknown>;
}
```

```tsx
// lib/render-log/RenderLogProvider.tsx
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { usePathname, useSegments } from 'expo-router';

interface RenderLogContextValue {
  isEnabled: boolean;
  logRender: (componentName: string, trigger: string, data?: Record<string, unknown>) => void;
  logInteraction: (
    eventType: string,
    targetComponent?: string,
    details?: Record<string, unknown>
  ) => void;
  getEntries: () => Promise<RenderLogEntry[]>;
  clear: () => Promise<void>;
  currentScreen: string;
}

const RenderLogContext = createContext<RenderLogContextValue | null>(null);

export function RenderLogProvider({ children, enableOnMount = __DEV__ }) {
  const [isEnabled, setEnabled] = useState(enableOnMount);
  const [logs, setLogs] = useState<RenderLogEntry[]>([]);

  const pathname = usePathname();
  const segments = useSegments();
  const currentScreen = pathname || segments.join('/') || '(root)';

  const previousScreenRef = useRef<string | null>(null);

  // Log screen changes
  useEffect(() => {
    if (!isEnabled) return;

    const previous = previousScreenRef.current;
    if (previous === currentScreen) return;
    previousScreenRef.current = currentScreen;

    const entry: RenderLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'screen_change',
      timestamp: Date.now(),
      source: currentScreen,
      trigger: previous ? 'navigation' : 'mount',
      data: {
        previousScreen: previous,
        currentScreen,
      },
    };

    setLogs((prev) => [...prev.slice(-499), entry]);
  }, [currentScreen, isEnabled]);

  const logRender = useCallback(
    (componentName, trigger, data = {}) => {
      if (!isEnabled) return;

      const entry: RenderLogEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'component_render',
        timestamp: Date.now(),
        source: componentName,
        trigger,
        data: { ...data, screen: currentScreen },
      };

      setLogs((prev) => [...prev.slice(-499), entry]);
    },
    [isEnabled, currentScreen]
  );

  const logInteraction = useCallback(
    (eventType, targetComponent, details = {}) => {
      if (!isEnabled) return;

      const entry: RenderLogEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'interaction',
        timestamp: Date.now(),
        source: targetComponent || 'unknown',
        trigger: eventType,
        data: { ...details, screen: currentScreen },
      };

      setLogs((prev) => [...prev.slice(-499), entry]);
    },
    [isEnabled, currentScreen]
  );

  const getEntries = useCallback(async () => logs, [logs]);
  const clear = useCallback(async () => setLogs([]), []);

  return (
    <RenderLogContext.Provider
      value={{
        isEnabled,
        logRender,
        logInteraction,
        getEntries,
        clear,
        currentScreen,
      }}
    >
      {children}
    </RenderLogContext.Provider>
  );
}

export function useRenderLog() {
  const context = useContext(RenderLogContext);
  if (!context) throw new Error('useRenderLog must be used within RenderLogProvider');
  return context;
}

export function useRenderLogOptional() {
  return useContext(RenderLogContext);
}
```

### 3. Update Layout with Render Logging

```tsx
// app/_layout.tsx
import { UIBridgeNativeProvider } from '@qontinui/ui-bridge-native';
import { useAutoRegister } from '@qontinui/ui-bridge-native/react';
import { RenderLogProvider } from '@/lib/render-log';

function AppContent() {
  useAutoRegister({ enabled: __DEV__ });
  return <Stack>{/* screens */}</Stack>;
}

export default function RootLayout() {
  return (
    <UIBridgeNativeProvider
      features={{ server: __DEV__, debug: __DEV__ }}
      config={{ serverPort: 9876 }}
    >
      <RenderLogProvider enableOnMount={__DEV__}>
        <AppContent />
      </RenderLogProvider>
    </UIBridgeNativeProvider>
  );
}
```

## Registering Interactive Elements

Since there's no automatic DOM discovery in React Native, register elements explicitly:

### Using useUIElement

```tsx
import { useUIElement } from '@qontinui/ui-bridge-native';
import { Pressable, Text } from 'react-native';

function SubmitButton({ onSubmit }) {
  const { props, trigger } = useUIElement({
    id: 'submit-button',
    type: 'button',
    label: 'Submit Form',
    actions: ['press'],
    customActions: {
      submit: {
        handler: onSubmit,
        description: 'Submit the form',
      },
    },
  });

  return (
    <Pressable
      {...props}
      onPress={() => {
        trigger('press');
        onSubmit();
      }}
    >
      <Text>Submit</Text>
    </Pressable>
  );
}
```

### Using useUIComponent

```tsx
import { useUIComponent } from '@qontinui/ui-bridge-native';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useUIComponent({
    id: 'login-form',
    name: 'Login Form',
    actions: [
      {
        id: 'login',
        label: 'Submit Login',
        handler: async ({ email, password }) => {
          await loginUser(email, password);
        },
      },
      {
        id: 'reset',
        label: 'Reset Form',
        handler: async () => {
          setEmail('');
          setPassword('');
        },
      },
    ],
  });

  return (
    <View>
      <TextInput value={email} onChangeText={setEmail} placeholder="Email" />
      <TextInput
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="Password"
      />
    </View>
  );
}
```

## Logging Component Renders

Use the render log to track what components display:

```tsx
import { useRenderLog } from '@/lib/render-log';
import { useEffect } from 'react';

function UserProfile({ user }) {
  const { logRender } = useRenderLog();

  useEffect(() => {
    logRender('UserProfile', 'data_loaded', {
      userId: user.id,
      hasAvatar: !!user.avatar,
      memberSince: user.createdAt,
    });
  }, [user]);

  return (
    <View>
      <Text>{user.name}</Text>
      {user.avatar && <Image source={{ uri: user.avatar }} />}
    </View>
  );
}
```

### Convenience Hook

```tsx
// lib/render-log/useLogRender.ts
import { useEffect } from 'react';
import { useRenderLogOptional } from './RenderLogProvider';

export function useLogRender(
  componentName: string,
  data?: Record<string, unknown>,
  deps: unknown[] = []
) {
  const renderLog = useRenderLogOptional();

  useEffect(() => {
    renderLog?.logRender(componentName, 'effect', data);
  }, [componentName, renderLog, ...deps]);
}
```

```tsx
// Usage
function ProductCard({ product }) {
  useLogRender(
    'ProductCard',
    {
      productId: product.id,
      inStock: product.quantity > 0,
    },
    [product.id]
  );

  return <View>...</View>;
}
```

## Logging Interactions

```tsx
import { useRenderLog } from '@/lib/render-log';

function AddToCartButton({ productId }) {
  const { logInteraction } = useRenderLog();

  const handlePress = () => {
    logInteraction('press', 'AddToCartButton', { productId });
    addToCart(productId);
  };

  return (
    <Pressable onPress={handlePress}>
      <Text>Add to Cart</Text>
    </Pressable>
  );
}
```

## Route Awareness

Report the screen the app is on as a route **template** with
`useRouteAwareness`. Every snapshot then carries it as `page.route`, which is
the same field the web SDK uses. The runner's journey ledger reads
`page.route.pattern` from that field and stores it as the screen's node key.

```typescript
function useRouteAwareness(info: RouteInfo, options?: { unmatched?: boolean }): void
```

`RouteInfo` has the same fields as the web hook's (`pattern`, `patternSource`,
`params`, `queryParams`, `routeStack`). Call the hook once, from a component
mounted inside `UIBridgeNativeProvider`. The info is cleared when that
component unmounts, and the hook does nothing outside a provider.

The concrete path is still reported separately, as `currentRoute` (from your
`RouteProvider`). `page` on native carries only `route`. It has no `url`,
`pathname` or `title`, by design.

### The rules

- **The pattern is a template, never the concrete path.** `/profile/[user]` is a
  template. `/profile/alice` is user input, and storing it as a template leaks
  it. Derive the pattern with `expoRouterPattern` or `reactNavigationPattern`.
  Both return `null` rather than leak.
- **Never pass `usePathname()`**, a URL, or a param value as the pattern.
- **Set `patternSource: 'router'`.** The runner keeps a pattern only when it
  carries that assertion, and drops it otherwise.
- **Groups are kept.** `["(tabs)", "runs"]` becomes `/(tabs)/runs`. Group names
  are declared by the developer, never typed by a user, so keeping them leaks
  nothing. Two screens in different groups can also share a URL (`(tabs)/index`
  and `(auth)/index` are both `/`), and the group keeps them apart as separate
  screens. A consumer can strip `(…)` segments if it wants the URL shape. A
  stripped pattern cannot be restored.
- **There is no not-found signal to wire.** The web SDK needs one because a
  Next.js layout renders before its `not-found.tsx` exists. Native routers do
  not have that gap: Expo Router's `useSegments()` already reads
  `['+not-found']` in the same render, and a React Navigation not-found screen
  is an ordinary named route. Pass `{ unmatched }` directly. While it is true,
  the reported `pattern` is `null` and `params` is dropped. On a not-found
  screen the concrete path is always in Expo Router's `pathname` (which you
  never pass), and for a NESTED `+not-found` route it is also in
  `params['not-found']`. Dropping `params` keeps it out of the snapshot.
- **`routeStack` holds cumulative templates**, as on the web
  (`["/", "/(tabs)", "/(tabs)/runs"]`), not raw segments. Derive it with
  `expoRouterRouteStack(segments)`, which fails closed the same way.

### Expo Router

Mount this once in the root layout (`app/_layout.tsx`):

```tsx
import { useLocalSearchParams, useSegments } from 'expo-router';
import {
  expoRouterPattern,
  expoRouterRouteStack,
  isExpoRouterUnmatched,
  useRouteAwareness,
} from '@qontinui/ui-bridge-native';

export function RouteAwareness() {
  const segments = useSegments();
  const searchParams = useLocalSearchParams();
  const unmatched = isExpoRouterUnmatched(segments);

  // A catch-all param ([...slug]) is a string[]; RouteInfo.params holds strings.
  const params = Object.fromEntries(
    Object.entries(searchParams).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.join('/') : String(value),
    ])
  );

  useRouteAwareness(
    {
      pattern: expoRouterPattern(segments),
      patternSource: 'router',
      params: unmatched ? undefined : params,
      routeStack: expoRouterRouteStack(segments),
    },
    { unmatched }
  );
  return null;
}
```

`params` is optional. Leave it out if you only need the pattern. The hook drops
it anyway while `unmatched` is true.

### React Navigation

Read the **root** navigation state from the container. Do not use
`useNavigationState`: directly under `NavigationContainer` it throws
("Couldn't get the navigation state. Is your component inside a
navigator?"), and inside a screen it returns only that navigator's state, which
truncates the chain. Wrap your navigators in a component like this one, rendered
inside `UIBridgeNativeProvider`:

```tsx
import { useState } from 'react';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import {
  reactNavigationPattern,
  useRouteAwareness,
  type NavigationStateLike,
} from '@qontinui/ui-bridge-native';

export function Navigation({ children }: { children: React.ReactNode }) {
  const navigationRef = useNavigationContainerRef();
  const [rootState, setRootState] = useState<NavigationStateLike | undefined>();
  const syncRootState = () => setRootState(navigationRef.getRootState());

  // 'NotFound' is the linking config's catch-all screen.
  const pattern = reactNavigationPattern(rootState, { notFoundRouteNames: ['NotFound'] });
  useRouteAwareness({ pattern, patternSource: 'router' }, { unmatched: pattern === null });

  return (
    <NavigationContainer ref={navigationRef} onReady={syncRootState} onStateChange={syncRootState}>
      {children}
    </NavigationContainer>
  );
}
```

A navigator level whose state has no `index` focuses its last route for a stack
and its first route for any other navigator type, matching React Navigation's
own rule.

The pattern is the chain of focused route **names** from the root navigator to
the leaf, such as `/HomeTabs/Profile`. Route names are static identifiers
declared in code, and `route.params` is never read, so the chain is a template
by construction. The whole chain is used, not only the leaf, so that
same-named screens in different navigators stay distinct.

Expo Router runs on React Navigation, but an Expo app should use
`expoRouterPattern`. Walking Expo's navigation state yields Expo's internal
route names, not the file routes.

## HTTP Server (Development)

In development, `ui-bridge-native` can expose an HTTP server for external tools:

```bash
# List registered elements
curl http://localhost:9876/elements

# Get element details
curl http://localhost:9876/elements/submit-button

# Execute action
curl -X POST http://localhost:9876/elements/submit-button/action \
  -H "Content-Type: application/json" \
  -d '{"action": "press"}'

# Get render log
curl http://localhost:9876/render-log
```

### Action body shape: `POST /control/element/:id/action`

The mobile bridge takes the **same `{ action, params }` envelope** as the
runner/web SDK. The element id goes in the **path**; the action name goes in the
JSON **body** under the top-level `action` field (NOT in the path, NOT under a
nested key). The on-device bridge listens on port **8087** under the
`/ui-bridge/` prefix:

```bash
# ✅ Press a button — `action` is a top-level body field
curl -X POST http://<device-ip>:8087/ui-bridge/control/element/submit-button/action \
  -H "Content-Type: application/json" \
  -d '{"action": "press"}'
```

```jsonc
// Request body schema
{
  "action": "press",          // required — the action name (press, type, setValue, scroll, …)
  "params": { },              // optional — per-action arguments (see below)
  "waitOptions": { }          // optional — pre-action wait predicate
}
```

A body that omits the top-level `action` field is rejected with
`{"success": false, "code": "INVALID_REQUEST", "error": "Action is required"}`.
Actions that take no arguments (`press`, `longPress`, `focus`, `blur`, …) need
only `{"action": "<name>"}` — `params` is optional for those. Value-mutating
actions require their argument under `params` (next section).

### Setting an input's value (mobile envelope)

:::caution Mobile requires a `params` envelope — top-level `value`/`text` is rejected
On the mobile (`ui-bridge-native`) bridge, value-mutating actions take their
argument **inside `params`**, not at the top level. The on-device bridge
listens on port **8087** under the `/ui-bridge/` prefix:

```bash
# ✅ Correct — text lives under params
curl -X POST http://<device-ip>:8087/ui-bridge/control/element/email-input/action \
  -H "Content-Type: application/json" \
  -d '{"action": "setValue", "params": {"text": "user@example.com"}}'

# `type` uses the same envelope and supports clear:true to replace atomically
curl -X POST http://<device-ip>:8087/ui-bridge/control/element/email-input/action \
  -H "Content-Type: application/json" \
  -d '{"action": "type", "params": {"text": "user@example.com", "clear": true}}'

# ❌ Rejected — a top-level `value` or `text` is NOT read on mobile
curl -X POST http://<device-ip>:8087/ui-bridge/control/element/email-input/action \
  -d '{"action": "setValue", "value": "user@example.com"}'   # → no value set
```

`setValue` accepts either `params.text` (canonical) **or** `params.value` as an
alias, but both must be **inside `params`**. After the action,
`GET /ui-bridge/control/element/email-input` and `/ui-bridge/control/snapshot`
both reflect the new `state.value` synchronously — no polling needed.
:::

## Python Client Usage

```python
from ui_bridge import UIBridgeClient

# Connect to React Native app's HTTP server
client = UIBridgeClient("http://192.168.1.100:9876")

# List elements
elements = client.get_elements()
for el in elements:
    print(f"{el.id}: {el.type}")

# Execute action
client.execute_action("submit-button", "press")

# Execute component action
client.component("login-form").action("login", {
    "email": "user@example.com",
    "password": "secret"
})
```

## Complete Example

```tsx
// app/_layout.tsx
import { Stack } from 'expo-router';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { UIBridgeNativeProvider } from '@qontinui/ui-bridge-native';
import { useAutoRegister } from '@qontinui/ui-bridge-native/react';
import { RenderLogProvider } from '@/lib/render-log';

const queryClient = new QueryClient();

function AppContent() {
  // Enable UI Bridge infrastructure
  useAutoRegister({ enabled: __DEV__ });

  return (
    <Stack screenOptions={{ headerShown: true }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <UIBridgeNativeProvider
          features={{ server: __DEV__, debug: __DEV__ }}
          config={{ serverPort: 9876, verbose: __DEV__ }}
        >
          <RenderLogProvider enableOnMount={__DEV__} maxEntries={500}>
            <AppContent />
          </RenderLogProvider>
        </UIBridgeNativeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
```

## Best Practices

### 1. Register Key Interactive Elements

Focus on registering elements that AI agents or tests need to interact with:

```tsx
// Good: Key user actions
<Pressable {...useUIElement({ id: 'checkout-btn', type: 'button' }).props}>
  Checkout
</Pressable>

// Skip: Internal/decorative elements
<Pressable onPress={toggleHelp}>
  <HelpIcon />
</Pressable>
```

### 2. Use Meaningful IDs

```tsx
// Good
useUIElement({ id: 'product-123-add-to-cart', type: 'button' });

// Bad
useUIElement({ id: 'btn1', type: 'button' });
```

### 3. Log Significant State Changes

```tsx
useEffect(() => {
  if (orderComplete) {
    logRender('CheckoutScreen', 'order_complete', {
      orderId: order.id,
      totalAmount: order.total,
    });
  }
}, [orderComplete]);
```

### 4. Development Only

```tsx
// Only enable in development
useAutoRegister({ enabled: __DEV__ });

<RenderLogProvider enableOnMount={__DEV__}>
```

## Troubleshooting

### HTTP Server Not Accessible

1. Check device/simulator IP address
2. Verify port 9876 is not blocked
3. For physical devices, ensure same network
4. Use `adb reverse tcp:9876 tcp:9876` for Android emulator

### Elements Not Registering

1. Verify `useUIElement` hook is called
2. Check element has unique ID
3. Verify `useAutoRegister` is enabled
4. Check console for registration logs

### Screen Changes Not Logged

1. Verify `RenderLogProvider` wraps the app
2. Check `usePathname` is returning values
3. Verify `enableOnMount` is true

## Next Steps

- [Auto-Registration](../react/auto-registration) - Hook details
- [Render Logging](../react/render-logging) - Logging options
- [API Reference](../api/overview) - HTTP endpoints
