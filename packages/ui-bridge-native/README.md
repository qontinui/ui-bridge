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

# Connect to device (use 10.0.2.2 for Android emulator)
client = UIBridgeClient("http://10.0.2.2:8087")

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

### Custom Server Adapter

The HTTP server requires a platform-specific adapter. See [documentation](./docs/server-adapters.md) for examples with:

- `react-native-http-bridge`
- `@aspect/react-native-http-server`

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
