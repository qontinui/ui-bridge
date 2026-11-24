// @vitest-environment node
/**
 * Self-test of the redaction-surface ratchet's match-based half
 * (`scripts/lib/redaction-guard-reach.cjs`, used by
 * `scripts/check-redaction-surface.cjs`). The text half sees only config
 * blocks that spell a `packages/ui-bridge/src/` literal; each bypass case below
 * reaches SDK source WITHOUT that literal (a glob, a spread copy of a block, no
 * `files` at all) and passed the old, text-only script. They must be refused
 * by what the block matches. The live config must pass.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change
 * (follow-up 0df8fd16; coord finding 9e2ca54a).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
// A static relative import, so the real-browser placement check can follow it.
import guardReach from '../../../../scripts/lib/redaction-guard-reach.cjs';
import liveConfig from '../../../../eslint.config.js';

type Block = Record<string, unknown>;
type Sanctioned = {
  layer1Files: string[];
  layer1Ignores: string[];
  projectionFiles: string[];
  projectionIgnores: string[];
};
type Tracked = { rel: string; text: string };
type SuppressionInputs = {
  suppressionFiles: Tracked[];
  packageFiles: Tracked[];
  workflowFiles?: Tracked[];
  ciTomlFiles?: Tracked[];
  srcPrefix: string;
};
const {
  guardReachProblems,
  suppressionProblems,
  trackedSuppressionInputs,
  CANARY,
  INLINE_DIRECTIVE_CONTROLS,
} = guardReach as {
  suppressionProblems: (opts: SuppressionInputs) => string[];
  trackedSuppressionInputs: (cwd: string, srcPrefix: string) => Required<SuppressionInputs>;
  guardReachProblems: (opts: {
    configs: unknown[];
    cwd: string;
    sdkFiles: string[];
    sanctioned: Sanctioned;
    lintOptions?: Record<string, unknown>;
    rootConfigFile?: string;
    readSource?: (relFile: string) => string;
    suppressionInputs?: SuppressionInputs;
  }) => Promise<{
    problems: string[];
    sourceBypassProblems: string[];
    ignoredSdkFiles: string[];
    layer1Selectors: string[];
    projectionSelectors: string[];
    inlineDirectiveControls: string[];
  }>;
  CANARY: string;
  INLINE_DIRECTIVE_CONTROLS: string[];
};

const ROOT = join(__dirname, '..', '..', '..', '..');
const SRC = 'packages/ui-bridge/src/';

// ---- a synthetic config shaped like the live one -----------------------------
const L1_FILES = [`${SRC}**/*.ts`, `${SRC}**/*.tsx`];
const L1_IGNORES = [`${SRC}**/__tests__/**`, `${SRC}core/redaction.ts`];
const PROJ_FILES = [`${SRC}server/handlers.ts`];
const PROJ_IGNORES = [`${SRC}**/__tests__/**`];
const SANCTIONED: Sanctioned = {
  layer1Files: L1_FILES,
  layer1Ignores: L1_IGNORES,
  projectionFiles: PROJ_FILES,
  projectionIgnores: PROJ_IGNORES,
};
const L1_SEL = [{ selector: "MemberExpression[property.name='innerText']", message: 'L1' }];
const L2_SEL = [{ selector: "MemberExpression[property.name='textContent']", message: 'L2' }];

const LAYER1: Block = {
  files: L1_FILES,
  ignores: L1_IGNORES,
  rules: { 'no-restricted-syntax': ['error', ...L1_SEL] },
};
const PROJECTION: Block = {
  files: PROJ_FILES,
  ignores: PROJ_IGNORES,
  rules: { 'no-restricted-syntax': ['error', ...L1_SEL, ...L2_SEL] },
};
const PURITY: Block = {
  files: [`${SRC}density/**/*.ts`],
  ignores: [`${SRC}density/__tests__/**`],
  rules: { 'no-restricted-globals': ['error', 'document'] },
};
const SDK = [
  `${SRC}density/reach.ts`,
  `${SRC}core/dom-walk.ts`,
  `${SRC}server/handlers.ts`,
  `${SRC}core/redaction.ts`,
];

// The synthetic SDK files do not exist on disk: the inline-configuration
// step reads their real text from here — a clean module unless a test
// overrides one file's text.
const CLEAN_SOURCE = 'export const value = 1;\nexport function f(): number {\n  return value;\n}\n';
function sourceOf(overrides: Record<string, string> = {}) {
  return (f: string) => overrides[f] ?? CLEAN_SOURCE;
}
function check(
  configs: unknown[],
  sanctioned: Sanctioned = SANCTIONED,
  sdkFiles = SDK,
  readSource = sourceOf()
) {
  return guardReachProblems({ configs, cwd: ROOT, sdkFiles, sanctioned, readSource });
}
async function problemsOf(configs: unknown[]): Promise<string> {
  return (await check(configs)).problems.join('\n');
}
// Like typescript-eslint's recommended block: what makes a .ts file linted at
// all (a file no `files` pattern matches is ignored, so a sanctioned reader the
// Layer-1 block ignores would otherwise read as unlinted), with the TS parser
// the canary needs.
const TS_BASE: Block = {
  files: ['**/*.ts', '**/*.tsx'],
  languageOptions: { parser: tseslint.parser },
};
const BASE = [TS_BASE, LAYER1, PROJECTION, PURITY];

describe('the match-based guard-reach check of the redaction-surface ratchet', () => {
  it('passes the live eslint.config.js over the tracked SDK sources', async () => {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, 'packages/ui-bridge/redaction-surface.manifest.json'), 'utf8')
    ) as Record<string, string[]>;
    const sdkFiles = execFileSync('git', ['ls-files', '-z', '--', SRC], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\0')
      .filter((f) => /\.(ts|tsx)$/.test(f));
    expect(sdkFiles.length).toBeGreaterThan(0);
    // The comment-free half must read something, or it passes vacuously.
    const inputs = trackedSuppressionInputs(ROOT, SRC);
    expect(inputs.packageFiles.map((f) => f.rel)).toContain('package.json');
    expect(inputs.workflowFiles.map((f) => f.rel)).toContain('.github/workflows/ci.yml');
    expect(inputs.ciTomlFiles.map((f) => f.rel)).toEqual(['.qontinui/ci.toml']);
    const result = await guardReachProblems({
      configs: liveConfig as unknown[],
      cwd: ROOT,
      sdkFiles,
      sanctioned: {
        layer1Files: L1_FILES,
        layer1Ignores: manifest.packageGuardExemptions,
        projectionFiles: manifest.projectionModules,
        projectionIgnores: manifest.projectionModuleIgnores,
      },
      // The CLI's own lookup and inputs, as the ratchet runs it.
      lintOptions: { cwd: ROOT },
      rootConfigFile: join(ROOT, 'eslint.config.js'),
      suppressionInputs: inputs,
    });
    expect(result.problems).toEqual([]);
    expect(result.sourceBypassProblems).toEqual([]);
    expect(result.ignoredSdkFiles).toEqual(manifest.globallyIgnoredSources);
    expect(result.layer1Selectors).toEqual(manifest.layer1Selectors);
    expect(result.projectionSelectors).toEqual(manifest.projectionSelectors);
    expect(result.inlineDirectiveControls).toEqual(manifest.inlineDirectiveControls);
  });

  it('passes a synthetic config with only the sanctioned and additive blocks', async () => {
    expect(await check(BASE)).toEqual({
      problems: [],
      sourceBypassProblems: [],
      ignoredSdkFiles: [],
      layer1Selectors: [L1_SEL[0].selector],
      projectionSelectors: [L1_SEL[0].selector, L2_SEL[0].selector].sort(),
      inlineDirectiveControls: [...INLINE_DIRECTIVE_CONTROLS].sort(),
    });
  });

  // ---- shapes that blank the code instead of touching the rule ---------------
  it('refuses a processor that hands the rule no code for SDK files', async () => {
    const out = await problemsOf([
      ...BASE,
      { files: ['**/density/**/*.ts'], processor: { preprocess: () => [], postprocess: () => [] } },
    ]);
    expect(out).toContain('do not report every §4.6 selector');
    expect(out).toContain(`${SRC}density/reach.ts`);
  });

  it('refuses a parser that yields an empty program for SDK files', async () => {
    const empty = {
      parseForESLint: (_code: string, options: Record<string, unknown>) =>
        tseslint.parser.parseForESLint('', options),
    };
    const out = await problemsOf([
      ...BASE,
      { files: ['**/density/**/*.ts'], languageOptions: { parser: empty } },
    ]);
    expect(out).toContain('do not report every §4.6 selector');
  });

  it('refuses a nested eslint.config.* that replaces the root config for SDK files', async () => {
    // ESLint looks a config file up from each linted file's directory, so a
    // nested one replaces the root config there. Built on disk in a temp tree.
    const dir = mkdtempSync(join(tmpdir(), 'guard-reach-'));
    try {
      // The temp tree has no node_modules, so its configs import the repo's
      // typescript-eslint parser by absolute URL.
      const parserPath = join(
        ROOT,
        'node_modules',
        '@typescript-eslint',
        'parser',
        'dist',
        'index.js'
      );
      expect(existsSync(parserPath)).toBe(true);
      const parserUrl = pathToFileURL(parserPath).href;
      const importParser = `import parser from ${JSON.stringify(parserUrl)};\n`;
      // The root config is BASE, with the parser imported rather than inlined.
      writeFileSync(
        join(dir, 'eslint.config.mjs'),
        importParser +
          `const ts = { files: ['**/*.ts', '**/*.tsx'], languageOptions: { parser } };\n` +
          `export default [ts, ...${JSON.stringify(BASE.slice(1))}];\n`
      );
      const run = () =>
        guardReachProblems({
          configs: BASE,
          cwd: dir,
          sdkFiles: SDK,
          sanctioned: SANCTIONED,
          lintOptions: { cwd: dir },
          rootConfigFile: join(dir, 'eslint.config.mjs'),
          readSource: sourceOf(),
          suppressionInputs: { suppressionFiles: [], packageFiles: [], srcPrefix: SRC },
        });
      // Control: the temp tree's root config alone passes.
      expect((await run()).problems).toEqual([]);
      expect((await run()).sourceBypassProblems).toEqual([]);
      const nested = join(dir, SRC, 'density');
      mkdirSync(nested, { recursive: true });
      // The bypass, three ways: the parser and no rules; `[{}]` and `[]`,
      // which leave the files matched by nothing (read as ignored, not linted).
      for (const body of [
        importParser + `export default [{ files: ['**/*.ts'], languageOptions: { parser } }];\n`,
        'export default [{}];\n',
        'export default [];\n',
      ]) {
        writeFileSync(join(nested, 'eslint.config.mjs'), body);
        const out = (await run()).problems.join('\n');
        expect(out).toContain('1 SDK source file(s) resolve a config file other than');
        expect(out).toContain(`${SRC}density/reach.ts -> ${SRC}density/eslint.config.mjs`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a resolved rule that re-emits the sanctioned messages from weaker selectors', async () => {
    const out = await problemsOf([
      ...BASE,
      {
        files: ['**/density/**/*.ts'],
        rules: { 'no-restricted-syntax': ['error', { selector: 'Program', message: 'L1' }] },
      },
    ]);
    // The message `L1` comes back, so only the resolved-selector half sees it.
    expect(out).toContain('do not report every §4.6 selector');
    expect(out).toContain(`first: ${JSON.stringify(`selector ${L1_SEL[0].selector}`)}`);
  });

  it('reports the sanctioned selector lists, so dropping a family from both blocks moves the ratchet', async () => {
    const extra = { selector: 'DebuggerStatement', message: 'L1b' };
    const result = await check([
      TS_BASE,
      { ...LAYER1, rules: { 'no-restricted-syntax': ['error', ...L1_SEL, extra] } },
      { ...PROJECTION, rules: { 'no-restricted-syntax': ['error', ...L1_SEL, extra, ...L2_SEL] } },
      PURITY,
    ]);
    expect(result.layer1Selectors).toEqual(['DebuggerStatement', L1_SEL[0].selector].sort());
    expect(result.layer1Selectors).not.toEqual((await check(BASE)).layer1Selectors);
  });

  // ---- the bypass shapes (each passed the text-only script) ------------------
  it('refuses a block whose glob reaches SDK source with no src literal (**/density/**)', async () => {
    const out = await problemsOf([
      ...BASE,
      { files: ['**/density/**'], rules: { 'no-restricted-syntax': 'off' } },
    ]);
    expect(out).toContain('reaches 1 SDK source file(s)');
    expect(out).toContain(`${SRC}density/reach.ts`);
  });

  it('refuses a block that sets no-restricted-syntax for SDK files through packages/*/src/**', async () => {
    const out = await problemsOf([
      ...BASE,
      { files: ['packages/*/src/**/*.ts'], rules: { 'no-restricted-syntax': ['error'] } },
    ]);
    expect(out).toContain('reaches 4 SDK source file(s)');
  });

  it('refuses a **/*.ts block and a block with no files at all', async () => {
    const glob = await problemsOf([
      ...BASE,
      { files: ['**/*.ts'], rules: { 'no-restricted-syntax': ['error', ...L1_SEL.slice(1)] } },
    ]);
    expect(glob).toContain('sets `no-restricted-syntax` and reaches');
    const global = await problemsOf([...BASE, { rules: { 'no-restricted-syntax': 'off' } }]);
    expect(global).toContain('no `files` (every linted file)');
  });

  it('refuses a duplicated purity block that switches no-restricted-syntax off', async () => {
    // A spread copy keeps the src literal out of the config text.
    const out = await problemsOf([
      ...BASE,
      { ...PURITY, rules: { ...(PURITY.rules as Block), 'no-restricted-syntax': 'off' } },
    ]);
    expect(out).toContain(`${SRC}density/reach.ts`);
  });

  it('refuses a duplicated sanctioned block, whose copy could replace its selectors', async () => {
    const out = await problemsOf([
      ...BASE,
      { ...LAYER1, rules: { 'no-restricted-syntax': 'off' } },
    ]);
    expect(out).toContain('sanctioned Layer-1 block appears 2 times');
  });

  it('refuses a global ignore that drops SDK source from linting', async () => {
    const result = await check([...BASE, { ignores: ['**/core/*.ts'] }]);
    expect(result.ignoredSdkFiles).toEqual([`${SRC}core/dom-walk.ts`, `${SRC}core/redaction.ts`]);
  });

  // ---- inline configuration in a guarded file's own text --------------------
  // eslint.config.js does not set `noInlineConfig` (legitimate directives for
  // other rules live in SDK source), so a comment in a guarded file could
  // switch the guard off where the synthetic canary never looks. Follow-up
  // e9c61900.
  const REACH = `${SRC}density/reach.ts`;
  const inlineOut = async (text: string, file = REACH) =>
    (await check(BASE, SANCTIONED, SDK, sourceOf({ [file]: text }))).sourceBypassProblems.join(
      '\n'
    );

  it('refuses an inline config comment that switches no-restricted-syntax off in an SDK file', async () => {
    const out = await inlineOut(`/* eslint no-restricted-syntax: off */\n${CLEAN_SOURCE}`);
    expect(out).toContain(`${REACH}: an inline \`/* eslint no-restricted-syntax: ... */\` comment`);
    expect(out).toContain('package-guard-exemptions');
  });

  it('refuses an inline config comment that lowers it to warn or replaces its selectors', async () => {
    const warn = await inlineOut(`/* eslint no-restricted-syntax: warn */\n${CLEAN_SOURCE}`);
    expect(warn).toContain('lowers it below error');
    const replaced = await inlineOut(
      `/* eslint no-restricted-syntax: ["error", { "selector": "Identifier", "message": "x" }] */\n${CLEAN_SOURCE}`
    );
    expect(replaced).toContain('replaces its selectors');
  });

  it('refuses eslint-disable, -line and -next-line naming the rule, and a blanket disable', async () => {
    for (const text of [
      `/* eslint-disable no-restricted-syntax */\n${CLEAN_SOURCE}`,
      `/* eslint-disable */\n${CLEAN_SOURCE}`,
      `export const a = 1;\n// eslint-disable-next-line no-restricted-syntax -- justified\nexport const b = 2;\n`,
      `export const a = 1; // eslint-disable-line no-restricted-syntax\n`,
      `export const a = 1;\n// eslint-disable-next-line\nexport const b = 2;\n`,
    ]) {
      expect(await inlineOut(text), text).toContain(
        `${REACH}: an eslint-disable directive suppresses`
      );
    }
    // A projection module is guarded the same way.
    const handlers = `${SRC}server/handlers.ts`;
    const proj = await inlineOut(
      `/* eslint-disable no-restricted-syntax */\n${CLEAN_SOURCE}`,
      handlers
    );
    expect(proj).toContain(`${handlers}: an eslint-disable directive suppresses`);
  });

  it('keeps directives for other rules, and any directive in a file the guard exempts', async () => {
    const result = await check(
      BASE,
      SANCTIONED,
      SDK,
      sourceOf({
        [REACH]:
          '// eslint-disable-next-line @typescript-eslint/no-explicit-any\n' +
          'export const x: any = 1;\n/* eslint-disable no-console */\n' +
          CLEAN_SOURCE,
        // core/redaction.ts is in the Layer-1 ignores: the rule never runs there.
        [`${SRC}core/redaction.ts`]: `/* eslint-disable no-restricted-syntax */\n${CLEAN_SOURCE}`,
      })
    );
    expect(result.problems).toEqual([]);
    expect(result.sourceBypassProblems).toEqual([]);
  });

  it('refuses every inline directive form when the canary carries it, and passes the bare canary', async () => {
    // The same forms are the check's own positive control on every run.
    expect(INLINE_DIRECTIVE_CONTROLS.length).toBeGreaterThanOrEqual(13);
    for (const control of INLINE_DIRECTIVE_CONTROLS) {
      // Each control must land on the verdict its shape produces.
      const verdict = control.includes('eslint-disable')
        ? 'an eslint-disable directive suppresses'
        : control.includes(': warn')
          ? 'lowers it below error'
          : 'switches the rule off or replaces its selectors';
      const out = await inlineOut(`${control}\n${CANARY}`);
      expect(out, control).toContain(`${REACH}: `);
      expect(out, control).toContain(verdict);
    }
    expect(await inlineOut(CANARY)).toBe('');
  });

  it('fails closed when its own positive control is blind, or refuses the clean canary', async () => {
    // A stub ESLint whose lint results `rewrite` — the `opts.ESLint` seam.
    const { ESLint: RealESLint } = await import('eslint');
    const stubbed = (rewrite: (r: Record<string, unknown>) => Record<string, unknown>) =>
      class extends RealESLint {
        async lintText(...args: Parameters<RealESLint['lintText']>) {
          const results = await super.lintText(...args);
          return results.map((r) => rewrite(r as unknown as Record<string, unknown>)) as never;
        }
      };
    const run = (Eslint: unknown) =>
      guardReachProblems({
        configs: BASE,
        cwd: ROOT,
        sdkFiles: SDK,
        sanctioned: SANCTIONED,
        readSource: sourceOf(),
        ESLint: Eslint,
      } as never).then((r) => r.sourceBypassProblems.join('\n'));
    // Blind: suppressions are dropped and the probe always reports cleanly.
    const blind = await run(
      stubbed((r) => {
        const messages = (r.messages as { ruleId: string }[]).concat(
          r.suppressedMessages as { ruleId: string }[]
        );
        const nonce = messages.find((m) => m.ruleId === 'no-restricted-syntax') as
          | { message: string }
          | undefined;
        const probe = nonce ?? { message: 'x' };
        return {
          ...r,
          suppressedMessages: [],
          messages: [
            { ruleId: 'no-restricted-syntax', severity: 2, message: probe.message, line: 1 },
          ],
        };
      })
    );
    expect(blind).toContain('the inline-configuration check did not see');
    // Over-eager: every result loses its probe reports, clean canary included.
    const eager = await run(
      stubbed((r) => ({
        ...r,
        messages: (r.messages as { ruleId: string }[]).filter(
          (m) => m.ruleId !== 'no-restricted-syntax'
        ),
      }))
    );
    expect(eager).toContain('refused the clean canary');
  });

  // ---- ESLint's bulk suppressions, the comment-free twin ----------------------
  it('refuses a tracked eslint-suppressions.json entry that silences the rule for SDK source', () => {
    const at = (rel: string, body: unknown) => ({ rel, text: JSON.stringify(body) });
    const sup = { [`${SRC}density/hash.ts`]: { 'no-restricted-syntax': { count: 1 } } };
    const pkgSup = { 'src/density/hash.ts': { 'no-restricted-syntax': { count: 2 } } };
    const other = { [`${SRC}density/hash.ts`]: { 'no-console': { count: 1 } } };
    const run = (
      files: { rel: string; text: string }[],
      pkgs: { rel: string; text: string }[] = []
    ) =>
      suppressionProblems({ suppressionFiles: files, packageFiles: pkgs, srcPrefix: SRC }).join(
        '\n'
      );
    expect(run([at('eslint-suppressions.json', sup)])).toContain(
      `eslint-suppressions.json suppresses \`no-restricted-syntax\` for ${SRC}density/hash.ts`
    );
    // A package-dir file's keys resolve against that dir.
    expect(run([at('packages/ui-bridge/eslint-suppressions.json', pkgSup)])).toContain(
      'suppresses `no-restricted-syntax` for src/density/hash.ts'
    );
    expect(run([{ rel: 'eslint-suppressions.json', text: '{' }])).toContain('fail closed');
    expect(
      run(
        [],
        [at('package.json', { scripts: { lint: 'eslint src --suppressions-location x.json' } })]
      )
    ).toContain('--suppressions-location');
    // Every guard-defeating flag, in a script or a workflow line, directly or
    // through `npm run lint -- ...`.
    for (const flag of [
      '--suppress-all',
      '--suppress-rule no-restricted-syntax',
      '--rule "no-restricted-syntax: off"',
      '-c other.config.js',
      '--config=other.config.js',
      '--no-config-lookup',
    ]) {
      const name = flag.split(/[ =]/)[0];
      expect(
        run([], [at('package.json', { scripts: { lint: `eslint src ${flag}` } })]),
        flag
      ).toContain(`runs eslint with ${name}`);
      const wf = suppressionProblems({
        suppressionFiles: [],
        packageFiles: [],
        workflowFiles: [
          { rel: '.github/workflows/ci.yml', text: `steps:\n  - run: npm run lint -- ${flag}\n` },
        ],
        srcPrefix: SRC,
      }).join('\n');
      expect(wf, flag).toContain(`.github/workflows/ci.yml:2 runs eslint with ${name}`);
    }
    // Workspace-form and runner-form lint invocations, a backslash-continued
    // workflow line, and a CLI ignore that drops SDK files from the run.
    const flagged = (pkgCmd: string[], workflow = '') =>
      suppressionProblems({
        suppressionFiles: [],
        packageFiles: [
          at('package.json', { scripts: Object.fromEntries(pkgCmd.map((c, i) => [`s${i}`, c])) }),
        ],
        workflowFiles: [{ rel: '.github/workflows/ci.yml', text: workflow }],
        srcPrefix: SRC,
      });
    const off = '--rule "no-restricted-syntax: off"';
    expect(
      flagged([
        `npm -w packages/ui-bridge run lint -- ${off}`,
        `npm run -w packages/ui-bridge lint -- ${off}`,
        `pnpm --filter @qontinui/ui-bridge lint ${off}`,
        `npx turbo run lint -- ${off}`,
        `node node_modules/eslint/bin/eslint.js src ${off}`,
        `eslint "packages/*/src/**/*.ts" --ignore-pattern "${SRC}density/**"`,
      ])
    ).toHaveLength(6);
    const continued = flagged(
      [],
      `jobs:\n  lint:\n    steps:\n      - run: |\n          npx eslint "packages/*/src/**/*.ts" \\\n            ${off}\n`
    );
    expect(continued.join('\n')).toContain('.github/workflows/ci.yml:5 runs eslint with --rule');
    // No false refusals: a flag on another command in the same script, a
    // word that merely contains "eslint", or another package's own lint.
    expect(
      flagged([
        'git -c core.autocrlf=false diff && npm run lint',
        'cd packages/ui-bridge-eslint-plugin && tar -c -f x.tgz .',
        'prettier --config .prettierrc --check . && eslint src',
        'eslint src --max-warnings 0 && prettier --config .prettierrc --check .',
        'npm run build -w packages/ui-bridge-eslint-plugin --if-present',
      ])
    ).toEqual([]);
    expect(
      suppressionProblems({
        suppressionFiles: [],
        packageFiles: [
          at('packages/ui-bridge-native/package.json', {
            scripts: { lint: 'eslint src --rule "no-console: off"' },
          }),
        ],
        srcPrefix: SRC,
      })
    ).toEqual([]);
    // A version-pinned binary, a CLI parser or stdin filename, and arguments
    // forwarded to a script that runs eslint under another name (directly or
    // through another such script).
    const ciScripts = {
      'ci:check': 'eslint "packages/*/src/**/*.ts" --max-warnings 0',
      verify: 'npm run ci:check && npm test',
      s0: `npx eslint@10 src ${off}`,
      s1: `npx -y eslint@10.3.0 src ${off}`,
      s2: 'eslint src --parser ./blank-parser.js',
      s3: "eslint --parser-options '{}' src",
      s4: `eslint --stdin --stdin-filename ${SRC}density/hash.ts`,
      s5: `npm run ci:check -- ${off}`,
      s6: `npm run verify -- ${off}`,
    };
    const named = suppressionProblems({
      suppressionFiles: [],
      packageFiles: [at('package.json', { scripts: ciScripts })],
      srcPrefix: SRC,
    }).join('\n');
    for (const s of ['s0', 's1', 's2', 's3', 's4', 's5', 's6']) {
      expect(named, s).toContain(`package.json script "${s}" runs eslint with`);
    }
    expect(named).not.toContain('script "ci:check"');
    expect(named).not.toContain('script "verify"');
    // The coord CI lane's argv steps, a composite action, and a folded block.
    const lanes = suppressionProblems({
      suppressionFiles: [],
      packageFiles: [],
      ciTomlFiles: [
        {
          rel: '.qontinui/ci.toml',
          text: `[[steps]]\nname = "lint"\ncommand = ["npm", "run", "lint", "--", "--rule", "no-restricted-syntax: off"]\n[[steps]]\nname = "ok"\ncommand = ["npm", "run", "lint"]\n`,
        },
      ],
      workflowFiles: [
        {
          rel: '.github/actions/x/action.yml',
          text: `runs:\n  using: composite\n  steps:\n    - run: >\n        npx eslint src\n        ${off}\n      shell: bash\n`,
        },
      ],
      srcPrefix: SRC,
    }).join('\n');
    expect(lanes).toContain('.qontinui/ci.toml:3 runs eslint with --rule');
    expect(lanes).not.toContain('.qontinui/ci.toml:6');
    expect(lanes).toContain('.github/actions/x/action.yml:4 runs eslint with --rule');
    // No srcPrefix: refused, never a silent pass.
    expect(
      suppressionProblems({
        suppressionFiles: [at('eslint-suppressions.json', sup)],
        packageFiles: [],
      } as never).join('\n')
    ).toContain('needs a srcPrefix');
    // A commented workflow line, and -c on a command that is not a lint.
    expect(
      suppressionProblems({
        suppressionFiles: [],
        packageFiles: [at('package.json', { scripts: { test: 'vitest -c vitest.config.ts' } })],
        workflowFiles: [{ rel: '.github/workflows/ci.yml', text: '# eslint --suppress-all\n' }],
        srcPrefix: SRC,
      })
    ).toEqual([]);
    // What it must not refuse: another rule, a non-SDK file, a plain lint script.
    expect(run([at('eslint-suppressions.json', other)])).toBe('');
    expect(
      run(
        [
          at('eslint-suppressions.json', {
            'packages/ui-bridge-cli-args/src/a.ts': sup[`${SRC}density/hash.ts`],
          }),
        ],
        [at('package.json', { scripts: { lint: 'eslint src --max-warnings 0' } })]
      )
    ).toBe('');
  });

  // ---- what it must NOT refuse -----------------------------------------------
  it('allows a no-restricted-syntax block that reaches no SDK source', async () => {
    const result = await check([
      ...BASE,
      {
        files: ['packages/ui-bridge-cli-args/src/**/*.ts'],
        rules: { 'no-restricted-syntax': 'off' },
      },
      { files: ['**/density/**'], ignores: [`${SRC}**`], rules: { 'no-restricted-syntax': 'off' } },
    ]);
    expect(result.problems).toEqual([]);
  });

  // ---- the sanctioned blocks themselves --------------------------------------
  it('refuses a weakened Layer-1 block (warn, or an extra key)', async () => {
    const warn = await problemsOf([
      TS_BASE,
      { ...LAYER1, rules: { 'no-restricted-syntax': ['warn', ...L1_SEL] } },
      PROJECTION,
    ]);
    expect(warn).toContain("must set `no-restricted-syntax` to ['error', ...selectors]");
    const key = await problemsOf([{ ...LAYER1, basePath: 'elsewhere' }, PROJECTION]);
    expect(key).toContain('has key `basePath`');
  });

  it('refuses a projection block that drops a Layer-1 selector, or comes first', async () => {
    const dropped = await problemsOf([
      LAYER1,
      { ...PROJECTION, rules: { 'no-restricted-syntax': ['error', ...L2_SEL] } },
    ]);
    expect(dropped).toContain('drops 1 Layer-1 selector(s)');
    const order = await problemsOf([PROJECTION, LAYER1]);
    expect(order).toContain('comes before the Layer-1 block');
  });

  it('fails closed with no SDK files or a missing sanctioned block', async () => {
    expect((await check(BASE, SANCTIONED, [])).problems.join('\n')).toContain('fail closed');
    // The CLI's mode (a rootConfigFile) without the comment-free inputs: a
    // caller that drops them fails rather than passing.
    const unwired = await guardReachProblems({
      configs: BASE,
      cwd: ROOT,
      sdkFiles: SDK,
      sanctioned: SANCTIONED,
      readSource: sourceOf(),
      rootConfigFile: join(ROOT, 'eslint.config.js'),
    });
    expect(unwired.sourceBypassProblems.join('\n')).toContain(
      'no suppressionInputs were passed with rootConfigFile'
    );
    expect(await problemsOf([PROJECTION])).toContain('no config block is the sanctioned Layer-1');
  });
});
