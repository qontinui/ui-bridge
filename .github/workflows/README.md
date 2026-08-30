# GitHub Actions Workflows

This directory contains CI workflows for the UI Bridge monorepo.

## Workflows

### `ci.yml` — Standard CI

Node + Python test matrix plus docs build. Runs on every push/PR to `main`.

### `docs.yml` / `publish.yml` / `release.yml`

Documentation deploy and npm/package publishing. See each file for details.

### `runner-contract.yml` — SDK ↔ runner route contract

`UI_BRIDGE_ROUTES` (`packages/ui-bridge/src/server/types.ts`) is the source of
truth for the UI Bridge HTTP contract, and `qontinui-runner` must expose every
entry. This gate catches a route added here with no runner handler — which
otherwise 404s against a live runner, silently, with both repos green.

Runs `scripts/check-runner-contract.mjs` (zero dependencies, no build step)
against a checkout of the sibling runner repo. **Two modes, and the split is
the safety property:**

| Event | Sibling tree | Route drift / extraction failure |
|---|---|---|
| `pull_request` | the commit in `.github/sibling-pins.conf` | **gating** |
| `push` to `main` | same pin | advisory |
| `schedule` (nightly) / `workflow_dispatch` | runner's default branch (pin bypassed) | advisory |

**"Advisory" is scoped to the peer, not to the job.** Route drift and
extraction failure are softened there, because a moving peer repo must never
red this repo's `main`. Two things stay hard on every event, because neither is
the peer's doing: a usage error, and a **sibling-provenance violation** — the
run being handed a runner tree this repo did not ask for.

The gating job must never float on the runner's `main` — a runner land exposing
a route this repo does not declare would then red *this* repo's main, which is
the same defect pointed the other way. Only the advisory nightly floats, and a
rotting pin therefore shows up as a growing nightly warning rather than as
silence.

Which tree the job actually got is **asserted, not assumed**: the workflow
passes `--expect-sibling pinned|floating` and the checker fails closed if the
sibling resolver's own `source` output disagrees. That covers the ways the pin
can quietly stop applying — manifest deleted or renamed, the `qontinui-runner`
line dropped from it, or the `mode` step regressing to an empty `pin_file` —
each of which is only a *log line* inside the resolver, not an error.

On the pinned arm it also checks the pin is **ours**: the resolver looks for a
relative `pin-file` in the action's own repo as well as this workspace, and the
action is consumed cross-repo from `qontinui-runner`, which carries a manifest
of its own. So the checked-out sha is compared against the one
`.github/sibling-pins.conf` records, not merely observed to exist.

One consequence: **removing the `qontinui-runner` entry from
`.github/sibling-pins.conf` is an error here**, not the silent per-sibling
opt-out the action documents generically. Floating the gating job is the hazard
this workflow exists to prevent, so opting out means editing the `mode` step
too — deliberately, in a reviewable diff.

`scripts/check-runner-contract.test.mjs` covers the provenance logic (every
`source` string the resolver can emit, both `--expect-sibling` arms, the
absent-vs-empty splits, and the entry-module guard). It runs in the same job,
before the sibling is fetched — it needs no runner tree and no `npm ci` — and is
gating on every event, since it asserts only this repo's own logic.

Run it locally before pushing a route change: see
[CONTRIBUTING.md](../../CONTRIBUTING.md) → "Adding or removing a route in
`UI_BRIDGE_ROUTES`".

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
