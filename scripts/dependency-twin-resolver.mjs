#!/usr/bin/env node
// dependency-twin-resolver.mjs
//
// Async resolver job for the Ξ_Dep (dependencies) digital-twin sub-space.
// See plan 2026-05-30-twin-dependencies-layer.md §5, §7.2 (Phase 3).
//
// This is the npm-workspace half of the twin: the install-safety + registry
// checks that CANNOT run in coord's request path (they need the npm resolver
// toolchain and outbound network to registry.npmjs.org). It runs in a
// scheduled GitHub Actions job, classifies the result against the
// `coord.dependency_resolution_observations` columns, and writes a JSON
// payload that the workflow POSTs to coord's ingest endpoint.
//
// Zero extra deps — Node built-ins only (child_process, fs, global fetch).
//
// Outputs: ./dependency-resolution-observations.json (an array under
// `observations`, plus top-level run metadata). Exits 0 even when npm or the
// network are unavailable — it degrades to a coverage<1 payload rather than
// crashing, so the job's artifact is always inspectable.

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ECOSYSTEM = 'npm';
const PROVENANCE = 'github_actions_resolver_job';
const REGISTRY_BASE = 'https://registry.npmjs.org';
const SCOPE_PREFIX = '@qontinui/';
const OUTPUT_FILE = 'dependency-resolution-observations.json';

const __dirname = dirname(fileURLToPath(import.meta.url));
// The script lives in <repo>/scripts; the workspace root is one level up.
const REPO_ROOT = resolve(__dirname, '..');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');

const SOURCE_RUN_ID = process.env.GITHUB_RUN_ID || 'local';

function log(...args) {
  // eslint-disable-next-line no-console
  console.error('[dependency-twin-resolver]', ...args);
}

// ---------------------------------------------------------------------------
// 1. Discover publishable @qontinui/* workspace packages
// ---------------------------------------------------------------------------
// Derive the list from packages/*/package.json `name` fields, excluding
// `private: true` ones (those are never published — e.g. ui-bridge-extension)
// and any non-@qontinui packages (e.g. create-ui-bridge-wrapper is a public
// scaffolder, not part of the @qontinui registry-versioned family — but we
// still consider it publishable if it carries no scope; v1 scope per the plan
// is the @qontinui family, so we key the registry checks on scoped names and
// fall back gracefully for unscoped ones).

function discoverPackages() {
  const pkgs = [];
  if (!existsSync(PACKAGES_DIR)) {
    log(`packages dir not found at ${PACKAGES_DIR}`);
    return pkgs;
  }
  for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(PACKAGES_DIR, entry.name, 'package.json');
    if (!existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      log(`failed to parse ${manifestPath}: ${err.message}`);
      continue;
    }
    if (manifest.private === true) continue; // never published
    if (!manifest.name) continue;
    pkgs.push({
      dir: entry.name,
      name: manifest.name,
      version: manifest.version,
      // External (non-@qontinui) declared deps that the published-side check
      // (Φ_Dep predicate (3)) verifies against the registry. Intra-workspace
      // @qontinui/* edges are checked by the sibling-consistency predicate (4),
      // NOT the published check — the path-dep/workspace carve-out (plan §2.4,
      // Open-Q5). So we exclude @qontinui/* here.
      externalDeps: collectExternalDeps(manifest),
    });
  }
  return pkgs;
}

