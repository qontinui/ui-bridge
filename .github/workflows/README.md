# GitHub Actions Workflows

This directory contains CI workflows for the UI Bridge monorepo.

## Workflows

### `ci.yml` — Standard CI

Node + Python test matrix plus docs build. Runs on every push/PR to `main`.

### `docs.yml` / `publish.yml` / `release.yml`

Documentation deploy and npm/package publishing. See each file for details.

### `smoke-test.yml` — UI Bridge smoke test

Two jobs:

1. **`lint-smoke-script`** (Ubuntu-hosted, runs on every PR + push to `main`)
   - `bash -n scripts/smoke-test-runner.sh` — catches shell syntax errors early.
   - `shellcheck` — informational only; warnings do **not** fail the job.
   - Confirms `scripts["smoke-test:runner"]` exists in root `package.json`.
   - Fast (< 30s). Always safe to gate merges on.

2. **`smoke-test-full`** (self-hosted, `workflow_dispatch` only)
   - Preflight-checks that supervisor (`:9875`) and backend (`:8000`) are reachable.
   - `npm ci` then `npm run smoke-test:runner`.
   - Uploads the full stdout/stderr log as an artifact (`smoke-test-log-<run-id>`).
   - Takes ~90s with cached runner binary, ~5 min with `SMOKE_REBUILD=true`.

## Why the default gate is syntax-only

The smoke test spawns a real Tauri runner window via the supervisor and drives it
through 23 live UI Bridge assertions. GitHub-hosted Linux runners cannot run
windowed Tauri apps out of the box, and even a headless setup would still need
the supervisor, backend, and a primary runner already live. That's not a
sensible thing to build fresh for every PR.

So the default path is a cheap, always-green syntax gate. The real smoke remains
a one-button manual trigger that targets a self-hosted runner where the dev
environment already exists.

## Running the full smoke manually

Prerequisites on the self-hosted machine:

- Supervisor running on `:9875`
- Backend running on `:8000`
- A primary runner registered with the supervisor
- Node 18+ and `bash` on `PATH`

Trigger it:

```sh
# From anywhere, once the workflow exists on main:
gh workflow run smoke-test.yml --ref main

# Force a runner rebuild before the smoke (slower, ~5 min):
gh workflow run smoke-test.yml --ref main -f smoke_rebuild=true
```

Then watch it:

```sh
gh run watch
# or download the log artifact after it finishes:
gh run download --name smoke-test-log-<run-id>
```

## Registering a self-hosted runner with the `qontinui-dev` label

Official docs: <https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/adding-self-hosted-runners>

Quick version:

1. **Repo Settings → Actions → Runners → New self-hosted runner.**
2. Pick Windows (or whichever OS your dev box runs). Follow the download + configure
   instructions GitHub prints — they include a one-time registration token.
3. When `./config.cmd` (Windows) or `./config.sh` (Linux/macOS) asks for labels,
   add **`qontinui-dev`** in addition to the defaults. The `runs-on:` clause
   in `smoke-test.yml` selects on this label.
4. Install as a service so it survives reboots:
   - Windows: `./svc install && ./svc start`
   - Linux: `sudo ./svc.sh install && sudo ./svc.sh start`
5. Verify it shows as **Idle** under Repo Settings → Actions → Runners.

Because the full smoke assumes supervisor + backend are already running, the
cleanest setup is to use your normal dev machine as the self-hosted runner and
invoke `gh workflow run ...` whenever you want a regression check.

## Troubleshooting

- **`lint-smoke-script` fails with "Missing scripts.smoke-test:runner"** — the
  root `package.json` lost its `smoke-test:runner` script. Restore it:
  `"smoke-test:runner": "bash scripts/smoke-test-runner.sh"`.
- **`smoke-test-full` fails at preflight with "Supervisor not reachable"** —
  start the supervisor on the self-hosted machine before dispatching.
- **No runners picked up the job** — check the runner still has the
  `qontinui-dev` label and is showing **Idle** in Repo Settings → Actions → Runners.
