// @vitest-environment node
/**
 * Self-test of the redaction-surface ratchet's additive-guard check
 * (`scripts/lib/additive-guard-block.cjs`, used by
 * `scripts/check-redaction-surface.cjs`). An additive guard block may name
 * `packages/ui-bridge/src/` paths outside the §4.6 sentinel lists only because
 * it provably exempts nothing from §4.6; each case below is a shape that WOULD
 * exempt something, and must be refused. The live config must pass.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (Phase 1).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const ROOT = join(__dirname, '..', '..', '..', '..');
const { additiveGuardBlockProblems } = require(
  join(ROOT, 'scripts', 'lib', 'additive-guard-block.cjs')
) as { additiveGuardBlockProblems: (source: string) => string[] };

const LIVE = readFileSync(join(ROOT, 'eslint.config.js'), 'utf8');

const S = '// redaction-surface:additive-guard-scopes:start';
const E = '// redaction-surface:additive-guard-scopes:end';
const FILES = "files: ['packages/ui-bridge/src/density/**/*.ts'],";
const IGNORES = "ignores: ['packages/ui-bridge/src/density/__tests__/**'],";
const RULES = "rules: { 'no-restricted-globals': ['error', 'document'] },";

/** A config with one block whose body is `body`. */
function config(body: string): string {
  return `export default [\n  {\n${body}\n  },\n];\n`;
}

const GOOD = [S, FILES, IGNORES, E, RULES].join('\n');

describe('the additive-guard check of the redaction-surface ratchet', () => {
  it('passes the live eslint.config.js', () => {
    expect(additiveGuardBlockProblems(LIVE)).toEqual([]);
  });

  it('passes a minimal additive block', () => {
    expect(additiveGuardBlockProblems(config(GOOD))).toEqual([]);
  });

  it('refuses no-restricted-syntax after the end sentinel', () => {
    const body = [S, FILES, IGNORES, E, "rules: { 'no-restricted-syntax': 'off' },"].join('\n');
    expect(additiveGuardBlockProblems(config(body)).join('\n')).toContain('no-restricted-syntax');
  });

  it('refuses rules placed before the start sentinel', () => {
    const body = ["rules: { 'no-restricted-syntax': 'off' },", S, FILES, IGNORES, E].join('\n');
    expect(additiveGuardBlockProblems(config(body)).join('\n')).toContain(
      'sets `no-restricted-syntax`'
    );
  });

  it('refuses a second rules key, which would hide the one checked', () => {
    const body = ["rules: { 'no-restricted-syntax': 'off' },", S, FILES, IGNORES, E, RULES].join(
      '\n'
    );
    expect(additiveGuardBlockProblems(config(body)).join('\n')).toContain('appears more than once');
  });

  it('refuses a computed rule key', () => {
    const body = [S, FILES, IGNORES, E, "rules: { ['no-restricted-' + 'syntax']: 'off' },"].join(
      '\n'
    );
    expect(additiveGuardBlockProblems(config(body)).join('\n')).toContain('computed key');
  });

  it('refuses an ignores-only object, which flat config reads as a global ignore', () => {
    const body = [S, "ignores: ['packages/ui-bridge/src/density/**/*.ts'],", E].join('\n');
    expect(additiveGuardBlockProblems(config(body)).join('\n')).toContain('GLOBAL ignore');
  });

  it('refuses a spread into the block or into its rules', () => {
    expect(
      additiveGuardBlockProblems(config([S, FILES, E, '...shared,', RULES].join('\n')))
    ).not.toEqual([]);
    expect(
      additiveGuardBlockProblems(config([S, FILES, E, 'rules: { ...shared },'].join('\n')))
    ).not.toEqual([]);
  });

  it('refuses a rule outside the allowlist and a key outside files/ignores/rules', () => {
    const rule = [S, FILES, E, "rules: { 'no-console': 'off' },"].join('\n');
    expect(additiveGuardBlockProblems(config(rule)).join('\n')).toContain('sets `no-console`');
    const key = [S, FILES, E, RULES, 'languageOptions: {},'].join('\n');
    expect(additiveGuardBlockProblems(config(key)).join('\n')).toContain('`languageOptions`');
  });

  it('refuses a files entry that is not a src literal', () => {
    const body = [S, "files: ['**/density/**/*.ts'],", E, RULES].join('\n');
    expect(additiveGuardBlockProblems(config(body)).join('\n')).toContain('is not a');
  });

  it('refuses missing or duplicated sentinels', () => {
    expect(additiveGuardBlockProblems(config([FILES, RULES].join('\n')))).not.toEqual([]);
    expect(additiveGuardBlockProblems(config([GOOD, S, E].join('\n')))).not.toEqual([]);
  });
});
