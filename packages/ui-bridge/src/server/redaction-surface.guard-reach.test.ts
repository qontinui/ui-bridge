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
const { guardReachProblems } = guardReach as {
  guardReachProblems: (opts: {
    configs: unknown[];
    cwd: string;
    sdkFiles: string[];
    sanctioned: Sanctioned;
    lintOptions?: Record<string, unknown>;
  }) => Promise<{
    problems: string[];
    ignoredSdkFiles: string[];
    layer1Selectors: string[];
    projectionSelectors: string[];
  }>;
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

function check(configs: unknown[], sanctioned: Sanctioned = SANCTIONED, sdkFiles = SDK) {
  return guardReachProblems({ configs, cwd: ROOT, sdkFiles, sanctioned });
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
      // The CLI's own lookup, as the ratchet runs it.
      lintOptions: { cwd: ROOT },
    });
    expect(result.problems).toEqual([]);
    expect(result.ignoredSdkFiles).toEqual(manifest.globallyIgnoredSources);
    expect(result.layer1Selectors).toEqual(manifest.layer1Selectors);
    expect(result.projectionSelectors).toEqual(manifest.projectionSelectors);
  });

  it('passes a synthetic config with only the sanctioned and additive blocks', async () => {
    expect(await check(BASE)).toEqual({
      problems: [],
      ignoredSdkFiles: [],
      layer1Selectors: [L1_SEL[0].selector],
      projectionSelectors: [L1_SEL[0].selector, L2_SEL[0].selector].sort(),
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
      // The bypass: a nested config with the parser and no rules at all.
      const nested = join(dir, SRC, 'density');
      mkdirSync(nested, { recursive: true });
      writeFileSync(
        join(nested, 'eslint.config.mjs'),
        importParser + `export default [{ files: ['**/*.ts'], languageOptions: { parser } }];\n`
      );
      const result = await guardReachProblems({
        configs: BASE,
        cwd: dir,
        sdkFiles: SDK,
        sanctioned: SANCTIONED,
        lintOptions: { cwd: dir },
      });
      const out = result.problems.join('\n');
      expect(out).toContain('1 guarded SDK file(s) do not report every §4.6 selector');
      expect(out).toContain(`${SRC}density/reach.ts`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
    expect(await problemsOf([PROJECTION])).toContain('no config block is the sanctioned Layer-1');
  });
});
