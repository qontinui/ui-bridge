// The match-based half of the redaction-surface ratchet
// (scripts/check-redaction-surface.cjs).
//
// The text half of the ratchet only sees config blocks that spell a
// `packages/ui-bridge/src/` literal. A block that reaches SDK source through
// any other pattern — `**/density/**`, `**/*.ts`, `packages/*/src/**`, a block
// with no `files` at all, or a spread copy of a block that does name a literal
// — could set `no-restricted-syntax` and so REPLACE the §4.6 Layer-1 selectors
// for those files (flat config does not merge one rule across blocks), or a
// global ignore could drop SDK files from linting altogether, and the text
// half would not notice.
//
// So this half decides by what a block MATCHES, using ESLint's own config
// resolution (`ESLint#calculateConfigForFile` / `#isPathIgnored`) on the
// loaded config array, against the tracked SDK source files:
//
//   1. Exactly one block is the sanctioned Layer-1 block (files = the Layer-1
//      pair, ignores = the package-guard-exemptions list) and exactly one is
//      the sanctioned projection block (files / ignores = the two Layer-2
//      lists). Each holds only files / ignores / rules (+ name), sets only
//      `no-restricted-syntax` at `error`, the projection block re-declares
//      every Layer-1 selector, and comes after the Layer-1 block.
//   2. Every OTHER block that sets `no-restricted-syntax` (to anything,
//      including 'off') is probed: if it reaches even one SDK source file it
//      is refused, however its `files` are written.
//   3. The SDK files the whole config ignores are returned, so the caller can
//      ratchet them against the committed manifest.
//   4. What actually RUNS is observed, not inferred: for every SDK file the
//      sanctioned Layer-1 (or projection) block reaches, a canary carrying one
//      violation per selector is linted with `lintText` through the same
//      config lookup the CLI uses (so a nested `eslint.config.*`, a processor,
//      a parser or a language override that blanks the code is seen), and
//      every one of that block's selector messages must come back.
//   5. The sanctioned blocks' selector lists are returned, so the caller can
//      ratchet them (dropping a selector family from both blocks at once
//      would otherwise pass every structural check above).
//
// Plan 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change
// (follow-up 0df8fd16; coord finding 9e2ca54a).

'use strict';

const path = require('node:path');

const RULE = 'no-restricted-syntax';
const SANCTIONED_KEYS = new Set(['files', 'ignores', 'rules', 'name']);
/** Matching-only keys copied into a probe; everything else cannot change what a block reaches. */
const MATCH_KEYS = ['files', 'ignores', 'basePath'];
const PROBE_MESSAGE = 'redaction-guard-reach probe';
const MAX_EXAMPLES = 3;

/**
 * One violation of every §4.6 Layer-1 selector (and, at the end, the two
 * Layer-2 reads). Linted as each guarded file's text, never written to disk.
 * A selector added to the sanctioned blocks without a matching line here makes
 * every guarded file miss it: extend this canary.
 */
const CANARY = [
  'declare const el: any;',
  'declare const x: unknown;',
  'type Scrubbed = string;',
  "el.className.split(' ');",
  'el?.className.trim();',
  "el.getAttribute('aria-label');",
  'void el.innerText;',
  'void (x as Scrubbed);',
  'void el.__reactProps$canary;',
  "void ('disabled' in el);",
  'void (el as HTMLButtonElement).disabled;',
  'void el.ariaDisabled;',
  "el.getAttribute('aria-disabled');",
  'void getComputedStyle(el).pointerEvents;',
  'void el.value;',
  'void el.textContent;',
  '',
].join('\n');

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Order-free equality of a block's pattern list with an expected string list. */
function sameStrings(actual, expected) {
  if (!Array.isArray(actual)) return false;
  if (!actual.every((s) => typeof s === 'string')) return false;
  const a = new Set(actual);
  const e = new Set(expected);
  return a.size === e.size && [...e].every((s) => a.has(s));
}

function describeBlock(block, index) {
  const label = typeof block.name === 'string' ? ` "${block.name}"` : '';
  let files;
  if (!('files' in block)) files = 'no `files` (every linted file)';
  else {
    try {
      files = `files ${JSON.stringify(block.files)}`;
    } catch {
      files = 'files <unprintable>';
    }
    if (files.length > 120) files = files.slice(0, 117) + '...';
  }
  return `config block #${index}${label} (${files})`;
}

