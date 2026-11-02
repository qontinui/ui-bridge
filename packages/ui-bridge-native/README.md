# ui-bridge-native

UI Bridge framework for React Native applications. Enables AI-driven UI automation and testing for mobile apps.

## Installation

```bash
npm install @qontinui/ui-bridge-native
# or
yarn add @qontinui/ui-bridge-native
```

## Quick Start

### 1. Wrap your app in the provider

```tsx
// app/_layout.tsx or App.tsx
import { UIBridgeNativeProvider } from '@qontinui/ui-bridge-native';

export default function RootLayout() {
  return (
    <UIBridgeNativeProvider
      features={{ server: __DEV__, debug: __DEV__ }}
      config={{ serverPort: 8087 }}
    >
      <Stack>{/* Your app content */}</Stack>
    </UIBridgeNativeProvider>
  );
}
```

### 2. Use hooks in your components

```tsx
import { useUIElement } from '@qontinui/ui-bridge-native';

function SubmitButton({ onPress }) {
  const { ref, onLayout, bridgeProps } = useUIElement({
    id: 'submit-button',
    type: 'button',
    label: 'Submit Form',
  });

  return (
    <Pressable ref={ref} onLayout={onLayout} {...bridgeProps} onPress={onPress}>
      <Text>Submit</Text>
    </Pressable>
  );
}
```

### 3. Control from Python (unchanged from web!)

```python
from ui_bridge import UIBridgeClient

# Over a cable or an emulator, after `adb forward tcp:8087 tcp:8087`. No token needed.
client = UIBridgeClient("http://localhost:8087")

# Find and interact with elements
client.press("submit-button")
client.type("email-input", "test@example.com")

# Get element state
state = client.get_element_state("submit-button")
print(f"Button visible: {state['visible']}")
```

## Hooks

### useUIElement

Register individual elements for control.

```tsx
const { ref, onLayout, bridgeProps, trigger, getState } = useUIElement({
  id: 'my-element',
  type: 'button', // or 'input', 'text', 'view', etc.
  label: 'My Button', // Human-readable label
});

// Spread onto your component
<Pressable ref={ref} onLayout={onLayout} {...bridgeProps}>
  <Text>Click Me</Text>
</Pressable>;
```

### useUIElementWithProps

Extended version that captures props for action execution.

```tsx
const { ref, onLayout, bridgeProps, captureProps } = useUIElementWithProps({
  id: 'text-input',
  type: 'input',
});

// Capture props so bridge can call onChangeText
captureProps({ onChangeText, value });

<TextInput
  ref={ref}
  onLayout={onLayout}
  {...bridgeProps}
  value={value}
  onChangeText={onChangeText}
/>;
```

### useUIComponent

Register component-level actions.

```tsx
useUIComponent({
  id: 'login-form',
  name: 'Login Form',
  actions: [
    {
      id: 'submit-login',
      label: 'Submit Login',
      handler: async ({ email, password }) => {
        setEmail(email);
        setPassword(password);
        await submitLogin();
      },
    },
    {
      id: 'clear-form',
      label: 'Clear Form',
      handler: () => {
        setEmail('');
        setPassword('');
      },
    },
  ],
});
```

### useUIBridge

Access bridge functionality from any component.

```tsx
const { available, elements, components, executeAction, find, createSnapshot } = useUIBridge();

// Find all buttons
const buttons = await find({ types: ['button'] });

// Execute action
await executeAction('submit-button', { action: 'press' });
```

### useRouteAwareness

Report the current screen as a route **template** (never the concrete path), emitted on every snapshot as `page.route`. Derive the template with `expoRouterPattern(useSegments())` (Expo Router) or `reactNavigationPattern(state)` (React Navigation), and set `patternSource: 'router'`.

```tsx
import { useSegments } from 'expo-router';
import { expoRouterPattern, isExpoRouterUnmatched, useRouteAwareness } from '@qontinui/ui-bridge-native';

const segments = useSegments();
useRouteAwareness(
  { pattern: expoRouterPattern(segments), patternSource: 'router' },
  { unmatched: isExpoRouterUnmatched(segments) }
);
```

