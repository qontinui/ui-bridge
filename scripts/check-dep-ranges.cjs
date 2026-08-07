#!/usr/bin/env node
// Internal dependency-range ratchet.
//
// PR #147 replaced the wrapper's hand-maintained 19-term OR-chain
// (`^0.4.0 || ^0.5.0 || … || ^0.22.0`) with `>=0.4.0 <1`, bounded the three
// ranges that were unbounded ABOVE, and taught the authoring guide the
// bounded form. What it did NOT leave behind was anything to keep it fixed:
// every one of those defects was reintroducible by a single hand edit, and
// two of the three had already been shipped to npm before anyone noticed.
//
// This is that guard. It fails the build when a PUBLISHED package declares an
// internal `@qontinui/*` range that is any of:
//
//   1. UNBOUNDED ABOVE (`*`, `>=0.4.0`, `>0.4.0`) — silently accepts a future
//      breaking major. The whole point of a major is that it may break you, so
//      a range that cannot say "no" hands the consumer a broken tree instead
//      of an install warning.
//
//   2. AN OR-CHAIN (`^0.4.0 || ^0.5.0 || …`) — bounded, but only because
//      somebody hand-extends it on every single minor. The ceiling goes stale
//      between releases and produces peer warnings caused purely by release
//      bookkeeping rather than by any real incompatibility. `>=<floor> <1`
//      expresses the same intent and never needs touching.
//
//   3. STALE — a range the depended-on package's CURRENT source version no
//      longer satisfies. This is the check with teeth: it is what turns "the
//      ceiling drifted" from a thing someone eventually notices into a red
//      build. It would have caught the original OR-chain's stale `^0.22.0`
//      ceiling the moment the engine cut 0.23.0, and it is what caught
//      `create-ui-bridge-wrapper` emitting `^0.1.0` for an engine at 0.22.0.
//
// PRIVATE packages are exempt by design: `ui-bridge-extension`, `e2e` and the
// six `examples/` are `private: true`, never publish, and use `"*"` / `file:`
// as plain workspace links. No consumer can ever resolve those, so bounding
// them would be ceremony. The exemption is by the manifest's own `private`
// flag, not by a hand-kept path list — a package that starts publishing is
// covered automatically, on the same commit that drops the flag.
//
// A FOURTH rule, `--registry`, is not run in CI — see the block comment on
// checkRegistry() below for why it belongs at publish time instead.
//
// Usage:
//   node scripts/check-dep-ranges.cjs                  # verify (CI, with the other *:check steps)
//   node scripts/check-dep-ranges.cjs --verbose        # also print every range it accepted
//   node scripts/check-dep-ranges.cjs --registry \
//     --package ui-bridge-wrapper                      # publish.yml: also prove each internal
//                                                      # dep resolves on the registry

'use strict';