function setsRule(block) {
  return isPlainObject(block.rules) && Object.prototype.hasOwnProperty.call(block.rules, RULE);
}

/** The selector entries of a rule value, or null when it is not an enabled error. */
function errorEntries(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (value[0] !== 'error' && value[0] !== 2) return null;
  return value.slice(1);
}
/** `[severity, ...selectors]` of a rule value as selector strings, or null. */
function errorSelectors(value) {
  const entries = errorEntries(value);
  return entries && entries.map((s) => (isPlainObject(s) ? s.selector : s));
}
/** The messages a block's selectors report: what the canary must see come back. */
function selectorMessages(block) {
  const entries = errorEntries(block.rules && block.rules[RULE]) || [];
  return [...new Set(entries.map((s) => (isPlainObject(s) && s.message) || null))];
}

/** Repo-relative files among `abs` that `block` reaches (a marker-rule probe). */
async function probeReach(Eslint, cwd, globalIgnores, block, abs, rel) {
  const probe = {};
  for (const k of MATCH_KEYS) if (k in block) probe[k] = block[k];
  probe.rules = { [RULE]: ['error', { selector: 'Program', message: PROBE_MESSAGE }] };
  const eslint = new Eslint({
    cwd,
    overrideConfigFile: true,
    overrideConfig: [{ files: ['**/*.ts', '**/*.tsx'] }, ...globalIgnores, probe],
  });
  const reached = [];
  for (const f of abs) {
    const cfg = await eslint.calculateConfigForFile(f);
    const value = cfg && cfg.rules && cfg.rules[RULE];
    if (
      Array.isArray(value) &&
      value.some((s) => isPlainObject(s) && s.message === PROBE_MESSAGE)
    ) {
      reached.push(rel(f));
    }
  }
  return reached;
}

/** Problems with one sanctioned block's shape; `[]` when it is sound. */
function sanctionedShapeProblems(block, what) {
  const problems = [];
  for (const key of Object.keys(block)) {
    if (!SANCTIONED_KEYS.has(key)) {
      problems.push(`the ${what} has key \`${key}\`; it may hold only files, ignores, rules`);
    }
  }
  const rules = isPlainObject(block.rules) ? Object.keys(block.rules) : null;
  if (!rules || rules.length !== 1 || rules[0] !== RULE) {
    problems.push(`the ${what} must set exactly one rule, \`${RULE}\``);
  }
  return problems;
}

function findUnique(configs, predicate, what, problems) {
  const hits = [];
  configs.forEach((b, i) => {
    if (isPlainObject(b) && predicate(b)) hits.push(i);
  });
  if (hits.length === 0) {
    problems.push(`no config block is the ${what} (its files/ignores no longer match the lists)`);
    return -1;
  }
  if (hits.length > 1) {
    problems.push(
      `the ${what} appears ${hits.length} times (blocks #${hits.join(', #')}); a copy of it can ` +
        `replace its selectors — keep exactly one`
    );
    return -1;
  }
  return hits[0];
}

/**
 * @param {object} opts
 * @param {unknown[]} opts.configs   the flattened config array eslint.config.js exports
 * @param {string}    opts.cwd       the repo root (the base path of every pattern)
 * @param {string[]}  opts.sdkFiles  repo-relative SDK source files (tracked .ts/.tsx under packages/ui-bridge/src)
 * @param {{layer1Files: string[], layer1Ignores: string[], projectionFiles: string[], projectionIgnores: string[]}} opts.sanctioned
 * @param {object} [opts.lintOptions]  ESLint constructor options for what actually RUNS (the
 *   canary and the ignore census). The CLI passes `{ cwd }`, i.e. ESLint's own per-file config
 *   lookup, nested `eslint.config.*` files included; a self-test passes an in-memory override.
 *   Default: the `configs` array itself.
 * @param {typeof import('eslint').ESLint} [opts.ESLint]
 * @returns {Promise<{problems: string[], ignoredSdkFiles: string[], layer1Selectors: string[], projectionSelectors: string[]}>}
 */
