#!/usr/bin/env node
/**
 * Peer-payload gate: does the route contract this repo DECLARES match the one
 * qontinui-runner EXPOSES?
 *
 * WHY THIS EXISTS
 * ---------------
 * `UI_BRIDGE_ROUTES` (packages/ui-bridge/src/server/types.ts) is the source of
 * truth for the UI Bridge HTTP contract, and qontinui-runner must expose every
 * entry. The runner asserts that in its own CI test
 * `sdk_manifest_routes_are_exposed_by_runner`. Until 2026-08-26 it asserted it
 * against a FLOATING clone of this repo, so a land here reddened the runner's
 * `main` an hour later on a commit that touched none of it — a 5h+ merge-train
 * outage on 2026-08-20.
 *
 * qontinui-runner#1158 fixed that by pinning the clone. But a pinned consumer
 * that stops breaking is a consumer that stops REPORTING: the contract then
 * drifts unobserved until someone bumps the pin. Measured 2026-08-29, three
 * days after the pin landed, this repo's `main` already declared
 * `POST /control/visibility` with no runner handler — and both repos were
 * green.
 *
 * This script is the producer half. A route addition fails HERE, on the PR
 * that adds it, instead of later on a sibling's main.
 *
 * WHAT IT DOES
 * ------------
 * Reproduces the runner's own verdict from static sources, with no Rust
 * toolchain: extracts both route sets, applies the runner's own accepted-
 * divergence lists plus this repo's ledger, and diffs. Validated against a
 * control — at the sha the runner is pinned to, it reports a clean diff in
 * both directions, which is exactly what runner CI reports.
 *
 * Running the runner's actual Rust test here was the alternative and was
 * rejected: it means building a full Tauri crate on every ui-bridge PR,
 * including the pure-docs ones, to reach a verdict this already reaches.
 *
 * FAIL CLOSED
 * -----------
 * A regex that matches nothing must never read as "no drift". Every
 * extraction step has a floor, and every floor is a hard error naming what it
 * could not find.
 *
 * Usage:
 *   node scripts/check-runner-contract.mjs [--runner <path>] [--advisory]
 *                                          [--types <path>] [--baseline <path>]
 *                                          [--expect-sibling pinned|floating]
 *                                          [--pins <path>]
 *
 * Exit codes: 0 clean · 1 drift · 2 extraction failure or wrong sibling tree.
 * With --advisory it exits 0 for drift and for extraction failure and annotates
 * instead (used on `push` and on the nightly schedule, so no peer land can ever
 * red this repo's main). It does NOT soften a usage error or a sibling-
 * provenance violation — both report THIS repo's own wiring, which is not what
 * advisory mode exists to tolerate. See ProvenanceError.
 *
 * Importable: the CLI body runs only when this file is the entry module, so the
 * provenance helpers can be unit-tested (scripts/check-runner-contract.test.mjs).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

// ── Floors ──────────────────────────────────────────────────────────────────
// Deliberately tighter than the runner test's own (50 SDK routes): that floor
// is slack enough to survive a regex regression that drops three quarters of
// the contract. These are sized just under the real counts at authoring time
// (200 SDK entries, 30 runner families) so a genuine shrink is loud.
const MIN_SDK_ROUTES = 150;
const MIN_RUNNER_MODULES = 25;

class ExtractionError extends Error {}

/**
 * A caller mistake, not a fact about the trees being compared. Never softened
 * by --advisory: advisory mode exists so a moving peer repo cannot fail this
 * job, and a malformed command line is not the peer's doing.
 */
class UsageError extends ExtractionError {}

/**
 * The verdict is real but it is about the WRONG TREE — the sibling resolver
 * handed this run a runner checkout the caller did not ask for.
 *
 * Never softened by --advisory, for the same reason UsageError is not: advisory
 * mode exists so a moving PEER repo cannot fail this job, and which tree got
 * checked out is decided entirely by this repo's own workflow and pin manifest.
 * A provenance violation is our defect, not the peer's.
 */
class ProvenanceError extends ExtractionError {}

// ── Which sibling tree did we actually get? ─────────────────────────────────

/**
 * Assert the sibling resolver gave this run the tree the event asked for.
 *
 * THE PROPERTY THIS DEFENDS is the one runner-contract.yml names as the whole
 * reason it has two modes:
 *
 *   "The gating job must never float on the runner's `main`: a runner land that
 *    exposed a route this repo does not declare would then red THIS repo's
 *    main — importing the very defect this plan exists to close, pointed the
 *    other way."
 *
 * Until now that was prose. The workflow already exported SIBLING_SOURCE /
 * SIBLING_SHA into this script's environment and then only `echo`ed them, so
 * every way the pin can quietly stop applying was invisible:
 *
 *   - `.github/sibling-pins.conf` deleted, renamed, or moved — the action logs
 *     "No pin manifest found … resolving by default branch" and RETURNS 0;
 *   - the `qontinui/qontinui-runner` line dropped from it — likewise a log line
 *     and a default-branch fall-through, not an error;
 *   - the `mode` step regressing to an empty `pin_file` on a PR — the exact bug
 *     class already hit once here, where `${{ cond && '' || 'x' }}` cannot
 *     yield an empty string in a GitHub expression.
 *
 * In all three the gate still runs, still prints a verdict, and still says
 * "OK — the declared contract and the runner surface agree" — against the
 * runner's moving `main`. Failing closed on provenance is what makes that
 * green mean what it claims.
 *
 * The mirror case matters too: the nightly drift radar is supposed to BYPASS
 * the pin, and a regression that silently reinstates it leaves the radar
 * reporting nothing new, forever, while looking like it works.
 *
 * Reading the action's documented outputs (checkout-sibling action.yml):
 *   - `sha` non-empty  ⟺ a specific commit was resolved — a declared adaptation
 *                        PR, else the pin manifest.
 *   - `source` carries `pinned` ⟺ the pin supplied that commit.
 *   - `source` naming a declaration form ⟺ a declared adaptation PR did.
 *   - bare `none` / `trailing-declined` with an empty `sha` ⟺ fell through to
 *                        the sibling's DEFAULT BRANCH. That is "floating".
 */
