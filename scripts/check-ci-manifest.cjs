#!/usr/bin/env node
// Local-CI manifest ratchet — validates `.qontinui/ci.toml` and enforces the
// Actions-parity invariant that manifest's own header declares.
//
// WHY THIS EXISTS
//
// `.qontinui/ci.toml` (added in PR #149) is the ONLY source of commands for the
// runner-as-CI-node lane: coord dispatches a SHA, the runner reads this file
// out of the checked-out tree and executes exactly what it says. Two things
// were true of it and neither was checked by anything:
//
//   1. Its header states "PARITY IS A REVIEW-TIME INVARIANT: the steps below
//      mirror the gate commands of .github/workflows/ci.yml's `lint-and-test`
//      and `docs` jobs, step for step and in their order. When those jobs
//      change, update this file in the SAME PR." Nothing enforced that, so the
//      first person to add a gate step to ci.yml would silently leave the
//      product lane weaker than the Actions lane — and a lane that is green
//      because it runs FEWER gates is the worst possible failure mode for a
//      verdict two lanes are supposed to agree on.
//
//   2. Nothing in this repo ever parsed the file. A typo — an unknown key, a
//      banned metacharacter, an oversize timeout — would be discovered at
//      DISPATCH time, on a user's machine, as a failed build with no commit to
//      blame. This repo cannot run the runner's Rust parser, so the rules are
//      mirrored here (see CONTRACT below) and run on every PR instead.
//
// This is the same shape as the repo's other ratchets (`diagnostics:check`,
// `redaction:check-surface`, `deps:check-ranges`): recompute the invariant from
// source, fail on drift, and make the fix obvious in the failure message.
//
// CONTRACT — mirrored from the runner's parser. The authority is
// `qontinui-runner/src-tauri/src/ci_node/manifest.rs::parse_and_validate`; the
// constants below are transcribed from it (ENV_ALLOWLIST, ARGV_BANNED_CHARS,
// MAX_STEP_TIMEOUT_SECS, the `deny_unknown_fields` key sets, and
// `validate_working_dir`). A transcription can drift from its source, so it is
// pinned by name here: if that file's rules change, this one must change with
// it. Failing CLOSED is the safe direction — this script may reject a manifest
// the runner would accept, but a manifest this script accepts and the runner
// rejects is the bug worth avoiding, so keep the rules at least as strict.
//
// Usage:
//   node scripts/check-ci-manifest.cjs           # verify (CI)
//   node scripts/check-ci-manifest.cjs --verbose # list every checked pairing
//   node scripts/check-ci-manifest.test.cjs      # the no-root rule's table tests

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const TOML = require('smol-toml');
const YAML = require('yaml');

const REPO_ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(REPO_ROOT, '.qontinui', 'ci.toml');
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
const VERBOSE = process.argv.includes('--verbose');

// --- the runner's contract, transcribed (manifest.rs) -----------------------

/** manifest.rs::ENV_ALLOWLIST (`:18-29`). */
const ENV_ALLOWLIST = [
  'RUSTFLAGS',
  'RUST_BACKTRACE',
  'RUST_LOG',
  'CARGO_BUILD_JOBS',
  'CARGO_INCREMENTAL',
  'CARGO_TERM_COLOR',
  'NODE_OPTIONS',
  'NODE_ENV',
  'CI',
  'QONTINUI_DISABLE_KEYCHAIN',
];

/** manifest.rs::ARGV_BANNED_CHARS (`:35`). */
const ARGV_BANNED_CHARS = ['&', '|', '<', '>', '^', '"', '\n', '\r', '\0', '%'];

/** manifest.rs::MAX_STEP_TIMEOUT_SECS (`:13`). */
const MAX_STEP_TIMEOUT_SECS = 7200;

/** `#[serde(deny_unknown_fields)]` key sets — CiManifest / CiStep / CiLimits. */
const MANIFEST_KEYS = new Set(['version', 'steps', 'limits']);
const STEP_KEYS = new Set(['name', 'command', 'env', 'timeout_secs', 'working_dir']);
const LIMITS_KEYS = new Set(['cargo_build_jobs']);

// --- the parity contract, declared ------------------------------------------

/**
 * ci.yml jobs whose every `run:` step must appear in the manifest, in order.
 * Manifest steps are matched to these by an explicit `# parity:` citation, so a
 * reordering on either side is caught rather than silently absorbed.
 */
const MIRRORED_JOBS = ['lint-and-test', 'docs'];