The rules, and a React Navigation example: [Route Awareness in the React Native / Expo guide](https://qontinui.github.io/ui-bridge/docs/guides/mobile#route-awareness).

## Element Types

- `button` - Pressable buttons
- `input` - Text inputs
- `text` - Text elements
- `view` - Generic views
- `scroll` - ScrollViews
- `list` - FlatList/SectionList
- `listItem` - List items
- `switch` - Toggle switches
- `checkbox` - Checkboxes
- `radio` - Radio buttons
- `image` - Images
- `touchable` - TouchableOpacity/TouchableHighlight
- `pressable` - Pressable components
- `modal` - Modals
- `custom` - Custom elements

## Actions

- `press` - Single tap
- `longPress` - Long press
- `doubleTap` - Double tap
- `type` - Type text (for inputs)
- `clear` - Clear text
- `focus` - Focus element
- `blur` - Blur element
- `scroll` - Scroll
- `scrollIntoView` - Scroll the element's declared `scrollAncestorId` container (vertical ScrollView / FlatList) so the element is on screen; advertised only on elements that declare one
- `swipe` - Swipe gesture
- `toggle` - Toggle switch/checkbox

## HTTP Server

The package includes an embedded HTTP server for external control. Configure with:

```tsx
<UIBridgeNativeProvider
  features={{ server: true }}
  config={{ serverPort: 8087 }}
>
```

### API Endpoints

The bridge serves **56** method+path pairs. Two of them tell you about the other
54, so this README does not try to be the list — it went stale at 7 rows while
the surface grew, and a partial table read as a complete one is worse than no
table:

| Method | Path                  | Description                                                  |
| ------ | --------------------- | ------------------------------------------------------------ |
| GET    | `/ui-bridge/_routes`  | Every mounted route as `{method, path}` — ask the live server |
| GET    | `/ui-bridge/_help`    | The same list plus per-handler descriptions, actions and tips |

```bash
# Over `adb forward`, which arrives as loopback. On a device IP this route answers
# 401 PAIRING_REQUIRED, or PAIRING_UNCONFIGURED with no pairingStore; see "Device Pairing".
curl -s http://localhost:8087/ui-bridge/_routes | jq '.data.routes'
```

Statically, the same contract is the exported `UI_BRIDGE_NATIVE_ROUTES`:

```ts
import { UI_BRIDGE_NATIVE_ROUTES } from '@qontinui/ui-bridge-native';
```

Entries carrying `requiresTestHooks: true` are mounted only when the server
config sets `testHooks`; a production build answers those with a plain 404.
`route-table-parity.test.ts` pins the exported table against `_routes` in both
directions, and separately at `testHooks: false`, so neither can drift from the
router.

A wrong verb on a path the bridge does publish answers **405** with an `Allow`
header naming the verbs it accepts (and the same verbs in the JSON envelope's
`error`); a path it does not publish answers **404**.

### Device Pairing

The server admits callers as follows:

| Caller | Answer |
| --- | --- |
| Loopback peer with a loopback `Host` and nothing a web page sends (`Origin`, `Referer`, a `Sec-Fetch-Site` other than `none`) | Admitted, no token |
| Any other caller with a valid `X-UI-Bridge-Auth` signature | Admitted |
| Anyone, `GET /ui-bridge/health` (trimmed) | Answered |
| Anyone but a web page, `POST /ui-bridge/pair` | Answered |
| A web page, `POST /ui-bridge/pair` | `403 PAIRING_WEB_CALLER_REFUSED` |
| Signature outside the 300 s window, or older than this server will accept | `401 PAIRING_TIMESTAMP_REFUSED` with `data.serverTime`: re-sync and sign again, no new pairing needed |
| Signed body over `SIGNED_BODY_MAX_CHARS` (262,144 characters) | `413 PAIRING_BODY_TOO_LARGE` |
| Signed method over 16 characters, or target over `SIGNED_TARGET_MAX_CHARS` (8,192) | `414 PAIRING_TARGET_TOO_LONG` |
| Everyone else | `401 PAIRING_REQUIRED` |
| Not loopback, on a server with no `pairingStore` | `401 PAIRING_UNCONFIGURED` |
| WebSocket upgrade from anywhere but a trusted loopback caller, signed or not | `403 PAIRING_WS_LOOPBACK_ONLY` |

`POST /ui-bridge/pair` refuses in its own terms: `401 PAIRING_NOT_ARMED` with no code live, `400 PAIRING_CODE_REQUIRED` with no well-formed code, `401 PAIRING_CODE_INVALID` for a wrong one, and `503 PAIRING_UNAVAILABLE` while the store or the device id is not ready.

`adb forward` was measured arriving as `::ffff:127.0.0.1` on an Android 11 emulator on 2026-10-31, which counts as loopback. Physical phones are unmeasured.

A `curl` over a cable keeps working with nothing new. A `curl` to a device IP can reach only health, because a hand `curl` cannot sign.

To accept LAN callers, pass a `pairingStore`. The app supplies persistence and secure randomness, since the SDK's only generator is `Math.random`:

```tsx
const pairingStore: PairingStore = {
  get: () => readToken(), // throw until loaded; return null only when there is no token
  set: (token) => writeToken(token), // pairing answers only after this settles
  clear: () => deleteToken(),
  randomBytes: (n) => Crypto.getRandomBytes(n),
};

<UIBridgeNativeProvider
  serverAdapter={adapter}
  deviceId={deviceId}
  pairingStore={pairingStore}
  // ...
/>;
```

`useUIBridgeNative()` gives Settings `armPairingCode()`, `disarmPairingCode()`, `getPairingState()` and `revokePairing()`. A code lasts about 2 minutes, works once, and is disarmed by 5 wrong attempts from anyone. `getPairingState().consumedBy` names the peer that used it. A correct code is not used up when the store fails, so the user can try it again. A revoke replaces the token. No signature verifies while it runs, and one checked against the old token is not served after it.

A sample on a trusted network can opt out with `allowUnauthenticatedNetwork`. Anything that can reach the port can then drive the app over HTTP, with two exceptions. A web page is refused with `403 PAIRING_WEB_CALLER_REFUSED`: anything carrying `Origin`, `Referer` or a `Sec-Fetch-Site` other than `none`, and any `Host` other than an IP address, `localhost` or a `.local` name, which is how DNS rebinding shows up. A WebSocket upgrade stays loopback-only.

### Custom Server Adapter

The HTTP server requires a platform-specific adapter. See [documentation](./docs/server-adapters.md) for examples with:

- `react-native-http-bridge`
- `@aspect/react-native-http-server`

An adapter must also pass what the gate reads. Fill each `HTTPRequest` with `remoteAddress` from the accepted socket, never from a header, and with `rawTarget` and `rawBody` exactly as received, because a signature covers those bytes. Without `remoteAddress` a caller is treated as not loopback. A WebSocket adapter must call `onWebSocketUpgrade(req)` before sending the 101 and answer `decision.response` when `decision.admit` is false. Messages are refused on an adapter that never calls `onWebSocketUpgrade`.

## Debug Inspector

Built-in visual inspector for development:

```tsx
import { UIBridgeInspector } from '@qontinui/ui-bridge-native/debug';

function App() {
  return (
    <UIBridgeNativeProvider features={{ debug: __DEV__ }}>
      <MainContent />
      {__DEV__ && <UIBridgeInspector />}
    </UIBridgeNativeProvider>
  );
}
```

## TypeScript

Full TypeScript support included. Import types as needed:

```tsx
import type { NativeElementState, NativeElementType, UseUIElementOptions } from '@qontinui/ui-bridge-native';
```

## License

MIT
