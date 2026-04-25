# `create-ui-bridge-wrapper`

Scaffold a new UI Bridge wrapper app.

```
npx create-ui-bridge-wrapper <name> [flags]
```

Produces a ready-to-build wrapper package that consumes
`@qontinui/ui-bridge-wrapper` and wires up one or more of the four
transports: `api`, `headless`, `headed`, `live`.

## Flags

| Flag                      | Default      | Notes                                                                                                                |
| ------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------- |
| `<name>`                  | — (required) | kebab-case identifier. Final npm name becomes `wrapper-<name>` (or kept as-is if it already starts with `wrapper-`). |
| `--transports <list>`     | prompted     | Comma-separated subset of `api,headless,headed,live`.                                                                |
| `--no-ui` / `--node-only` | prompted     | Emit a plain Node daemon (no React).                                                                                 |
| `--out <dir>`             | `./<name>`   | Output directory.                                                                                                    |
| `--monorepo`              | prompted     | Drop under `../../qontinui-wrappers/packages/<name>/` with `@qontinui/`-scoped name and `workspace:*` deps.          |
| `--yes` / `-y`            | off          | Skip all prompts. Defaults to `--transports api` and `--no-ui`.                                                      |
| `--force`                 | off          | Overwrite the output directory if it already exists.                                                                 |
| `--help`                  | —            | Print usage and exit.                                                                                                |

## Examples

Scaffold an api-only Node daemon, no prompts:

```
npx create-ui-bridge-wrapper my-sdk --transports api --yes
```

Pick transports interactively and include the React `WrapperAppShell`:

```
npx create-ui-bridge-wrapper my-frontend
```

Scaffold a live wrapper aimed at the runner, writing to a custom path:

```
npx create-ui-bridge-wrapper my-runner \
  --transports live \
  --out ./wrappers/my-runner
```

## What you get

```
<name>/
├── package.json         — name: wrapper-<name>, peer deps on @qontinui/ui-bridge{,-wrapper}
├── tsconfig.json
├── vitest.config.ts
├── .gitignore
├── README.md
├── src/
│   ├── index.tsx | index-node.ts   — transport wiring + lifecycle
│   ├── handlers.ts                 — `registerHandlers(transport)` entry
│   └── actions/hello.ts            — one example per selected transport kind
└── tests/handlers.test.ts
```

Run `npm install`, then `npm run build` and `npm test` to verify.
