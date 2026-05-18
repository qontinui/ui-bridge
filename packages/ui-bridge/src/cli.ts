/**
 * `@qontinui/ui-bridge` CLI.
 *
 * Single binary entry point for the package (package.json `bin`). Today it
 * exposes one subcommand:
 *
 *   npx @qontinui/ui-bridge explain <CODE> [--json]
 *
 * `explain` prints the diagnostic catalog entry for a `UB-` code as readable
 * plain text; `--json` prints the raw `codes.json` entry (the exact object
 * from the single source of truth) for agent consumption.
 *
 * Source of truth: the bundled `diagnostics/codes.json` (copied into `dist/`
 * at build time, see tsup.config.ts). When the JSON file cannot be resolved
 * (e.g. running straight from `src/` under a ts loader), it falls back to the
 * generated `DIAGNOSTICS` catalog — same single source, generated from the
 * same `codes.json` by `scripts/gen-diagnostics.ts`.
 *
 * Plan: D:/qontinui-root/plans/2026-05-18-ui-bridge-diagnostic-discipline-plan.md  Phase 2
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIAGNOSTICS } from './diagnostics/codes.generated';
import type { DiagnosticCategory, RecoverySuggestion } from './diagnostics';

interface RawCodeEntry {
  code: string;
  category: DiagnosticCategory;
  description: string;
  commonCauses: string[];
  recoveryTemplate: RecoverySuggestion[];
}

/** Resolve the directory this module is running from (CJS or ESM). */
function moduleDir(): string {
  // tsup emits CJS for the bin; __dirname exists there. Under ESM/ts-loader,
  // fall back to import.meta.url.
  if (typeof __dirname === 'string') return __dirname;
  return dirname(fileURLToPath(import.meta.url));
}

/**
 * Load the closed catalog as `code -> raw entry`.
 *
 * Prefers the bundled `codes.json` (shipped alongside the built CLI in
 * `dist/`, and present at repo root during development). Falls back to the
 * generated `DIAGNOSTICS` record, which is byte-equivalent (same generator,
 * same source) — so `--json` output is identical either way.
 */
function loadCatalog(): Record<string, RawCodeEntry> {
  const here = moduleDir();
  const candidates = [
    // Shipped next to the built CLI (tsup copies it into dist/).
    join(here, 'codes.json'),
    join(here, 'diagnostics', 'codes.json'),
    // Running from packages/ui-bridge/src or dist during development.
    resolve(here, '..', '..', '..', 'diagnostics', 'codes.json'),
    resolve(here, '..', '..', 'diagnostics', 'codes.json'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
          codes: RawCodeEntry[];
        };
        if (Array.isArray(parsed.codes) && parsed.codes.length > 0) {
          const map: Record<string, RawCodeEntry> = {};
          for (const e of parsed.codes) map[e.code] = e;
          return map;
        }
      } catch {
        // fall through to next candidate / generated fallback
      }
    }
  }
  // Fallback: reconstruct raw entries from the generated catalog.
  const map: Record<string, RawCodeEntry> = {};
  for (const code of Object.keys(DIAGNOSTICS)) {
    const e = DIAGNOSTICS[code as keyof typeof DIAGNOSTICS];
    map[code] = {
      code,
      category: e.category,
      description: e.description,
      commonCauses: e.commonCauses,
      recoveryTemplate: e.recoveryTemplate,
    };
  }
  return map;
}

function renderRecovery(r: RecoverySuggestion): string {
  const meta: string[] = [];
  if (r.command !== undefined) meta.push(`command: \`${r.command}\``);
  meta.push(`confidence: ${r.confidence}`);
  meta.push(`retryable: ${r.retryable ? 'yes' : 'no'}`);
  if (r.priority !== undefined) meta.push(`priority: ${r.priority}`);
  return `  - ${r.suggestion}\n      (${meta.join(', ')})`;
}

function renderPlainText(entry: RawCodeEntry): string {
  const lines: string[] = [];
  lines.push(entry.code);
  lines.push('='.repeat(entry.code.length));
  lines.push('');
  lines.push(`Category: ${entry.category}`);
  lines.push('');
  lines.push(entry.description);
  lines.push('');
  lines.push('Common causes:');
  for (const c of entry.commonCauses) lines.push(`  - ${c}`);
  lines.push('');
  lines.push('Recovery template:');
  if (entry.recoveryTemplate.length === 0) {
    lines.push('  (none)');
  } else {
    for (const r of entry.recoveryTemplate) lines.push(renderRecovery(r));
  }
  return lines.join('\n');
}

function categoriesOf(catalog: Record<string, RawCodeEntry>): string[] {
  return [...new Set(Object.values(catalog).map((e) => e.category))].sort();
}

const USAGE = `Usage: ui-bridge explain <CODE> [--json]

  explain <CODE>          Print the diagnostic catalog entry for a UB- code.
  explain <CODE> --json   Print the raw codes.json entry (for agents).`;

/**
 * Run the CLI. Returns the desired process exit code (0 = ok).
 * Side effects (stdout/stderr) are kept here so the function is testable.
 */
export function runCli(argv: string[]): number {
  const args = argv.slice();
  const command = args.shift();

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return command ? 0 : 1;
  }

  if (command !== 'explain') {
    process.stderr.write(`Unknown command: ${command}\n${USAGE}\n`);
    return 1;
  }

  const json = args.includes('--json');
  const positional = args.filter((a) => !a.startsWith('--'));
  const code = positional[0];

  if (!code) {
    process.stderr.write(`explain: missing <CODE>\n${USAGE}\n`);
    return 1;
  }

  const catalog = loadCatalog();
  const entry = catalog[code];

  if (!entry) {
    const cats = categoriesOf(catalog);
    process.stderr.write(
      `Unknown diagnostic code: ${code}\n` +
        `Valid categories: ${cats.join(', ')}\n` +
        `Run \`ui-bridge explain <CODE>\` with a UB- code from the catalog ` +
        `(see packages/ui-bridge/docs/diagnostics.md or GET /diagnostics).\n`
    );
    return 1;
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(entry, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderPlainText(entry)}\n`);
  }
  return 0;
}

// Execute only when run as a script (not when imported by tests).
// tsup emits CJS for the bin entry, so `require.main === module` is the
// reliable guard.
declare const require: NodeRequire | undefined;
declare const module: NodeModule | undefined;
const isMain =
  typeof require !== 'undefined' &&
  typeof module !== 'undefined' &&
  require.main === module;

if (isMain) {
  process.exit(runCli(process.argv.slice(2)));
}