async function guardReachProblems({ configs, cwd, sdkFiles, sanctioned, lintOptions, ESLint }) {
  const Eslint = ESLint || require('eslint').ESLint;
  const problems = [];
  const empty = { ignoredSdkFiles: [], layer1Selectors: [], projectionSelectors: [] };
  if (!Array.isArray(configs)) {
    return { problems: ['eslint.config.js does not export a config array'], ...empty };
  }
  if (!Array.isArray(sdkFiles) || sdkFiles.length === 0) {
    return { problems: ['no SDK source files to check against (fail closed)'], ...empty };
  }
  configs.forEach((b, i) => {
    if (!isPlainObject(b)) problems.push(`config block #${i} is not a plain object`);
  });

  // 1. The two sanctioned blocks, identified by their ratcheted lists.
  const l1 = findUnique(
    configs,
    (b) =>
      sameStrings(b.files, sanctioned.layer1Files) &&
      sameStrings(b.ignores, sanctioned.layer1Ignores),
    'sanctioned Layer-1 block',
    problems
  );
  const proj = findUnique(
    configs,
    (b) =>
      sameStrings(b.files, sanctioned.projectionFiles) &&
      sameStrings(b.ignores, sanctioned.projectionIgnores),
    'sanctioned projection block',
    problems
  );
  let l1Selectors = null;
  let projSelectorList = [];
  if (l1 !== -1) {
    problems.push(...sanctionedShapeProblems(configs[l1], 'sanctioned Layer-1 block'));
    l1Selectors = errorSelectors(configs[l1].rules && configs[l1].rules[RULE]);
    if (!l1Selectors || l1Selectors.length === 0) {
      problems.push(`the sanctioned Layer-1 block must set \`${RULE}\` to ['error', ...selectors]`);
      l1Selectors = null;
    }
  }
  if (proj !== -1) {
    problems.push(...sanctionedShapeProblems(configs[proj], 'sanctioned projection block'));
    const projSelectors = errorSelectors(configs[proj].rules && configs[proj].rules[RULE]);
    if (projSelectors) projSelectorList = projSelectors;
    if (!projSelectors) {
      problems.push(
        `the sanctioned projection block must set \`${RULE}\` to ['error', ...selectors]`
      );
    } else if (l1Selectors) {
      const have = new Set(projSelectors);
      const missing = l1Selectors.filter((s) => !have.has(s));
      if (missing.length) {
        problems.push(
          `the sanctioned projection block drops ${missing.length} Layer-1 selector(s); it REPLACES ` +
            `the Layer-1 value for its files, so it must re-declare every one`
        );
      }
    }
  }
  if (l1 !== -1 && proj !== -1 && proj < l1) {
    problems.push(
      'the sanctioned projection block comes before the Layer-1 block, so the Layer-1 value ' +
        'replaces the Layer-2 selectors for every projection module'
    );
  }

  const abs = sdkFiles.map((f) => path.resolve(cwd, f));
  const rel = (p) => path.relative(cwd, p).split(path.sep).join('/');
  // Global ignores take part in every probe: a file nothing lints is not
  // reached (it is ratcheted through `ignoredSdkFiles` instead).
  const globalIgnores = configs.filter(
    (b) =>
      isPlainObject(b) &&
      Object.keys(b).every((k) => k === 'ignores' || k === 'name' || k === 'basePath') &&
      'ignores' in b
  );

  // 2. Every other block that sets the rule: refused if it reaches SDK source.
  for (let i = 0; i < configs.length; i++) {
    const block = configs[i];
    if (i === l1 || i === proj || !isPlainObject(block) || !setsRule(block)) continue;
    let reached;
    try {
      reached = await probeReach(Eslint, cwd, globalIgnores, block, abs, rel);
    } catch (e) {
      problems.push(
        `${describeBlock(block, i)} sets \`${RULE}\` and could not be resolved: ${e.message}`
      );
      continue;
    }
    if (reached.length) {
      // Name guarded source before tests in the examples: it is what the
      // override actually unguards.
      const isTest = (f) => /\/__tests__\/|\.test\.tsx?$/.test(f);
      reached.sort((a, b) => Number(isTest(a)) - Number(isTest(b)));
      problems.push(
        `${describeBlock(block, i)} sets \`${RULE}\` and reaches ${reached.length} SDK source ` +
          `file(s) (e.g. ${reached.slice(0, MAX_EXAMPLES).join(', ')}). For those files it ` +
          `REPLACES or erases the §4.6 Layer-1 selectors; only the sanctioned Layer-1 and ` +
          `projection blocks may set \`${RULE}\` for packages/ui-bridge/src`
      );
    }
  }

  // 3. SDK files the config ignores (linted by nothing), through the lookup
  // that actually runs.
  const ignoredSdkFiles = [];
  let whole = null;
  try {
    whole = new Eslint(lintOptions || { cwd, overrideConfigFile: true, overrideConfig: configs });
    for (const f of abs) if (await whole.isPathIgnored(f)) ignoredSdkFiles.push(rel(f));
  } catch (e) {
    problems.push(`could not resolve which SDK files the config ignores: ${e.message}`);
    whole = null;
  }

  // 4. The canary: every selector of the sanctioned block that reaches a file
  // must actually report on that file, through the lookup that runs. A nested
  // config file, a processor, a parser or a language override that switches
  // the guard off shows up here as missing messages, whatever its shape.
  if (whole && l1 !== -1) {
    const ignored = new Set(ignoredSdkFiles);
    const targets = new Map(); // rel file -> messages it must report
    let resolved = true;
    try {
      const l1Messages = selectorMessages(configs[l1]);
      for (const f of await probeReach(Eslint, cwd, globalIgnores, configs[l1], abs, rel)) {
        targets.set(f, l1Messages);
      }
      if (proj !== -1) {
        const projMessages = selectorMessages(configs[proj]);
        for (const f of await probeReach(Eslint, cwd, globalIgnores, configs[proj], abs, rel)) {
          targets.set(f, projMessages);
        }
      }
    } catch (e) {
      resolved = false;
      problems.push(`could not resolve which SDK files the sanctioned blocks reach: ${e.message}`);
    }
    if (resolved && targets.size === 0) {
      problems.push('the sanctioned Layer-1 block reaches no SDK source file (fail closed)');
    }
    const unguarded = [];
    for (const [f, required] of targets) {
      if (ignored.has(f)) continue; // ratcheted as globallyIgnoredSources
      let reported;
      try {
        const [result] = await whole.lintText(CANARY, { filePath: path.resolve(cwd, f) });
        if (!result) throw new Error('no lint result');
        const fatal = result.messages.find((m) => m.fatal);
        if (fatal) throw new Error(`the canary did not parse: ${fatal.message}`);
        reported = new Set(result.messages.filter((m) => m.ruleId === RULE).map((m) => m.message));
      } catch (e) {
        problems.push(`could not lint the §4.6 canary as ${f}: ${e.message}`);
        break;
      }
      const missing = required.filter((m) => !reported.has(m));
      if (missing.length) unguarded.push({ f, missing });
    }
    if (unguarded.length) {
      const first = unguarded[0];
      const examples = unguarded
        .slice(0, MAX_EXAMPLES)
        .map((u) => u.f)
        .join(', ');
      problems.push(
        `${unguarded.length} guarded SDK file(s) do not report every §4.6 selector when the ` +
          `canary is linted as them (e.g. ${examples}; ${first.f} misses ${first.missing.length}, ` +
          `first: ${JSON.stringify(String(first.missing[0]).slice(0, 80))}). Something switches ` +
          `the guard off for them (a nested eslint.config.*, a processor, a parser or a language ` +
          `override). If EVERY file misses the same new selector, extend CANARY in ` +
          `scripts/lib/redaction-guard-reach.cjs`
      );
    }
  }

  return {
    problems,
    ignoredSdkFiles: ignoredSdkFiles.sort(),
    layer1Selectors: [...new Set(l1Selectors || [])].sort(),
    projectionSelectors: [...new Set(projSelectorList)].sort(),
  };
}

module.exports = { guardReachProblems, PROBE_MESSAGE, CANARY };
