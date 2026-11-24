// @vitest-environment node
/**
 * The density core's two structural promises: every public name says
 * `density`, and every file imports only its siblings and the envelope (the
 * directory is copied verbatim into `@qontinui/ui-bridge-headless`, so a
 * reach outside it would not resolve there).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as density from '../index';

const DIR = join(__dirname, '..');
const CORE_FILES = readdirSync(DIR).filter((f) => f.endsWith('.ts'));

describe('density core boundary', () => {
  it('runs with no DOM', () => {
    expect(typeof document).toBe('undefined');
  });

  it('every exported runtime name contains density or Density', () => {
    const names = Object.keys(density);
    expect(names.length).toBeGreaterThan(10);
    expect(names.filter((n) => !/density/i.test(n))).toEqual([]);
  });

  it('every type and value re-exported by index.ts names density', () => {
    const source = readFileSync(join(DIR, 'index.ts'), 'utf8');
    const block = [...source.matchAll(/export\s*\{([^}]*)\}/g)].map((m) => m[1]).join(',');
    const names = block
      .split(',')
      .map((s) => s.replace(/^\s*type\s+/, '').trim())
      .filter(Boolean);
    expect(names.length).toBeGreaterThan(30);
    expect(names.filter((n) => !/density/i.test(n))).toEqual([]);
  });

  it('the core is the seventeen files the plan names', () => {
    expect(CORE_FILES.sort()).toEqual([
      'affordances.ts',
      'bounds.ts',
      'budget.ts',
      'capture-from-snapshot.ts',
      'classify.ts',
      'hash.ts',
      'index.ts',
      'ledger.ts',
      'lint.ts',
      'match.ts',
      'measure.ts',
      'quantities.ts',
      'reach.ts',
      'repeats.ts',
      'schema.ts',
      'shape.ts',
      'structure.ts',
    ]);
  });

  it.each(CORE_FILES)('%s imports only siblings and ../observation/observation', (file) => {
    const source = readFileSync(join(DIR, file), 'utf8');
    const specifiers = [
      ...source.matchAll(/(?:import|export)[^'";]*?from\s*['"]([^'"]+)['"]/g),
    ].map((m) => m[1]);
    const bad = specifiers.filter(
      (s) => s !== '../observation/observation' && !/^\.\/[a-z-]+$/.test(s)
    );
    expect(bad).toEqual([]);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/__SDK_VERSION__/);
  });
});