const DECLARATION_FORMS = [
  'downstream-of',
  'upstream-of',
  'self-upstream-of',
  'sibling-downstream-of',
];

/** The sibling this repo's contract gate is about. */
const SIBLING_REPO = 'qontinui/qontinui-runner';

/**
 * Classify a `source` string into exactly one of three kinds.
 *
 * `declared` and `pinned` are mutually exclusive at the source: apply_pin()
 * early-returns once a declaration has already set SHA, so the action cannot
 * emit a declaration form together with `+pinned`. The returned shape says
 * only what is producible — a `pinned` flag alongside `kind: 'declared'` would
 * advertise a combination that cannot occur.
 */
export function describeSiblingProvenance(source, sha) {
  const parts = source.split('+');
  const forms = DECLARATION_FORMS.filter((f) => parts.includes(f));
  if (forms.length) return { kind: 'declared', forms, sha };
  if (parts.includes('pinned')) return { kind: 'pinned', forms: [], sha };
  // `trailing-declined` is carried through so the report can say a declaration
  // WAS found and declined, rather than flattening it to "nothing declared".
  return { kind: 'floating', forms: [], sha, declined: parts.includes('trailing-declined') };
}

/**
 * The sha THIS repo's manifest records for the sibling, or null if unlisted.
 *
 * Needed because `pinned` alone does not mean "pinned by us". apply_pin()
 * resolves a relative `pin-file` against two roots — `$GITHUB_WORKSPACE` and
 * the ACTION's own repo — and `checkout-sibling` is consumed cross-repo from
 * qontinui-runner, which carries a `.github/sibling-pins.conf` of its own. So
 * if this repo's manifest ever went missing while the runner's happened to
 * list `qontinui/qontinui-runner`, the resolver would report `none+pinned`
 * from a file this repo does not own and an existence-only check would pass.
 * Comparing the sha closes that: the pin's PROVENANCE is checked, not just
 * that some pin applied.
 */
export function ourPinnedSha(pinsFile) {
  if (!fs.existsSync(pinsFile)) return null;
  for (const raw of fs.readFileSync(pinsFile, 'utf8').split('\n')) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const m = /^(\S+)\s+([0-9a-f]{40})$/.exec(line);
    if (m && m[1] === SIBLING_REPO) return m[2];
  }
  return null;
}

/**
 * One line for the report header saying WHERE the runner tree came from.
 *
 * Falls back to the raw `source` when no expectation was asserted, and to an
 * explicit UNKNOWN when the action outputs are absent altogether — a developer
 * running this against a local sibling has no resolver behind them, and that is
 * a different thing from a CI run whose provenance went missing.
 */
export function describeResolution(provenance, env, pinsFile) {
  if (!provenance) {
    const source = (env.SIBLING_SOURCE || '').trim();
    return source
      ? `source="${source}" (not asserted — no --expect-sibling)`
      : 'UNKNOWN (no sibling resolver outputs — local checkout, provenance unasserted)';
  }
  const { kind, forms, sha, declined } = provenance;
  const at = sha ? ` @ ${sha}` : '';
  if (kind === 'declared') {
    return `DECLARED adaptation PR${at} via ${forms.join('+')} (outranks the pin, as designed)`;
  }
  // Name the manifest the run was actually told to use, not a hardcoded path —
  // `pin-file` is a workflow input and the two can differ.
  if (kind === 'pinned') return `the PIN in ${pinsFile}${at}`;
  const why = declined
    ? 'floating — a declaration was found and DECLINED, and no pin applied'
    : 'floating — no pin, no declaration';
  return `qontinui-runner's DEFAULT BRANCH (${why})`;
}

