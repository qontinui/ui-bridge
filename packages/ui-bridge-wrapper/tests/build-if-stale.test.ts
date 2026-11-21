import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { staleReason } from '../../../test-support/build-if-stale.mjs';

/**
 * The staleness rule in test-support/build-if-stale.mjs, against throwaway
 * packages in os.tmpdir() whose mtimes are set with utimesSync. Every case
 * first asserts the opposite verdict, so each one fails if the rule stops
 * telling the two states apart.
 */

const T0 = Date.now() / 1000 - 3_600;
/** Seconds after T0: inputs at +0, outputs at +60, edits at +120. */
const at = (path: string, offset: number) => utimesSync(path, T0 + offset, T0 + offset);

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A package whose inputs are all at +0 and whose one output is at +60: fresh. */
function fakePackage(): string {
  const dir = mkdtempSync(join(tmpdir(), 'build-if-stale-'));
  made.push(dir);
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, 'dist'));
  const inputs = ['package.json', 'tsconfig.json', 'tsconfig.build.json', 'tsup.config.ts'];
  for (const name of inputs) writeFileSync(join(dir, name), '{}');
  writeFileSync(join(dir, 'src', 'index.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'src', 'index.test.ts'), '// a test\n');
  for (const name of inputs) at(join(dir, name), 0);
  at(join(dir, 'src', 'index.ts'), 0);
  at(join(dir, 'src', 'index.test.ts'), 0);
  writeFileSync(join(dir, 'dist', 'index.js'), 'built');
  at(join(dir, 'dist', 'index.js'), 60);
  return dir;
}

const step = (dir: string, inlines: string[] = []) => ({
  dir,
  outputs: ['dist/index.js'],
  inlines,
});

describe('staleReason (test-support/build-if-stale.mjs)', () => {
  it('a missing required output is stale', () => {
    const dir = fakePackage();
    expect(staleReason(step(dir))).toBeNull();
    expect(staleReason({ dir, outputs: ['dist/index.js', 'dist/index.cjs'] })).toMatch(
      /dist\/index\.cjs is missing/
    );
  });

  it('a source input newer than the oldest output is stale', () => {
    const dir = fakePackage();
    writeFileSync(join(dir, 'dist', 'index.cjs'), 'built');
    at(join(dir, 'dist', 'index.cjs'), 90);
    const both = { dir, outputs: ['dist/index.js', 'dist/index.cjs'] };
    at(join(dir, 'src', 'index.ts'), 75); // newer than index.js (+60), older than index.cjs (+90)
    expect(staleReason({ dir, outputs: ['dist/index.cjs'] })).toBeNull();
    expect(staleReason(both)).toMatch(/newer than its oldest output/);
  });

  it('an edited test file is not a build input', () => {
    const dir = fakePackage();
    at(join(dir, 'src', 'index.test.ts'), 120);
    expect(staleReason(step(dir))).toBeNull();
    at(join(dir, 'src', 'index.ts'), 120);
    expect(staleReason(step(dir))).toMatch(/newer than its oldest output/);
  });

  it('a newer input of an inlined package is stale', () => {
    const dir = fakePackage();
    const inlined = fakePackage();
    at(join(inlined, 'src', 'index.ts'), 120);
    expect(staleReason(step(dir))).toBeNull();
    expect(staleReason(step(dir, [inlined]))).toMatch(/newer than its oldest output/);
  });

  it('a tsconfig.json edit is stale', () => {
    const dir = fakePackage();
    expect(staleReason(step(dir))).toBeNull();
    at(join(dir, 'tsconfig.json'), 120);
    expect(staleReason(step(dir))).toMatch(/newer than its oldest output/);
  });
});
