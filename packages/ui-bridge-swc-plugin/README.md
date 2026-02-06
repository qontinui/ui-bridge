# @qontinui/ui-bridge-swc-plugin

SWC plugin for automatic UI Bridge instrumentation. Adds `data-ui-id`, `data-ui-aliases`, and `data-ui-type` attributes to JSX elements during build time.

**This plugin is fully compatible with Next.js 15+ and `next/font`.**

## Why SWC Plugin?

| Feature                  | Babel Plugin    | SWC Plugin      |
| ------------------------ | --------------- | --------------- |
| Next.js 15 + `next/font` | ❌ Incompatible | ✅ Full support |
| Build speed              | Baseline        | 20-70x faster   |
| Same output              | ✅              | ✅              |
| Same config              | ✅              | ✅              |

## Installation

```bash
npm install -D @qontinui/ui-bridge-swc-plugin
```

## Usage with Next.js

```js
// next.config.js
module.exports = {
  experimental: {
    swcPlugins: [
      [
        '@qontinui/ui-bridge-swc-plugin',
        {
          elements: ['button', 'input', 'select', 'textarea', 'a', 'form'],
          idPrefix: 'ui',
        },
      ],
    ],
  },
};
```

## Example Transformation

**Input:**

```jsx
function LoginForm() {
  return (
    <form>
      <input placeholder="Email" />
      <input type="password" placeholder="Password" />
      <button onClick={handleSubmit}>Sign In</button>
    </form>
  );
}
```

**Output:**

```jsx
function LoginForm() {
  return (
    <form data-ui-id="ui-login-form-form" data-ui-type="form">
      <input
        placeholder="Email"
        data-ui-id="ui-login-form-email-input"
        data-ui-type="email-input"
        data-ui-aliases="email"
      />
      <input
        type="password"
        placeholder="Password"
        data-ui-id="ui-login-form-password-input"
        data-ui-type="password-input"
        data-ui-aliases="password"
      />
      <button
        onClick={handleSubmit}
        data-ui-id="ui-login-form-sign-in-button"
        data-ui-type="button"
        data-ui-aliases="sign in,signin,login,log in"
      >
        Sign In
      </button>
    </form>
  );
}
```

## Configuration Options

| Option                 | Type       | Default                                                  | Description                              |
| ---------------------- | ---------- | -------------------------------------------------------- | ---------------------------------------- |
| `elements`             | `string[]` | `['button', 'input', 'select', 'textarea', 'a', 'form']` | Elements to instrument                   |
| `idPrefix`             | `string`   | `'ui'`                                                   | Prefix for generated IDs                 |
| `idAttribute`          | `string`   | `'data-ui-id'`                                           | Attribute name for IDs                   |
| `aliasesAttribute`     | `string`   | `'data-ui-aliases'`                                      | Attribute name for aliases               |
| `typeAttribute`        | `string`   | `'data-ui-type'`                                         | Attribute name for element type          |
| `generateAliases`      | `boolean`  | `true`                                                   | Generate aliases from text/aria          |
| `includeComponentName` | `boolean`  | `true`                                                   | Include component name in ID             |
| `includeFilePath`      | `boolean`  | `false`                                                  | Include file path in ID                  |
| `hashIds`              | `boolean`  | `false`                                                  | Hash IDs for shorter strings             |
| `maxAliases`           | `number`   | `5`                                                      | Maximum aliases per element              |
| `skipExisting`         | `boolean`  | `true`                                                   | Skip elements with existing data-ui-id   |
| `onlyInComponents`     | `string[]` | `[]`                                                     | Only instrument in these components      |
| `skipInComponents`     | `string[]` | `[]`                                                     | Skip instrumentation in these components |
| `verbose`              | `boolean`  | `false`                                                  | Enable verbose logging                   |

## How It Works

1. **Parses JSX**: Uses SWC's native JSX parser
2. **Identifies targets**: Matches configured element types (button, input, etc.)
3. **Extracts context**: Gets text content, aria-label, placeholder, component name
4. **Generates ID**: Creates deterministic ID from context
5. **Generates aliases**: Creates aliases from text and common synonyms
6. **Injects attributes**: Adds data-ui-\* attributes to elements

## Why Auto-Instrumentation for AI?

AI agents need stable, semantic identifiers to interact with UIs. This plugin:

1. **Zero manual work**: Every interactive element gets instrumented automatically
2. **Semantic IDs**: IDs contain component name, text content, and element type
3. **Aliases for fuzzy matching**: AI can find elements using natural language
4. **Deterministic**: Same code produces same IDs across builds

**Example: AI agent interaction**

```python
from ui_bridge import UIBridgeClient

client = UIBridgeClient("http://localhost:9876")

# AI can find elements by natural language
client.ai.execute("click Sign In button")  # Matches aliases
client.ai.execute("type 'user@example.com' in Email input")
```

## Migrating from Babel Plugin

If you were using `@qontinui/ui-bridge-babel-plugin`:

1. **Remove Babel config** (if only used for UI Bridge)
2. **Install SWC plugin**: `npm install -D @qontinui/ui-bridge-swc-plugin`
3. **Update next.config.js**:

```diff
- // babel.config.js (delete this file)
- module.exports = {
-   presets: ['next/babel'],
-   plugins: [['@qontinui/ui-bridge-babel-plugin', { ... }]]
- };

+ // next.config.js
+ module.exports = {
+   experimental: {
+     swcPlugins: [
+       ['@qontinui/ui-bridge-swc-plugin', { /* same options */ }]
+     ]
+   }
+ };
```

## Requirements

- Node.js 18+
- Next.js 13+ (for SWC plugin support)
- Rust toolchain (for building from source only)

## Building from Source

```bash
# Install Rust and wasm32 target
rustup target add wasm32-wasip1

# Build
cargo build --release --target wasm32-wasip1

# Copy WASM file
cp target/wasm32-wasip1/release/ui_bridge_swc_plugin.wasm .
```

## Comparison with Babel Plugin

| Aspect                 | Babel Plugin | SWC Plugin |
| ---------------------- | ------------ | ---------- |
| Language               | TypeScript   | Rust       |
| Speed                  | ~1x          | ~20-70x    |
| Next.js 15 + next/font | ❌           | ✅         |
| Vite/CRA/Webpack       | ✅           | ❌         |
| Config format          | Same         | Same       |
| Output                 | Same         | Same       |

**Use Babel plugin** for: Vite, Create React App, Webpack, Remix, Next.js 12-14

**Use SWC plugin** for: Next.js 15+, Turbopack, any SWC-based build

## License

MIT
