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
//      Every SDK file must also resolve the ROOT config file: a nested config
//      exporting `[]` leaves its files matched by nothing, which reads as
//      ignored rather than unguarded. And the rule value each guarded file
//      resolves must carry exactly the sanctioned selectors, so the messages
//      cannot be re-emitted by weaker ones.
//   5. The sanctioned blocks' selector lists are returned, so the caller can
//      ratchet them (dropping a selector family from both blocks at once
//      would otherwise pass every structural check above).
//   6. Inline configuration in the guarded files themselves cannot switch the
//      guard off. The canary above is synthetic text, so it never sees a
//      `/* eslint no-restricted-syntax: off */`, a `/* eslint-disable */` or
//      an `// eslint-disable-next-line no-restricted-syntax` sitting in a real
//      SDK file — and eslint.config.js does not set `noInlineConfig`, because
//      packages/ui-bridge/src carries legitimate directives for OTHER rules
//      (count them: `git grep -n 'eslint-disable' -- packages/ui-bridge/src`).
//      So every guarded file's REAL text is linted with the rule set to a
//      nonce-tagged `*` probe (one report per node) through the same lookup,
//      inline config allowed exactly as the CLI allows it, and any probe
//      report the file's own comments suppress, re-severity or replace is
//      refused, whatever the directive's spelling. Directives that name other
//      rules are untouched. A positive control proves on every run that the
//      detector still sees each directive form (`INLINE_DIRECTIVE_CONTROLS`,
//      returned so the caller can ratchet the list). `suppressionProblems`
//      covers the comment-free twin: ESLint's bulk `eslint-suppressions.json`,
//      which the CLI applies by default and the API only under
//      `applySuppressions: true` (the probe does not set it), plus the eslint
//      CLI flags that change the guard without a comment.
//
// Plan 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change
// (follow-up 0df8fd16; coord finding 9e2ca54a; follow-up e9c61900 for step 6).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const RULE = 'no-restricted-syntax';
const SANCTIONED_KEYS = new Set(['files', 'ignores', 'rules', 'name']);
/** Matching-only keys copied into a probe; everything else cannot change what a block reaches. */
const MATCH_KEYS = ['files', 'ignores', 'basePath'];
const PROBE_MESSAGE = 'redaction-guard-reach probe';
const MAX_EXAMPLES = 3;

/**
 * Every inline-configuration shape that can switch `no-restricted-syntax` off
 * (or weaken it) for the code it covers. Each one is prepended to the canary
 * on every run and must be refused by `inlineSuppression`: a positive control
 * that the detector is not vacuous. Ratcheted by the caller, so dropping a
 * form is a manifest change.
 */
const INLINE_DIRECTIVE_CONTROLS = [
  `/* eslint ${RULE}: off */`,
  `/* eslint ${RULE}: warn */`,
  `/* eslint ${RULE}: ["error", { "selector": "DebuggerStatement" }] */`,
  '/* eslint-disable */',
  `/* eslint-disable ${RULE} */`,
  `/* eslint-disable ${RULE} -- with a justification */`,
  `// eslint-disable-next-line ${RULE}`,
  `/* eslint-disable-next-line ${RULE} */`,
  '// eslint-disable-next-line',
  // Shapes that need code on their own line, or a range: each is a prefix of
  // complete lines, so it still precedes the canary.
  `void 0; // eslint-disable-line ${RULE}`,
  `void 0; /* eslint-disable-line no-console, ${RULE} */`,
  `/* eslint-disable no-console, ${RULE} */`,
  `/* eslint-disable ${RULE} */\nvoid 0;\n/* eslint-enable ${RULE} */`,
];

/**
 * What a file's own inline configuration did to the nonce-tagged `*` probe,
 * or null when it did nothing. `result` is one ESLint lint result.
 */