export function checkSiblingProvenance(expect, env, pinsFile) {
  // ABSENT and EMPTY are different answers, and conflating them fails OPEN.
  // The workflow spells this `--expect-sibling "${{ steps.mode.outputs.… }}"`,
  // so a `mode` step that stopped emitting the output would pass an empty
  // STRING, not no flag at all — and `if (!expect) return null` would then
  // silently drop the assertion in exactly the case it exists to catch.
  // Absent means a developer running this by hand; empty means CI wiring broke.
  if (expect === undefined) return null; // local `npm run contract:runner`
  if (expect === '') {
    throw new UsageError(
      '--expect-sibling was passed an empty value. In CI this means the `mode` step stopped ' +
        'emitting `expect_sibling`; refusing to fall through to an unasserted run, which would ' +
        'drop the check in precisely the case it exists to catch.',
    );
  }
  // Validate the WORD before reading the environment. A typo is the caller's
  // mistake and must say so; reporting "SIBLING_SOURCE is empty" to someone who
  // typed `--expect-sibling pin` sends them after CI wiring they do not have.
  if (expect !== 'pinned' && expect !== 'floating') {
    throw new UsageError(
      `--expect-sibling takes "pinned" or "floating", not ${JSON.stringify(expect)}`,
    );
  }

  const source = (env.SIBLING_SOURCE || '').trim();
  if (!source) {
    throw new ProvenanceError(
      '--expect-sibling was requested but SIBLING_SOURCE is empty. The workflow step must ' +
        "export the checkout-sibling action's `source` output, and the action must still " +
        'produce one. Refusing to certify a contract verdict without knowing which runner ' +
        'tree produced it.',
    );
  }

  const p = describeSiblingProvenance(source, (env.SIBLING_SHA || '').trim());

  if (expect === 'pinned') {
    // A DECLARED adaptation PR legitimately outranks the pin — that is the
    // documented deadlock-breaker for a coordinated two-repo route addition.
    // Rejecting it here would make exactly the change this gate is meant to
    // permit unlandable, so `declared` is accepted alongside `pinned`.
    if (p.kind === 'floating') {
      throw new ProvenanceError(
        `this run must compare against a PINNED runner tree, but the sibling resolver reported ` +
          `source="${source}" (sha=${p.sha || '<empty>'}), which means it fell through to ` +
          "qontinui-runner's DEFAULT BRANCH.\n\n" +
          'A gating run that floats on the runner\'s main reds THIS repo on a peer\'s land — ' +
          'the defect this workflow exists to close, pointed the other way. Check that ' +
          `${pinsFile} still exists, still lists ${SIBLING_REPO}, and ` +
          "that the workflow's `mode` step is still passing it as `pin-file`.",
      );
    }

    // `pinned` is not the same claim as "pinned BY US" — see ourPinnedSha().
    if (p.kind === 'pinned') {
      // Same absent-vs-empty split as `--expect-sibling` above, applied to the
      // sha — and load-bearing for the identical reason. `SIBLING_SHA` feeds
      // only the echo in the workflow's `run:` block, so it reads as
      // decorative and is the obvious casualty of tidying that `env:` block.
      // Were an empty sha allowed to skip the comparison, the pin-provenance
      // check would go inert from that commit on while staying green: our
      // manifest still lists the runner, so `ours` is non-null and nothing
      // else objects. apply_pin() sets SHA before appending `+pinned`, so a
      // `pinned` source with no sha is provably broken wiring, never a
      // legitimate run.
      if (!p.sha) {
        throw new ProvenanceError(
          `source="${source}" says the pin applied, but SIBLING_SHA is empty. The action always ` +
            'emits a sha alongside `+pinned`, so the workflow step has stopped exporting it — ' +
            `and without it the pin cannot be checked against ${pinsFile}. Restore ` +
            'SIBLING_SHA in the contract-check step\'s `env:` block.',
        );
      }
      const ours = ourPinnedSha(pinsFile);
      if (ours === null) {
        throw new ProvenanceError(
          `the resolver reported source="${source}", but ${pinsFile} does not list ` +
            `${SIBLING_REPO}. The commit that was checked out therefore came from some OTHER ` +
            'pin manifest — the action resolves a relative `pin-file` against its own repo as ' +
            'well as this workspace, and it is consumed cross-repo from qontinui-runner, which ' +
            'carries a manifest of its own.\n\n' +
            'Restore the entry. Deleting it does NOT float this gate on purpose: floating the ' +
            'GATING job is the hazard this workflow exists to prevent, so it is an error here ' +
            'rather than the per-sibling opt-out the action documents generically.',
        );
      }
      if (p.sha !== ours) {
        throw new ProvenanceError(
          `the resolver checked out ${SIBLING_REPO} @ ${p.sha}, but ${pinsFile} records ` +
            `${ours}. The pin that applied is not this repo's.\n\n` +
            'Most likely `pin-file` resolved against a manifest in the action\'s own repo ' +
            'instead of this workspace. The verdict would be about a runner tree this repo ' +
            'never chose.',
        );
      }
    }
    return p;
  }

  // expect === 'floating'. Assert the KIND, not just the absence of a pin: the
  // radar's question is "what does the runner look like today", and a declared
  // adaptation head is no more today's default branch than a pinned sha is.
  // Unreachable while `schedule`/`workflow_dispatch` carry no PR context — the
  // resolver can only emit `none` or `none+pinned` there — but an assertion
  // that reads as if it validates floating-ness should actually do so.
  if (p.kind !== 'floating') {
    const why =
      p.kind === 'pinned'
        ? 'the pin applied'
        : `a declared adaptation PR resolved (${p.forms.join('+')})`;
    throw new ProvenanceError(
      `this run is the drift radar and must compare against ${SIBLING_REPO}'s DEFAULT BRANCH, ` +
        `but the sibling resolver reported source="${source}" — ${why}.\n\n` +
        'A radar that silently keeps using the pin reports nothing new, forever, while ' +
        "looking like it works. Check the workflow's `mode` step: on `schedule` and " +
        '`workflow_dispatch` it must emit an EMPTY `pin_file`.',
    );
  }
  return p;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { advisory: false };
  // A dangling `--runner` must NOT fall through to the ../qontinui-runner
  // convention: it would compare against a tree the caller did not name and
  // still exit 0, which is the "silently answered a different question" shape
  // every floor in this file exists to prevent.
  const value = (flag, i) => {
    const v = argv[i];
    if (v === undefined || v.startsWith('--')) {
      throw new UsageError(`${flag} requires a value`);
    }
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--advisory') out.advisory = true;
    else if (a === '--runner') out.runner = value(a, ++i);
    else if (a === '--types') out.types = value(a, ++i);
    else if (a === '--baseline') out.baseline = value(a, ++i);
    else if (a === '--expect-sibling') out.expectSibling = value(a, ++i);
    else if (a === '--pins') out.pins = value(a, ++i);
    else throw new UsageError(`unknown argument: ${a}`);
  }
  return out;
}

