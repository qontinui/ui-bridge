#!/usr/bin/env node
// Internal dependency ratchet.
//
// PR #147 replaced the wrapper's hand-maintained 19-term OR-chain
// (`^0.4.0 || ^0.5.0 || … || ^0.22.0`) with `>=0.4.0 <1`, bounded the three
// ranges that were unbounded ABOVE, and taught the authoring guide the
// bounded form. What it did NOT leave behind was anything to keep it fixed:
// every one of those defects was reintroducible by a single hand edit, and
// two of the three had already shipped to npm before anyone noticed.
//
// This is that guard. For every PUBLISHED workspace package it enforces four
// offline rules on each internal `@qontinui/*` dependency, plus one optional
// online rule (`--registry`, publish-time only).
//
// OFFLINE RULES
//
//   1. VALID — the spec parses as a semver range, or is `workspace:` (which
//      npm rewrites to a real range at pack time). A `file:` / `link:` /
//      `portal:` spec in a PUBLISHED package is a hard failure: it names a
//      path on the author's disk, so it is 100% uninstallable for everyone
//      else. Those protocols are fine in a private package and only there.
//
//   2. BOUNDED ABOVE — `*`, `>=0.4.0` and `>0.4.0` silently accept a future
//      breaking major. The whole point of a major is that it may break you,
//      so a range that cannot say "no" hands the consumer a broken tree
//      instead of an install warning.
//
//   3. WHOLE-BAND — the range must admit its ENTIRE major band, from its own
//      floor up to the next major. This is the anti-treadmill rule and it is
//      the general form of "no OR-chains": a 19-term `^0.x || …` chain fails
//      it, but so does the bare `^0.1.0` that a chain is built out of, since
//      `^0.1.0` means `>=0.1.0 <0.2.0` and has to be hand-edited on every
//      single engine minor. `>=0.1.0 <1` expresses the same intent and never
//      needs touching. On a 1.x package `^1.2.3` already spans the whole band
//      and passes unchanged.
//
//   4. NOT STALE — the depended-on package's CURRENT source version must
//      satisfy the range. This is the rule with teeth: it turns "the ceiling
//      drifted" from something someone eventually notices into a red build.
//      It would have caught the original chain's stale `^0.22.0` ceiling the
//      moment the engine cut 0.23.0, and it is what caught
//      `create-ui-bridge-wrapper` emitting `^0.1.0` for an engine at 0.22.0.
//
//   5. PUBLISHABLE — a non-private package must have a release path, i.e. a
//      matching `<dir>-v*` tag prefix in publish.yml. Without one there is no
//      way to ship it, so its version and its dependency metadata are fiction.
//
// PRIVATE packages are exempt from all of it by design: `ui-bridge-extension`,
// `e2e`, the repo root and the six `examples/` are `private: true`, never
// publish, and use `"*"` / `file:` as plain workspace links. No consumer can
// ever resolve those, so bounding them would be ceremony. The exemption keys
// off the manifest's own `private` flag, not a hand-kept path list — a package
// that starts publishing is covered on the same commit that drops the flag.
//
// The `--registry` rule is NOT run in CI; see checkRegistry() for why it
// belongs at publish time. It is also NOT what
// `.github/workflows/dependency-twin-resolver.yml` does: that job checks
// EXTERNAL deps and explicitly carves out intra-workspace `@qontinui/*` ones
// (see its `collectExternalDeps`), which is exactly the hole this fills.
//
// Usage:
//   node scripts/check-dep-ranges.cjs                  # verify (CI, with the other *:check steps)
//   node scripts/check-dep-ranges.cjs --verbose        # also print every range it accepted
//   node scripts/check-dep-ranges.cjs --registry \
//     --package ui-bridge-wrapper                      # publish.yml: also prove each internal
//                                                      # dep resolves on the registry

'use strict';

const { readFileSync, existsSync, readdirSync, statSync } = require('node:fs');
const { join, resolve, relative } = require('node:path');
const semver = require('semver');

const ROOT = resolve(__dirname, '..');
const VERBOSE = process.argv.includes('--verbose');
const CHECK_REGISTRY = process.argv.includes('--registry');
const ONLY_PACKAGE = parsePackageFlag();

const INTERNAL_SCOPE = '@qontinui/';
const DEP_BLOCKS = ['dependencies', 'peerDependencies', 'optionalDependencies'];

// Prerelease-aware throughout. Without this, a legitimate bounded range with a
// prerelease floor (`>=0.1.0-alpha.1 <1`) is misread as unbounded above.
const SEMVER_OPTS = { includePrerelease: true };

