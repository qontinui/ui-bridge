# GitHub Actions Workflows

This directory contains CI workflows for the UI Bridge monorepo.

## Workflows

### `ci.yml` — Standard CI

Node + Python test matrix plus docs build. Runs on every push/PR to `main`, on
coord's `merge-candidate*/**` pushes, and by hand (`workflow_dispatch`).

### Where the Linux jobs run — the self-hosted pool and its hosted floor

On a **push** (`main` and coord's `merge-candidate*/**` refs), a
**`workflow_dispatch`**, or a **same-repo `pull_request`**, the jobs of `ci.yml`,
`qontinui-ci.yml`, `smoke-test.yml` and `ci-integrity-selftest.yml` can run on
the self-hosted pool `[self-hosted, Linux, X64, ram-16g]` instead of the hosted
floor `ubuntu-24.04` (a fork PR or a re-run always takes the floor). The floor
is pinned, not `ubuntu-latest`: `ubuntu-latest` became Ubuntu 26.04, on which
Playwright refuses to install chromium, and `scripts/check-ci-routing.py`
requires one floor label for every routed job, so it is spelled `ubuntu-24.04`
in each `route` step's `UIBRIDGE_CI_LINUX_HOSTED_LABEL`, its mismatch fallback,
each routed `runs-on` and the checker's `HOSTED` constant. The router's own
`DEFAULT_HOSTED_LABEL` stays `ubuntu-latest` (it is a verbatim copy) and is
always overridden by that env var. Each of those workflows has a `route` job that decides, using
the fleet's router `.github/scripts/route-ci-lane.py` (a verbatim copy of
qontinui-claude-config `scripts/route-ci-lane.py`; re-sync by copying it and
updating the blob pin in each `route` step, never by editing it — under
`auto`, a copy that does not match its pin routes to the hosted floor). The
repository variable `UIBRIDGE_CI_LINUX_LANE` picks the lane:

| Value | `route` | The routed jobs |
|---|---|---|
| `auto` | runs | the pool, unless it is stalled (a pool job queued 10 min or more), saturated (4 or more queued) or unreadable — then the hosted floor |
| `self-hosted` | skipped | the pool, with no overflow: a dead pool queues them for up to 24 h |
| `hosted`, unset, anything else | skipped | the hosted floor (the kill switch) |

What `auto` costs: `route` itself runs on a hosted runner, so a run still waits
for one hosted job before its pool jobs start — and when `route` picks the floor,
the jobs then wait in the hosted queue a second time. `self-hosted` removes that
wait and gives up the overflow.

What these workflows never route to the pool, whatever the variable says:

- **A FORK `pull_request` run** (head repo is not this repo). Routing is gated
  on an allowlist of events (`push`, `workflow_dispatch`, and a SAME-REPO
  `pull_request`), checked in every routed job's own `runs-on`. Same-repo PR
  runs route exactly like pushes: external PRs are prohibited on every qontinui
  repo, so repo visibility is not a trust boundary (decision record
  `self-hosted-runners-on-public-repos`, amendment 2026-11-04; policy
  `production-and-cost` `external-prs-are-prohibited-so-public-repo-ci-is-not-a-trust-boundary`).
  The fork guard is an optional extra on top of the repository's fork-PR
  approval policy (`all_external_contributors`), which stays.
- **A re-run** (attempt 2 and later), so a pool that picks jobs up and then fails
  them cannot fail the retry too.
- **`ci-integrity.yml`** (`pull_request_target`), **`docs.yml`** (the Pages
  deploy), **`publish.yml`** and **`publish-pypi.yml`**: they hold base-repo
  permissions or publishing credentials, and stay on hosted runners.

The check names do not change with the pool: they come from the job and its
matrix values, so `lint-and-test (22.x)` is `lint-and-test (22.x)` on both. On
the pool each job first runs `.github/actions/self-hosted-job-env`, which gives
it a HOME and TMPDIR of its own (every pool registration shares one unix
account), and the hosted-only steps (setup-node's npm cache, Playwright's
`--with-deps`) carry `runner.environment == 'github-hosted'` guards. Node and
Python come from the pool host's shared tool cache, so a new `node-version` or
`python-version` must be provisioned on the pool hosts before a workflow asks
for it (the action's header says why). ci.yml's `route` job carries the full
explanation.

The pool label set and the router's blob pin are spelled by hand at every site:
`--self-hosted-labels` in each `route` step, the forced-lane literal in each
routed `runs-on`, the `# coord-pools:` line directly above it, and the `want=`
pin. `scripts/check-ci-routing.py` (run by `ci-integrity-selftest.yml`'s
`guard-tests` job) fails on any disagreement among them or between a pin and the
committed router, so after a re-sync or a label change run
`python3 scripts/check-ci-routing.py` before pushing.

### `docs.yml` / `publish.yml` / `publish-pypi.yml`

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

### `ci-integrity.yml` — guard gating workflows from self-edits

Runs on `pull_request_target` (so `main`'s copy judges every PR) whenever a PR
touches `.github/workflows/**` or `.github/actions/**`. Every such file counts as
a gate, except this README (listed in the guard's `NON_GATING`, with the reason).
The guard never checks out PR code; it reads the diff through the API.

| The PR... | It needs |
|---|---|
| touches no workflow or action | nothing |
| only ADDS (a new job or file; nothing existing altered) | label `ci:gate-change=declared` |
| ALTERS or REMOVES an existing job, or changes anything outside `jobs:` | label `ci:gate-change=alters-a-gate`, plus one line per finding in the PR body |

Body lines are matched as WHOLE lines, each on its own line starting at column
0: `Gate-Change: <file-stem>#<job-key>`, `Gate-Removal: <file-stem>#<job-key>`,
or `Gate-Change: <file-stem>#workflow` for a change outside `jobs:` — for
example `Gate-Change: secret-scan#gitleaks`. The failure message lists the lines
it needs indented by two spaces; drop that indentation when you paste them, or
they will not match. Adding a label does not re-trigger the workflow: add it,
then re-run the job. On a pass the guard posts a PR comment
recording what changed. It is the same guard as qontinui-runner's; the header of
`ci-integrity.yml` states what it does and does NOT detect.

`ci-integrity-selftest.yml` runs the guard's tests (`scripts/tests/ci-integrity/`)
against the guard as committed in the PR, since the guard itself only ever runs
`main`'s copy.

### `smoke-test.yml` — UI Bridge smoke test

One job:

- **`lint-smoke-script`** (runs on every PR + push to `main`; Ubuntu-hosted for a
  fork PR or a re-run, routed to the self-hosted pool on a push or a same-repo
  PR — see "Where the Linux jobs run")
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
