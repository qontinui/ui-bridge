#!/usr/bin/env node
/**
 * Table-driven tests for rule 6 (FROZEN) of scripts/check-dep-ranges.cjs.
 *
 * Rule 6 compares a package's source dependency blocks with the manifest its
 * release tag carries. Its failure mode is a QUIET one: a reader that answers
 * "untagged" for a tag it could not read, or a comparison that misses a block,
 * passes exactly the drift it exists to catch (20e7c37 raised a released
 * floor in two packages without a bump, and nothing noticed). So the rule is
 * pinned here against fixture manifests and a stubbed tag reader, and the
 * real reader (`makeTagReader`) against a stubbed `git`, no git and no network
 * involved.
 *
 * Usage:  node scripts/check-dep-ranges.test.cjs
 * Exit:   0 all passed / 1 one or more failed
 */

'use strict';

const assert = require('node:assert/strict');
const { canonicalBlock, frozenFailures, makeTagReader } = require('./check-dep-ranges.cjs');

let failed = 0;
let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  FAIL ${name}\n       ${e.message.split('\n').slice(0, 6).join('\n       ')}`);
  }
}

const WHERE = 'packages/ui-bridge-headless/package.json';
const DIR = 'ui-bridge-headless';

/** The source manifest: headless at 0.7.0 with the raised cli-args floor. */
const SOURCE = {
  name: '@qontinui/ui-bridge-headless',
  version: '0.7.0',
  dependencies: { '@qontinui/ui-bridge-cli-args': '>=0.3.0 <1', playwright: '^1.48.0' },
};

/** What `ui-bridge-headless-v0.7.0` actually released. */
const RELEASED = {
  name: '@qontinui/ui-bridge-headless',
  version: '0.7.0',
  dependencies: { '@qontinui/ui-bridge-cli-args': '>=0.1.0 <1', playwright: '^1.48.0' },
};

/** A stub tag reader answering `answer` and recording what it was asked. */
function reader(answer) {
  const asked = [];
  const read = (dir, version) => {
    asked.push(`${dir}-v${version}`);
    return answer;
  };
  return { read, asked };
}

test('equal dependency blocks pass', () => {
  const { read, asked } = reader({
    state: 'tagged',
    tag: 'ui-bridge-headless-v0.7.0',
    json: SOURCE,
  });
  assert.deepEqual(frozenFailures(WHERE, DIR, SOURCE, read), []);
  assert.deepEqual(asked, ['ui-bridge-headless-v0.7.0']);
});

test('key order does not matter: blocks compare canonically', () => {
  const reordered = {
    ...SOURCE,
    dependencies: { playwright: '^1.48.0', '@qontinui/ui-bridge-cli-args': '>=0.3.0 <1' },
  };
  const { read } = reader({ state: 'tagged', tag: 'ui-bridge-headless-v0.7.0', json: reordered });
  assert.deepEqual(frozenFailures(WHERE, DIR, SOURCE, read), []);
});

test('a changed internal floor fails, naming the package, version, tag and both ranges', () => {
  const { read } = reader({ state: 'tagged', tag: 'ui-bridge-headless-v0.7.0', json: RELEASED });
  const failures = frozenFailures(WHERE, DIR, SOURCE, read);
  assert.equal(failures.length, 1);
  const [f] = failures;
  assert.equal(f.where, WHERE);
  assert.equal(f.block, 'dependencies');
  assert.equal(f.label, 'dependencies of @qontinui/ui-bridge-headless@0.7.0');
  assert.match(f.reason, /released as ui-bridge-headless-v0\.7\.0/);
  assert.match(f.reason, /"@qontinui\/ui-bridge-cli-args":">=0\.1\.0 <1"/);
  assert.match(f.reason, /"@qontinui\/ui-bridge-cli-args":">=0\.3\.0 <1"/);
  assert.match(f.fix, /bump @qontinui\/ui-bridge-headless to the next version \(above 0\.7\.0\)/);
});

test('a block present in the source but absent from the release fails', () => {
  const withPeer = { ...SOURCE, peerDependencies: { react: '>=18' } };
  const { read } = reader({ state: 'tagged', tag: 'ui-bridge-headless-v0.7.0', json: SOURCE });
  const failures = frozenFailures(WHERE, DIR, withPeer, read);
  assert.deepEqual(
    failures.map((f) => f.block),
    ['peerDependencies']
  );
});

test('a changed external dependency fails too: every dependency block is frozen', () => {
  const bumped = { ...SOURCE, dependencies: { ...SOURCE.dependencies, playwright: '^1.50.0' } };
  const { read } = reader({ state: 'tagged', tag: 'ui-bridge-headless-v0.7.0', json: SOURCE });
  assert.equal(frozenFailures(WHERE, DIR, bumped, read).length, 1);
});

test('no tag passes (the version is unreleased)', () => {
  const { read } = reader({ state: 'untagged', tag: 'ui-bridge-headless-v0.7.0' });
  assert.deepEqual(frozenFailures(WHERE, DIR, SOURCE, read), []);
});

test('a reader that cannot answer fails as UNKNOWN, never passes', () => {
  const { read } = reader({
    state: 'unknown',
    tag: 'ui-bridge-headless-v0.7.0',
    detail: 'fatal: unable to access origin',
  });
  const failures = frozenFailures(WHERE, DIR, SOURCE, read);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].label, '@qontinui/ui-bridge-headless@0.7.0');
  assert.match(failures[0].reason, /^UNKNOWN whether 0\.7\.0 is released/);
  assert.match(failures[0].reason, /fatal: unable to access origin/);
});

test('an answer in no known state is UNKNOWN too', () => {
  const { read } = reader({});
  assert.match(frozenFailures(WHERE, DIR, SOURCE, read)[0].reason, /^UNKNOWN/);
});

test('a manifest outside packages/ (no dir) is not asked about', () => {
  const { read, asked } = reader({ state: 'unknown' });
  assert.deepEqual(frozenFailures('package.json', null, SOURCE, read), []);
  assert.deepEqual(asked, []);
});

test('canonicalBlock reads an absent block as {}', () => {
  assert.equal(canonicalBlock(undefined), '{}');
  assert.equal(canonicalBlock({ b: '1', a: '2' }), '{"a":"2","b":"1"}');
});

// ---------------------------------------------------------------------------
// makeTagReader — the real reader, over a stubbed `git`.
// ---------------------------------------------------------------------------

const TAGGED_JSON = JSON.stringify(RELEASED);

/**
 * A stubbed `git(args)`: `local` is the set of tag refs present locally,
 * `remote` the `ls-remote --tags origin` output (or an Error to throw),
 * `shallow` the `--is-shallow-repository` answer. Records every call.
 */
function fakeGit({ local = new Set(), remote = '', shallow = false, fetchFails = false } = {}) {
  const calls = [];
  const run = (args) => {
    calls.push(args.join(' '));
    const [verb] = args;
    if (verb === 'rev-parse' && args[1] === '--is-shallow-repository') return `${shallow}\n`;
    if (verb === 'rev-parse') {
      const ref = args[3].replace(/\^\{commit\}$/, '');
      if (local.has(ref)) return 'deadbeef\n';
      throw Object.assign(new Error('fatal: Needed a single revision'), { stderr: '' });
    }
    if (verb === 'ls-remote') {
      if (remote instanceof Error) throw remote;
      return remote;
    }
    if (verb === 'fetch') {
      if (fetchFails) {
        throw Object.assign(new Error('fetch failed'), {
          stderr: 'fatal: could not read from remote',
        });
      }
      local.add(args[args.length - 1].split(':')[1]);
      return '';
    }
    if (verb === 'show') return TAGGED_JSON;
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  return { run, calls };
}

const REF = 'refs/tags/ui-bridge-headless-v0.7.0';
const LS_REMOTE = `aaa\trefs/tags/ui-bridge-v0.53.0\n` + `bbb\t${REF}\n` + `ccc\t${REF}^{}\n`;

test('reader: a local tag is read without asking origin', () => {
  const { run, calls } = fakeGit({ local: new Set([REF]) });
  const answer = makeTagReader(run)('ui-bridge-headless', '0.7.0');
  assert.equal(answer.state, 'tagged');
  assert.deepEqual(answer.json, RELEASED);
  assert.ok(!calls.some((c) => c.startsWith('ls-remote')), calls.join(' | '));
});

test('reader: a tag only on origin is fetched, then read', () => {
  const { run, calls } = fakeGit({ remote: LS_REMOTE });
  const answer = makeTagReader(run)('ui-bridge-headless', '0.7.0');
  assert.equal(answer.state, 'tagged');
  assert.ok(calls.includes(`fetch --quiet --no-tags origin +${REF}:${REF}`), calls.join(' | '));
});

test('reader: a peeled ^{} line names its tag (the strip is what matches it)', () => {
  const { run } = fakeGit({ remote: `ccc\t${REF}^{}\n` });
  assert.equal(makeTagReader(run)('ui-bridge-headless', '0.7.0').state, 'tagged');
});

test('reader: a full clone is never deepen-fetched (no --depth), a shallow one is', () => {
  const full = fakeGit({ remote: LS_REMOTE, shallow: false });
  makeTagReader(full.run)('ui-bridge-headless', '0.7.0');
  assert.ok(!full.calls.some((c) => c.includes('--depth')), full.calls.join(' | '));
  const shallow = fakeGit({ remote: LS_REMOTE, shallow: true });
  makeTagReader(shallow.run)('ui-bridge-headless', '0.7.0');
  assert.ok(
    shallow.calls.includes(`fetch --quiet --no-tags --depth=1 origin +${REF}:${REF}`),
    shallow.calls.join(' | ')
  );
});

test('reader: a tag absent from a non-empty origin list is untagged', () => {
  const { run } = fakeGit({ remote: LS_REMOTE });
  assert.equal(makeTagReader(run)('ui-bridge-headless', '0.8.0').state, 'untagged');
});

test('reader: a failed ls-remote is UNKNOWN on EVERY later call, never untagged', () => {
  const { run, calls } = fakeGit({ remote: new Error('fatal: unable to access origin') });
  const read = makeTagReader(run);
  const first = read('ui-bridge-headless', '0.7.0');
  const second = read('ui-bridge-wrapper', '0.14.0');
  assert.equal(first.state, 'unknown');
  assert.equal(second.state, 'unknown');
  assert.match(second.detail, /unable to access origin/);
  assert.equal(calls.filter((c) => c.startsWith('ls-remote')).length, 1);
});

test('reader: an origin that lists no tags at all is UNKNOWN, not "nothing released"', () => {
  const { run } = fakeGit({ remote: '' });
  const answer = makeTagReader(run)('ui-bridge-headless', '0.7.0');
  assert.equal(answer.state, 'unknown');
  assert.match(answer.detail, /lists no tags/);
});

test('reader: a fetch that fails is UNKNOWN', () => {
  const { run } = fakeGit({ remote: LS_REMOTE, fetchFails: true });
  const answer = makeTagReader(run)('ui-bridge-headless', '0.7.0');
  assert.equal(answer.state, 'unknown');
  assert.match(answer.detail, /could not read from remote/);
});

test('reader: an invalid version never reaches git', () => {
  const { run, calls } = fakeGit({ remote: LS_REMOTE });
  const answer = makeTagReader(run)('ui-bridge-headless', '0.7.0; rm -rf /');
  assert.equal(answer.state, 'unknown');
  assert.deepEqual(calls, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
