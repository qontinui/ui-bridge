# GitHub Actions Workflows

This directory contains CI workflows for the UI Bridge monorepo.

## Workflows

### `ci.yml` — Standard CI

Node + Python test matrix plus docs build. Runs on every push/PR to `main`.

### `docs.yml` / `publish.yml` / `release.yml`

Documentation deploy and npm/package publishing. See each file for details.

### `smoke-test.yml` — UI Bridge smoke test

One job:

- **`lint-smoke-script`** (Ubuntu-hosted, runs on every PR + push to `main`)
  - `bash -n scripts/smoke-test-runner.sh` — catches shell syntax errors early.
  - `shellcheck` — informational only; warnings do **not** fail the job.
  - Confirms `scripts["smoke-test:runner"]` exists in root `package.json`.
  - Fast (< 30s). Always safe to gate merges on.

## Why CI is syntax-only

The full smoke test spawns a real Tauri runner window via the supervisor and
drives it through live UI Bridge assertions. GitHub-hosted Linux runners cannot
run windowed Tauri apps out of the box, and even a headless setup would still
need the supervisor, backend, and a primary runner already live. That's not a
sensible thing to build fresh for every PR, so CI only does a cheap,
always-green syntax gate.

## Running the full smoke locally

The full smoke runs from your own dev machine, where the supervisor + backend
+ a primary runner already exist — no CI job involved.

Prerequisites:

- Supervisor running on `:9875`
- Backend running on `:8000`
- A primary runner registered with the supervisor
- Node 18+ and `bash` on `PATH`

Run it:

```sh
# ~90s with a cached runner binary:
npm run smoke-test:runner

# Force a runner rebuild first (slower, ~5 min):
SMOKE_REBUILD=true npm run smoke-test:runner
```

## Troubleshooting

- **`lint-smoke-script` fails with "Missing scripts.smoke-test:runner"** — the
  root `package.json` lost its `smoke-test:runner` script. Restore it:
  `"smoke-test:runner": "bash scripts/smoke-test-runner.sh"`.
- **Full smoke fails at preflight with "Supervisor not reachable"** — start the
  supervisor on `:9875` (and the backend on `:8000`) before running it.