/**
 * ci.yml jobs deliberately NOT mirrored, each with the reason the manifest's
 * header gives. A job appearing in ci.yml that is in neither list fails this
 * check: a new gate job must be a conscious decision to mirror or to exclude,
 * which is exactly the drift this ratchet exists to catch.
 */
const EXCLUDED_JOBS = new Map([
  [
    'browser-smokes',
    'It installs a browser with `npx playwright install --with-deps chromium`, and ' +
      '`--with-deps` runs `sudo apt-get` on Linux: on the local-CI lane that fails every ' +
      'dispatch without passwordless sudo or installs system packages as root. The smokes ' +
      'it runs skip themselves without Chromium, so the mirrored `test` step runs them ' +
      'skipping. Manifest header item 9.',
  ],
  [
    'python-tests',
    'Its `pip install -e ".[dev]"` records an editable finder pointing into the ' +
      'dispatch directory the executor deletes, permanently breaking `import ui_bridge` ' +
      'on the host. Its 3.10/3.11/3.12 matrix is separately unrepresentable — a manifest ' +
      'has one PATH and one interpreter.',
  ],
]);

/**
 * Argv words refused ANYWHERE in a manifest step. A step runs on a user's own
 * machine, and each of these changes that machine's system packages or
 * escalates to root: the step would either fail every dispatch on a host without
 * passwordless sudo, or change the host for every other program on it (manifest
 * header items 1, 2 and 9). `npm install` and `npx playwright install chromium`
 * pass; `--with-deps` and `install-deps`, Playwright's apt path, do not.
 *
 * sudo, su, doas, pkexec, gsudo and runas run a command as root or as an
 * administrator. The package managers here name a system package manager and
 * nothing else, so the word alone is refused, whatever follows it. That is
 * stricter than reading their subcommand, and for two of them it has to be:
 * pacman and dpkg install through OPTIONS (`pacman -S`, `dpkg -i`), which no
 * subcommand reading sees.
 */
const HOST_PACKAGE_WORDS = new Set([
  'sudo',
  'su',
  'doas',
  'pkexec',
  'gsudo',
  'runas',
  'apt',
  'apt-get',
  'dpkg',
  'dnf',
  'yum',
  'zypper',
  'pacman',
  'brew',
  'choco',
  'winget',
  'scoop',
  '--with-deps',
  'install-deps',
]);

/** Subcommands that change the host under any package manager. */
const HOST_CHANGING_SUBCOMMANDS = [
  'install',
  'add',
  'upgrade',
  'update',
  'del',
  'remove',
  'uninstall',
  'selfupdate',
  'purge',
  'reinstall',
  'downgrade',
  'autoremove',
];

/**
 * Package managers whose name is ALSO an ordinary argv word: `apk` an Android
 * build target, `port` a flag value, `snap` a script name. Refusing the word
 * would block legitimate steps, so the rule reads the invocation instead (see
 * hostChange): each manager maps to the subcommands that change the host, the
 * shared ones above plus its own.
 */
const AMBIGUOUS_PACKAGE_MANAGERS = new Map([
  ['apk', new Set([...HOST_CHANGING_SUBCOMMANDS, 'fix', 'cache'])],
  [
    'port',
    new Set([
      ...HOST_CHANGING_SUBCOMMANDS,
      'sync',
      'activate',
      'deactivate',
      'clean',
      'load',
      'unload',
      'migrate',
      'reclaim',
      'rev-upgrade',
      'setrequested',
      'unsetrequested',
    ]),
  ],
  [
    'snap',
    new Set([
      ...HOST_CHANGING_SUBCOMMANDS,
      'refresh',
      'revert',
      'enable',
      'disable',
      'connect',
      'disconnect',
      'set',
      'unset',
      'switch',
      'alias',
      'unalias',
      'prefer',
      'try',
      'ack',
      'start',
      'stop',
      'restart',
      'save',
      'restore',
      'forget',
    ]),
  ],
]);

/**
 * Interpreters that run code given INLINE in argv. `code` matches the flag that
 * introduces it. The code is every word after that flag (a shell's `-c` string
 * together with the positional words it may run, `cmd /c`'s whole command line),
 * plus, where the interpreter accepts code ATTACHED to its flag
 * (`python3 -cCODE`, `perl -eCODE`, `cmd /cCODE`, `env -SCODE`, `--eval=CODE`),
 * the rest of that word: `code`'s first capture group that matched.
 *
 * `unreadable` matches the flags whose code this rule cannot read (encoded, or
 * read from stdin). A lone `-`, the program read from stdin, is unreadable for
 * every interpreter but env, whose `-` means an empty environment. `positional`
 * marks PowerShell 5.1, which runs its first word that is not an option as
 * `-Command`, so the rule reads every word from there on as code (a `-File`
 * script's name and arguments included, which over-reads them). `skip` matches a subcommand read past on the
 * way to the flag (`npm exec -c`). Options are `-x` words, and `/x` ones for cmd
 * and PowerShell.
 */
