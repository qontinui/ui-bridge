#!/usr/bin/env node
/**
 * `create-ui-bridge-wrapper` — scaffold a new UI Bridge wrapper.
 *
 * Usage:
 *   npx create-ui-bridge-wrapper <name>
 *       [--transports api,headless,headed,live]
 *       [--no-ui | --node-only]
 *       [--monorepo]
 *       [--out <dir>]
 *       [--yes | -y]
 *       [--force]
 *
 * See README.md for the full reference.
 */

import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  gatherAnswers,
  parseTransportsFlag,
  type PromptAnswers,
  type TransportKind,
} from './prompts.js';
import { renderTree } from './copy.js';
import { toDisplayName, toPascalCase } from './render.js';
import { depSpecFor } from './dep-specs.js';

interface CliFlags {
  name: string | null;
  transports: TransportKind[] | null;
  noUi: boolean | null;
  monorepo: boolean | null;
  out: string | null;
  yes: boolean;
  force: boolean;
  help: boolean;
}

const USAGE = `create-ui-bridge-wrapper — scaffold a UI Bridge wrapper

Usage:
  npx create-ui-bridge-wrapper <name> [flags]

Flags:
  --transports <list>       api,headless,headed,live (comma-separated)
  --no-ui, --node-only      Emit a plain Node daemon instead of a React UI
  --ui                      Force inclusion of a React UI
  --monorepo                Place in ../../qontinui-wrappers/packages/<name>/
                            with @qontinui scope + workspace:* deps
  --out <dir>               Output directory (default: ./<name>)
  --yes, -y                 Skip prompts; defaults: api-only, no UI
  --force                   Overwrite output dir if non-empty
  --help                    Print this help and exit
`;

export interface RunOptions {
  /** Overrides process.argv.slice(2). */
  argv?: string[];
  /** Overrides process.cwd() — useful for tests. */
  cwd?: string;
  /** Swallow console output (used by tests). */
  silent?: boolean;
}

export interface RunResult {
  outDir: string;
  written: string[];
  answers: PromptAnswers;
}

export async function run(opts: RunOptions = {}): Promise<RunResult> {
  const argv = opts.argv ?? process.argv.slice(2);
  const cwd = opts.cwd ?? process.cwd();
  const flags = parseCliFlags(argv);
  if (flags.help) {
    if (!opts.silent) process.stdout.write(USAGE);
    return {
      outDir: '',
      written: [],
      answers: {
        name: '',
        transports: [],
        includeUi: false,
        monorepo: false,
      },
    };
  }

  const answers = await gatherAnswers({
    nameFromCli: flags.name,
    transportsFromCli: flags.transports,
    includeUiFromCli: flags.noUi === null ? null : !flags.noUi,
    monorepoFromCli: flags.monorepo,
    skipPrompts: flags.yes,
  });

  const outDir = resolveOutDir(answers, flags, cwd);
  await assertOutDirUsable(outDir, flags.force);

  const written = await scaffold(answers, outDir);

  if (!opts.silent) {
    process.stdout.write(
      `\nScaffolded wrapper '${packageNameFor(answers)}' at:\n  ${outDir}\n\n` +
        `Next steps:\n` +
        `  cd ${outDir}\n` +
        `  npm install\n` +
        `  npm run build\n` +
        `  npm test\n`
    );
  }

  return { outDir, written, answers };
}

function parseCliFlags(argv: string[]): CliFlags {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      transports: { type: 'string' },
      'no-ui': { type: 'boolean' },
      'node-only': { type: 'boolean' },
      ui: { type: 'boolean' },
      monorepo: { type: 'boolean' },
      out: { type: 'string' },
      yes: { type: 'boolean', short: 'y' },
      force: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  const name = positionals[0] ?? null;
  if (name !== null && !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    die(`Invalid wrapper name '${name}'. Use kebab-case: lowercase letters, digits, hyphens.`);
  }

  let transports: TransportKind[] | null = null;
  if (typeof values.transports === 'string') {
    try {
      transports = parseTransportsFlag(values.transports);
    } catch (err) {
      die(err instanceof Error ? err.message : String(err));
    }
  }

  let noUi: boolean | null = null;
  if (values['no-ui'] === true || values['node-only'] === true) noUi = true;
  if (values.ui === true) {
    if (noUi === true) die('--ui and --no-ui/--node-only are mutually exclusive');
    noUi = false;
  }

  return {
    name,
    transports,
    noUi,
    monorepo: typeof values.monorepo === 'boolean' ? values.monorepo : null,
    out: typeof values.out === 'string' ? values.out : null,
    yes: values.yes === true,
    force: values.force === true,
    help: values.help === true,
  };
}

function die(msg: string): never {
  process.stderr.write(`${msg}\n\n${USAGE}`);
  process.exit(2);
}

function resolveOutDir(answers: PromptAnswers, flags: CliFlags, cwd: string): string {
  if (flags.out) {
    return isAbsolute(flags.out) ? flags.out : resolve(cwd, flags.out);
  }
  if (answers.monorepo) {
    return resolve(cwd, '..', '..', 'qontinui-wrappers', 'packages', answers.name);
  }
  return resolve(cwd, answers.name);
}

async function assertOutDirUsable(outDir: string, force: boolean): Promise<void> {
  if (!existsSync(outDir)) return;
  const s = await stat(outDir);
  if (!s.isDirectory()) {
    die(`Output path exists and is not a directory: ${outDir}`);
  }
  const entries = await readdir(outDir);
  if (entries.length === 0) return;
  if (!force) {
    die(
      `Output directory is not empty: ${outDir}\n` +
        `Pass --force to overwrite or choose a different --out.`
    );
  }
}

