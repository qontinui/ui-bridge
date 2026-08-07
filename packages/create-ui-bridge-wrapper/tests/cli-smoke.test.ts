import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { run } from '../src/cli.js';
import { REGISTRY_DEP_SPECS, WORKSPACE_DEP_SPEC } from '../src/dep-specs.js';

const cleanup: string[] = [];

afterAll(async () => {
  for (const dir of cleanup) {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

async function scaffoldInto(
  subdir: string,
  argv: string[]
): Promise<{ outDir: string; written: string[] }> {
  const tmp = await mkdtemp(join(tmpdir(), 'create-ui-bridge-wrapper-'));
  cleanup.push(tmp);
  const outDir = join(tmp, subdir);
  const result = await run({
    argv: [...argv, '--out', outDir, '--yes'],
    cwd: tmp,
    silent: true,
  });
  return { outDir: result.outDir, written: result.written };
}

describe('create-ui-bridge-wrapper CLI', () => {
  it('scaffolds an api + node-only wrapper', async () => {
    const { outDir, written } = await scaffoldInto('my-api', ['my-api', '--transports', 'api']);

    expect(outDir.endsWith('my-api')).toBe(true);
    // Expected files present.
    const mustExist = [
      'package.json',
      'tsconfig.json',
      'tsconfig.build.json',
      'tsup.config.ts',
      'vitest.config.ts',
      '.gitignore',
      'README.md',
      'src/index.ts',
      'src/handlers.ts',
      'src/actions/hello.ts',
      'tests/handlers.test.ts',
      'tests/transport-api.test.ts',
    ];
    for (const rel of mustExist) {
      const abs = join(outDir, rel);
      expect(existsSync(abs), `expected ${rel}`).toBe(true);
    }
    // No React entry for --no-ui mode.
    expect(existsSync(join(outDir, 'src/index.tsx'))).toBe(false);

    // Every file we wrote is inside the output dir.
    for (const abs of written) {
      expect(abs.startsWith(outDir)).toBe(true);
    }
  });

  it('produces a valid package.json with the right name and deps', async () => {
    const { outDir } = await scaffoldInto('my-api-pkg', ['my-api-pkg', '--transports', 'api']);

    const pkgRaw = await readFile(join(outDir, 'package.json'), 'utf8');
    // Must be valid JSON.
    const pkg = JSON.parse(pkgRaw) as {
      name: string;
      peerDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    expect(pkg.name).toBe('wrapper-my-api-pkg');
    expect(pkg.peerDependencies).toBeDefined();
    // The specs are declared once in src/dep-specs.ts and kept honest against
    // the live workspace versions by tests/dep-specs.test.ts. Asserting the
    // rendered output here is what proves the template actually reaches them —
    // `toBeDefined()` alone passed for the whole time all three were `^0.1.0`.
    expect(pkg.peerDependencies!['@qontinui/ui-bridge']).toBe(
      REGISTRY_DEP_SPECS['@qontinui/ui-bridge']
    );
    expect(pkg.peerDependencies!['@qontinui/ui-bridge-wrapper']).toBe(
      REGISTRY_DEP_SPECS['@qontinui/ui-bridge-wrapper']
    );
    // api-only + --no-ui: no `ws`, no `@qontinui/ui-bridge-headless`.
    expect(pkg.dependencies?.['ws']).toBeUndefined();
    expect(pkg.dependencies?.['@qontinui/ui-bridge-headless']).toBeUndefined();
  });

  it('keeps wrapper- prefix when name already starts with wrapper-', async () => {
    const { outDir } = await scaffoldInto('wrapper-prefixed', [
      'wrapper-prefixed',
      '--transports',
      'api',
    ]);
    const pkg = JSON.parse(await readFile(join(outDir, 'package.json'), 'utf8')) as {
      name: string;
    };
    expect(pkg.name).toBe('wrapper-prefixed');
  });

  it('emits ws dep and WebSocket shim for node + live', async () => {
    const { outDir } = await scaffoldInto('my-live', ['my-live', '--transports', 'live']);
    const pkgRaw = await readFile(join(outDir, 'package.json'), 'utf8');
    const pkg = JSON.parse(pkgRaw) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.['ws']).toBeDefined();

    const entry = await readFile(join(outDir, 'src/index.ts'), 'utf8');
    expect(entry).toContain("import WebSocketCtor from 'ws'");
    expect(entry).toContain('webSocketCtor: WebSocketCtor');
    expect(entry).toContain("kind: 'live'");
    expect(entry).toContain('runnerUrl');
  });

  it('emits a React entry + @qontinui/ui-bridge-headless dep when --ui + headless', async () => {
    const { outDir } = await scaffoldInto('my-ui', [
      'my-ui',
      '--transports',
      'headless,api',
      '--ui',
    ]);

    // React entry present, Node entry absent.
    expect(existsSync(join(outDir, 'src/index.tsx'))).toBe(true);
    expect(existsSync(join(outDir, 'src/index.ts'))).toBe(false);

    const pkg = JSON.parse(await readFile(join(outDir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.['@qontinui/ui-bridge-headless']).toBe(
      REGISTRY_DEP_SPECS['@qontinui/ui-bridge-headless']
    );
    expect(pkg.peerDependencies?.['react']).toBeDefined();

    const entry = await readFile(join(outDir, 'src/index.tsx'), 'utf8');
    expect(entry).toContain('WrapperAppShell');
    expect(entry).toContain('useUIComponent');
    expect(entry).toContain('MyUiWrapper');
  });

  it('multi-transport scaffold emits a test file per transport', async () => {
    const { outDir } = await scaffoldInto('my-multi', [
      'my-multi',
      '--transports',
      'api,headless,live',
    ]);
    expect(existsSync(join(outDir, 'tests/transport-api.test.ts'))).toBe(true);
    expect(existsSync(join(outDir, 'tests/transport-headless.test.ts'))).toBe(true);
    expect(existsSync(join(outDir, 'tests/transport-live.test.ts'))).toBe(true);
    expect(existsSync(join(outDir, 'tests/transport-headed.test.ts'))).toBe(false);
  });

  it('refuses to overwrite a non-empty output dir without --force', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'create-ui-bridge-wrapper-'));
    cleanup.push(tmp);
    const out = join(tmp, 'collide');
    // First run succeeds.
    await run({
      argv: ['collide', '--transports', 'api', '--yes', '--out', out],
      cwd: tmp,
      silent: true,
    });
    // Second run bails (process.exit(2)) — mock exit.
    const origExit = process.exit;
    let exitCode: number | undefined;
    (process as { exit: (code?: number) => never }).exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`__exit_${code}`);
    }) as typeof process.exit;
    try {
      await expect(
        run({
          argv: ['collide', '--transports', 'api', '--yes', '--out', out],
          cwd: tmp,
          silent: true,
        })
      ).rejects.toThrow(/__exit_2/);
      expect(exitCode).toBe(2);
    } finally {
      process.exit = origExit;
    }
  });

  it('--monorepo produces @qontinui/ scope + workspace:* deps', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'create-ui-bridge-wrapper-'));
    cleanup.push(tmp);
    const out = join(tmp, 'mono-pkg');
    await run({
      argv: ['mono-pkg', '--transports', 'api', '--monorepo', '--yes', '--out', out],
      cwd: tmp,
      silent: true,
    });
    const pkg = JSON.parse(await readFile(join(out, 'package.json'), 'utf8')) as {
      name: string;
      peerDependencies?: Record<string, string>;
    };
    expect(pkg.name).toBe('@qontinui/wrapper-mono-pkg');
    expect(pkg.peerDependencies!['@qontinui/ui-bridge-wrapper']).toBe(WORKSPACE_DEP_SPEC);
  });

  it('outDir stat is a real directory', async () => {
    const { outDir } = await scaffoldInto('exists', ['exists', '--transports', 'api']);
    const s = await stat(outDir);
    expect(s.isDirectory()).toBe(true);
  });
});