const SHELL = { code: /^-[A-Za-z]*c[A-Za-z]*$/, unreadable: /^-[A-Za-z]*s[A-Za-z]*$/ };
const POWERSHELL = {
  // -Command and its prefixes down to -c, -CommandWithArgs and -cwa, each also
  // as -Command:<code>; -EncodedCommand, -enc, -ec, -e.
  code: /^[-/](?:c|co|com|comm|comma|comman|command|cwa|commandwithargs)(?::(.*))?$/is,
  unreadable:
    /^[-/](e|ec|en|enc|enco|encod|encode|encoded|encodedc|encodedco|encodedcom|encodedcomm|encodedcomma|encodedcomman|encodedcommand)$/i,
  slashOptions: true,
};
// -e, -p, or both (-pe); --eval and --print, or --eval=<code>. Neither node
// nor bun takes code attached to a short flag (`node -e1` is a bad option).
const JS_EVAL = { code: /^(?:-[A-Za-z]*[ep][A-Za-z]*|--eval|--print)$|^--(?:eval|print)=(.*)$/s };
// npx -c <code> and npm exec -c <code>: the code runs in a shell.
const NPM_CALL = { code: /^(?:-c|--call)$|^--call=(.*)$/s };

const INLINE_INTERPRETERS = new Map([
  // -c alone or in a cluster (-ec, -xc); -s reads the commands from stdin.
  ...['sh', 'bash', 'zsh', 'dash', 'ksh', 'ash', 'mksh', 'csh', 'tcsh'].map((shell) => [
    shell,
    SHELL,
  ]),
  // -c / -C (--init-command) alone or in a cluster, --command, --command=<code>.
  ['fish', { code: /^-[A-Za-z]*[cC][A-Za-z]*$|^--(?:command|init-command)(?:=(.*))?$/s }],
  // /c or /k, and everything after it in the same word (`/cchoco install x`).
  ['cmd', { code: /^\/[ck](.*)$/is, slashOptions: true }],
  ['pwsh', POWERSHELL],
  ['powershell', { ...POWERSHELL, positional: true }],
  ['node', JS_EVAL],
  ['bun', JS_EVAL],
  ['deno', { code: /^eval$/ }],
  // -c, or a cluster ending in it (-Ic); code attached after it is the code.
  ...['python', 'python3', 'py'].map((python) => [python, { code: /^-[A-Za-z]*?c(.*)$/s }]),
  ['perl', { code: /^-[A-Za-z]*?[eE](.*)$/s }],
  ['ruby', { code: /^-[A-Za-z]*?e(.*)$/s }],
  // -S <string> / --split-string: env splits the string and runs it as argv.
  [
    'env',
    {
      code: /^-[A-Za-z0-9]*?S(.*)$|^--split-string(?:=(.*))?$/s,
      dashIsStdin: false,
    },
  ],
  ['npx', NPM_CALL],
  ['npm', { ...NPM_CALL, skip: /^(?:exec|x)$/ }],
]);

