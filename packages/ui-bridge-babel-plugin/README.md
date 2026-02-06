# @qontinui/ui-bridge-babel-plugin

Babel plugin for automatic UI Bridge instrumentation. Automatically adds `data-ui-id`, `data-ui-aliases`, and `data-ui-type` attributes to JSX elements during build time.

## Compatibility

| Framework            | Compatible | Notes             |
| -------------------- | ---------- | ----------------- |
| **Vite + React**     | ✅ Yes     | Full support      |
| **Create React App** | ✅ Yes     | Full support      |
| **Webpack + React**  | ✅ Yes     | Full support      |
| **Remix**            | ✅ Yes     | With Babel config |
| **Next.js 12-14**    | ✅ Yes     | With Babel config |
| **Next.js 15**       | ⚠️ Partial | See warning below |

### ⚠️ Next.js 15 + `next/font` Warning

**This plugin is NOT compatible with Next.js 15 projects that use `next/font`.**

Next.js 15 uses SWC (a Rust-based compiler) by default. When you add a Babel config, Next.js falls back to Babel, but `next/font` requires SWC and will fail:

```
Syntax error: "next/font" requires SWC although Babel is being used due to a custom babel config being present.
```

**Options for Next.js 15:**

1. **Use runtime instrumentation** - Use `@qontinui/ui-bridge` with `AutoRegisterProvider` instead (no build-time plugin needed)
2. **Remove `next/font`** - Use CSS `@font-face` instead (loses font optimization)
3. **Wait for SWC plugin** - A Rust-based SWC plugin is planned for full Next.js 15 compatibility

For Next.js 15 projects, we recommend the **runtime approach** with `@qontinui/ui-bridge` which provides equivalent functionality without build-time instrumentation.

## Installation

```bash
npm install -D @qontinui/ui-bridge-babel-plugin
```

## Usage

### With Babel Config

```js
// babel.config.js
module.exports = {
  plugins: [
    [
      '@qontinui/ui-bridge-babel-plugin',
      {
        // Options
        elements: ['button', 'input', 'select', 'textarea', 'a', 'form'],
        idPrefix: 'ui',
      },
    ],
  ],
};
```

### With Next.js (12-14, or 15 without `next/font`)

> ⚠️ **Not compatible with Next.js 15 + `next/font`**. See [Compatibility](#compatibility) section above.

```js
// babel.config.js
module.exports = {
  presets: ['next/babel'],
  plugins: [
    [
      '@qontinui/ui-bridge-babel-plugin',
      {
        elements: ['button', 'input', 'a'],
      },
    ],
  ],
};
```

If using Next.js 15 without `next/font`, also add to `next.config.js`:

```js
// next.config.js
module.exports = {
  // Disable SWC to allow Babel plugin
  swcMinify: false,
};
```

### With Vite

```js
// vite.config.js
import react from '@vitejs/plugin-react';

export default {
  plugins: [
    react({
      babel: {
        plugins: [
          [
            '@qontinui/ui-bridge-babel-plugin',
            {
              elements: ['button', 'input', 'a'],
            },
          ],
        ],
      },
    }),
  ],
};
```

## Example

**Input (your code):**

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

**Output (after transformation):**

```jsx
function LoginForm() {
  return (
    <form data-ui-id="ui-loginform-form" data-ui-type="form">
      <input
        placeholder="Email"
        data-ui-id="ui-loginform-email-input"
        data-ui-type="input"
        data-ui-aliases="email"
      />
      <input
        type="password"
        placeholder="Password"
        data-ui-id="ui-loginform-password-input"
        data-ui-type="input"
        data-ui-aliases="password"
      />
      <button
        onClick={handleSubmit}
        data-ui-id="ui-loginform-sign-in-button"
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
| `include`              | `string[]` | `['**/*.tsx', '**/*.jsx']`                               | File patterns to include                 |
| `exclude`              | `string[]` | `['**/node_modules/**', '**/*.test.*']`                  | File patterns to exclude                 |
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

## ID Generation

IDs are generated using:

1. Prefix (`idPrefix`)
2. Component name (if `includeComponentName` is true)
3. Text content, aria-label, or placeholder
4. Element semantic type (button, input, link, etc.)

Example: `ui-loginform-sign-in-button`

## Alias Generation

Aliases are automatically generated from:

- Text content
- `aria-label` attribute
- `placeholder` attribute
- `title` attribute
- `name` attribute

Common synonyms are also added (e.g., "sign in" also gets "signin", "login", "log in").

## Supported Elements

By default, the plugin instruments:

- `button` - Buttons
- `input` - Input fields
- `select` - Dropdowns
- `textarea` - Text areas
- `a` - Links
- `form` - Forms

You can customize this with the `elements` option:

```js
{
  elements: [
    'button',
    'input',
    'select',
    'textarea',
    'a',
    'form',
    'nav',
    'header',
    'footer',
    'dialog',
    'img',
  ];
}
```

## Best Practices

1. **Keep IDs stable**: The plugin generates deterministic IDs based on component structure. Avoid frequent refactoring that changes component names.

2. **Add meaningful text**: Elements with text content get better IDs and aliases. Use aria-labels for icon-only buttons.

3. **Use in development**: Consider only running the plugin in development/test builds if bundle size is a concern.

4. **Combine with UI Bridge**: This plugin works best with the [@qontinui/ui-bridge](../ui-bridge) package for AI-native automation.

## Why Auto-Instrumentation for AI?

AI agents need stable, semantic identifiers to interact with UIs. Manual ID assignment is tedious and often forgotten. This plugin solves both problems:

1. **Zero manual work**: Every interactive element gets instrumented automatically
2. **Semantic IDs**: IDs contain component name, text content, and element type
3. **Aliases for fuzzy matching**: AI agents can find elements using natural language
4. **Deterministic**: Same code produces same IDs across builds

**Example: AI agent interaction after instrumentation**

```python
from ui_bridge import UIBridgeClient

client = UIBridgeClient("http://localhost:9876")

# AI can find elements by natural language
client.ai.click("Sign In button")  # Matches data-ui-aliases="sign in,signin,login"
client.ai.type_text("Email input", "user@example.com")  # Matches aliases="email"

# Or use fuzzy search
results = client.ai.search(text_contains="submit")
```

## How It Works

The plugin traverses the JSX AST during Babel transformation:

1. **Identifies target elements**: Matches configured element types (button, input, etc.)
2. **Extracts context**: Gets text content, aria-label, placeholder, component name
3. **Generates ID**: Creates deterministic ID from context
4. **Generates aliases**: Creates aliases from text and common synonyms
5. **Injects attributes**: Adds data-ui-id, data-ui-type, data-ui-aliases

## License

MIT
