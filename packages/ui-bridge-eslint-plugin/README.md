# @qontinui/ui-bridge-eslint-plugin

ESLint plugin for the UI Bridge IR. Two rules:

| Rule                                                    | Default severity in `recommended` | What it does                                                                                                  |
| ------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [`require-action-effect`](#require-action-effect)       | `error`                           | Requires an `effect` safety class on every component action registered through `useUIComponent({ actions })`. |
| [`require-state-annotation`](#require-state-annotation) | `warn`                            | Warns when JSX conditionally renders a component the IR builder cannot statically pick up.                    |

---

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
    rules: {
      'ui-bridge/require-action-effect': 'error',
      'ui-bridge/require-state-annotation': 'warn',
    },
  },
];
```

# `require-action-effect`

Every component action registered through `useUIComponent({ actions: [...] })`
must declare an `effect` — one of `"read"`, `"write"`, `"destructive"`.

## Why

An absent `effect` is **UNCLASSIFIED, not `read`**. The serializer forwards the
field undefaulted on purpose, and no verb in the SDK's consumer-side
`STANDARD_ACTION_EFFECTS` map can ever yield `destructive`. So to an autonomous
caller deciding whether an action is safe to invoke, an unannotated action is
indistinguishable from a harmless one.

It is shipped at **`error`**, not `warn` or `off`. Its sibling
`require-state-annotation` was wired into a consumer at `"off"` "until the
codebase is progressively annotated" and stayed off across 1355 sites; a
capability nobody switched on is a capability the product does not have. This
rule is shippable ON because the annotation pass landed first — so it starts
green and acts as a ratchet rather than as a backlog.

## What gets flagged

```ts
// FLAGGED (missingActionEffect) — no `effect` on the action.
useUIComponent({
  id: 'terminal-page',
  actions: [{ id: 'close-terminal', handler: () => {} }],
});

// FLAGGED (invalidActionEffect) — not one of the three IREffect values.
useUIComponent({ id: 'c', actions: [{ id: 'a', effect: 'readonly', handler: () => {} }] });

// FLAGGED (unresolvedActionEffect) — the element cannot be reduced to an
// object literal, so the rule cannot SEE an annotation. Unresolved is UNKNOWN,
// not annotated.
import { buildAction } from 'some-npm-package';
useUIComponent({ id: 'c', actions: [buildAction()] });

// FLAGGED (unenumerableActions) — a forwarded array cannot be enumerated.
useUIComponent({ id: `page-${id}`, actions: actions || [] });
```

## What does NOT get flagged

```ts
// OK — annotated inline.
useUIComponent({ id: 'c', actions: [{ id: 'refresh', effect: 'read', handler: () => {} }] });

// OK — no `actions` key registers no actions.
useUIComponent({ id: 'page-help', name: 'Help' });

// OK — the factory is FOLLOWED across the relative import to its returned
// object literal, which carries the annotation.
import { buildCreatePlainTerminalAction } from './createPlainTerminalAction';
useUIComponent({ id: 'terminal-page', actions: [buildCreatePlainTerminalAction(create)] });

// OK — a local const, a local factory, a `const actions = [...]` array, and a
// spread whose source demonstrably supplies `effect` are all followed.
```

Element-level `customActions` are deliberately **out of scope**: the schema
change that makes them annotatable has not landed.

## How it resolves non-literal actions

Not every action is written inline. The rule follows identifiers, locally
declared factories, object and array spreads, `export … from` barrels, and
**relative imports read from disk** through to the object literal they produce.
Two deliberate limits, both reported rather than assumed away:

- **Bare package specifiers are not followed.** Chasing a factory into
  `node_modules` would lint a published artifact rather than this repository's
  source.
- **Namespace imports (`import * as ns`) are not followed**, because the rule
  would have to model member access on the namespace.

Anything it cannot reduce is reported with the reason it failed. There is no
allow-list, no exemption glob and no id-keyed default table anywhere in the
rule: action ids collide across components by design, so annotation is
per-call-site and every message is qualified by the component id.

## Options

```js
'ui-bridge/require-action-effect': ['error', {
  hookNames: ['useUIComponent'],
  importAliases: { '@/': 'src' },
}]
```

| Option          | Type                    | Default              | Purpose                                                                                                                                                                                                                                                                                        |
| --------------- | ----------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hookNames`     | `string[]`              | `['useUIComponent']` | Hook names whose first argument is a component registration.                                                                                                                                                                                                                                   |
| `importAliases` | `Record<string,string>` | `{}`                 | Path-alias prefixes to follow when a factory is imported through one (e.g. a tsconfig `@/*` path). Targets resolve against the ESLint working directory. This is resolution configuration, not a suppression list — an unconfigured alias makes the import unresolved, and therefore reported. |

---

# `require-state-annotation`

## Why

The UI Bridge IR is built by walking JSX for `<State>` and `<TransitionTo>`
declarations. A pattern like

```tsx
{
  shouldShowModal && <LoginModal />;
}
```

hides `LoginModal` from the static walk: unless `LoginModal` itself renders a
`<State>` or a sibling annotation makes the configuration explicit, the IR
builder will silently miss the corresponding state.

This rule warns at those sites so the author can either wrap a branch in an IR
primitive or add a sibling `<State>` declaration.

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

| Option      | Type       | Default                                                              | Purpose                                                                               |
| ----------- | ---------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `testGlobs` | `string[]` | `['**/*.test.{ts,tsx}', '**/__tests__/**', '**/*.stories.{ts,tsx}']` | Files exempted from the rule. Tests + stories legitimately render different branches. |

## License

MIT.