/** Around a command in shell or script code: whitespace and these, never part of a name. */
const CODE_SEPARATORS = /[\s;&|<>(){}[\],`$=!]+/;

/**
 * Two readings of inline code as words, each read on its own.
 *
 * - The SHELL reading removes quotes and backslashes before splitting, as a
 *   shell does when it builds a word: `ap''t-get`, `a\pt-get` and `su"d"o` are
 *   the words apt-get and sudo, and so is `$'sudo'`.
 * - The SCRIPT reading splits on quotes and keeps backslashes, so a string
 *   literal is a word of its own (`'sudo'.trim()`, `"sudo"+x`) and a Windows
 *   path keeps the separators commandName reads (`C:\x\choco.exe`).
 *
 * The code is NOT parsed: every word of each reading is read, whatever role it
 * plays (an argument, a string, a comment), and either reading refuses. What it
 * does not do is RUN the code, so a word the code assembles at run time passes
 * it (LIMITS, at hostChange).
 */
function inlineReadings(code) {
  const shell = code
    .replace(/\$(?=['"])/g, '')
    .replace(/['"\\]/g, '')
    .split(CODE_SEPARATORS);
  const script = code.split(/['"]/).flatMap((part) => part.split(CODE_SEPARATORS));
  return [script.filter(Boolean), shell.filter(Boolean)];
}

/**
 * The command an argv word names: its last path component, less a Windows
 * executable suffix, lowercased. PowerShell and cmd resolve commands without
 * regard to case (`Choco`, `CHOCO`, `RunAs` run choco and runas), and so do the
 * default macOS and Windows file systems, so the sets it is looked up in are
 * matched case-insensitively. That holds for every word of inline code too, in
 * either reading (inlineReadings) and whatever role the word plays: a POSIX shell
 * variable (`SUDO=1`, `$APT`), a node or python identifier (`const APT = 1`), a
 * PowerShell variable (`$Su`), a word in a string (`"Run Brew later"`) or in a
 * comment. Each is refused as the command it spells: rename it or reword it.
 */
function commandName(word) {
  return word
    .split(/[\\/]/)
    .pop()
    .replace(/\.(exe|cmd|bat|com)$/i, '')
    .toLowerCase();
}

/**
 * PowerShell's `Start-Process ... -Verb RunAs` runs a program as administrator.
 * `-Verb RunAs` reads as two words and the second is HOST_PACKAGE_WORDS's runas;
 * this is the one-word form, `-Verb:RunAs`, any case and any quoting.
 */
const RUNAS_VERB = /^-verb:['"]?runas['"]?$/i;

/**
 * What in an argv would change the host, or null when nothing would:
 * `{ quoted, unreadable }`, where `quoted` is the words to quote in a failure and
 * `unreadable` says the argv runs code this rule cannot read at all.
 *
 * After an ambiguous manager the rule skips options (`apk --no-cache add`,
 * `port -N install`) and refuses when the first word that is not an option is a
 * host-changing subcommand. A word right after an option written without `=`
 * may be that option's VALUE (`apk -X <repository> add`), so when it is not
 * itself a host-changing subcommand the rule reads on to the next word. A bare
 * `apk` (a build target), `port 3000` and `--port 3000` all pass.
 *
 * After an interpreter's inline-code flag (`sh -c`, `node -e`, `python3 -c`,
 * `env -S`, INLINE_INTERPRETERS), the rule reads the code's words for the same
 * things, so `bash -c "sudo apt-get ..."` and `node -e "...execSync('apt-get ...')"`
 * are refused like the argv they hide. Code passed in a form the rule knows it
 * cannot read, encoded (`pwsh -EncodedCommand`) or from stdin (`bash -s`, a
 * lone `-`), is refused outright.
 *
 * LIMITS. It reads the manifest's argv, and the inline code of those
 * interpreters as words, and follows nothing else:
 * - a script FILE (`bash scripts/x.sh`, `node scripts/x.mjs`, `pwsh -File x.ps1`,
 *   a module node preloads with `-r` or `--import`) and a package.json or
 *   deno.json script (`npm run x`, `deno task x`, whose body may run
 *   `sudo apt-get ...`) pass it unread;
 * - inline code is read, never run, so a word the code BUILDS at run time
 *   passes: a variable or a command substitution inside a name
 *   (`ap${X}t-get`, `$(printf sudo)`), a glob (`/usr/bin/su?o`), a string
 *   concatenated in a script (`'su' + 'do'`), or decoded data;
 * - a program that runs a string as code but is not in INLINE_INTERPRETERS
 *   passes with its code unread: `awk 'BEGIN { system("...") }'`, `php -r`,
 *   `lua -e`, `Rscript -e`, `osascript -e`, `pnpm dlx -c`, `yarn exec`,
 *   `git -c alias.x='!...'`, `make --eval`.
 * Keep host-changing work out of the files and the package.json scripts a step
 * runs, and out of code a step builds.
 */
function hostChange(argv) {
  for (let t = 0; t < argv.length; t += 1) {
    const name = commandName(argv[t]);
    if (HOST_PACKAGE_WORDS.has(name) || RUNAS_VERB.test(argv[t])) {
      return { quoted: argv[t], unreadable: false };
    }
    const interpreter = INLINE_INTERPRETERS.get(name);
    if (interpreter) {
      const inline = inlineHostChange(argv, t, interpreter);
      if (inline) return inline;
    }
    const subcommands = AMBIGUOUS_PACKAGE_MANAGERS.get(name);
    if (!subcommands) continue;
    let mayBeOptionValue = false;
    for (let s = t + 1; s < argv.length; s += 1) {
      const word = argv[s];
      if (word.startsWith('-')) {
        mayBeOptionValue = !word.includes('=');
        continue;
      }
      if (subcommands.has(word)) {
        return { quoted: argv.slice(t, s + 1).join(' '), unreadable: false };
      }
      if (!mayBeOptionValue) break;
      mayBeOptionValue = false;
    }
  }
  return null;
}

/** The host change in `inline`, the words of code run by `prefix` (`bash -c`), or null. */
function codeHostChange(prefix, inline) {
  if (inline[0] === '-') return { quoted: `${prefix} -`, unreadable: true };
  for (const words of inlineReadings(inline.join(' '))) {
    const inner = hostChange(words);
    if (inner !== null) {
      return { quoted: `${prefix} … ${inner.quoted}`, unreadable: inner.unreadable };
    }
  }
  return null;
}

/**
 * The host change in the inline code of the interpreter at argv[t], or an
 * unreadable form of that code, or null. Its options are read until the first
 * word that is neither an option nor, possibly, an option's value: that word is
 * a script file, and what follows it belongs to the script (for PowerShell 5.1,
 * that word is the code).
 */
function inlineHostChange(argv, t, interpreter) {
  const {
    code,
    unreadable,
    skip,
    positional = false,
    slashOptions = false,
    dashIsStdin = true,
  } = interpreter;
  const isOption = (word) => word.startsWith('-') || (slashOptions && word.startsWith('/'));
  let via = argv[t];
  let mayBeOptionValue = false;
  for (let s = t + 1; s < argv.length; s += 1) {
    const word = argv[s];
    if ((dashIsStdin && word === '-') || unreadable?.test(word)) {
      return { quoted: `${via} ${word}`, unreadable: true };
    }
    const flag = code.exec(word);
    if (flag !== null) {
      const attached = flag.slice(1).find((group) => group !== undefined && group !== '');
      const shown =
        attached === undefined ? word : word.slice(0, -attached.length).replace(/[=:]$/, '');
      const inline = attached === undefined ? argv.slice(s + 1) : [attached, ...argv.slice(s + 1)];
      return codeHostChange(`${via} ${shown}`, inline);
    }
    if (skip?.test(word)) {
      via = `${via} ${word}`;
      continue;
    }
    if (isOption(word)) {
      mayBeOptionValue = !word.includes('=');
      continue;
    }
    if (positional) return codeHostChange(via, argv.slice(s));
    if (!mayBeOptionValue) return null;
    mayBeOptionValue = false;
  }
  return null;
}

/** `# parity: <job> "<step name>"` — the citation that binds a manifest step. */
const PARITY_CITATION = /^#\s*parity:\s*ci\.yml\s+([A-Za-z0-9_-]+)\s+"(.+)"\s*$/;

const failures = [];
const fail = (msg) => failures.push(msg);

// --- manifest: parse + validate against the runner's contract ---------------

function validateManifest(manifest) {
  for (const key of Object.keys(manifest)) {
    if (!MANIFEST_KEYS.has(key)) {
      fail(
        `ci.toml: unknown top-level key ${JSON.stringify(key)} — the runner parses with ` +
          `deny_unknown_fields and would reject the whole file`
      );
    }
  }

  if (manifest.version !== 1) {
    fail(`ci.toml: version must be exactly 1, got ${JSON.stringify(manifest.version)}`);
  }

  if (manifest.limits !== undefined) {
    for (const key of Object.keys(manifest.limits)) {
      if (!LIMITS_KEYS.has(key)) {
        fail(`ci.toml [limits]: unknown key ${JSON.stringify(key)}`);
      }
    }
  }

  const steps = manifest.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    fail('ci.toml: has no [[steps]] — nothing to run');
    return [];
  }

  steps.forEach((step, i) => {
    const label =
      typeof step.name === 'string' && step.name.trim() ? `step '${step.name}'` : `steps[${i}]`;

    for (const key of Object.keys(step)) {
      if (!STEP_KEYS.has(key)) {
        fail(`ci.toml ${label}: unknown key ${JSON.stringify(key)}`);
      }
    }

    if (typeof step.name !== 'string' || !step.name.trim()) {
      fail(`ci.toml ${label}: name must be a non-empty string`);
    }

    if (!Array.isArray(step.command) || step.command.length === 0) {
      fail(`ci.toml ${label}: command must be a non-empty argv array (never a shell string)`);
    } else {
      step.command.forEach((token, t) => {
        if (typeof token !== 'string') {
          fail(`ci.toml ${label}: command[${t}] must be a string`);
          return;
        }
        if (t === 0 && !token.trim()) {
          fail(`ci.toml ${label}: command[0] must be non-empty`);
        }
        const banned = ARGV_BANNED_CHARS.filter((c) => token.includes(c));
        if (banned.length > 0) {
          fail(
            `ci.toml ${label}: command token ${JSON.stringify(token)} contains banned shell ` +
              `metacharacter(s) ${JSON.stringify(banned.join(''))}`
          );
        }
      });
      // The no-root rule: HOST_PACKAGE_WORDS, AMBIGUOUS_PACKAGE_MANAGERS and
      // INLINE_INTERPRETERS, read by hostChange, which states the rule's limits.
      const change = step.command.every((token) => typeof token === 'string')
        ? hostChange(step.command)
        : null;
      if (change !== null && change.unreadable) {
        fail(
          `ci.toml ${label}: command ${JSON.stringify(change.quoted)} runs code this check ` +
            `cannot read (encoded, or from stdin), and this lane runs on a user's own machine, ` +
            `where that code could change the host or escalate to root (header items 1, 2 and ` +
            `9). Pass the code inline, or run it in a GitHub-hosted ci.yml job listed in ` +
            `EXCLUDED_JOBS instead.`
        );
      } else if (change !== null) {
        fail(
          `ci.toml ${label}: command ${JSON.stringify(change.quoted)} changes the host's system ` +
            `packages or escalates to root, and this lane runs on a user's own machine: it would ` +
            `fail every dispatch without passwordless sudo, or change the host for every other ` +
            `program on it (header items 1, 2 and 9). Run it in a GitHub-hosted ci.yml job ` +
            `listed in EXCLUDED_JOBS instead. Inline code is read word by word, case-` +
            `insensitively, so a variable, identifier, string or comment that spells one of ` +
            `these commands is refused too: if that is what was flagged, rename or reword it.`
        );
      }
    }

    if (step.env !== undefined) {
      for (const key of Object.keys(step.env)) {
        if (!ENV_ALLOWLIST.includes(key)) {
          fail(
            `ci.toml ${label}: env var ${JSON.stringify(key)} is not allowlisted ` +
              `(allowed: ${ENV_ALLOWLIST.join(', ')})`
          );
        }
      }
    }

    if (step.timeout_secs !== undefined) {
      const t = step.timeout_secs;
      if (!Number.isInteger(t) || t < 1 || t > MAX_STEP_TIMEOUT_SECS) {
        fail(`ci.toml ${label}: timeout_secs ${t} out of range (1..=${MAX_STEP_TIMEOUT_SECS})`);
      }
    }

    if (step.working_dir !== undefined) {
      const wd = step.working_dir;
      if (typeof wd !== 'string' || !wd) {
        fail(`ci.toml ${label}: working_dir must be a non-empty string`);
      } else if (
        path.posix.isAbsolute(wd) ||
        wd.startsWith('/') ||
        wd.startsWith('\\') ||
        wd.includes(':')
      ) {
        fail(`ci.toml ${label}: working_dir ${JSON.stringify(wd)} must be repo-relative`);
      } else if (wd.split(/[\\/]/).some((c) => c === '..')) {
        fail(
          `ci.toml ${label}: working_dir ${JSON.stringify(wd)} must not contain parent components`
        );
      } else if (!fs.existsSync(path.join(REPO_ROOT, wd))) {
        // Not a runner rule — the executor canonicalizes at run time and would
        // fail there. Catching it here turns a dispatch-time failure on a user's
        // machine into a PR-time one.
        fail(`ci.toml ${label}: working_dir ${JSON.stringify(wd)} does not exist in the repo`);
      }
    }
  });

  return steps;
}