const { readFileSync, existsSync, readdirSync, statSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { join, resolve, relative } = require('node:path');
const semver = require('semver');

const ROOT = resolve(__dirname, '..');
const VERBOSE = process.argv.includes('--verbose');
const CHECK_REGISTRY = process.argv.includes('--registry');
const ONLY_PACKAGE = (() => {
  const i = process.argv.indexOf('--package');
  return i === -1 ? null : process.argv[i + 1];
})();

const INTERNAL_SCOPE = '@qontinui/';
const DEP_BLOCKS = ['dependencies', 'peerDependencies', 'optionalDependencies'];

// A range is "bounded above" iff it excludes some sufficiently large version.
// Testing against a sentinel ceiling rather than `<1.0.0` keeps the rule honest
// after UI Bridge goes 1.x: `>=1.0.0 <2` must pass, `>=1.0.0` must not.
const UNREACHABLE_CEILING = '<9999.0.0';

// Specs that name a location rather than a registry range. npm resolves these
// from the tree, so there is no ceiling to bound and no published version to
// compare against.
const LOCAL_PROTOCOLS = ['file:', 'link:', 'workspace:', 'portal:'];

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
 * Every version of `name` the registry knows about, or null if the package
 * itself is unpublished (404). Any other npm failure throws — a network blip
 * must not read as "unpublished" [policy: silent-empty-is-unknown].
 */
const registryCache = new Map();

function registryVersions(name) {
  if (registryCache.has(name)) return registryCache.get(name);
  const result = fetchRegistryVersions(name);
  registryCache.set(name, result);
  return result;
}

function fetchRegistryVersions(name) {
  try {
    const out = execFileSync('npm', ['view', name, 'versions', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (err) {
    const stderr = String(err.stderr ?? '');
    if (stderr.includes('E404') || stderr.includes('404 Not Found')) return null;
    throw new Error(`npm view ${name} failed (not a 404, so the answer is UNKNOWN):\n${stderr}`);
  }
}

/**
 * The rule the other three could not catch: an internal dependency that is
 * perfectly well-formed and perfectly current, but that NOBODY CAN INSTALL.
 *
 * On 2026-08-07 `@qontinui/ui-bridge-cli-args` had never been published — no
 * `private` flag, its own tag prefix in publish.yml, simply never tagged —
 * while `@qontinui/ui-bridge-headless@0.4.0` and
 * `@qontinui/ui-bridge-wrapper@0.7.1` both shipped declaring it a hard
 * dependency. Both packages' `latest` were uninstallable: a clean
 * `npm install @qontinui/ui-bridge-wrapper` died with `E404` on cli-args. The
 * form rules above all PASS on `^0.1.0` — it is bounded, chain-free, and
 * satisfied by the workspace's own 0.1.0. Only the registry knows.
 *
 * This runs at PUBLISH time, not in CI, and deliberately so. Registry state is
 * not a property of the diff: a coordinated release where two new packages land
 * together is CORRECT even though the dependency is momentarily unpublished, so
 * gating every PR on it would red the build for changes that are fine and train
 * everyone to ignore it. At publish time the question is exactly right — this
 * tarball is about to become installable, so its dependencies must already be.
 */
function checkRegistry(manifest, failures) {
  for (const block of DEP_BLOCKS) {
    for (const [name, range] of Object.entries(manifest.json[block] ?? {})) {
      if (!name.startsWith(INTERNAL_SCOPE)) continue;
      if (LOCAL_PROTOCOLS.some((p) => range.startsWith(p))) continue;

      const where = relative(ROOT, manifest.path).replace(/\\/g, '/');
      const versions = registryVersions(name);

      if (versions === null) {
        failures.push({
          where,
          block,
          name,
          range,
          reason:
            'is not published to the registry at all — every consumer of this ' +
            'package would get E404 on install',
          fix: `publish ${name} first (git tag ${name.replace(INTERNAL_SCOPE, '')}-v<version>)`,
        });
        continue;
      }

      if (semver.maxSatisfying(versions, range) === null) {
        failures.push({
          where,
          block,
          name,
          range,
          reason:
            `is published, but no released version satisfies this range ` +
            `(registry has ${versions[versions.length - 1]})`,
          fix: `release a ${name} matching "${range}", or widen the range`,
        });
        continue;
      }

      if (VERBOSE) {
        process.stdout.write(
          `  ok  ${where} ${block} ${name}: ${range} -> registry ${semver.maxSatisfying(versions, range)}\n`
        );
      }
    }
  }
}

function main() {
  const manifests = readWorkspaceManifests();

  // name -> current source version, for the staleness check. Only packages
  // that live in this monorepo can be checked this way; a sibling-repo package
  // like @qontinui/ui-bridge-auto gets the two form checks and nothing more.
  const workspaceVersions = new Map();
  for (const { json } of manifests) {
    if (json.name && json.version) workspaceVersions.set(json.name, json.version);
  }

  const failures = [];
  const accepted = [];
  let skippedPrivate = 0;

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
    process.exit(1);
  }

  for (const { path, json } of selected) {
    const where = relative(ROOT, path).replace(/\\/g, '/');

    if (json.private === true) {
      skippedPrivate += 1;
      continue;
    }

    for (const block of DEP_BLOCKS) {
      for (const [name, range] of Object.entries(json[block] ?? {})) {
        if (!name.startsWith(INTERNAL_SCOPE)) continue;
        if (LOCAL_PROTOCOLS.some((p) => range.startsWith(p))) continue;

        const fail = (reason, fix) => failures.push({ where, block, name, range, reason, fix });

        if (semver.validRange(range) === null) {
          fail('is not a valid semver range', 'use `>=<floor> <1`');
          continue;
        }

        if (range.includes('||')) {
          fail(
            'is a hand-maintained OR-chain — it needs a manual edit on every minor, ' +
              'and goes stale in between',
            `use \`>=${semver.minVersion(range)?.version ?? '<floor>'} <1\``
          );
          continue;
        }

        if (!semver.subset(range, UNREACHABLE_CEILING)) {
          fail(
            'is unbounded above — it silently accepts a future breaking major',
            `use \`>=${semver.minVersion(range)?.version ?? '<floor>'} <1\``
          );
          continue;
        }

        const current = workspaceVersions.get(name);
        if (current && !semver.satisfies(current, range)) {
          fail(
            `is stale — ${name} is now ${current}, which this range excludes`,
            `use \`>=${semver.major(current)}.${semver.minor(current)}.0 <1\``
          );
          continue;
        }

        accepted.push({ where, block, name, range, current });
      }
    }
  }

  if (CHECK_REGISTRY) {
    for (const manifest of selected) {
      if (manifest.json.private === true) continue;
      checkRegistry(manifest, failures);
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
      'Every internal @qontinui/* range in a PUBLISHED package must be bounded on both\n' +
        'ends and must admit the current source version of its package' +
        (CHECK_REGISTRY ? ', and must resolve\nagainst the registry' : '') +
        '. See docs/wrappers/authoring-guide.md for the reasoning.\n'
    );
    process.exit(1);
  }

  process.stdout.write(
    `Dependency ranges OK — ${accepted.length} internal range(s) checked across ` +
      `${selected.length - skippedPrivate} published package(s); ` +
      `${skippedPrivate} private package(s) exempt` +
      `${CHECK_REGISTRY ? '; registry resolvability proven' : ''}.\n`
  );
}

main();