// A range is "bounded above" iff it excludes some sufficiently large version.
// Testing against a sentinel ceiling rather than `<1.0.0` keeps the rule honest
// after UI Bridge goes 1.x: `>=1.0.0 <2` must pass, `>=1.0.0` must not.
const UNREACHABLE_CEILING = '<9999.0.0';

// npm rewrites `workspace:` to a concrete range when it packs the tarball, so
// it is the one non-range protocol a published package may legitimately carry.
// `file:`/`link:`/`portal:` are NOT rewritten and ship as-is.
const REWRITTEN_PROTOCOL = 'workspace:';
const PATH_PROTOCOLS = ['file:', 'link:', 'portal:'];

function parsePackageFlag() {
  const i = process.argv.indexOf('--package');
  if (i === -1) return null;
  const value = process.argv[i + 1];
  if (!value || value.startsWith('--')) {
    process.stderr.write('--package requires a workspace directory name\n');
    process.exit(2);
  }
  return value;
}

/** The whole-band range for `range`'s own floor, e.g. `^0.1.0` -> `>=0.1.0 <1.0.0-0`. */
function majorBandOf(range) {
  const floor = semver.minVersion(range);
  if (!floor) return null;
  // 0.x has no compatible band above it — every 0.minor may break — so the
  // band for a 0.x floor runs to 1.0.0, matching the `<1` the guide mandates.
  const ceiling = floor.major === 0 ? 1 : floor.major + 1;
  return { floor, text: `>=${floor.version} <${ceiling}.0.0-0` };
}

/** The range this package SHOULD declare, given a floor. Never emits `<1` for a 1.x floor. */
function suggestedRange(floor) {
  const parsed = typeof floor === 'string' ? semver.parse(floor) : floor;
  if (!parsed) return '`>=<floor> <<next-major>>`';
  const ceiling = parsed.major === 0 ? 1 : parsed.major + 1;
  return `>=${parsed.version} <${ceiling}`;
}

/** Every workspace manifest, expanded from the root `workspaces` globs. */
function readWorkspaceManifests() {
  const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const paths = [join(ROOT, 'package.json')];

  for (const pattern of rootPkg.workspaces ?? []) {
    if (pattern.endsWith('/*')) {
      const dir = join(ROOT, pattern.slice(0, -2));
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir)) {
        const manifest = join(dir, entry, 'package.json');
        if (statSync(join(dir, entry)).isDirectory() && existsSync(manifest)) paths.push(manifest);
      }
    } else {
      const manifest = join(ROOT, pattern, 'package.json');
      if (existsSync(manifest)) paths.push(manifest);
    }
  }

  return paths.map((path) => ({ path, json: JSON.parse(readFileSync(path, 'utf8')) }));
}

/**
 * The workspace directory names publish.yml can release, read from its trigger
 * list. Parsed with a line regex rather than a YAML dependency because the
 * other check scripts take no dependencies either, and the shape it reads is a
 * literal list of quoted globs.
 */
function publishableDirs() {
  const workflow = join(ROOT, '.github', 'workflows', 'publish.yml');
  if (!existsSync(workflow)) return null;
  const dirs = new Set();
  for (const line of readFileSync(workflow, 'utf8').split('\n')) {
    const m = line.match(/^\s*-\s*'([A-Za-z0-9._-]+)-v\*'\s*$/);
    if (m) dirs.add(m[1]);
  }
  return dirs.size > 0 ? dirs : null;
}

const REGISTRY_BASE = 'https://registry.npmjs.org';
const registryCache = new Map();

async function registryVersions(name) {
  if (!registryCache.has(name)) registryCache.set(name, await fetchRegistryVersions(name));
  return registryCache.get(name);
}

// Scoped names keep the slash unescaped per the registry convention
// (@scope/name); encodeURIComponent would turn `/` into %2F, which the registry
// rejects for the document route. Same helper as
// scripts/dependency-twin-resolver.mjs.
function encodeRegistryName(name) {
  if (!name.startsWith('@')) return encodeURIComponent(name);
  const [scope, rest] = name.split('/');
  return `${scope}/${encodeURIComponent(rest)}`;
}

/**
 * Every version of `name` the registry knows, oldest first, or null if the
 * package itself is unpublished (404). Any OTHER failure throws — a network
 * blip must never read as "unpublished" [policy: silent-empty-is-unknown].
 *
 * Queried over HTTPS rather than by shelling out to `npm view`: it is the same
 * door dependency-twin-resolver.mjs already uses, and it keeps a manifest key
 * from ever reaching a shell. That matters because this script runs inside
 * publish.yml, in a job holding an `id-token: write` OIDC context. (Node 22
 * also refuses to spawn `npm.cmd` without `shell: true`, so on Windows the
 * subprocess route has no safe spelling at all.)
 */
