# {{PACKAGE_NAME}}

UI Bridge wrapper — **{{DISPLAY_NAME}}**.

Scaffolded by `create-ui-bridge-wrapper`. Supports the following transports:
`{{TRANSPORTS_CSV}}`. The default transport (the one wired up in
`src/index.{{#IF_UI}}tsx{{/IF_UI}}{{#IF_NODE}}ts{{/IF_NODE}}`) is
`{{DEFAULT_TRANSPORT}}`.

## Quick start

```
npm install
npm run build
npm test
```

{{#IF_NODE}}To run the Node daemon:

```
node dist/index.js
```

Press `Ctrl+C` to shut the transport down cleanly.
{{/IF_NODE}}{{#IF_UI}}This scaffold ships a React entry point. Render
`{{PASCAL_NAME}}Wrapper` inside whatever host app you plug the wrapper
into (runner tab, dev shell, Storybook…).
{{/IF_UI}}

## Layout

- `src/index.{{#IF_UI}}tsx{{/IF_UI}}{{#IF_NODE}}ts{{/IF_NODE}}` — picks a
  transport via `createTransport` and wires it up.
- `src/handlers.ts` — registers every action the wrapper knows how to run.
- `src/actions/hello.ts` — example action; copy-and-rename to add more.
- `tests/handlers.test.ts` — minimal round-trip test against `api`.

## Adding an action

1. Drop a new file under `src/actions/` that exports a handler function.
2. Wire it up in `src/handlers.ts` via
   `transport.handlerRegistry.register('my-action', handler)`.
3. Add a test under `tests/` that exercises it.

See `@qontinui/ui-bridge-wrapper`'s README for the full transport API.
