---
sidebar_position: 4
---

# Auto-Registration

Auto-registration enables automatic discovery and registration of interactive UI elements without requiring manual `useUIElement()` calls on every component. This provides comprehensive UI Bridge coverage with minimal setup.

## Overview

By default, UI Bridge requires you to manually register each interactive element:

```tsx
// Manual registration (still supported)
function MyButton() {
  const { ref } = useUIElement({
    id: 'my-button',
    type: 'button',
  });
  return <button ref={ref}>Click me</button>;
}
```

With auto-registration, interactive elements are automatically discovered and registered:

```tsx
// Automatic - no manual registration needed!
function MyButton() {
  return <button data-testid="my-button">Click me</button>;
}
```

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│                  AutoRegisterProvider                   │
├─────────────────────────────────────────────────────────┤
│  1. Initial Scan                                        │
│     → Finds all interactive elements                    │
│     → Auto-generates IDs from attributes                │
│     → Registers with UI Bridge registry                 │
│                                                         │
│  2. MutationObserver                                    │
│     → Watches for DOM changes                           │
│     → Auto-registers new elements                       │
│     → Unregisters removed elements                      │
│     → Debounced for performance                         │
│                                                         │
│  3. ID Generation (priority order)                      │
│     data-ui-id → data-testid → id → semantic → auto    │
└─────────────────────────────────────────────────────────┘
```

## Quick Start

### Web / Next.js

```tsx
// app/layout.tsx or _app.tsx
import { UIBridgeProvider, AutoRegisterProvider } from 'ui-bridge/react';

export default function RootLayout({ children }) {
  return (
    <UIBridgeProvider features={{ control: true }}>
      <AutoRegisterProvider enabled={process.env.NODE_ENV === 'development'}>
        {children}
      </AutoRegisterProvider>
    </UIBridgeProvider>
  );
}
```

### Tauri Desktop

```tsx
// App.tsx
import { UIBridgeProvider, AutoRegisterProvider } from 'ui-bridge';

function App() {
  return (
    <UIBridgeProvider features={{ control: true }}>
      <AutoRegisterProvider enabled={import.meta.env.DEV}>
        <YourApp />
      </AutoRegisterProvider>
    </UIBridgeProvider>
  );
}
```

### React Native / Expo

React Native doesn't have a DOM, so auto-registration works differently. See [Mobile Guide](../guides/mobile) for details.

```tsx
// app/_layout.tsx
import { UIBridgeNativeProvider, useAutoRegister } from 'ui-bridge-native';

function AppContent() {
  // Enable auto-registration infrastructure
  useAutoRegister({ enabled: __DEV__ });

  return <YourApp />;
}
```

## Configuration

### AutoRegisterProvider Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `enabled` | `boolean` | `true` in dev | Enable auto-registration |
| `idStrategy` | `IdStrategy` | `'prefer-existing'` | How to generate element IDs |
| `debounceMs` | `number` | `100` | Debounce time for DOM mutations |
| `includeHidden` | `boolean` | `false` | Include hidden elements |
| `includeSelectors` | `string[]` | `[]` | Additional selectors to include |
| `excludeSelectors` | `string[]` | `[]` | Selectors to exclude |
| `scopeToChildren` | `boolean` | `false` | Only observe within provider's subtree |
| `generateId` | `function` | - | Custom ID generator |
| `onRegister` | `function` | - | Callback when element registered |
| `onUnregister` | `function` | - | Callback when element unregistered |

### ID Strategies

```tsx
<AutoRegisterProvider idStrategy="prefer-existing">
```

| Strategy | Description | Example Output |
|----------|-------------|----------------|
| `'prefer-existing'` | Use existing attributes, fall back to semantic | `submit-btn` (from data-testid) |
| `'data-testid'` | Only use data-testid | `submit-btn` or auto-generated |
| `'data-ui-id'` | Only use data-ui-id | `my-button` or auto-generated |
| `'semantic'` | Generate from element content | `button-submit-form` |
| `'auto'` | Always auto-generate | `button-1705123456-abc123` |

### ID Priority (prefer-existing)

When using `prefer-existing` strategy, IDs are generated in this order:

1. `data-ui-id` attribute
2. `data-testid` attribute
3. `id` attribute
4. Semantic (based on label/content)
5. Auto-generated

```html
<!-- Uses "my-button" -->
<button data-ui-id="my-button">Submit</button>

<!-- Uses "submit-btn" -->
<button data-testid="submit-btn">Submit</button>

<!-- Uses "form-submit" -->
<button id="form-submit">Submit</button>