/**
 * Resolve the runner checkout. CI passes --runner explicitly; a developer
 * running this by hand gets the dev-tree convention (a sibling of this repo).
 */
function resolveRunnerDir(explicit, repoRoot) {
  const candidates = explicit
    ? [explicit]
    : [
        process.env.RUNNER_CHECKOUT,
        path.join(repoRoot, 'qontinui-runner'),
        path.join(repoRoot, '..', 'qontinui-runner'),
      ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'src-tauri/src/mcp/ui_bridge/mod.rs'))) return c;
  }
  throw new ExtractionError(
    'no qontinui-runner checkout found (looked for src-tauri/src/mcp/ui_bridge/mod.rs in: ' +
      candidates.join(', ') +
      '). Pass --runner <path>.',
  );
}

/**
 * Say WHICH runner tree the verdict came from.
 *
 * A green that came from a stale local checkout is not a green against the
 * ref anyone else will see. The runner's own drift test reads a sibling
 * checkout and says nothing about which branch it is on, which is how a naive
 * local `cargo test` passed while CI failed during the 2026-08-20 incident.
 * Do not repeat that here.
 */
function describeRunnerRef(runnerDir) {
  try {
    const sha = execFileSync('git', ['-C', runnerDir, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    let label = '';
    try {
      label = execFileSync('git', ['-C', runnerDir, 'rev-parse', '--abbrev-ref', 'HEAD'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      /* detached / no branch — the sha is the answer */
    }
    return label && label !== 'HEAD' ? `${sha} (${label})` : sha;
  } catch {
    return 'UNKNOWN (not a git checkout — cannot say which runner ref this verdict is against)';
  }
}

// ── Shared normalisation ────────────────────────────────────────────────────

/**
 * Fold `:id` (SDK/express) and `{id}` (runner/axum) placeholders to `{}`.
 * Mirrors `canonicalise_path` in the runner's mod.rs: axum routes by position,
 * not by binding name, so `{run_id}` and `{runId}` are the same route.
 */
function canonicalise(p) {
  return p
    .split('/')
    .map((seg) => {
      const isAxum = seg.startsWith('{') && seg.endsWith('}') && seg.length >= 2;
      const isExpress = seg.startsWith(':');
      return isAxum || isExpress ? '{}' : seg;
    })
    .join('/');
}

const key = (method, p) => `${method} ${p}`;

/** Balanced scan from just after an opening bracket to its matching close. */
function balancedBody(text, bodyStart, open, close, what) {
  let depth = 1;
  for (let i = bodyStart; i < text.length; i++) {
    const c = text[i];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return text.slice(bodyStart, i);
    }
  }
  throw new ExtractionError(`${what}: opening ${open} never closes — scan logic bug or truncated file`);
}

// ── SDK side ────────────────────────────────────────────────────────────────

/**
 * Scrape UI_BRIDGE_ROUTES out of types.ts.
 *
 * The regexes intentionally MIRROR the runner's Rust test (mod.rs, the
 * `sdk_manifest_routes_are_exposed_by_runner` scrape) rather than improving on
 * it — including its blind spot: the entry matcher cannot see an entry that
 * contains a nested object literal, because it does not nest. Diverging here
 * would make this gate disagree with the consumer test it exists to anticipate,
 * which is worse than sharing a known limitation. If that limitation is ever
 * fixed, fix it on BOTH sides in one change.
 */
function parseSdkRoutes(typesPath) {
  const src = readOrFail(typesPath, 'SDK types.ts');
  const open = /export\s+const\s+UI_BRIDGE_ROUTES[^=]*=\s*\[/.exec(src);
  if (!open) {
    throw new ExtractionError(
      `UI_BRIDGE_ROUTES array not found in ${typesPath} — the declaration moved or was renamed`,
    );
  }
  const body = balancedBody(src, open.index + open[0].length, '[', ']', 'UI_BRIDGE_ROUTES');

  const routes = new Set();
  for (const chunk of body.match(/\{[^{}]*\}/gs) || []) {
    const m = /method:\s*'([A-Z]+)'/.exec(chunk);
    const p = /path:\s*'([^']+)'/.exec(chunk);
    if (m && p) routes.add(key(m[1], canonicalise(`/ui-bridge${p[1]}`)));
  }

  if (routes.size < MIN_SDK_ROUTES) {
    throw new ExtractionError(
      `only ${routes.size} SDK routes scraped from ${typesPath} (floor ${MIN_SDK_ROUTES}) — ` +
        'the entry regex is almost certainly broken. Refusing to report "no drift" off a ' +
        'partial extraction.',
    );
  }
  return routes;
}

// ── Runner side ─────────────────────────────────────────────────────────────

/**
 * Blank out Rust comments, preserving offsets and line structure.
 *
 * THIS IS LOAD-BEARING, NOT TIDINESS. The runner side is regex-SCRAPED while
 * the Rust it mirrors is COMPILED, and `//` is the one character pair that
 * separates those two readings. Without this, commenting out a single line
 * flips a real drift into a green:
 *
 *   - comment out a tuple in a family's route_entries() and the route stays in
 *     this checker's runner set, so a route the runner no longer serves reads
 *     as served;
 *   - comment out a line in `runner_only_baseline` / `sdk_only_baseline` and
 *     this checker keeps applying a suppression the compiler has dropped —
 *     which hides exactly the 404 this gate exists to catch.
 *
 * The second is the likelier one in practice: commenting a baseline line out is
 * how an engineer asks "is this still needed?", and mod.rs already carries
 * several prose comments describing entries that were removed that way.
 *
 * The SDK side is deliberately NOT comment-stripped — the Rust test is equally
 * blind to a commented-out `{ method, path }` chunk, and that blindness is
 * shared on purpose. This asymmetry is the point: only the runner side is read
 * by a different mechanism than the one that decides the real verdict.
 *
 * Handles line comments, (nesting) block comments, string literals with escapes,
 * raw strings (`r"…"`, `r#"…"#`), and char literals. Char literals need the
 * lifetime disambiguation — `&'static str` must not open a literal — so a `'`
 * counts as one only when a closing `'` sits where a one-char-or-escape literal
 * would put it.
 */
function stripRustComments(src) {
  const s = src;
  const out = s.split(''); // UTF-16 units — indices align with s[i] throughout
  const blank = (from, to) => {
    for (let k = from; k < to && k < s.length; k++) out[k] = s[k] === '\n' ? '\n' : ' ';
  };

  let i = 0;
  while (i < s.length) {
    const c = s[i];

    // Raw string: r"…" / r#"…"# / r##"…"## …
    if (c === 'r') {
      const m = /^r(#*)"/.exec(s.slice(i, i + 40));
      if (m && (i === 0 || !/[A-Za-z0-9_]/.test(s[i - 1]))) {
        const close = '"' + m[1];
        const end = s.indexOf(close, i + m[0].length);
        i = end < 0 ? s.length : end + close.length;
        continue;
      }
    }

    if (c === '"') {
      i++;
      while (i < s.length && s[i] !== '"') i += s[i] === '\\' ? 2 : 1;
      i++;
      continue;
    }

    if (c === "'") {
      // char literal only if a closing quote lands where one would: 'x' or '\n'
      const esc = s[i + 1] === '\\';
      const closeAt = esc ? s.indexOf("'", i + 2) : i + 2;
      if (!esc && s[closeAt] === "'") { i = closeAt + 1; continue; }
      if (esc && closeAt > 0 && closeAt - i <= 8) { i = closeAt + 1; continue; }
      i++; // a lifetime, e.g. &'static — nothing to skip
      continue;
    }

    if (c === '/' && s[i + 1] === '/') {
      let end = s.indexOf('\n', i);
      if (end < 0) end = s.length;
      blank(i, end);
      i = end;
      continue;
    }

    if (c === '/' && s[i + 1] === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < s.length && depth > 0) {
        if (s[j] === '/' && s[j + 1] === '*') { depth++; j += 2; }
        else if (s[j] === '*' && s[j + 1] === '/') { depth--; j += 2; }
        else j++;
      }
      blank(i, j);
      i = j;
      continue;
    }

    i++;
  }
  return out.join('');
}

/** Brace-balance a named Rust fn body. */
function rustFnBody(text, fnName, where) {
  const m = new RegExp(String.raw`fn\s+` + fnName + String.raw`\s*\(\s*\)`).exec(text);
  if (!m) return null;
  const brace = text.indexOf('{', m.index + m[0].length);
  if (brace < 0) return null;
  return balancedBody(text, brace + 1, '{', '}', `${where}::${fnName}`);
}

/**
 * Extract `("METHOD", "/ui-bridge/...")` tuples.
 *
 * `\s*,?\s*\)` is load-bearing, not defensive: rustfmt wraps a long tuple onto
 * three lines WITH a trailing comma —
 *
 *     (
 *         "POST",
 *         "/ui-bridge/control/design/element/{id}/state-styles",
 *     ),
 *
 * — and a pattern that insists on `"` immediately before `)` silently drops
 * every wrapped entry. That produced two phantom "SDK declares but runner does
 * not expose" rows while this checker was being written; it was caught only
 * because the pinned-sha control was supposed to be clean and was not.
 */
const TUPLE_RE = /\(\s*"([A-Z]+)"\s*,\s*"(\/ui-bridge\/[^"]*)"\s*,?\s*\)/g;

function tuplesFrom(body) {
  return [...body.matchAll(TUPLE_RE)].map((m) => key(m[1], m[2]));
}

/**
 * Reproduce the runner's `route_manifest()`: the families it actually
 * concatenates, not every .rs file that happens to define route_entries().
 * Reading the concatenation list keeps this faithful to what the runner
 * really serves.
 */
function parseRunnerManifest(runnerDir) {
  const uiBridgeDir = path.join(runnerDir, 'src-tauri/src/mcp/ui_bridge');
  const modPath = path.join(uiBridgeDir, 'mod.rs');
  const modSrc = stripRustComments(readOrFail(modPath, 'runner mod.rs'));

  // Read route_manifest()'s ACTUAL body and refuse anything in it we do not
  // understand. Harvesting the statements we recognise and ignoring the rest
  // is a false-green generator: an `all.push(("GET", "/ui-bridge/new"))` added
  // alongside the recognised families would be invisible here while the Rust
  // test panics on it, and MIN_RUNNER_MODULES cannot catch that — it asks "did
  // the known shape shrink", not "did I understand the whole body".
  const manifestBody = rustFnBody(modSrc, 'route_manifest', 'mod.rs');
  if (manifestBody === null) {
    throw new ExtractionError(`route_manifest() not found in ${modPath} — it moved or was renamed`);
  }

  const mods = [];
  let sawLocal = false;
  for (const call of manifestBody.matchAll(/\ball\s*\.\s*(\w+)\s*\(/g)) {
    const method = call[1];
    if (method !== 'extend_from_slice') {
      throw new ExtractionError(
        `route_manifest() calls all.${method}(...) in ${modPath}, which this checker does not ` +
          'understand. Routes added that way would be invisible here while the runner serves ' +
          'them. Teach this script the new shape rather than letting it report a partial manifest.',
      );
    }
    const arg = balancedBody(manifestBody, call.index + call[0].length, '(', ')', 'extend_from_slice');
    const named = /^\s*(\w+)::route_entries\(\)\s*$/.exec(arg);
    if (named) mods.push(named[1]);
    else if (/^\s*local_route_entries\(\)\s*$/.test(arg)) sawLocal = true;
    else {
      throw new ExtractionError(
        `route_manifest() in ${modPath} extends from ${JSON.stringify(arg.trim())}, which this ` +
          'checker cannot resolve to a route_entries() table. Refusing to compare against a ' +
          'manifest it only partly understands.',
      );
    }
  }

  if (mods.length < MIN_RUNNER_MODULES) {
    throw new ExtractionError(
      `route_manifest() names only ${mods.length} route families (floor ${MIN_RUNNER_MODULES}) in ` +
        `${modPath} — the concatenation shape changed. Refusing to compare against a partial ` +
        'runner manifest, which would manufacture SDK-only entries.',
    );
  }

  const routes = new Set();

  if (sawLocal) {
    const body = rustFnBody(modSrc, 'local_route_entries', 'mod.rs');
    if (body === null) {
      throw new ExtractionError(
        'route_manifest() concatenates local_route_entries() but its body could not be parsed in mod.rs',
      );
    }
    tuplesFrom(body).forEach((r) => routes.add(r));
  }

  for (const mod of mods) {
    const file = path.join(uiBridgeDir, `${mod}.rs`);
    const body = rustFnBody(
      stripRustComments(readOrFail(file, `runner ${mod}.rs`)),
      'route_entries',
      `${mod}.rs`,
    );
    if (body === null) {
      throw new ExtractionError(
        `route_manifest() concatenates ${mod}::route_entries() but its body could not be parsed ` +
          `in ${file} — a signature change would otherwise silently shrink the runner's side`,
      );
    }
    tuplesFrom(body).forEach((r) => routes.add(r));
  }

  return { routes, modSrc, modPath, familyCount: mods.length };
}

/**
 * Lift the runner's OWN accepted-divergence lists. They belong to the consumer;
 * re-declaring them here would fork the moment the runner edits its own.
 */
function parseRunnerBaselines(modSrc, modPath) {
  const list = (name) => {
    const m = new RegExp(String.raw`let\s+` + name + String.raw`\s*:[^=]*=\s*\[`).exec(modSrc);
    if (!m) {
      throw new ExtractionError(
        `${name} not found in ${modPath} — the runner's accepted-divergence list moved or was ` +
          'renamed. Refusing to diff without it: every baselined route would surface as drift.',
      );
    }
    const body = balancedBody(modSrc, m.index + m[0].length, '[', ']', name);
    return new Set(
      [...body.matchAll(/\(\s*"([A-Z]+)"\s*,\s*"([^"]*)"\s*,?\s*\)/g)].map((x) => key(x[1], x[2])),
    );
  };

  const pm = /let\s+runner_only_prefixes\s*:[^=]*=\s*&\[([^\]]*)\]/.exec(modSrc);
  if (!pm) {
    throw new ExtractionError(
      `runner_only_prefixes not found in ${modPath} — the runner-only prefix allow-list moved or ` +
        'was renamed.',
    );
  }

  return {
    runnerOnly: list('runner_only_baseline'),
    sdkOnly: list('sdk_only_baseline'),
    prefixes: [...pm[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]),
  };
}

// ── This repo's ledger ──────────────────────────────────────────────────────

function parseLedger(file) {
  if (!fs.existsSync(file)) return [];
  const entries = [];
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    if (!raw.trim() || raw.trimStart().startsWith('#')) return;

    const hash = raw.indexOf('#');
    if (hash < 0) {
      throw new ExtractionError(
        `${file}:${lineNo}: entry has no \`# reason\`. The reason is required — an undocumented ` +
          'suppression is how a gate goes quiet.',
      );
    }
    const decl = raw.slice(0, hash).trim();
    const reason = raw.slice(hash + 1).trim();
    if (!reason) {
      throw new ExtractionError(`${file}:${lineNo}: the \`#\` reason is empty.`);
    }

    const m = /^(SDK_ONLY|RUNNER_ONLY)\s+([A-Z]+)\s+(\/ui-bridge\/\S*)$/.exec(decl);
    if (!m) {
      throw new ExtractionError(
        `${file}:${lineNo}: malformed entry ${JSON.stringify(decl)} — expected ` +
          '`SDK_ONLY|RUNNER_ONLY <METHOD> </ui-bridge/...>  # reason`',
      );
    }
    entries.push({ side: m[1], route: key(m[2], canonicalise(m[3])), reason, lineNo, raw: decl });
  });
  return entries;
}