/**
 * Read each step's `# parity:` citation out of the raw TOML.
 *
 * The citation cannot be a TOML key: the runner parses `[[steps]]` with
 * `deny_unknown_fields`, so any extra key would make the whole manifest
 * unrunnable. A comment is the only place it can live, which is why this is a
 * text scan rather than a lookup on the parsed object.
 */
function readParityCitations(text) {
  const lines = text.split(/\r?\n/);
  const citations = [];
  let index = -1;

  for (const line of lines) {
    if (/^\s*\[\[steps\]\]\s*$/.test(line)) {
      index += 1;
      citations[index] = null;
      continue;
    }
    if (index < 0) continue;
    // A new top-level table ends the steps region.
    if (/^\s*\[[^[]/.test(line)) break;

    const m = line.match(PARITY_CITATION);
    if (m) {
      if (citations[index]) {
        fail(`ci.toml steps[${index}]: more than one "# parity:" citation`);
      }
      citations[index] = { job: m[1], name: m[2] };
    }
  }

  return citations;
}

// --- workflow: the steps the manifest must mirror ---------------------------

function readWorkflowSteps(workflow) {
  const jobs = workflow.jobs || {};
  const self = path.relative(REPO_ROOT, __filename).replace(/\\/g, '/');

  for (const jobName of Object.keys(jobs)) {
    if (!MIRRORED_JOBS.includes(jobName) && !EXCLUDED_JOBS.has(jobName)) {
      fail(
        `ci.yml job ${JSON.stringify(jobName)} is neither mirrored into .qontinui/ci.toml nor ` +
          `declared as excluded. Add its gate steps to the manifest, or add it to EXCLUDED_JOBS ` +
          `in ${self} with the reason it cannot run on the local-CI lane (and record that reason ` +
          `in the manifest header too).`
      );
    }
  }

  // A declared exclusion outlives the job it excuses unless something says so.
  // Left unchecked, the reasons in EXCLUDED_JOBS become folklore about jobs that
  // no longer exist — and the next reader trusts them.
  for (const [jobName, reason] of EXCLUDED_JOBS) {
    if (!(jobName in jobs)) {
      fail(
        `EXCLUDED_JOBS in ${self} still excuses ci.yml job ${JSON.stringify(jobName)}, which ` +
          `ci.yml no longer defines. Drop the entry — and drop the matching paragraph from ` +
          `.qontinui/ci.toml's "WHAT THIS MANIFEST CANNOT EXPRESS" header.`
      );
    } else if (VERBOSE) {
      process.stdout.write(`  --  ${jobName} deliberately not mirrored: ${reason}\n`);
    }
  }

  const expected = [];
  for (const jobName of MIRRORED_JOBS) {
    const job = jobs[jobName];
    if (!job) {
      fail(`ci.yml has no job ${JSON.stringify(jobName)}, but the manifest mirrors it`);
      continue;
    }
    for (const step of job.steps || []) {
      if (typeof step.run !== 'string') continue; // `uses:` steps have no command
      expected.push({
        job: jobName,
        name: typeof step.name === 'string' ? step.name : '',
        run: step.run.trim(),
        workingDir: step['working-directory'],
      });
    }
  }
  return expected;
}

// --- the parity comparison --------------------------------------------------

function checkParity(steps, citations, expected) {
  const cited = [];
  steps.forEach((step, i) => {
    if (!citations[i]) {
      fail(
        `ci.toml steps[${i}] ('${step.name}') has no "# parity:" citation. Every manifest step ` +
          `must name the ci.yml step it mirrors, e.g. ` +
          `\`# parity: ci.yml lint-and-test "Install dependencies"\`.`
      );
      return;
    }
    cited.push({ index: i, step, citation: citations[i] });
  });

  if (cited.length !== expected.length) {
    fail(
      `Parity drift: ci.yml's mirrored jobs (${MIRRORED_JOBS.join(', ')}) have ${expected.length} ` +
        `command step(s); .qontinui/ci.toml cites ${cited.length}. The manifest must mirror them ` +
        `step for step and in order — update it in the SAME PR that changed ci.yml.`
    );
  }

  const pairs = Math.min(cited.length, expected.length);
  for (let i = 0; i < pairs; i += 1) {
    const { step, citation } = cited[i];
    const want = expected[i];
    const label = `ci.toml step '${step.name}'`;

    if (citation.job !== want.job || citation.name !== want.name) {
      fail(
        `${label}: cites ci.yml ${citation.job} "${citation.name}" but position ${i} of the ` +
          `mirrored jobs is ${want.job} "${want.name}". Order is part of the invariant — the ` +
          `cheap ratchets run before Lint on purpose.`
      );
      continue;
    }

    if (want.run.includes('\n')) {
      fail(
        `${label}: ci.yml ${want.job} "${want.name}" is a multi-line shell block, which no argv ` +
          `manifest step can express. Either keep it out of a mirrored job or declare the job ` +
          `excluded with a reason.`
      );
      continue;
    }

    const argv = Array.isArray(step.command) ? step.command.join(' ') : '';
    if (argv !== want.run) {
      fail(
        `${label}: command ${JSON.stringify(argv)} does not match ci.yml ${want.job} ` +
          `"${want.name}" which runs ${JSON.stringify(want.run)}.`
      );
    }

    const manifestDir = step.working_dir ?? null;
    const actionsDir = want.workingDir ?? null;
    if (manifestDir !== actionsDir) {
      fail(
        `${label}: working_dir ${JSON.stringify(manifestDir)} does not match ci.yml ` +
          `${want.job} "${want.name}" working-directory ${JSON.stringify(actionsDir)}.`
      );
    }

    if (VERBOSE) {
      process.stdout.write(`  ok  ${want.job} "${want.name}" -> '${step.name}' (${argv})\n`);
    }
  }
}

/**
 * `npm run <script>` is only as stable as the script's name. A rename in
 * package.json leaves ci.yml and the manifest both citing a script that no
 * longer exists — Actions would fail loudly, but only after the merge.
 */
function checkNpmScriptsResolve(steps) {
  const scriptsCache = new Map();
  const scriptsFor = (dir) => {
    if (!scriptsCache.has(dir)) {
      const pkgPath = path.join(REPO_ROOT, dir, 'package.json');
      const scripts = fs.existsSync(pkgPath)
        ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')).scripts || {}
        : null;
      scriptsCache.set(dir, scripts);
    }
    return scriptsCache.get(dir);
  };

  for (const step of steps) {
    if (!Array.isArray(step.command)) continue;
    const [bin, sub, name] = step.command;
    if (bin !== 'npm' || sub !== 'run' || typeof name !== 'string') continue;

    const dir = step.working_dir ?? '.';
    const scripts = scriptsFor(dir);
    if (!scripts) {
      fail(
        `ci.toml step '${step.name}': no package.json at ${dir}/ to resolve \`npm run ${name}\``
      );
      continue;
    }
    if (!(name in scripts)) {
      fail(
        `ci.toml step '${step.name}': \`npm run ${name}\` has no matching script in ` +
          `${dir === '.' ? 'package.json' : `${dir}/package.json`}`
      );
    }
  }
}

// --- main -------------------------------------------------------------------

function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    process.stderr.write(
      `Missing .qontinui/ci.toml — this repo declares a local-CI manifest and it is the only\n` +
        `source of commands for the runner-as-CI-node lane. Restore it rather than deleting it;\n` +
        `a repo without one cannot run on that lane at all.\n`
    );
    process.exit(1);
  }

  const text = fs.readFileSync(MANIFEST_PATH, 'utf8');

  let manifest;
  try {
    manifest = TOML.parse(text);
  } catch (e) {
    process.stderr.write(`.qontinui/ci.toml is not valid TOML: ${e.message}\n`);
    process.exit(1);
  }

  const steps = validateManifest(manifest);
  const citations = readParityCitations(text);

  const workflow = YAML.parse(fs.readFileSync(WORKFLOW_PATH, 'utf8'));
  const expected = readWorkflowSteps(workflow);

  checkParity(steps, citations, expected);
  checkNpmScriptsResolve(steps);

  if (failures.length > 0) {
    process.stderr.write(`\nCI manifest ratchet failed (${failures.length} problem(s)):\n\n`);
    for (const f of failures) process.stderr.write(`  - ${f}\n`);
    process.stderr.write(
      `\nThe manifest at .qontinui/ci.toml is what the product's local-CI lane executes.\n` +
        `Its header states the invariant this check enforces: the steps mirror ci.yml's\n` +
        `\`${MIRRORED_JOBS.join('` and `')}\` jobs, step for step and in their order, and change in the SAME PR.\n`
    );
    process.exit(1);
  }

  process.stdout.write(
    `CI manifest ok: ${steps.length} step(s) valid against the runner's contract and in parity ` +
      `with ci.yml's ${MIRRORED_JOBS.join(' + ')} jobs.\n`
  );
}

// Run the check only when invoked as a script. Requiring this module, which
// check-ci-manifest.test.cjs does to pin the no-root rule directly, must not
// start a check or set an exit code. Same split as check-docs-symbols.cjs.
const isEntry = require.main === module;

// If that detection went wrong the ratchet would do NOTHING and exit 0. A real
// run is `node scripts/check-ci-manifest.cjs`, so argv[1] naming this file while
// `require.main` does not is a misfire, and it refuses rather than passing.
if (!isEntry && process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  throw new Error(
    `check-ci-manifest.cjs was invoked as ${JSON.stringify(process.argv[1])} but did not ` +
      'detect itself as the entry module. Refusing to exit 0 without running the check.'
  );
}

// The rule itself, for the test beside this file: a test that re-implemented it
// would pin the re-implementation.
module.exports = { hostChange };

if (isEntry) main();
