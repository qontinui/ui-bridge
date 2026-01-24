---
sidebar_position: 3
---

# React Native / Expo Guide

Complete guide for integrating UI Bridge with React Native and Expo applications. Mobile integration differs significantly from web since there's no DOM to observe.

## Key Differences from Web

| Feature | Web | React Native |
|---------|-----|--------------|
| DOM Snapshots | ✅ Full DOM capture | ❌ No DOM |
| MutationObserver | ✅ Auto-detects changes | ❌ Not available |
| Auto-Registration | ✅ Automatic discovery | ⚠️ Manual via hooks |
| Render Logging | ✅ DOM-based | ✅ Screen/component-based |
| Element Control | ✅ Direct DOM access | ✅ Via component refs |

## Installation

```bash
npm install ui-bridge-native
```

For Expo projects, no additional native modules are required.

## Basic Setup

### 1. Add the Provider

```tsx
// app/_layout.tsx (Expo Router)
import { UIBridgeNativeProvider, useAutoRegister } from 'ui-bridge-native';

function AppContent() {
  // Enable auto-registration infrastructure
  useAutoRegister({ enabled: __DEV__ });

  return <Stack>{/* your screens */}</Stack>;
}

export default function RootLayout() {
  return (
    <UIBridgeNativeProvider
      features={{
        server: __DEV__,  // Enable HTTP server in dev
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
  logInteraction: (eventType: string, targetComponent?: string, details?: Record<string, unknown>) => void;
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

    setLogs(prev => [...prev.slice(-499), entry]);
  }, [currentScreen, isEnabled]);

  const logRender = useCallback((componentName, trigger, data = {}) => {
    if (!isEnabled) return;

    const entry: RenderLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'component_render',
      timestamp: Date.now(),
      source: componentName,
      trigger,
      data: { ...data, screen: currentScreen },
    };

    setLogs(prev => [...prev.slice(-499), entry]);
  }, [isEnabled, currentScreen]);

  const logInteraction = useCallback((eventType, targetComponent, details = {}) => {
    if (!isEnabled) return;

    const entry: RenderLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'interaction',
      timestamp: Date.now(),
      source: targetComponent || 'unknown',
      trigger: eventType,
      data: { ...details, screen: currentScreen },
    };

    setLogs(prev => [...prev.slice(-499), entry]);
  }, [isEnabled, currentScreen]);

  const getEntries = useCallback(async () => logs, [logs]);
  const clear = useCallback(async () => setLogs([]), []);

  return (
    <RenderLogContext.Provider value={{
      isEnabled,
      logRender,
      logInteraction,
      getEntries,
      clear,
      currentScreen,
    }}>
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
import { UIBridgeNativeProvider, useAutoRegister } from 'ui-bridge-native';
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
import { useUIElement } from 'ui-bridge-native';
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
import { useUIComponent } from 'ui-bridge-native';

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
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="Email"
      />
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
  useLogRender('ProductCard', {
    productId: product.id,
    inStock: product.quantity > 0,
  }, [product.id]);

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
import { UIBridgeNativeProvider, useAutoRegister } from 'ui-bridge-native';
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