function collectExternalDeps(manifest) {
  const out = {};
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    const block = manifest[field];
    if (!block) continue;
    for (const [dep, range] of Object.entries(block)) {
      if (dep.startsWith(SCOPE_PREFIX)) continue; // workspace edge — carve-out
      // peerDependencies are constraints on the consumer's tree, not deps this
      // package installs; we still surface them as declared external edges so a
      // missing/yanked peer target is observable. Tag the field for provenance.
      if (!out[dep]) out[dep] = { ranges: [], fields: [] };
      out[dep].ranges.push(range);
      out[dep].fields.push(field);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Install-safety probe — npm ci --dry-run --json (+ fallback signal)
// ---------------------------------------------------------------------------
// An ERESOLVE is a non-zero exit whose JSON/text body carries an ERESOLVE
// marker. We capture stdout, stderr, and the exit code, then classify.

function runNpm(args, label) {
  // On Windows `npm` is a `.cmd` shim that Node can only spawn via a shell
  // (a direct spawn of `npm.cmd` raises EINVAL on modern Node). On the CI
  // runner (Linux) `npm` is a plain executable and we spawn it directly with
  // no shell, so our literal args are never shell-interpreted there. The
  // Windows-only shell path triggers a cosmetic DEP0190 warning; our args are
  // fixed literals (no user/network input), so there is no injection surface.
  const isWin = process.platform === 'win32';
  log(`running: npm ${args.join(' ')}`);
  const res = spawnSync('npm', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: isWin,
  });
  if (res.error) {
    log(`${label}: spawn error: ${res.error.message}`);
    return { ran: false, status: null, stdout: '', stderr: String(res.error.message) };
  }
  return {
    ran: true,
    status: res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
  };
}

// Extract a structured ERESOLVE detail from npm's output. npm emits an
// `npm error code ERESOLVE` block on stderr and, with --json, a JSON object
// on stdout whose `error.code === 'ERESOLVE'`. We try JSON first, then fall
// back to a text scrape so we still get a verdict on older/newer npm output.
function parseEresolve(probe) {
  if (!probe.ran) {
    return { decided: false, would_eresolve: null, detail: { reason: 'npm_unavailable' } };
  }
  const combined = `${probe.stdout}\n${probe.stderr}`;
  // Try JSON body on stdout.
  let jsonErr = null;
  const trimmed = probe.stdout.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && parsed.error) jsonErr = parsed.error;
    } catch {
      /* not JSON or partial — fall through to text scrape */
    }
  }
  if (jsonErr && jsonErr.code === 'ERESOLVE') {
    return {
      decided: true,
      would_eresolve: true,
      detail: {
        source: 'json',
        code: jsonErr.code,
        summary: jsonErr.summary || null,
        detail: jsonErr.detail || null,
        exit_code: probe.status,
      },
    };
  }
  // Text scrape — npm prints "code ERESOLVE" and "ERESOLVE could not resolve".
  if (/ERESOLVE/.test(combined)) {
    const lines = combined
      .split('\n')
      .filter((l) => /ERESOLVE|peer|conflict|while resolving|Found:|Could not resolve/i.test(l))
      .map((l) => l.replace(/^npm (error|warn|notice)\s?/i, '').trim())
      .filter(Boolean)
      .slice(0, 40);
    return {
      decided: true,
      would_eresolve: true,
      detail: {
        source: 'text',
        code: 'ERESOLVE',
        exit_code: probe.status,
        lines,
      },
    };
  }
  // No ERESOLVE marker. A zero exit means the dry-run resolved cleanly.
  if (probe.status === 0) {
    return { decided: true, would_eresolve: false, detail: { source: 'clean', exit_code: 0 } };
  }
  // Non-zero exit without an ERESOLVE marker: some other npm failure
  // (network, missing lockfile, etc). We can't claim a clean verdict; mark
  // undecided so coverage degrades rather than emitting a false "safe".
  return {
    decided: false,
    would_eresolve: null,
    detail: {
      source: 'inconclusive',
      exit_code: probe.status,
      stderr_tail: probe.stderr.split('\n').slice(-20).join('\n'),
    },
  };
}

function probeInstallSafety() {
  // Primary: npm ci --dry-run --json (resolves the full graph against the lock).
  const ci = runNpm(['ci', '--dry-run', '--json'], 'npm ci --dry-run');
  let verdict = parseEresolve(ci);

  // Fallback signal: npm install --package-lock-only --dry-run --json.
  // Re-resolves ranges ignoring the existing lock — catches a declared-range
  // conflict the lock would otherwise mask. Tolerant (`|| true` semantics):
  // we only consult it if the primary was undecided or said "clean", to avoid
  // a false-positive overriding a confident primary verdict.
  let fallback = null;
  if (!verdict.decided || verdict.would_eresolve === false) {
    const inst = runNpm(
      ['install', '--package-lock-only', '--dry-run', '--json'],
      'npm install --package-lock-only --dry-run',
    );
    fallback = parseEresolve(inst);
    if (fallback.decided && fallback.would_eresolve === true) {
      // Fallback found an ERESOLVE the primary missed (or primary was
      // undecided) — promote it, tagging provenance.
      verdict = {
        decided: true,
        would_eresolve: true,
        detail: { ...fallback.detail, via: 'package-lock-only-fallback' },
      };
    } else if (!verdict.decided && fallback.decided) {
      verdict = fallback;
    }
  }

  return { verdict, primaryRan: ci.ran, fallbackRan: fallback != null };
}

// ---------------------------------------------------------------------------
// 3. Registry probe — registry.npmjs.org per package
// ---------------------------------------------------------------------------
// Per publishable @qontinui/* package compute:
//  - tag_already_published: is <pkg>@<currentVersion> already on the registry?
//  - published_missing[]:   declared EXTERNAL deps whose declared range has no
//                           satisfying published version (best-effort: we flag
//                           a dep whose package is entirely absent, or whose
//                           every published version is deprecated).
//  - published_yanked[]:    external deps that exist but are deprecated
//                           (npm has no hard "yank"; `deprecated` is the analog).

