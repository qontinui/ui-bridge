# `@qontinui/ui-bridge`

The UI Bridge engine: a React app registers its elements, components, states
and transitions with the bridge, and any HTTP client — a test, an agent, the
qontinui runner — can then observe and drive that UI by **semantic id** rather
than by CSS selector.

```bash
npm install @qontinui/ui-bridge
# or: yarn add @qontinui/ui-bridge  /  pnpm add @qontinui/ui-bridge
```

Full documentation: <https://qontinui.github.io/ui-bridge/>.

## Quick start

Wrap the app once:

```tsx
import { UIBridgeProvider } from '@qontinui/ui-bridge';

export function App() {
  return (
    <UIBridgeProvider
      features={{ control: true, renderLog: true, debug: true }}
      config={{ serverPort: 9876 }}
    >
      <YourApp />
    </UIBridgeProvider>
  );
}
```

Then register the things worth naming:

```tsx
import { useUIElement, useUIComponent } from '@qontinui/ui-bridge';

function LoginForm() {
  const email = useUIElement({ id: 'login-email', type: 'input', label: 'Email' });
  const submit = useUIElement({ id: 'login-submit', type: 'button', label: 'Log in' });

  useUIComponent({
    id: 'login-form',
    name: 'Login Form',
    actions: [{ id: 'login', label: 'Log in', handler: async () => ({ success: true }) }],
  });

  return (
    <form>
      <input ref={email.ref} data-ui-id="login-email" />
      <button ref={submit.ref} data-ui-id="login-submit" />
    </form>
  );
}
```

`useUIElement` returns the `ref` you attach; `data-ui-id` is what a client
addresses the element by.

## Subpath entry points

The root entry re-exports the React surface, so `@qontinui/ui-bridge` alone is
enough to get started. The subpaths exist so a consumer can import only the
slice it needs — a Node-only server never pays for the React import:

| Subpath                                          | What lives there                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| `.`                                              | Everything below that is browser-safe, including all of `./react`               |
| `./react`                                        | Providers and the 33 hooks (`useUIElement`, `useUIState`, `useUITransition`, …) |
| `./core`                                         | Registry, element/component types, the serializers                              |
| `./control`                                      | The control API — snapshots, find, element and component actions                |
| `./render-log`                                   | Render logging (`RenderLogManager`)                                             |
| `./debug`                                        | Debug/diagnostic surface                                                        |
| `./specs`, `./discovery`, `./contracts`          | App spec capture, discovery, contract types                                     |
| `./annotations`, `./vision`, `./ai`              | Annotation, vision and AI-assisted element resolution                           |
| `./idle`, `./artifacts`, `./verification-layers` | Idle detection, artifact capture, verification layers                           |
| `./ctr`, `./ctr/migrate`                         | Click-to-refine capture and its config migration                                |
| `./native`, `./native/*`                         | React Native bridge (core, react, control, server, debug)                       |
| `./server`, `./server/*`                         | In-package server adapters (see also `@qontinui/ui-bridge-server`)              |
| `./injected`, `./injected/bundle.global.js`      | The injected-transport bundle for pages that do not embed the SDK               |
| `./diagnostics`                                  | The generated diagnostic-code catalogue                                         |

`npm run docs:check-symbols` at the repo root name-checks every documented
import on this page — and every one in a fenced `@example` block in this
package's own source comments, which is what an IDE hover shows you — against
these `exports` entries and their real export surfaces, so an example cannot
drift from the code without failing CI.

## CLI

The package ships a `ui-bridge` bin. Run `npx ui-bridge --help` for the
current commands.

## Related packages

| Package                                               | Use it for                                                 |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| [`@qontinui/ui-bridge-server`](../ui-bridge-server)   | Express / Next.js / standalone HTTP adapters               |
| [`@qontinui/ui-bridge-native`](../ui-bridge-native)   | React Native apps                                          |
| [`@qontinui/ui-bridge-wrapper`](../ui-bridge-wrapper) | Driving a target system through interchangeable transports |
| `ui-bridge-python` (PyPI)                             | The Python client (`UIBridgeClient`)                       |

## License

AGPL-3.0-or-later.