function inlineSuppression(result, nonce) {
  const fatal = result.messages.find((m) => m.fatal);
  if (fatal) return `does not parse (${fatal.message}), so its directives cannot be read`;
  const suppressed = (result.suppressedMessages || []).filter((m) => m.ruleId === RULE);
  if (suppressed.length) {
    const lines = [...new Set(suppressed.map((m) => m.line))].sort((a, b) => a - b);
    const shown =
      lines.slice(0, MAX_EXAMPLES).join(', ') + (lines.length > MAX_EXAMPLES ? ', ...' : '');
    return `an eslint-disable directive suppresses \`${RULE}\` on ${lines.length} line(s) (${shown})`;
  }
  const own = result.messages.filter((m) => m.ruleId === RULE);
  if (own.length === 0) {
    return `an inline \`/* eslint ${RULE}: ... */\` comment switches the rule off or replaces its selectors`;
  }
  if (own.some((m) => m.message !== nonce)) {
    return `an inline \`/* eslint ${RULE}: ... */\` comment replaces its selectors`;
  }
  if (own.some((m) => m.severity !== 2)) {
    return `an inline \`/* eslint ${RULE}: ... */\` comment lowers it below error`;
  }
  return null;
}

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
 * @param {string} [opts.rootConfigFile]  with a lookup `lintOptions`, the config file every SDK
 *   file must resolve (absolute); any other — a nested `eslint.config.*` — is refused.
 * @param {{suppressionFiles: {rel: string, text: string}[], packageFiles: {rel: string, text: string}[], workflowFiles?: {rel: string, text: string}[], ciTomlFiles?: {rel: string, text: string}[], srcPrefix: string}} [opts.suppressionInputs]
 *   the tracked files `suppressionProblems` reads (see `trackedSuppressionInputs`). REQUIRED
 *   with `rootConfigFile` (the CLI's mode): omitting them there is a problem, so a caller that
 *   drops the comment-free half fails rather than passing.
 * @param {(relFile: string) => string} [opts.readSource]  a guarded file's real text, for the
 *   inline-configuration check. Default: read it from disk under `cwd`; a self-test injects text.
 * @param {typeof import('eslint').ESLint} [opts.ESLint]
 * @returns {Promise<{problems: string[], sourceBypassProblems: string[], ignoredSdkFiles: string[], layer1Selectors: string[], projectionSelectors: string[], inlineDirectiveControls: string[]}>}
 *   `problems` are eslint.config.js defects; `sourceBypassProblems` are the guard switched off
 *   from outside it (an SDK file's inline config, a suppressions file, a lint flag).
 */
async function guardReachProblems({
  configs,
  cwd,
  sdkFiles,
  sanctioned,
  lintOptions,
  rootConfigFile,
  readSource,
  suppressionInputs,
  ESLint,
}) {
  const Eslint = ESLint || require('eslint').ESLint;
  const read = readSource || ((f) => fs.readFileSync(path.resolve(cwd, f), 'utf8'));
  const problems = [];
  // Steps 6 and 7: the guard switched off from OUTSIDE eslint.config.js (an
  // SDK file's own comments, a suppressions file, a lint flag), reported apart.
  const sourceBypassProblems = [];
  const empty = {
    sourceBypassProblems: [],
    ignoredSdkFiles: [],
    layer1Selectors: [],
    projectionSelectors: [],
    inlineDirectiveControls: [],
  };
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

  // 3b. Every SDK file must resolve the ROOT config file. A nested
  // `eslint.config.*` replaces the root config for the files under it, and
  // one exporting `[]` or `[{}]` leaves them matched by nothing — which reads
  // as "ignored" above and so would never reach the canary.
  if (whole && rootConfigFile) {
    const foreign = [];
    try {
      for (const f of abs) {
        const found = await whole.findConfigFile(f);
        if (!found || path.resolve(found) !== path.resolve(rootConfigFile)) {
          foreign.push({ f: rel(f), found: found ? rel(found) : 'none' });
        }
      }
    } catch (e) {
      problems.push(`could not resolve which config file each SDK file uses: ${e.message}`);
    }
    if (foreign.length) {
      const examples = foreign
        .slice(0, MAX_EXAMPLES)
        .map((x) => `${x.f} -> ${x.found}`)
        .join(', ');
      problems.push(
        `${foreign.length} SDK source file(s) resolve a config file other than ` +
          `${rel(rootConfigFile)} (e.g. ${examples}). A nested eslint.config.* REPLACES the root ` +
          `config, §4.6 guards included, for every file under it — remove it`
      );
    }
  }

  // 4. The canary: every selector of the sanctioned block that reaches a file
  // must actually report on that file, through the lookup that runs. A nested
  // config file, a processor, a parser or a language override that switches
  // the guard off shows up here as missing messages, whatever its shape.
  if (whole && l1 !== -1) {
    const ignored = new Set(ignoredSdkFiles);
    // rel file -> the messages it must report and the selectors it must resolve
    const targets = new Map();
    const expect = (block) => ({
      messages: selectorMessages(block),
      selectors: [...new Set(errorSelectors(block.rules && block.rules[RULE]) || [])],
    });
    let resolved = true;
    try {
      const l1Expect = expect(configs[l1]);
      for (const f of await probeReach(Eslint, cwd, globalIgnores, configs[l1], abs, rel)) {
        targets.set(f, l1Expect);
      }
      if (proj !== -1) {
        const projExpect = expect(configs[proj]);
        for (const f of await probeReach(Eslint, cwd, globalIgnores, configs[proj], abs, rel)) {
          targets.set(f, projExpect);
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
      let resolvedSelectors;
      try {
        const file = path.resolve(cwd, f);
        const [result] = await whole.lintText(CANARY, { filePath: file });
        if (!result) throw new Error('no lint result');
        const fatal = result.messages.find((m) => m.fatal);
        if (fatal) throw new Error(`the canary did not parse: ${fatal.message}`);
        reported = new Set(result.messages.filter((m) => m.ruleId === RULE).map((m) => m.message));
        // The messages alone could be re-emitted by weaker selectors; the rule
        // value the file resolves must carry exactly the sanctioned selectors.
        const cfg = await whole.calculateConfigForFile(file);
        resolvedSelectors = new Set(errorSelectors(cfg && cfg.rules && cfg.rules[RULE]) || []);
      } catch (e) {
        problems.push(`could not lint the §4.6 canary as ${f}: ${e.message}`);
        break;
      }
      const missing = [
        ...required.messages.filter((m) => !reported.has(m)),
        ...required.selectors.filter((s) => !resolvedSelectors.has(s)).map((s) => `selector ${s}`),
      ];
      if (resolvedSelectors.size !== required.selectors.length) {
        missing.push(
          `the resolved rule carries ${resolvedSelectors.size} selector(s), not ${required.selectors.length}`
        );
      }
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

    // 6. Inline configuration in the guarded files' REAL text. The rule is
    // re-set to a nonce-tagged `*` probe (one report per node, so every line
    // that holds code carries one) through the same lookup, inline config
    // allowed as the CLI allows it; a report the file's own comments
    // suppress, re-severity or replace is a guard switched off by a comment.
    const guarded = [...targets.keys()].filter((f) => !ignored.has(f)).sort();
    if (guarded.length) {
      sourceBypassProblems.push(
        ...(await inlineConfigProblems(Eslint, cwd, configs, lintOptions, guarded, read))
      );
    }
  }

  // 7. The comment-free twin: bulk suppressions and guard-defeating lint flags.
  if (suppressionInputs) {
    sourceBypassProblems.push(...suppressionProblems(suppressionInputs));
  } else if (rootConfigFile) {
    sourceBypassProblems.push(
      'no suppressionInputs were passed with rootConfigFile, so eslint-suppressions.json and ' +
        'the lint commands were not read (fail closed)'
    );
  }

  return {
    problems,
    sourceBypassProblems,
    ignoredSdkFiles: ignoredSdkFiles.sort(),
    layer1Selectors: [...new Set(l1Selectors || [])].sort(),
    projectionSelectors: [...new Set(projSelectorList)].sort(),
    inlineDirectiveControls: [...INLINE_DIRECTIVE_CONTROLS].sort(),
  };
}

/** Step 6: problems with inline configuration in `guarded` (repo-relative) files. */
async function inlineConfigProblems(Eslint, cwd, configs, lintOptions, guarded, read) {
  const problems = [];
  const nonce = `redaction-guard-reach inline probe ${randomUUID()}`;
  const probe = {
    files: ['**/*.ts', '**/*.tsx'],
    rules: { [RULE]: ['error', { selector: '*', message: nonce }] },
  };
  const base = lintOptions || { cwd, overrideConfigFile: true, overrideConfig: configs };
  const prior = base.overrideConfig;
  const priorList = prior === undefined ? [] : Array.isArray(prior) ? prior : [prior];
  let eslint;
  try {
    eslint = new Eslint({
      ...base,
      overrideConfig: [...priorList, probe],
      // What the CLI does: inline config is honoured unless the config itself
      // sets `linterOptions.noInlineConfig`.
      allowInlineConfig: true,
      ruleFilter: ({ ruleId }) => ruleId === RULE,
    });
  } catch (e) {
    return [`could not build the inline-configuration probe: ${e.message}`];
  }
  const lintAs = async (text, f) => {
    const [result] = await eslint.lintText(text, { filePath: path.resolve(cwd, f) });
    if (!result) throw new Error('no lint result');
    return inlineSuppression(result, nonce);
  };

  // Positive control, on every run: each directive form, prepended to the
  // canary and linted as the first guarded file, must be refused — and the
  // canary alone, or under a directive for another rule, must not be.
  const host = guarded[0];
  try {
    const blind = [];
    for (const control of INLINE_DIRECTIVE_CONTROLS) {
      if ((await lintAs(`${control}\n${CANARY}`, host)) === null) blind.push(control);
    }
    if (blind.length) {
      problems.push(
        `the inline-configuration check did not see ${blind.length} injected directive(s) ` +
          `(first: ${JSON.stringify(blind[0])}) when the canary was linted as ${host}; it would ` +
          `pass a real one too (fail closed)`
      );
    }
    for (const clean of [CANARY, `// eslint-disable-next-line no-console\n${CANARY}`]) {
      const verdict = await lintAs(clean, host);
      if (verdict !== null) {
        problems.push(
          `the inline-configuration check refused the clean canary linted as ${host} (${verdict}); ` +
            `it cannot tell a directive for another rule from one for \`${RULE}\` (fail closed)`
        );
      }
    }
  } catch (e) {
    return [...problems, `could not run the inline-configuration control as ${host}: ${e.message}`];
  }

  const offending = [];
  for (const f of guarded) {
    let verdict;
    try {
      verdict = await lintAs(read(f), f);
    } catch (e) {
      problems.push(`could not lint ${f} for inline configuration: ${e.message}`);
      break;
    }
    if (verdict !== null) offending.push({ f, verdict });
  }
  for (const { f, verdict } of offending) {
    problems.push(
      `${f}: ${verdict}. Inline configuration may not switch the §4.6 guard off for SDK source — ` +
        `a sanctioned reader belongs in the package-guard-exemptions list in eslint.config.js`
    );
  }
  return problems;
}

/**
 * ESLint's bulk-suppressions file is the other comment-free way to silence
 * the guard: the CLI (`npm run lint`) applies `eslint-suppressions.json` from
 * its cwd, or the file `--suppressions-location` names, and drops up to N
 * violations of a rule per file. The API applies it only when an instance is
 * built with `applySuppressions: true`, which the inline probe is not, so the
 * probe cannot see it. Refuse any tracked suppressions file with a `RULE`
 * entry for a file under `srcPrefix`, and any tracked package script or
 * workflow line that runs eslint with a flag that changes the guard without a
 * comment (`GUARD_DEFEATING_FLAGS`: suppressions written or read elsewhere, a
 * `--rule` override, another config, no config lookup).
 *
 * @param {object} opts
 * @param {{rel: string, text: string}[]} opts.suppressionFiles  tracked `eslint-suppressions.json` files
 * @param {{rel: string, text: string}[]} opts.packageFiles      tracked package.json files
 * @param {{rel: string, text: string}[]} [opts.workflowFiles]   tracked workflow and composite-action YAML files
 * @param {{rel: string, text: string}[]} [opts.ciTomlFiles]     tracked .qontinui/ci.toml (the coord CI lane's argv steps)
 * @param {string} opts.srcPrefix  repo-relative SDK source prefix, e.g. `packages/ui-bridge/src/`
 * @returns {string[]} problems
 */
function suppressionProblems({
  suppressionFiles,
  packageFiles,
  workflowFiles,
  ciTomlFiles,
  srcPrefix,
}) {
  const problems = [];
  if (typeof srcPrefix !== 'string' || !srcPrefix.endsWith('/') || srcPrefix.length < 2) {
    return [
      `suppressionProblems needs a srcPrefix ending in "/", got ${JSON.stringify(srcPrefix)} (fail closed)`,
    ];
  }
  const norm = (p) => path.posix.normalize(p.split(path.sep).join('/'));
  for (const { rel, text } of suppressionFiles) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      problems.push(
        `${rel} does not parse as JSON (${e.message}); it cannot be read (fail closed)`
      );
      continue;
    }
    if (!isPlainObject(parsed)) {
      problems.push(`${rel} is not a JSON object; it cannot be read (fail closed)`);
      continue;
    }
    const dir = path.posix.dirname(norm(rel));
    for (const [key, rules] of Object.entries(parsed)) {
      if (!isPlainObject(rules) || !Object.prototype.hasOwnProperty.call(rules, RULE)) continue;
      // The CLI resolves keys against its cwd: the repo root for the root
      // `lint` script, the package dir for a package's own. Check both.
      const candidates = [norm(key), norm(path.posix.join(dir, norm(key)))];
      if (candidates.some((c) => c.startsWith(srcPrefix))) {
        problems.push(
          `${rel} suppresses \`${RULE}\` for ${key}. ESLint's bulk suppressions may not switch ` +
            `the §4.6 guard off for SDK source — remove the entry (a sanctioned reader belongs ` +
            `in the package-guard-exemptions list in eslint.config.js)`
        );
      }
    }
  }
  // Lint commands: the scripts of the packages whose lint reaches SDK source;
  // every non-comment line of a workflow or composite action (a superset of
  // its `run:` lines), with backslash continuations and folded (`run: >`)
  // blocks joined; and each `command = [...]` argv of a .qontinui/ci.toml.
  const commands = [];
  const scriptBodies = new Map(); // script name -> bodies, across the reaching packages
  for (const { rel, text } of packageFiles) {
    if (!LINT_REACHING_PACKAGES.includes(norm(rel))) continue;
    let scripts;
    try {
      scripts = (JSON.parse(text) || {}).scripts || {};
    } catch (e) {
      problems.push(`${rel} does not parse as JSON (${e.message}) (fail closed)`);
      continue;
    }
    for (const [name, cmd] of Object.entries(scripts)) {
      if (typeof cmd !== 'string') continue;
      commands.push({ where: `${rel} script "${name}"`, cmd });
      scriptBodies.set(name, [...(scriptBodies.get(name) || []), cmd]);
    }
  }
  for (const { rel, text } of workflowFiles || []) {
    for (const { line, cmd } of yamlCommands(text)) {
      commands.push({ where: `${rel}:${line}`, cmd });
    }
  }
  for (const { rel, text } of ciTomlFiles || []) {
    for (const { line, cmd } of tomlCommands(text)) {
      commands.push({ where: `${rel}:${line}`, cmd });
    }
  }
  // The scripts that run eslint under any name, directly or through another
  // such script: arguments forwarded to them (`npm run ci:check -- --rule ...`)
  // reach eslint too.
  const eslintScripts = new Set();
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, bodies] of scriptBodies) {
      if (eslintScripts.has(name)) continue;
      if (bodies.some((b) => runsEslint(b, eslintScripts))) {
        eslintScripts.add(name);
        grew = true;
      }
    }
  }
  for (const { where, cmd } of commands) {
    const flags = [...new Set(guardDefeatingFlags(cmd, eslintScripts))];
    if (flags.length) {
      problems.push(
        `${where} runs eslint with ${flags.join(', ')}, which can switch the §4.6 guard off ` +
          `(or read a config or suppressions this check does not) with no comment in SDK ` +
          `source — remove the flag`
      );
    }
  }
  return problems;
}

