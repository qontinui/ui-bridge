# @qontinui/ui-bridge-eslint-plugin

ESLint plugin for the UI Bridge IR. Ships a single rule —
`require-state-annotation` — that warns when JSX conditionally renders a
component the IR builder cannot statically pick up.

## Why

The UI Bridge IR is built by walking JSX for `<State>` and `<TransitionTo>`
declarations. A pattern like

```tsx
{shouldShowModal && <LoginModal />}
```

hides `LoginModal` from the static walk: unless `LoginModal` itself renders a
`<State>` or a sibling annotation makes the configuration explicit, the IR
builder will silently miss the corresponding state.

This rule warns at those sites so the author can either wrap a branch in an IR
primitive or add a sibling `<State>` declaration.

## Install

```bash
npm install --save-dev @qontinui/ui-bridge-eslint-plugin
```

## Usage (flat config)

```js
import uiBridgePlugin from '@qontinui/ui-bridge-eslint-plugin';

export default [
  {
    plugins: { 'ui-bridge': uiBridgePlugin },
    rules: { 'ui-bridge/require-state-annotation': 'warn' },
  },
];
```

## What gets flagged

```tsx
// FLAGGED — LoginModal hidden from the IR.
<div>{open && <LoginModal />}</div>

// FLAGGED — both branches are component renders.
<div>{open ? <Yes /> : <No />}</div>
```

## What does NOT get flagged

```tsx
// OK — host element, not a component.
<div>{x && <span />}</div>

// OK — sibling <State> annotates the boundary.
<div>{x && <Modal />}<State id="open" /></div>

// OK — IR primitive in the conditional itself.
<div>{x && <State id="open" />}</div>
```

## Options

```js
'ui-bridge/require-state-annotation': ['warn', {
  testGlobs: ['**/*.test.{ts,tsx}', '**/__tests__/**', '**/*.stories.{ts,tsx}'],
}]
```

| Option      | Type       | Default                                                                | Purpose                                                                              |
| ----------- | ---------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `testGlobs` | `string[]` | `['**/*.test.{ts,tsx}', '**/__tests__/**', '**/*.stories.{ts,tsx}']`   | Files exempted from the rule. Tests + stories legitimately render different branches. |

## License

MIT.
