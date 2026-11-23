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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
// A static relative import, so the real-browser placement check can follow it.
import guardReach from '../../../../scripts/lib/redaction-guard-reach.cjs';

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
  }) => Promise<{ problems: string[]; ignoredSdkFiles: string[] }>;
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
// Layer-1 block ignores would otherwise read as unlinted).
const TS_BASE: Block = { files: ['**/*.ts', '**/*.tsx'], rules: {} };
const BASE = [TS_BASE, LAYER1, PROJECTION, PURITY];

describe('the match-based guard-reach check of the redaction-surface ratchet', () => {
  it('passes the live eslint.config.js over the tracked SDK sources', async () => {
    const live = (await import(pathToFileURL(join(ROOT, 'eslint.config.js')).href)) as {
      default: Block[];
    };
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
      configs: live.default,
      cwd: ROOT,
      sdkFiles,
      sanctioned: {
        layer1Files: L1_FILES,
        layer1Ignores: manifest.packageGuardExemptions,
        projectionFiles: manifest.projectionModules,
        projectionIgnores: manifest.projectionModuleIgnores,
      },
    });
    expect(result.problems).toEqual([]);
    expect(result.ignoredSdkFiles).toEqual(manifest.globallyIgnoredSources);
  });

  it('passes a synthetic config with only the sanctioned and additive blocks', async () => {
    expect(await check(BASE)).toEqual({ problems: [], ignoredSdkFiles: [] });
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
