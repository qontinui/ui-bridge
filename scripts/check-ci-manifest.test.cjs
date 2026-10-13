#!/usr/bin/env node
/**
 * Table-driven tests for the no-root rule of scripts/check-ci-manifest.cjs:
 * hostChange, which decides whether a .qontinui/ci.toml step would change the
 * system packages of the user's machine it runs on, or escalate to root.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The rule's misses are silent. A form it does not recognise passes the ratchet
 * and runs on a user's machine, and nothing about a green run says which forms
 * were checked. Review found two such misses in turn: `apk` and `port` matched
 * as bare words, which would have blocked a build target and a flag value; then
 * their subcommand was read only as the very next word, so
 * `apk --no-cache add chromium`, the usual Dockerfile form, passed. Each shape is
 * pinned below both ways round: refused (the reviewer's five probes first) and
 * allowed (words the rule must not take for a host change).
 *
 * Usage:  node scripts/check-ci-manifest.test.cjs
 * Exit:   0 all passed / 1 one or more failed
 */

'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const { hostChange } = require('./check-ci-manifest.cjs');

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

// [argv, the words the failure quotes]
const REFUSED = [
  // The reviewer's five probes: options before the subcommand, and host-changing
  // subcommands other than add and install.
  [['apk', '--no-cache', 'add', 'chromium'], 'apk --no-cache add'],
  [['apk', '-U', 'add'], 'apk -U add'],
  [['port', '-N', 'install'], 'port -N install'],
  [['apk', 'upgrade'], 'apk upgrade'],
  [['apk', 'del'], 'apk del'],
  // An option's value between the manager and its subcommand.
  [
    ['apk', '-X', 'https://dl-cdn.alpinelinux.org/alpine/edge/testing', 'add', 'chromium'],
    'apk -X https://dl-cdn.alpinelinux.org/alpine/edge/testing add',
  ],
  [
    ['apk', '--repositories-file=/etc/apk/repositories', 'fix'],
    'apk --repositories-file=/etc/apk/repositories fix',
  ],
  // The shared subcommands, and a manager's own.
  [['apk', 'add', 'chromium'], 'apk add'],
  [['apk', 'update'], 'apk update'],
  [['port', 'install', 'chromium'], 'port install'],
  [['port', '-v', 'selfupdate'], 'port -v selfupdate'],
  [['port', 'uninstall', 'chromium'], 'port uninstall'],
  [['snap', 'install', 'chromium'], 'snap install'],
  [['snap', 'refresh'], 'snap refresh'],
  // The manager named by path, or with a Windows executable suffix.
  [['/sbin/apk', '--no-cache', 'add', 'chromium'], '/sbin/apk --no-cache add'],
  [
    ['C:\\ProgramData\\chocolatey\\bin\\choco.exe', 'install', 'chromium'],
    'C:\\ProgramData\\chocolatey\\bin\\choco.exe',
  ],
  // Refused outright, whatever follows: privilege escalation, the managers that
  // name nothing else (pacman and dpkg install through options), and
  // Playwright's apt path.
  [['sudo', 'npm', 'ci'], 'sudo'],
  [['apt-get', '-y', 'install', 'libnss3'], 'apt-get'],
  [['pacman', '-S', '--noconfirm', 'chromium'], 'pacman'],
  [['dpkg', '-i', 'chromium.deb'], 'dpkg'],
  [['brew', 'install', 'chromium'], 'brew'],
  [['npx', 'playwright', 'install', '--with-deps', 'chromium'], '--with-deps'],
  [['npx', 'playwright', 'install-deps'], 'install-deps'],
];

// Words the rule must not take for a host change.
const ALLOWED = [
  ['npm', 'ci'],
  ['npm', 'install'],
  ['npx', 'playwright', 'install', 'chromium'],
  // A bare `apk` is a build target.
  ['npm', 'run', 'build', '--', 'apk'],
  ['npm', 'run', 'build', '--', '--target', 'apk', '--verbose'],
  ['npm', 'run', 'build:apk'],
  ['node', 'scripts/sign.mjs', 'dist/app.apk'],
  // `--port` values, and `port` as an ordinary word.
  ['npx', 'vite', 'preview', '--port', '4173'],
  ['npx', 'serve', '--port=3000'],
  ['node', 'server.mjs', 'port', '3000'],
  // A manager's read-only subcommands, with and without options first.
  ['apk', 'info', 'chromium'],
  ['apk', '--print-arch'],
  ['apk', '-X', 'https://example.test/alpine', 'search', 'chromium'],
  ['port', '--version'],
  // `snap` as a script name.
  ['npm', 'run', 'snap'],
];

for (const [argv, quoted] of REFUSED) {
  test(`refuses ${argv.join(' ')}`, () => assert.equal(hostChange(argv), quoted));
}
for (const argv of ALLOWED) {
  test(`allows  ${argv.join(' ')}`, () => assert.equal(hostChange(argv), null));
}

// ---------------------------------------------------------------------------
// The entry-point split. Requiring the ratchet must not run it, or every case
// above would run a whole-repo check as a side effect; and if the detection went
// wrong the ratchet would do NOTHING and exit 0. Neither shows in a passing run.
// ---------------------------------------------------------------------------

const RATCHET = path.resolve(__dirname, 'check-ci-manifest.cjs');

test('requiring the ratchet does not run it', () => {
  const out = execFileSync(
    process.execPath,
    ['-e', `require(${JSON.stringify(RATCHET)}); console.log('quiet');`],
    { encoding: 'utf8' }
  );
  assert.equal(out.trim(), 'quiet');
});

test('running it as a script runs the check', () => {
  const out = execFileSync(process.execPath, [RATCHET], { encoding: 'utf8' });
  assert.match(out, /^CI manifest ok: \d+ step\(s\) valid/);
});

test('argv[1] naming the ratchet while require.main does not is refused, loudly', () => {
  let status = null;
  let stderr = '';
  try {
    execFileSync(
      process.execPath,
      ['-e', `process.argv[1] = ${JSON.stringify(RATCHET)}; require(${JSON.stringify(RATCHET)});`],
      { stdio: 'pipe' }
    );
  } catch (e) {
    status = e.status;
    stderr = String(e.stderr);
  }
  assert.equal(status, 1, 'the guard must fail the process, not pass silently');
  assert.match(stderr, /did not detect itself as the entry module/);
});

if (failed) {
  console.error(`\n${failed} of ${failed + passed} test(s) failed.`);
  process.exit(1);
}
console.log(`\ncheck-ci-manifest.test.cjs OK (${passed} passed)`);
