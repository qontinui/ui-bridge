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

/** `[severity, ...selectors]` of a rule value, or null when it is not an enabled error. */
function errorSelectors(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (value[0] !== 'error' && value[0] !== 2) return null;
  return value.slice(1).map((s) => (isPlainObject(s) ? s.selector : s));
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
 * @param {typeof import('eslint').ESLint} [opts.ESLint]
 * @returns {Promise<{problems: string[], ignoredSdkFiles: string[]}>}
 */
async function guardReachProblems({ configs, cwd, sdkFiles, sanctioned, ESLint }) {
  const Eslint = ESLint || require('eslint').ESLint;
  const problems = [];
  if (!Array.isArray(configs)) {
    return { problems: ['eslint.config.js does not export a config array'], ignoredSdkFiles: [] };
  }
  if (!Array.isArray(sdkFiles) || sdkFiles.length === 0) {
    return {
      problems: ['no SDK source files to check against (fail closed)'],
      ignoredSdkFiles: [],
    };
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
      Object.keys(b).every((k) => k === 'ignores' || k === 'name') &&
      'ignores' in b
  );

  // 2. Every other block that sets the rule: refused if it reaches SDK source.
  for (let i = 0; i < configs.length; i++) {
    const block = configs[i];
    if (i === l1 || i === proj || !isPlainObject(block) || !setsRule(block)) continue;
    const probe = {};
    for (const k of MATCH_KEYS) if (k in block) probe[k] = block[k];
    probe.rules = { [RULE]: ['error', { selector: 'Program', message: PROBE_MESSAGE }] };
    let eslint;
    try {
      eslint = new Eslint({
        cwd,
        overrideConfigFile: true,
        overrideConfig: [{ files: ['**/*.ts', '**/*.tsx'] }, ...globalIgnores, probe],
      });
    } catch (e) {
      problems.push(
        `${describeBlock(block, i)} sets \`${RULE}\` and could not be resolved: ${e.message}`
      );
      continue;
    }
    const reached = [];
    for (const f of abs) {
      let cfg;
      try {
        cfg = await eslint.calculateConfigForFile(f);
      } catch (e) {
        problems.push(
          `${describeBlock(block, i)} could not be resolved for ${rel(f)}: ${e.message}`
        );
        break;
      }
      const value = cfg && cfg.rules && cfg.rules[RULE];
      const hit =
        Array.isArray(value) && value.some((s) => isPlainObject(s) && s.message === PROBE_MESSAGE);
      if (hit) reached.push(rel(f));
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

  // 3. SDK files the whole config ignores (linted by nothing).
  const ignoredSdkFiles = [];
  try {
    const whole = new Eslint({ cwd, overrideConfigFile: true, overrideConfig: configs });
    for (const f of abs) if (await whole.isPathIgnored(f)) ignoredSdkFiles.push(rel(f));
  } catch (e) {
    problems.push(`could not resolve which SDK files the config ignores: ${e.message}`);
  }
  return { problems, ignoredSdkFiles: ignoredSdkFiles.sort() };
}

module.exports = { guardReachProblems, PROBE_MESSAGE };