async function fetchRegistry(pkgName) {
  const url = `${REGISTRY_BASE}/${encodeRegistryName(pkgName)}`;
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      // Node's global fetch has no default timeout; cap it so a hung registry
      // can't stall the whole job.
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 404) return { ok: true, found: false, data: null };
    if (!res.ok) return { ok: false, found: null, data: null, status: res.status };
    const data = await res.json();
    return { ok: true, found: true, data };
  } catch (err) {
    return { ok: false, found: null, data: null, error: String(err && err.message) };
  }
}

// Scoped names must keep the slash unescaped per the registry convention
// (@scope/name). encodeURIComponent would turn `/` into %2F which the
// registry rejects for the document route.
function encodeRegistryName(name) {
  if (name.startsWith('@')) {
    const [scope, rest] = name.split('/');
    return `${scope}/${encodeURIComponent(rest)}`;
  }
  return encodeURIComponent(name);
}

// Minimal semver-ish check: does any published version literally appear as a
// candidate for the declared range? We do NOT implement full semver
// satisfaction here (that's the resolver's job and is covered by the
// --dry-run probe). The registry check's honest job is the coarse-but-high-
// credibility fact "this package/version EXISTS / is deprecated". So we flag:
//   - missing: the package document 404s entirely (no published versions).
//   - deprecated: every published version carries a `deprecated` field, OR the
//     latest dist-tag version is deprecated.
function classifyExternalDep(depName, ranges, reg) {
  if (!reg.ok) {
    return { status: 'unknown', reason: reg.error || `http_${reg.status}` };
  }
  if (!reg.found) {
    return { status: 'missing', reason: 'registry_404' };
  }
  const versions = reg.data.versions || {};
  const versionKeys = Object.keys(versions);
  if (versionKeys.length === 0) {
    return { status: 'missing', reason: 'no_published_versions' };
  }
  const latestTag = reg.data['dist-tags'] && reg.data['dist-tags'].latest;
  const allDeprecated = versionKeys.every((v) => versions[v] && versions[v].deprecated);
  const latestDeprecated =
    latestTag && versions[latestTag] && Boolean(versions[latestTag].deprecated);
  if (allDeprecated) {
    return {
      status: 'deprecated',
      reason: 'all_versions_deprecated',
      latest: latestTag || null,
      declared_ranges: ranges,
    };
  }
  if (latestDeprecated) {
    return {
      status: 'deprecated',
      reason: 'latest_deprecated',
      latest: latestTag,
      deprecated_message: versions[latestTag].deprecated,
      declared_ranges: ranges,
    };
  }
  return { status: 'ok', latest: latestTag || null };
}

async function probeRegistryForPackage(pkg) {
  const result = {
    tag_already_published: null, // null = couldn't determine
    published_missing: [],
    published_yanked: [], // npm "deprecated" maps here per the column semantics
    registry_errors: 0,
    registry_attempts: 0,
  };

  // 3a. Own version: is <pkg>@<version> already published?
  result.registry_attempts += 1;
  const ownReg = await fetchRegistry(pkg.name);
  if (!ownReg.ok) {
    result.registry_errors += 1;
    result.tag_already_published = null;
  } else if (!ownReg.found) {
    // Package has never been published at all → the tag is not published.
    result.tag_already_published = false;
  } else {
    const versions = ownReg.data.versions || {};
    result.tag_already_published = Boolean(pkg.version && versions[pkg.version]);
  }

  // 3b. External declared deps: missing / deprecated.
  for (const [depName, info] of Object.entries(pkg.externalDeps)) {
    result.registry_attempts += 1;
    const reg = await fetchRegistry(depName);
    if (!reg.ok) {
      result.registry_errors += 1;
    }
    const cls = classifyExternalDep(depName, info.ranges, reg);
    if (cls.status === 'missing') {
      result.published_missing.push({ name: depName, ranges: info.ranges, ...cls });
    } else if (cls.status === 'deprecated') {
      result.published_yanked.push({ name: depName, ...cls });
    }
    // 'unknown' contributes to registry_errors (already counted) → coverage<1.
  }

  return result;
}

// ---------------------------------------------------------------------------
// 4. Classify + assemble payload (one object per workspace_member)
// ---------------------------------------------------------------------------

function deriveDriftClass(would_eresolve, published_missing, published_yanked, tag_already_published) {
  // Matches the §2.5 / §7.1 ordering used by coord_dependency_drift:
  // 4=would-eresolve, 6=published-missing, 7=published-yanked. We pick the
  // most-severe applicable class for this member's async facts.
  if (would_eresolve === true) return 'would-eresolve';
  if (published_missing.length > 0) return 'published-missing';
  if (published_yanked.length > 0) return 'published-yanked';
  if (tag_already_published === true) return 'tag-already-published';
  return 'ok';
}