<!-- Uses "button-submit-form" (semantic) -->
<button>Submit Form</button>
```

## Interactive Elements

Auto-registration detects these elements by default:

| Element | Selector |
|---------|----------|
| Links | `a[href]` |
| Buttons | `button`, `[role="button"]` |
| Inputs | `input`, `textarea`, `[role="textbox"]` |
| Selects | `select`, `[role="combobox"]`, `[role="listbox"]` |
| Checkboxes | `input[type="checkbox"]`, `[role="checkbox"]` |
| Radio buttons | `input[type="radio"]`, `[role="radio"]` |
| Tabs | `[role="tab"]` |
| Menu items | `[role="menuitem"]` |
| Sliders | `input[type="range"]`, `[role="slider"]` |
| Switches | `[role="switch"]` |
| Focusable | `[tabindex]:not([tabindex="-1"])` |
| Editable | `[contenteditable="true"]` |
| Explicit | `[data-ui-element]`, `[data-testid]` |

### Adding Custom Selectors

```tsx
<AutoRegisterProvider
  includeSelectors={[
    '.custom-interactive',
    '[data-action]',
  ]}
>
```

## Excluding Elements

### Via Selector

```tsx
<AutoRegisterProvider
  excludeSelectors={[
    '[data-no-register]',
    '.internal-button',
    '#skip-element',
  ]}
>
```

### Via Attribute

```html
<!-- This element won't be registered -->
<button data-no-register>Internal Action</button>
```

## Scoped Registration

Register only elements within a specific subtree:

```tsx
function Dashboard() {
  return (
    <>
      {/* Only elements inside here are auto-registered */}
      <AutoRegisterProvider scopeToChildren>
        <DashboardContent />
      </AutoRegisterProvider>

      {/* These elements are NOT auto-registered */}
      <Sidebar />
    </>
  );
}
```

## Custom ID Generator

```tsx
<AutoRegisterProvider
  generateId={(element) => {
    const testId = element.getAttribute('data-testid');
    if (testId) return `test-${testId}`;

    const label = element.textContent?.trim().slice(0, 20);
    if (label) return `el-${label.toLowerCase().replace(/\s+/g, '-')}`;

    return `auto-${Date.now()}`;
  }}
>
```

## Callbacks

```tsx
<AutoRegisterProvider
  onRegister={(id, element) => {
    console.log(`Registered: ${id}`, element);
  }}
  onUnregister={(id) => {
    console.log(`Unregistered: ${id}`);
  }}
>
```

## useAutoRegister Hook

For more control, use the hook directly:

```tsx
import { useAutoRegister } from 'ui-bridge/react';

function MyComponent() {
  useAutoRegister({
    enabled: true,
    root: document.getElementById('my-container'),
    idStrategy: 'semantic',
    debounceMs: 200,
    onRegister: (id) => console.log('Registered:', id),
  });

  return <div id="my-container">...</div>;
}
```

## Combining with Manual Registration

Auto-registration respects manually registered elements:

```tsx
function MyForm() {
  // Manual registration with custom actions
  const { ref } = useUIElement({
    id: 'special-button',
    type: 'button',
    customActions: {
      'validate-and-submit': {
        handler: async () => {
          await validate();
          await submit();
        },
      },
    },
  });

  return (
    <form>
      {/* Manually registered with custom action */}
      <button ref={ref}>Submit</button>

      {/* Auto-registered (no custom actions needed) */}
      <button data-testid="cancel-btn">Cancel</button>
    </form>
  );
}
```

## Performance Considerations

1. **Debouncing**: DOM mutations are debounced (default 100ms) to prevent excessive registration during rapid updates

2. **Development Only**: Enable only in development to avoid production overhead:
   ```tsx
   <AutoRegisterProvider enabled={process.env.NODE_ENV === 'development'}>
   ```

3. **Scoping**: Use `scopeToChildren` for large apps to limit observation scope

4. **Visibility Check**: Hidden elements are skipped by default (use `includeHidden` to change)

## Troubleshooting

### Element Not Being Registered

1. Check if element matches interactive selectors
2. Verify element is visible (not `display: none`)
3. Check exclude selectors aren't matching
4. Add `data-ui-element` attribute to force registration

### Duplicate IDs

If two elements generate the same ID, a unique suffix is added:
```
submit-btn → submit-btn
submit-btn → submit-btn-1705123456abc
```

### Too Many Elements Registered

1. Use `excludeSelectors` to filter unwanted elements
2. Use `scopeToChildren` to limit scope
3. Mark internal elements with `data-no-register`

## Next Steps

- [Render Logging](./render-logging) - Capture UI state automatically
- [Element Control](../concepts/actions) - Learn about element actions
- [Platform Guides](../guides/web) - Platform-specific setup