/**
 * The tracked files `suppressionProblems` reads, from `git ls-files` under `cwd`.
 * @param {string} cwd  the repo root
 * @param {string} srcPrefix
 */
function trackedSuppressionInputs(cwd, srcPrefix) {
  const { execFileSync } = require('node:child_process');
  const all = execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  const load = (pred) =>
    all.filter(pred).map((rel) => ({ rel, text: fs.readFileSync(path.join(cwd, rel), 'utf8') }));
  return {
    suppressionFiles: load((f) => path.posix.basename(f) === 'eslint-suppressions.json'),
    packageFiles: load((f) => path.posix.basename(f) === 'package.json'),
    workflowFiles: load(
      (f) =>
        /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f) ||
        /^\.github\/actions\/.+\/action\.ya?ml$/.test(f)
    ),
    ciTomlFiles: load((f) => f === '.qontinui/ci.toml'),
    srcPrefix,
  };
}

/**
 * The shell commands of a YAML file: every non-comment line, with backslash
 * continuations joined, and a folded block (`run: >`) joined into one line
 * (YAML folds it into one shell command). `line` is the 1-based first line.
 */
function yamlCommands(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  const indent = (l) => l.length - l.trimStart().length;
  for (let i = 0; i < lines.length; i++) {
    const start = i;
    let cmd = lines[i];
    if (/:\s*>[-+]?\s*$/.test(cmd)) {
      const base = indent(cmd);
      const folded = [];
      while (i + 1 < lines.length && (lines[i + 1].trim() === '' || indent(lines[i + 1]) > base)) {
        folded.push(lines[++i].trim());
      }
      cmd = folded.join(' ');
    }
    while (/\\\s*$/.test(cmd) && i + 1 < lines.length) {
      cmd = cmd.replace(/\\\s*$/, ' ') + lines[++i];
    }
    if (!/^\s*#/.test(cmd)) out.push({ line: start + 1, cmd });
  }
  return out;
}

/** Each `command = ["a", "b", ...]` argv of a TOML file, joined back into one quoted line. */
function tomlCommands(text) {
  const out = [];
  const re = /^\s*command\s*=\s*\[([\s\S]*?)\]/gm;
  let m;
  while ((m = re.exec(text))) {
    const argv = [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map((x) =>
      x[1] !== undefined ? x[1].replace(/\\(.)/g, '$1') : x[2]
    );
    const line = text.slice(0, m.index).split('\n').length;
    out.push({ line, cmd: argv.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ') });
  }
  return out;
}

/**
 * The packages whose own scripts lint packages/ui-bridge/src: the root (whose
 * `lint` CI runs over `packages/*\/src`) and the SDK package itself. Another
 * package's `eslint src` lints only its own tree.
 */
const LINT_REACHING_PACKAGES = ['package.json', 'packages/ui-bridge/package.json'];

/**
 * The eslint CLI flags that change what the guard does without a comment:
 * bulk suppressions written or read elsewhere, an inline `--rule` override,
 * another config file or none, or files dropped from the run.
 */
const GUARD_DEFEATING_FLAGS = [
  '--suppress-all',
  '--suppress-rule',
  '--suppressions-location',
  '--rule',
  '--config',
  '-c',
  '--no-config-lookup',
  '--ignore-pattern',
  '--stdin-filename',
  '--parser',
  '--parser-options',
];

/** Shell-ish words of one command segment: quotes grouped, not interpreted further. */
function words(segment) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(segment))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/**
 * A word that is the eslint binary itself: `eslint`, `eslint@10`,
 * `node_modules/.bin/eslint`, `eslint.js`, ...
 */
function isEslintBin(w) {
  return /(^|[\\/])eslint(@[\w.^~<>=*-]+)?(\.(js|cjs|mjs|cmd|ps1))?$/.test(w);
}

/**
 * The arguments eslint receives in one command segment, or null when the
 * segment does not run eslint. Direct: everything after the eslint binary.
 * Through a package script that runs eslint (`npm [-w x] run lint -- ...`,
 * `pnpm --filter x lint ...`, `npx turbo run lint -- ...`, or any script in
 * `eslintScripts`): everything after the script name, since the package
 * manager forwards it to the script.
 */
function eslintArgs(segment, eslintScripts = new Set()) {
  const ws = words(segment);
  const bin = ws.findIndex(isEslintBin);
  if (bin !== -1) return ws.slice(bin + 1);
  // The package manager need not be the first word: a workflow line reads
  // `- run: npm run lint -- ...`.
  const pm = ws.findIndex((w) => /^(npm|pnpm|yarn|npx|bun)$/.test(w));
  if (pm === -1) return null;
  const script = ws.findIndex(
    (w, i) => i > pm && (/^lint([:\w-]*)$/.test(w) || eslintScripts.has(w))
  );
  if (script === -1) return null;
  return ws.slice(script + 1);
}

/** Whether `cmd` runs eslint, directly or through one of `eslintScripts`. */
function runsEslint(cmd, eslintScripts) {
  return cmd.split(/&&|\|\||;|\|/).some((s) => eslintArgs(s.trim(), eslintScripts) !== null);
}

/** The guard-defeating flags passed to eslint anywhere in `cmd` (split on && || ; |). */
function guardDefeatingFlags(cmd, eslintScripts = new Set()) {
  const found = [];
  for (const segment of cmd.split(/&&|\|\||;|\|/)) {
    const args = eslintArgs(segment.trim(), eslintScripts);
    if (!args) continue;
    for (const a of args) {
      for (const flag of GUARD_DEFEATING_FLAGS) {
        if (a === flag || a.startsWith(`${flag}=`)) found.push(flag);
      }
    }
  }
  return found;
}

module.exports = {
  guardReachProblems,
  suppressionProblems,
  trackedSuppressionInputs,
  guardDefeatingFlags,
  inlineSuppression,
  GUARD_DEFEATING_FLAGS,
  PROBE_MESSAGE,
  CANARY,
  INLINE_DIRECTIVE_CONTROLS,
};