async function main() {
  const registryCheckedAt = new Date().toISOString();
  const packages = discoverPackages();
  log(`discovered ${packages.length} publishable package(s): ${packages.map((p) => p.name).join(', ')}`);

  // Install-safety probe is whole-workspace (one resolver run resolves all
  // workspaces together), so the verdict is shared across members. Per-member
  // attribution of an ERESOLVE would need parsing the conflict graph; v1
  // attaches the workspace-level verdict to every member with honest
  // provenance (the eresolve_detail carries the conflict edges for triage).
  const install = probeInstallSafety();
  const wouldEresolve = install.verdict.would_eresolve;
  const eresolveDetail = install.verdict.detail;
  const installDecided = install.verdict.decided;

  const observations = [];
  for (const pkg of packages) {
    const reg = await probeRegistryForPackage(pkg);

    // Coverage: fraction of intended checks that produced a definitive fact.
    // Two channels: (a) the install verdict (decided?), (b) the registry
    // checks (errors lower it). Combine as a simple mean of the two channel
    // coverages so a single failing channel doesn't zero the whole answer.
    const installCoverage = installDecided ? 1 : 0;
    const registryCoverage =
      reg.registry_attempts === 0
        ? 0
        : (reg.registry_attempts - reg.registry_errors) / reg.registry_attempts;
    const coverage = Number(((installCoverage + registryCoverage) / 2).toFixed(3));

    // Credibility (plan §3): registry facts are the HIGHEST-credibility
    // observer (the external publish authority); the --dry-run verdict is
    // HIGH for "will install / ERESOLVE". We report the strongest credibility
    // backing this row's facts, degraded to "low" if neither channel decided.
    let credibility;
    if (reg.registry_errors === 0 && reg.registry_attempts > 0) {
      credibility = 'highest'; // clean registry facts present
    } else if (installDecided) {
      credibility = 'high'; // dry-run verdict stands even if a registry call failed
    } else if (registryCoverage > 0) {
      credibility = 'high';
    } else {
      credibility = 'low'; // nothing decided this run
    }

    observations.push({
      ecosystem: ECOSYSTEM,
      workspace_member: pkg.name,
      would_eresolve: wouldEresolve, // bool | null (null = undecided this run)
      eresolve_detail: eresolveDetail,
      published_missing: reg.published_missing,
      published_yanked: reg.published_yanked,
      tag_already_published: reg.tag_already_published, // bool | null
      registry_checked_at: registryCheckedAt,
      coverage,
      provenance: PROVENANCE,
      credibility,
      source_run_id: SOURCE_RUN_ID,
      // Convenience (not a coord column, but useful in the artifact):
      drift_class: deriveDriftClass(
        wouldEresolve,
        reg.published_missing,
        reg.published_yanked,
        reg.tag_already_published,
      ),
    });
  }

  const payload = {
    schema: 'coord.dependency_resolution_observations',
    generated_at: registryCheckedAt,
    source_run_id: SOURCE_RUN_ID,
    ecosystem: ECOSYSTEM,
    install_probe: {
      decided: installDecided,
      would_eresolve: wouldEresolve,
      primary_ran: install.primaryRan,
      fallback_ran: install.fallbackRan,
    },
    observations,
  };

  const outPath = join(REPO_ROOT, OUTPUT_FILE);
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  log(`wrote ${observations.length} observation(s) to ${outPath}`);
  log(
    `install: decided=${installDecided} would_eresolve=${wouldEresolve}; ` +
      `members=${observations.length}`,
  );
}

main().catch((err) => {
  // Never crash the job — degrade to an empty/partial payload and exit 0 so
  // the artifact upload + (tolerant) ingest still run. The artifact records
  // the failure for triage.
  log(`fatal (degrading to coverage=0 payload): ${err && err.stack ? err.stack : err}`);
  const fallbackPayload = {
    schema: 'coord.dependency_resolution_observations',
    generated_at: new Date().toISOString(),
    source_run_id: SOURCE_RUN_ID,
    ecosystem: ECOSYSTEM,
    error: String(err && err.message ? err.message : err),
    install_probe: { decided: false, would_eresolve: null },
    observations: [],
  };
  try {
    writeFileSync(join(REPO_ROOT, OUTPUT_FILE), JSON.stringify(fallbackPayload, null, 2) + '\n', 'utf8');
  } catch (writeErr) {
    log(`could not write fallback payload: ${writeErr.message}`);
  }
  process.exit(0);
});