async function fetchRegistryVersions(name) {
  const url = `${REGISTRY_BASE}/${encodeRegistryName(name)}`;
  let res;
  try {
    res = await fetch(url, {
      headers: { accept: 'application/json' },
      // Node's global fetch has no default timeout; cap it so a hung registry
      // cannot stall a publish.
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw new Error(`GET ${url} failed (so the answer is UNKNOWN, not "unpublished"): ${err}`);
  }

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GET ${url} returned HTTP ${res.status} (the answer is UNKNOWN)`);
  }

  const doc = await res.json();
  const valid = Object.keys(doc.versions ?? {}).filter((v) => semver.valid(v));
  if (valid.length === 0) {
    // A package document with no versions is an unpublished/withdrawn package,
    // not a resolvable dependency.
    return null;
  }
  return semver.sort(valid);
}

/**
 * The rule the offline ones cannot catch: an internal dependency that is
 * perfectly well-formed and perfectly current, but that NOBODY CAN INSTALL.
 *
 * On 2026-08-07 `@qontinui/ui-bridge-cli-args` had never been published — no
 * `private` flag, its own tag prefix in publish.yml, simply never tagged —
 * while `@qontinui/ui-bridge-headless@0.4.0` and
 * `@qontinui/ui-bridge-wrapper@0.7.1` both shipped declaring it a hard
 * dependency. Both packages' `latest` were uninstallable: a clean
 * `npm install @qontinui/ui-bridge-wrapper` died with `E404` on cli-args. Every
 * offline rule PASSES on that `^0.1.0`. Only the registry knows.
 *
 * This runs at PUBLISH time, not in CI, and deliberately so. Registry state is
 * not a property of the diff: a coordinated release where two new packages land
 * together is CORRECT even though the dependency is momentarily unpublished, so
 * gating every PR on it would red the build for changes that are fine and train
 * everyone to ignore it. At publish time the question is exactly right — this
 * tarball is about to become installable, so its dependencies must already be.
 */
async function checkRegistry(manifest, alreadyFailed, failures) {
  const where = relative(ROOT, manifest.path).replace(/\\/g, '/');
  const seen = new Set();
  let checked = 0;

  for (const block of DEP_BLOCKS) {
    for (const [name, range] of Object.entries(manifest.json[block] ?? {})) {
      if (!name.startsWith(INTERNAL_SCOPE)) continue;
      if (range.startsWith(REWRITTEN_PROTOCOL)) continue;
      // A dep that already failed an offline rule needs one report, not two;
      // and the same dep in two blocks is one registry question, not two.
      if (alreadyFailed.has(name) || seen.has(name)) continue;
      seen.add(name);

      const versions = await registryVersions(name);
      const optional = block === 'optionalDependencies';

      if (versions === null) {
        failures.push({
          where,
          block,
          name,
          range,
          reason: optional
            ? 'is not published to the registry at all — it can never resolve, so the ' +
              'optional dependency is dead weight'
            : 'is not published to the registry at all — every consumer of this package ' +
              'would get E404 on install',
          fix: `publish ${name} first (git tag ${name.slice(INTERNAL_SCOPE.length)}-v<version>)`,
        });
        continue;
      }

      const match = semver.maxSatisfying(versions, range, SEMVER_OPTS);
      if (match === null) {
        failures.push({
          where,
          block,
          name,
          range,
          reason:
            'is published, but no released version satisfies this range ' +
            `(newest on the registry is ${versions[versions.length - 1]})`,
          fix: `release a ${name} matching "${range}", or widen the range`,
        });
        continue;
      }

      checked += 1;
      if (VERBOSE) {
        process.stdout.write(`  ok  ${where} ${block} ${name}: ${range} -> registry ${match}\n`);
      }
    }
  }

  return checked;
}

async function main() {
  const manifests = readWorkspaceManifests();
  const publishable = publishableDirs();

  // name -> current source version, for the staleness rule. Only packages that
  // live in this monorepo can be checked that way; a sibling-repo package like
  // @qontinui/ui-bridge-auto gets the form rules and nothing more.
  const workspaceVersions = new Map();
  for (const { json } of manifests) {
    if (json.name && json.version) workspaceVersions.set(json.name, json.version);
  }

  // `--package <dir>` scopes the run to one workspace package — publish.yml
  // asks only about the tarball it is on the verge of pushing.
  const selected = ONLY_PACKAGE
    ? manifests.filter(
        (m) =>
          relative(ROOT, m.path).replace(/\\/g, '/') === `packages/${ONLY_PACKAGE}/package.json`
      )
    : manifests;

  if (ONLY_PACKAGE && selected.length === 0) {
    process.stderr.write(`No workspace package at packages/${ONLY_PACKAGE}\n`);
    process.exit(2);
  }

  const failures = [];
  const accepted = [];
  const published = [];
  let skippedPrivate = 0;

  for (const manifest of selected) {
    const { path, json } = manifest;
    const where = relative(ROOT, path).replace(/\\/g, '/');

    if (json.private === true) {
      skippedPrivate += 1;
      continue;
    }
    published.push(manifest);

    // Rule 5 — a publishable package needs somewhere to publish FROM.
    const dir = where.startsWith('packages/') ? where.split('/')[1] : null;
    if (publishable && dir && !publishable.has(dir)) {
      failures.push({
        where,
        block: 'package',
        name: json.name,
        range: json.version,
        reason:
          'is not private but has no release path — no matching tag prefix in ' +
          '.github/workflows/publish.yml, so there is no way to ship it',
        fix: `add '${dir}-v*' to publish.yml's tag triggers, or mark the package private`,
      });
    }

    for (const block of DEP_BLOCKS) {
      for (const [name, range] of Object.entries(json[block] ?? {})) {
        if (!name.startsWith(INTERNAL_SCOPE)) continue;

        const fail = (reason, fix) => failures.push({ where, block, name, range, reason, fix });

        // Rule 1 — valid, and not a path protocol.
        if (range.startsWith(REWRITTEN_PROTOCOL)) continue;
        if (PATH_PROTOCOLS.some((p) => range.startsWith(p))) {
          fail(
            'is a filesystem path in a PUBLISHED package — it names a directory on the ' +
              "author's machine, so no consumer can resolve it",
            'use a registry range, or `workspace:*` if npm should rewrite it at pack time'
          );
          continue;
        }
        if (semver.validRange(range) === null) {
          fail('is not a valid semver range', 'use `>=<floor> <<next-major>>`');
          continue;
        }

        // Rule 2 — bounded above.
        if (!semver.subset(range, UNREACHABLE_CEILING, SEMVER_OPTS)) {
          fail(
            'is unbounded above — it silently accepts a future breaking major',
            `use \`${suggestedRange(semver.minVersion(range))}\``
          );
          continue;
        }

        // Rule 3 — admits its whole major band.
        const band = majorBandOf(range);
        if (band && !semver.subset(band.text, range, SEMVER_OPTS)) {
          fail(
            range.includes('||')
              ? 'is a hand-maintained OR-chain — it needs a manual edit on every minor, ' +
                  'and goes stale in between'
              : 'is narrower than its major band — it locks to one minor, so it needs a ' +
                  'manual edit on every release of that package',
            `use \`${suggestedRange(band.floor)}\``
          );
          continue;
        }

        // Rule 4 — not stale.
        const current = workspaceVersions.get(name);
        if (current && !semver.satisfies(current, range, SEMVER_OPTS)) {
          fail(
            `is stale — ${name} is now ${current}, which this range excludes`,
            `use \`${suggestedRange(`${semver.major(current)}.${semver.minor(current)}.0`)}\``
          );
          continue;
        }

        accepted.push({ where, block, name, range, current });
      }
    }
  }

  let registryChecked = 0;
  if (CHECK_REGISTRY) {
    const failedNames = new Set(failures.map((f) => f.name));
    for (const manifest of published) {
      registryChecked += await checkRegistry(manifest, failedNames, failures);
    }
  }

  if (VERBOSE) {
    for (const a of accepted) {
      const at = a.current ? ` (workspace ${a.current})` : ' (not in this workspace)';
      process.stdout.write(`  ok  ${a.where} ${a.block} ${a.name}: ${a.range}${at}\n`);
    }
  }

  if (failures.length > 0) {
    process.stderr.write(`Internal dependency check failed (${failures.length}):\n\n`);
    for (const f of failures) {
      process.stderr.write(`  ${f.where}\n`);
      process.stderr.write(`    ${f.block}["${f.name}"] = "${f.range}"\n`);
      process.stderr.write(`    ${f.reason}\n`);
      process.stderr.write(`    fix: ${f.fix}\n\n`);
    }
    process.stderr.write(
      'Every internal @qontinui/* range in a PUBLISHED package must be a valid registry\n' +
        'range, bounded above, wide enough to span its major band, and satisfied by the\n' +
        'depended-on package’s current source version. See\n' +
        'docs/wrappers/authoring-guide.md for the reasoning.\n'
    );
    process.exit(1);
  }

  const registryNote = CHECK_REGISTRY
    ? `; ${registryChecked} proven resolvable on the registry`
    : '';
  process.stdout.write(
    `Dependency ranges OK — ${accepted.length} internal range(s) across ` +
      `${published.length} published package(s); ` +
      `${skippedPrivate} private manifest(s) exempt${registryNote}.\n`
  );
}

main().catch((err) => {
  process.stderr.write(`${err.message ?? err}
`);
  process.exit(1);
});