// ── Plumbing ────────────────────────────────────────────────────────────────

function readOrFail(file, what) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new ExtractionError(`${what} unreadable at ${file}: ${e.message}`);
  }
}

const REMEDIES = `
How to resolve this — there are exactly three legitimate answers, and the
allow-list is only one of them:

  1. Land the runner handler in qontinui-runner
     (src-tauri/src/mcp/ui_bridge/<family>.rs — register in BOTH routes() and
     route_entries()), then bump qontinui/qontinui-runner in
     .github/sibling-pins.conf IN THIS PR.

  2. If the runner adaptation PR is already open, declare it with a coord
     dep-edge label (/coord-pr-label, e.g.
     coord:upstream-of=qontinui/qontinui-runner#<n>). A declared adaptation PR
     outranks the pin, so this gate resolves that tree instead — which is how a
     coordinated two-repo route addition lands without deadlocking.

  3. If the divergence is intentional, add a line to
     .github/peer-contract-baseline.conf WITH a reason. Note that a PERMANENT
     divergence usually belongs in the runner's own sdk_only_baseline /
     runner_only_baseline instead — otherwise the consumer goes red at its next
     pin bump, and this file only defers that.
`.trim();

function main() {
  const args = parseArgs(process.argv.slice(2));
  // `fileURLToPath`, not `new URL(...).pathname`: the latter keeps a leading
  // slash before a Windows drive letter and leaves %20 undecoded in a path
  // containing a space.
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  const typesPath = args.types || path.join(repoRoot, 'packages/ui-bridge/src/server/types.ts');
  const baselinePath = args.baseline || path.join(repoRoot, '.github/peer-contract-baseline.conf');

  // FIRST — before resolveRunnerDir, not merely before extraction.
  //
  // resolveRunnerDir() throws a plain ExtractionError, which --advisory SOFTENS.
  // Running it first lets a peer-caused failure MASK a provenance violation on
  // exactly the events where one would first surface: nightly `mode` step
  // regresses to the pinned branch AND qontinui-runner moves mod.rs on its
  // main -> extraction throws -> advisory swallows it -> exit 0, and the drift
  // radar's own regression stays invisible behind a warning about something
  // else. The provenance question needs no runner tree, so ask it first.
  // Resolved against the REPO ROOT, not the process CWD. The workflow passes
  // `--pins .github/sibling-pins.conf` — the same relative literal the action
  // gets — and the action explicitly resolves it against `$GITHUB_WORKSPACE`.
  // Leaving it CWD-relative made the two agree only by the accident of the step
  // inheriting the workspace as its working directory: add a `working-directory:`,
  // wrap the call in a script, or run it by hand from a subdirectory, and
  // `existsSync` misses, `ourPinnedSha` returns null, and a CORRECT run is
  // red-lighted with "does not list qontinui/qontinui-runner" pointing at a
  // manifest whose entry is right there. `path.resolve` leaves an absolute
  // `--pins` untouched.
  const pinsPath = args.pins
    ? path.resolve(repoRoot, args.pins)
    : path.join(repoRoot, '.github/sibling-pins.conf');
  const provenance = checkSiblingProvenance(args.expectSibling, process.env, pinsPath);

  const runnerDir = resolveRunnerDir(args.runner, repoRoot);

  const sdkRaw = parseSdkRoutes(typesPath);
  const { routes: runnerRaw, modSrc, modPath, familyCount } = parseRunnerManifest(runnerDir);
  const { runnerOnly, sdkOnly, prefixes } = parseRunnerBaselines(modSrc, modPath);
  const ledger = parseLedger(baselinePath);

  // Apply the runner's own filters, exactly as its Rust test does.
  const runner = new Set(
    [...runnerRaw]
      .filter((r) => !prefixes.some((p) => r.slice(r.indexOf(' ') + 1).startsWith(p)))
      .map((r) => key(r.slice(0, r.indexOf(' ')), canonicalise(r.slice(r.indexOf(' ') + 1))))
      .filter((r) => !runnerOnly.has(r)),
  );
  const sdk = new Set([...sdkRaw].filter((r) => !sdkOnly.has(r)));

  const sdkMissing = [...sdk].filter((r) => !runner.has(r)).sort();
  const runnerExtra = [...runner].filter((r) => !sdk.has(r)).sort();

  // Ledger: subtract acknowledged divergence, and fail any entry that no
  // longer describes reality. A ledger that is never emptied is a write-only
  // suppression list.
  const acked = { SDK_ONLY: new Set(), RUNNER_ONLY: new Set() };
  const stale = [];
  for (const e of ledger) {
    const live = e.side === 'SDK_ONLY' ? sdkMissing.includes(e.route) : runnerExtra.includes(e.route);
    if (live) acked[e.side].add(e.route);
    else stale.push(e);
  }

  const sdkResidual = sdkMissing.filter((r) => !acked.SDK_ONLY.has(r));
  const runnerResidual = runnerExtra.filter((r) => !acked.RUNNER_ONLY.has(r));

  console.log('UI Bridge <-> qontinui-runner contract check');
  console.log(`  SDK contract:  ${typesPath}`);
  console.log(`  runner tree:   ${runnerDir}`);
  console.log(`  runner ref:    ${describeRunnerRef(runnerDir)}`);
  // The sibling action materialises its checkout with `git init` + a depth-1
  // fetch, so describeRunnerRef() above can only ever report a detached sha —
  // it cannot say whether that sha came from the pin, from a declared
  // adaptation PR, or from the runner's moving default branch. This line is
  // the only place that distinction appears in the verdict itself.
  console.log(`  resolved by:   ${describeResolution(provenance, process.env, pinsPath)}`);
  console.log(
    `  extracted:     ${sdkRaw.size} SDK routes, ${runnerRaw.size} runner routes ` +
      `across ${familyCount} families`,
  );
  console.log(
    `  runner allows: ${sdkOnly.size} sdk_only, ${runnerOnly.size} runner_only, ` +
      `${prefixes.length} prefix(es)`,
  );
  console.log(`  local ledger:  ${ledger.length} entry(ies) (${baselinePath})`);
  console.log('');

  const problems = [];

  if (sdkResidual.length) {
    problems.push(
      `This repo DECLARES ${sdkResidual.length} route(s) the pinned runner does NOT expose ` +
        `(they would 404 against a live runner):\n  ` +
        sdkResidual.join('\n  '),
    );
  }
  if (runnerResidual.length) {
    problems.push(
      `The pinned runner EXPOSES ${runnerResidual.length} route(s) this repo does NOT declare:\n  ` +
        runnerResidual.join('\n  '),
    );
  }
  if (stale.length) {
    problems.push(
      `${stale.length} stale line(s) in ${baselinePath} — the divergence they record no longer ` +
        `exists. DELETE them:\n  ` +
        stale.map((e) => `${baselinePath}:${e.lineNo}: ${e.raw}`).join('\n  '),
    );
  }

  if (!problems.length) {
    console.log('OK — the declared contract and the runner surface agree.');
    return 0;
  }

  const body = problems.join('\n\n') + '\n\n' + REMEDIES;
  if (args.advisory) {
    console.log(body);
    console.log(`\n::warning title=UI Bridge contract drift::${problems.length} finding(s) — advisory run, not gating.`);
    return 0;
  }
  console.error(body);
  return 1;
}

