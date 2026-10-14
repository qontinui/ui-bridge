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
 * `apk --no-cache add chromium`, the usual Dockerfile form, passed. A third
 * review found the same words passing inside an interpreter's inline code
 * (`sh -c "apt-get install ..."`, `node -e "...execSync('sudo ...')"`) and four
 * escalators missing. A sixth found code attached to its flag (`python3 -cCODE`,
 * `env -SCODE`), words a shell builds from quotes (`ap''t-get`), PowerShell 5.1's
 * positional command and five interpreters passing unread. Each shape is pinned
 * below both ways round: refused (each review's probes first), refused as
 * unreadable, and allowed (words the rule must not take for a host change).
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
  // The escalators the third review added, and doas.
  [['pkexec', 'npm', 'ci'], 'pkexec'],
  [['gsudo', 'npm', 'ci'], 'gsudo'],
  [['runas', '/user:Administrator', 'npm ci'], 'runas'],
  [['C:\\Windows\\System32\\runas.exe', '/user:admin', 'cmd'], 'C:\\Windows\\System32\\runas.exe'],
  [['doas', 'npm', 'ci'], 'doas'],
  // The third review's probes: the words inside an interpreter's inline code.
  [['sh', '-c', 'apt-get install -y libnss3'], 'sh -c … apt-get'],
  [['bash', '-c', 'sudo apt-get update; npm ci'], 'bash -c … sudo'],
  [['cmd', '/c', 'choco install chromium'], 'cmd /c … choco'],
  [['pwsh', '-Command', 'winget install chromium'], 'pwsh -Command … winget'],
  [
    ['node', '-e', "require('child_process').execSync('sudo apt-get install -y libnss3')"],
    'node -e … sudo',
  ],
  [['python3', '-c', "import os; os.system('apt-get install -y libnss3')"], 'python3 -c … apt-get'],
  // Every interpreter and flag form the rule reads.
  [['zsh', '-c', 'brew install chromium'], 'zsh -c … brew'],
  [['dash', '-ec', 'apk add chromium'], 'dash -ec … apk add'],
  [['ksh', '-xc', 'sudo true'], 'ksh -xc … sudo'],
  [['bash', '-euo', 'pipefail', '-c', 'apt-get install -y libnss3'], 'bash -c … apt-get'],
  [['sh', '-c', 'exec "$@"', 'sh', 'apt-get', 'install', 'x'], 'sh -c … apt-get'],
  [['/bin/sh', '-c', 'sudo true'], '/bin/sh -c … sudo'],
  [['cmd', '/C', 'choco', 'install', 'chromium'], 'cmd /C … choco'],
  [
    ['C:\\Windows\\System32\\cmd.exe', '/k', 'winget install x'],
    'C:\\Windows\\System32\\cmd.exe /k … winget',
  ],
  [['powershell', '-NoProfile', '-c', 'choco upgrade all -y'], 'powershell -c … choco'],
  [
    ['pwsh', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-command', 'scoop install x'],
    'pwsh -command … scoop',
  ],
  [['node', '--eval', "require('child_process').execSync('brew install x')"], 'node --eval … brew'],
  [['node', "--eval=require('child_process').execSync('apk add x')"], 'node --eval … apk add'],
  [['node', '-pe', "require('child_process').execSync('pkexec true')"], 'node -pe … pkexec'],
  [['node', '--print', "require('child_process').execSync('gsudo x')"], 'node --print … gsudo'],
  [['node', '-p', "require('child_process').execSync('doas true')"], 'node -p … doas'],
  [
    ['python', '-c', "import subprocess; subprocess.run(['winget', 'install', 'x'])"],
    'python -c … winget',
  ],
  [['py', '-3', '-c', "import os; os.system('choco install x')"], 'py -c … choco'],
  [['python3', '-Ic', "__import__('os').system('apt install x')"], 'python3 -Ic … apt'],
  [['perl', '-e', "system('sudo apt-get install -y x')"], 'perl -e … sudo'],
  [['perl', '-wle', "system('yum install x')"], 'perl -wle … yum'],
  [['ruby', '-e', "system('brew install x')"], 'ruby -e … brew'],
  // Interpreters nested in inline code: the quote names each layer.
  [['bash', '-c', 'bash -c \'node -e "x" ; dnf install x\''], 'bash -c … bash -c … node -e … dnf'],
  [['sh', '-c', 'port -N install chromium'], 'sh -c … port -N install'],
  [['sh', '-c', '/usr/bin/sudo -n true'], 'sh -c … /usr/bin/sudo'],
  // The sixth review's probes. Code ATTACHED to its flag is the code.
  [['python3', '-cimport os; os.system("sudo apt-get install x")'], 'python3 -c … sudo'],
  [['python3', '-Icimport os; os.system("apt install x")'], 'python3 -Ic … apt'],
  [['perl', '-esystem("sudo apt-get install x")'], 'perl -e … sudo'],
  [['perl', '-wlEsystem "yum install x"'], 'perl -wlE … yum'],
  [['ruby', '-esystem("sudo apt-get install x")'], 'ruby -e … sudo'],
  [['cmd', '/cchoco install chromium'], 'cmd /c … choco'],
  [['cmd', '/s', '/Kwinget install x'], 'cmd /K … winget'],
  // env -S / --split-string run their string as argv, like a shell's -c.
  [['env', '-S', 'sudo apt-get install -y x'], 'env -S … sudo'],
  [['env', '-Ssudo apt-get install x'], 'env -S … sudo'],
  [['env', '-iS', 'apk add chromium'], 'env -iS … apk add'],
  [['env', '--split-string', 'brew install x'], 'env --split-string … brew'],
  [['env', '--split-string=dnf install x'], 'env --split-string … dnf'],
  // Quotes and backslashes are removed before splitting, as a shell builds a word.
  [['bash', '-c', "ap''t-get install x"], 'bash -c … apt-get'],
  [['bash', '-c', 'a\\pt-get install x'], 'bash -c … apt-get'],
  [['sh', '-c', "s'u'do true"], 'sh -c … sudo'],
  [['sh', '-c', '\\sudo true'], 'sh -c … \\sudo'],
  [['bash', '-c', "a$'p't-get install x"], 'bash -c … apt-get'],
  // ...and a string literal is still a word of its own in a script.
  [['node', '-e', "require('child_process').execSync('sudo'+' true')"], 'node -e … sudo'],
  [['node', '-e', "execSync('sudo'.trim())"], 'node -e … sudo'],
  [
    ['cmd', '/c', 'C:\\ProgramData\\chocolatey\\bin\\choco.exe install x'],
    'cmd /c … C:\\ProgramData\\chocolatey\\bin\\choco.exe',
  ],
  // PowerShell 5.1 runs its first word that is not an option as -Command.
  [['powershell', 'choco install x'], 'powershell … choco'],
  [['powershell', '-NoProfile', 'winget install x'], 'powershell … winget'],
  [['powershell', '-ExecutionPolicy', 'Bypass', 'scoop install x'], 'powershell … scoop'],
  // -CommandWithArgs / -cwa, and -Command:<code>.
  [['pwsh', '-CommandWithArgs', 'choco install $args[0]', 'x'], 'pwsh -CommandWithArgs … choco'],
  [['pwsh', '-cwa', 'winget install x'], 'pwsh -cwa … winget'],
  [['pwsh', '-Command:choco install x'], 'pwsh -Command … choco'],
  // The other interpreters the review listed.
  [['npx', '-c', 'sudo apt-get install x'], 'npx -c … sudo'],
  [['npx', '--yes', '--call=apt-get install x'], 'npx --call … apt-get'],
  [['npm', 'exec', '-c', 'sudo true'], 'npm exec -c … sudo'],
  [['npm', 'x', '--call', 'brew install x'], 'npm x --call … brew'],
  [['fish', '-c', 'sudo true'], 'fish -c … sudo'],
  [['fish', '--command=brew install x'], 'fish --command … brew'],
  [['fish', '-C', 'sudo true'], 'fish -C … sudo'],
  [['bun', '-e', 'Bun.spawnSync(["sudo","true"])'], 'bun -e … sudo'],
  [['bun', '--print', 'Bun.spawnSync(["apt-get","install","x"])'], 'bun --print … apt-get'],
  [['deno', 'eval', 'new Deno.Command("sudo").outputSync()'], 'deno eval … sudo'],
  [
    ['deno', '-q', 'eval', "new Deno.Command('brew', { args: ['install', 'x'] })"],
    'deno eval … brew',
  ],
  [['ash', '-c', 'apk add chromium'], 'ash -c … apk add'],
  [['tcsh', '-c', 'sudo true'], 'tcsh -c … sudo'],
  // PowerShell and cmd resolve commands without regard to case.
  [['pwsh', '-Command', 'Choco install x'], 'pwsh -Command … Choco'],
  [['cmd', '/c', 'CHOCO install x'], 'cmd /c … CHOCO'],
  [['WinGet.exe', 'install', 'x'], 'WinGet.exe'],
  [['PowerShell.exe', '-Command', 'Scoop install x'], 'PowerShell.exe -Command … Scoop'],
  // Start-Process -Verb RunAs runs a program as administrator.
  [['pwsh', '-Command', 'Start-Process -Verb RunAs pwsh'], 'pwsh -Command … RunAs'],
  [['pwsh', '-Command', "Start-Process pwsh -verb 'runas'"], 'pwsh -Command … runas'],
  [['pwsh', '-Command', 'Start-Process pwsh -Verb:RunAs'], 'pwsh -Command … -Verb:RunAs'],
];

// [argv, the words the failure quotes]: code the rule cannot read at all.
const UNREADABLE = [
  [['pwsh', '-EncodedCommand', 'ZQBjAGgAbwAgAGgAaQA='], 'pwsh -EncodedCommand'],
  [['pwsh', '-enc', 'ZQBj'], 'pwsh -enc'],
  [['pwsh', '-ec', 'ZQBj'], 'pwsh -ec'],
  [['powershell', '-e', 'ZQBj'], 'powershell -e'],
  [['powershell', '-NoProfile', '-EncodedCommand', 'ZQBj'], 'powershell -EncodedCommand'],
  [['pwsh', '-Command', '-'], 'pwsh -Command -'],
  [['pwsh', '-'], 'pwsh -'],
  [['bash', '-s'], 'bash -s'],
  [['sh', '-es'], 'sh -es'],
  [['node', '-'], 'node -'],
  [['python3', '-'], 'python3 -'],
  [['perl', '-'], 'perl -'],
  [['ruby', '-'], 'ruby -'],
  [['sh', '-c', 'pwsh -enc ZQBj'], 'sh -c … pwsh -enc'],
  [['fish', '-'], 'fish -'],
  [['npx', '-c', '-'], 'npx -c -'],
  [['env', '-S', 'pwsh -enc ZQBj'], 'env -S … pwsh -enc'],
  [['powershell', '-NoProfile', '-'], 'powershell -'],
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
  // Inline code that changes nothing on the host.
  ['sh', '-c', 'npm ci'],
  ['bash', '-c', 'echo port 3000'],
  ['cmd', '/c', 'npm run build'],
  ['pwsh', '-NoProfile', '-Command', 'Get-ChildItem dist'],
  ['node', '-e', 'console.log(process.version)'],
  ['node', '-pe', "require('./package.json').version"],
  ['python3', '-c', "print('install')"],
  ['perl', '-ne', 'print if /apk/'],
  // A script FILE is not followed (a stated limit), and its own arguments are its.
  ['bash', 'scripts/release.sh', '-s'],
  ['node', 'scripts/apt-mirror.mjs', '-e'],
  ['python3', 'scripts/tool.py', '-'],
  ['pwsh', '-File', 'scripts/build.ps1'],
  // `-ExecutionPolicy` is not `-EncodedCommand`.
  ['pwsh', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/build.ps1'],
  // PowerShell 5.1 reads a -File script's name and arguments as code: no host word here.
  ['powershell', '-NoProfile', '-File', 'scripts/build.ps1', 'install'],
  // env's lone `-` is an empty environment, not stdin; its -S code that changes nothing.
  ['env', '-', 'npm', 'ci'],
  ['env', '-S', 'npm ci'],
  ['env', 'NODE_ENV=production', 'npm', 'run', 'build'],
  // Attached code that changes nothing on the host, and options that are not code.
  ['python3', '-cprint(1)'],
  ['python3', '-W', 'ignore', '-c', "print('ok')"],
  ['perl', '-eprint 1'],
  ['cmd', '/cnpm run build'],
  ['node', '--input-type=module', '-e', 'console.log(1)'],
  // The shell reading must not merge a quoted argument into a host word.
  ['bash', '-c', "echo 'ap' 't-get'"],
  // npm and npx running a package, or a script, rather than inline code.
  ['npm', 'exec', 'vitest', 'run'],
  ['npx', '--yes', 'prettier', '--check', '.'],
  ['deno', 'run', 'scripts/eval.ts'],
  ['bun', 'run', 'build'],
  ['fish', 'scripts/build.fish'],
];

for (const [argv, quoted] of REFUSED) {
  test(`refuses    ${argv.join(' ')}`, () =>
    assert.deepEqual(hostChange(argv), { quoted, unreadable: false }));
}
for (const [argv, quoted] of UNREADABLE) {
  test(`unreadable ${argv.join(' ')}`, () =>
    assert.deepEqual(hostChange(argv), { quoted, unreadable: true }));
}
for (const argv of ALLOWED) {
  test(`allows     ${argv.join(' ')}`, () => assert.equal(hostChange(argv), null));
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