async function scaffold(answers: PromptAnswers, outDir: string): Promise<string[]> {
  const templatesRoot = resolveTemplatesRoot();
  const vars = buildVars(answers);
  const flags = buildFlags(answers);
  const filter = buildFilter(answers);

  const commonWritten = await renderTree({
    sourceDir: join(templatesRoot, '_common'),
    destDir: outDir,
    vars,
    flags,
    filter,
    rename: (rel) => {
      // Node entry template is authored as `src/index-node.ts.tpl`
      // but must ship as `src/index.ts` so the wrapper has a single
      // canonical entry point.
      if (rel === 'src/index-node.ts') return 'src/index.ts';
      return rel;
    },
  });

  // Always-on handlers smoke test.
  const handlersTestWritten = await renderTree({
    sourceDir: templatesRoot,
    destDir: outDir,
    vars,
    flags,
    filter: (rel) => rel === 'test-handlers.test.ts.tpl',
    rename: (rel) => (rel === 'test-handlers.test.ts' ? 'tests/handlers.test.ts' : rel),
  });

  // Per-transport test file (one file per selected transport, placed in
  // `tests/transport-<kind>.test.ts`).
  const perTransportWritten: string[] = [];
  for (const kind of answers.transports) {
    const source = join(templatesRoot, `transport-${kind}.ts.tpl`);
    if (existsSync(source)) {
      const written = await renderTree({
        sourceDir: dirname(source),
        destDir: outDir,
        vars,
        flags,
        filter: (rel) => rel === `transport-${kind}.ts.tpl`,
        rename: (rel) => {
          if (rel === `transport-${kind}.ts`) {
            return `tests/transport-${kind}.test.ts`;
          }
          return rel;
        },
      });
      perTransportWritten.push(...written);
    }
  }

  return [...commonWritten, ...handlersTestWritten, ...perTransportWritten];
}

function buildVars(answers: PromptAnswers): Record<string, string> {
  const packageName = packageNameFor(answers);
  const defaultTransport = answers.transports[0] ?? 'api';
  const runnerUrlField =
    defaultTransport === 'live'
      ? 'runnerUrl: process.env.RUNNER_WS_URL ?? "ws://localhost:1420/ui-bridge/ws",'
      : '';
  return {
    NAME: answers.name,
    PASCAL_NAME: toPascalCase(answers.name),
    DISPLAY_NAME: toDisplayName(answers.name),
    PACKAGE_NAME: packageName,
    DEFAULT_TRANSPORT: defaultTransport,
    RUNNER_URL_FIELD: runnerUrlField,
    WRAPPER_DEP_SPEC: depSpecFor('@qontinui/ui-bridge-wrapper', answers.monorepo),
    UI_BRIDGE_DEP_SPEC: depSpecFor('@qontinui/ui-bridge', answers.monorepo),
    HEADLESS_DEP_SPEC: depSpecFor('@qontinui/ui-bridge-headless', answers.monorepo),
    TRANSPORTS_CSV: answers.transports.join(','),
  };
}

function buildFlags(answers: PromptAnswers): Record<string, boolean> {
  return {
    UI: answers.includeUi,
    NODE: !answers.includeUi,
    MONOREPO: answers.monorepo,
    API: answers.transports.includes('api'),
    HEADLESS: answers.transports.includes('headless'),
    HEADED: answers.transports.includes('headed'),
    LIVE: answers.transports.includes('live'),
    PLAYWRIGHT: answers.transports.includes('headless') || answers.transports.includes('headed'),
    WS_DEP: answers.transports.includes('live') && !answers.includeUi,
    REACT_DEP: answers.includeUi,
  };
}

/**
 * Skip template files that don't belong in this scaffold (e.g. the React
 * entry for `--no-ui`, or the Node entry for UI-mode).
 */
function buildFilter(answers: PromptAnswers): (rel: string) => boolean {
  return (rel) => {
    if (rel === 'src/index.tsx.tpl' && !answers.includeUi) return false;
    if (rel === 'src/index-node.ts.tpl' && answers.includeUi) return false;
    return true;
  };
}

function packageNameFor(answers: PromptAnswers): string {
  const base = answers.name.startsWith('wrapper-') ? answers.name : `wrapper-${answers.name}`;
  return answers.monorepo ? `@qontinui/${base}` : base;
}

/**
 * Templates ship next to the compiled CLI. In dev we run the CLI out of
 * `src/cli.ts`, in prod out of `dist/cli.js` — both paths resolve to the
 * same `templates/` location via `new URL('./templates', import.meta.url)`
 * because tsup places `dist/cli.js` adjacent to a sibling `templates` dir
 * (we copy it in the build script below).
 *
 * During vitest the compiled dist is unnecessary; we walk up to
 * `src/templates` by detecting the `/src/` segment in the current URL.
 */
function resolveTemplatesRoot(): string {
  const here = fileURLToPath(import.meta.url);
  const hereDir = dirname(here);
  // If we're running from src/ (tests / ts-node / vitest), templates are
  // a sibling dir. If we're running from dist/, templates were copied to
  // dist/templates by the postbuild step.
  const srcSibling = join(hereDir, 'templates');
  if (existsSync(srcSibling)) return srcSibling;
  // Fall back to the checked-in source templates.
  const srcFallback = join(hereDir, '..', 'src', 'templates');
  if (existsSync(srcFallback)) return srcFallback;
  throw new Error(
    `Could not locate template directory. Looked at:\n  ${srcSibling}\n  ${srcFallback}`
  );
}

// When invoked directly (not imported), run the CLI.
const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (invokedDirectly) {
  run().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[create-ui-bridge-wrapper] ${msg}\n`);
    process.exit(1);
  });
}