// Run the CLI only when invoked as one. Importing this module (the test does)
// must not execute a contract check or set an exit code.
const isEntry =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

// If this detection ever went wrong the CLI would do NOTHING and exit 0 —
// silent green, the exact failure class this whole file exists to end, and the
// worst possible bug to introduce while closing it. So the not-entry path is
// only allowed to be quiet when it looks like an import: a real CLI invocation
// always passes flags, and seeing them here means the guard misfired.
if (!isEntry && process.argv.slice(2).some((a) => a.startsWith('--'))) {
  throw new Error(
    'check-runner-contract.mjs was given CLI flags but did not detect itself as the entry ' +
      `module (argv[1]=${JSON.stringify(process.argv[1])}, import.meta.url=${import.meta.url}). ` +
      'Refusing to exit 0 without running the check.',
  );
}

if (isEntry) {
  try {
    process.exitCode = main();
  } catch (e) {
    if (e instanceof ExtractionError) {
      // Fail CLOSED on the gating path. An extraction that cannot see the
      // contract has not proved the contract is fine — it has proved nothing,
      // which is the more dangerous of the two.
      //
      // But NOT on an advisory run. The nightly compares against the runner's
      // moving default branch, so a rename there could break extraction — and
      // an advisory job that fails on a peer's land is this plan's original
      // defect, re-imported in the reverse direction. Annotate loudly, exit 0.
      //
      // ProvenanceError joins UsageError in the not-softened set: it reports
      // that THIS repo's workflow handed the run the wrong sibling tree. That
      // is our own wiring, not a peer's land, so the reason advisory mode
      // exists does not apply to it — and softening it would leave the
      // nightly's own pin-bypass regression as the silent failure the mode
      // split exists to prevent.
      const ours = e instanceof UsageError || e instanceof ProvenanceError;
      const advisory = !ours && process.argv.includes('--advisory');
      console.error(`contract check could not run: ${e.message}`);
      console.error('\n::error title=UI Bridge contract check could not run::' + e.message);
      process.exitCode = advisory ? 0 : 2;
    } else {
      throw e;
    }
  }
}
